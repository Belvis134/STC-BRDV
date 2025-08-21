const { default: fetch } = require('node-fetch');
const unzipper = require('unzipper');

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
  const {date, account_key, data_type, data_type2} = event.queryStringParameters;

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
  }

  console.log("Datamall URL:", datamall_url);
  console.log("Using AccountKey:", account_key);

  try {
    // --- Step 1: Fetch JSON data from Datamall ---
    const response = await fetch(datamall_url, {
      method: "GET",
      headers: {
        'AccountKey': account_key,
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
    console.log("Extracted CSV link:", link);

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
    // Instead of reading the entire ZIP into memory, we do it chunk by chunk with unzipper.Parse().
    return new Promise((resolve, reject) => {
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
};