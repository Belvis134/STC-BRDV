const { default: fetch } = require('node-fetch');
const unzipper = require('unzipper');
const {datamall_api_key_1, datamall_api_key_2} = require('../config.js')

exports.handler = async function (event) {
  // Handle preflight OPTIONS request
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
      },
      body: ""
    };
  }

  // Extract query parameters
  const {date, account_key, data_type, data_type2, format} = event.queryStringParameters;

  // Construct the Datamall URL
  if (data_type === "origin_destination") {
    if (data_type2 === "bus") {
      var datamall_url = `https://datamall2.mytransport.sg/ltaodataservice/PV/ODBus?Date=${date}`
    } else if (data_type2 === "train") {
      var datamall_url = `https://datamall2.mytransport.sg/ltaodataservice/PV/ODTrain?Date=${date}`
    }
  } else if (data_type === "specific_stop") {
    if (data_type2 === "bus") {
      var datamall_url = `https://datamall2.mytransport.sg/ltaodataservice/PV/Bus?Date=${date}`;
    } else if (data_type2 === "train") {
      var datamall_url = `https://datamall2.mytransport.sg/ltaodataservice/PV/Train?Date=${date}`;
    }
  } else if (data_type === "routes") {
    if (data_type2 === "bus") {
      var datamall_url = `https://datamall2.mytransport.sg/ltaodataservice/BusRoutes`
    }
  }

  // Account Key processing
  if (account_key === 'default_key_1') {var input_account_key = datamall_api_key_1}
  else if (account_key === 'default_key_2') {var input_account_key = datamall_api_key_2}
  else {var input_account_key = account_key}

  console.log("Datamall URL:", datamall_url);
  console.log("Using AccountKey:", input_account_key);

  if (["origin_destination", "specific_stop"].includes(data_type)) {
    try {
      // --- Step 1: Fetch JSON data from Datamall ---
      const response = await fetch(datamall_url, {
        method: "GET",
        headers: {
          'AccountKey': input_account_key,
          'accept': 'application/json'
        }
      });

      if (!response.ok) {
        const error_text = await response.text();
        let error_json = null;
        try {
          error_json = JSON.parse(error_text);
        } catch (e) {}
        if (response.status === 404) {
          if (error_text.trim() === "The requested API was not found") {
            return {
              statusCode: 404,
              headers: { "Access-Control-Allow-Origin": "*" },
              body: JSON.stringify({ error: "Invalid account key... Huh?!" })
            };
          } else if (error_text.trim() === "") {
            return {
              statusCode: 404,
              headers: { "Access-Control-Allow-Origin": "*" },
              body: JSON.stringify({ error: "No data found for the given date. Is your provided date within the last 3 months?" })
            };
          }
        } else if (error_json && error_json.fault) {
          return {
            statusCode: 429,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ error: "You have reached the rate limit. Try again after a while." })
          };
        }
      }

      // --- Step 2: Parse JSON data ---
      const json_data = await response.json();

      // --- Step 3: Extract the CSV link from the JSON ---
      const link = json_data.value[0].Link;

      // --- Step 4: Fetch the ZIP file ---
      const link_response = await fetch(link);
      if (!link_response.ok) {
        return {
          statusCode: link_response.status,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ error: "Failed to fetch the ZIP file from S3." })
        };
      }

      // --- Step 5: Stream and unzip the CSV file ---
      // For the raw ZIP content.
      if (format === 'zip') {
        console.log('Requested to Datamall proxy to send in ZIP format.');
        
        const array_buffer = await link_response.arrayBuffer();
        const zip_buffer = Buffer.from(array_buffer);
        
        return {
          statusCode: 200,
          isBase64Encoded: false,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/zip",
            "Content-Disposition": "attachment; filename=datamall_csv.zip"
          },
          body: zip_buffer // Send raw buffer directly
        };
      }

      // Instead of reading the entire ZIP into memory, we do it chunk by chunk with unzipper.Parse().

      return new Promise((resolve, reject) => {
        console.log('Requested to Datamall proxy to send in CSV format.')
        let csv_found = false;

        link_response.body
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
              // If somehow, no CSV file was found...
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
      console.error('Error in datamall_proxy:', error);
      return {
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: error.message })
      };
    }
  } else if (data_type === "routes") {
    try {
      let existing_data = {};
      let new_data = [{this_is: "a_placeholder"}];
      let skip = 0;
      console.log('Compiling bus route info.')
      while(new_data.length > 0) {
        const res = await fetch(`https://datamall2.mytransport.sg/ltaodataservice/BusRoutes?$skip=${500*skip}`, {
          method: "GET",
          headers: {
            AccountKey: input_account_key,
            accept: 'application/json'
          }
        });
        const raw = await res.json()
        new_data = raw.value
        for (data of new_data) {
          const svc = data.ServiceNo;
          const dir = data.Direction;
          const stop_seq = data.StopSequence;
          const dist = data.Distance;
          const stop_code = data.BusStopCode;
          if (!existing_data[svc]) {existing_data[svc] = {}};
          if (!existing_data[svc][dir]) {existing_data[svc][dir] = []};
          existing_data[svc][dir].push([stop_seq, stop_code, dist])
        };
        skip++;
      };
      console.log(`Bus route info compile complete. Maximum skip reached is ${skip-1}*500.`);
      return {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(existing_data)
      }
    } catch (error) {
      console.error('Error in datamall_proxy:', error);
      return {
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: error.message })
      };
    }
  } else if (data_type === 'services') {
    try {
      let existing_data = {};
      let new_data = [{this_is: "a_placeholder"}];
      let skip = 0;
      console.log('Compiling bus service info.')
      while(new_data.length > 0) {
        const res = await fetch(`https://datamall2.mytransport.sg/ltaodataservice/BusServices?$skip=${500*skip}`, {
          method: "GET",
          headers: {
            AccountKey: input_account_key,
            accept: 'application/json'
          }
        });
        const raw = await res.json()
        new_data = raw.value
        for (data of new_data) {
          const svc = data.ServiceNo;
          const dir = data.Direction;
          const category = data.Category;
          const am_peak = data.AM_Peak_Freq;
          const am_off_peak = data.AM_Offpeak_Freq;
          const pm_peak = data.PM_Peak_Freq;
          const pm_off_peak = data.PM_Offpeak_Freq;
          if (!existing_data[svc]) {existing_data[svc] = {}};
          if (!existing_data[svc].category) {existing_data[svc].category = category}
          if (!existing_data[svc][dir]) {existing_data[svc][dir] = []};
          existing_data[svc][dir].push([am_peak, am_off_peak, pm_peak, pm_off_peak])
        };
        skip++;
      };
      console.log(`Bus services info compile complete. Maximum skip reached is ${skip-1}*500.`);
      return {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(existing_data)
      }
    } catch (error) {
      console.error('Error in datamall_proxy:', error);
      return {
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: error.message })
      };
    }
  }
};