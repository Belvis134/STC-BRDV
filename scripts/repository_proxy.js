const {default: fetch} = require('node-fetch');
const {drive} = require('./drive_api_handler.js');
const unzipper = require('unzipper')
const {registry_file_id} = require('../config.js');

async function load_registry() {
  try {
    // Request the registry file content by its file ID.
    const res = await drive.files.get(
      { fileId: registry_file_id, alt: 'media' },
      { responseType: 'stream' }
    );
    let data = '';
    await new Promise((resolve, reject) => {
      res.data.on('data', (chunk) => data += chunk.toString('utf8'));
      res.data.on('end', resolve);
      res.data.on('error', reject);
    });
    return JSON.parse(data);
  } catch (error) {
    throw new Error('Failed to load registry from Google Drive: ' + error.message);
  }
}

// Fetch Datamall data from repository
// Not using a download link for Datamall, instead using Google Drive API
async function fetch_datamall(datamall_date, data_type, data_type2) {
  const registry = await load_registry();
  const data_type_names = {'origin_destination': 'origin_destination', 'specific_stop': 'transport_node'}
  if (data_type === "origin_destination") {
    var datamall_file_id = registry.datamall.origin_destination[data_type2][`origin_destination_${data_type2}_` + datamall_date + '.zip']
  } else if (data_type === "specific_stop") {
    var datamall_file_id = registry.datamall.transport_node[data_type2][`transport_node_${data_type2}_` + datamall_date + '.zip']
  }
  try {
    const drive_response = await drive.files.get(
      { fileId: datamall_file_id, alt: 'media' },
      { responseType: 'stream' }
    );
    console.log(`ZIP file found for ${data_type_names[data_type]}_${data_type2} for ${datamall_date}.`)
    return await new Promise((resolve, reject) => {
      let csv_found = false;
      drive_response.data
        .pipe(unzipper.Parse())
        .on('entry', entry => {
          const file_name = entry.path;
          if (file_name.endsWith('.csv')) {
            csv_found = true;
            let csv_data = '';
            entry.on('data', chunk => {
              csv_data += chunk.toString('utf8');
            });
            entry.on('end', () => {
              resolve({
                statusCode: 200,
                headers: {
                  "Access-Control-Allow-Origin": "*",
                  "Content-Type": "text/csv"
                },
                body: csv_data
              });
            });
          } else {
            entry.autodrain();
          }
        })
        .on('close', () => {
          if (!csv_found) {
            resolve({
              statusCode: 500,
              headers: { "Access-Control-Allow-Origin": "*" },
              body: JSON.stringify({ error: "No CSV file found in ZIP... Huh?!" })
            });
          }
        })
        .on('error', error => {
          console.error('Stream error:', error);
          reject({
            statusCode: 500,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ error: error.message })
          });
        });
    });
  } catch (error) {
    console.error(`Error fetching Datamall data for ${datamall_date}:`, error);
    throw new Error(`There seems to be no Datamall data on the repository for ${datamall_date}: ${error}...`);
  }
}

// Fetch BusRouter data from repository
async function fetch_busrouter(busrouter_date, data_type) {
  try {
    const registry = await load_registry();
    const repo_json_urls = data_type === "bus" 
    ? [
      "https://drive.google.com/uc?export=download&id=" + registry.busrouter.services['services_' + busrouter_date + '.json'],
      "https://drive.google.com/uc?export=download&id=" + registry.busrouter.stops['stops_' + busrouter_date + '.json']
      ]
    : [
      "https://drive.google.com/uc?export=download&id=" + registry.train.stations['stations.json'],
      "https://drive.google.com/uc?export=download&id=" + registry.train.names['station_names.json']
      ]
    ;
    console.log(`Using the following repository links:\n${(data_type === "bus") ? "BusRouter bus services:" : "MRT lines"} ${repo_json_urls[0]}\n${(data_type === "bus") ? "BusRouter bus stops:" : "MRT station names:"} ${repo_json_urls[1]}`)
    
    let busrouter_data;
    try {
      busrouter_data = await Promise.all(
        repo_json_urls.map(async (url) => {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`There seems to be no ${(data_type === "bus") ? "BusRouter" : "MRT lines and station names"} data on the repository for ${busrouter_date}: ${res.statusText}...`);
        }
        return res.json();
        })
      );
      busrouter_data = {
        data2: busrouter_data[0],
        data3: busrouter_data[1]
      };
    } catch (e) {
      busrouter_data = { error: e.message };
    }
    console.log(`${(data_type === "bus") ? "BusRouter" : "MRT lines and station names"} fetch from repository successful.`)
    return busrouter_data;
    
  } catch (error) {
    // Fallback error in case something unexpected happened
    throw new Error("Repository fetching error: " + error.message);
  }
}

module.exports = {fetch_datamall, fetch_busrouter};