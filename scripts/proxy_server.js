const http = require('http');
const https = require('https')
const url = require('url');
const fs = require('fs')
const path = require('path')
const cron = require('node-cron');
const fetch = require('node-fetch');
const datamall_proxy = require('./datamall_proxy');
const {fetch_datamall, fetch_busrouter} = require('./repository_proxy');
const {auto_import_datamall, auto_import_busrouter} = require('./auto_import');
const {run_handler, force_refresh} = require('./drive_api_handler');
const root = 'C:/R Projects/Websites/Bus-Route-Demand-Visualiser/data/storage';
// const {proxy_port} = require('../config.js')
const cors_headers = {
  "Access-Control-Allow-Origin": "*", // CORS stuff
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const heatmap_folder = path.join(__dirname, 'tmp', 'heatmap');
fs.mkdirSync(heatmap_folder, { recursive: true });
const https_options = {
  key: fs.readFileSync(path.resolve(`${root}/cert/private.key`)),
  cert: fs.readFileSync(path.resolve(`${root}/cert/fullchain.pem`))
};
async function request_handler(req, res) {
  const { pathname, query } = url.parse(req.url, true);
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors_headers);
    return res.end();
  }
  try {
    if (pathname === '/datamall-proxy') {
      await datamall_endpoint(req, res, query);
    } else if (pathname === '/repository/datamall') {
      await repo_datamall_endpoint(res, query);
    } else if (pathname === '/repository/busrouter') {
      await repo_busrouter_endpoint(res, query);
    } else if (pathname === '/data/discord') {
      await discord_data_endpoint(res, query);
    } else if (pathname === '/data/heatmap') {
      await discord_heatmap_endpoint(res, query);
    } else if (req.url.startsWith('/.well-known/pki-validation/')) {
      await post_ssl_verf_file(res, pathname);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain", ...cors_headers });
      res.end('Not found');
    }
  } catch (err) {
    console.error('[Server] Uncaught error', err);
    res.writeHead(500, { "Content-Type": "text/plain", ...cors_headers });
    res.end('Internal server error');
  }
}

(async function main() {
  // Refresh Drive API token after server starts
  await run_handler();

  // Task scheduling
  // Schedule the Datamall fetch to run 5 mins after midnight on the 10th of every month
  cron.schedule('5 0 10 * *', () => {
    console.log("Auto-importing from Datamall started.");
    auto_import_datamall();
  });
  // Schedule the BusRouter fetch to run 5 mins after midnight on the 2nd of every month
  cron.schedule('5 0 2 * *', () => {
    console.log("Auto-importing from BusRouter started.");
    auto_import_busrouter();
  });
  // Schedule a Drive API token refresh at 00:00 on day 1 of every 4th month
  cron.schedule('0 0 1 */4 *', () => {
    console.log('Quarterly token refresh in progress...');
    force_refresh().catch(console.error);
  });

  // Create & start HTTP server
  const http_server = http.createServer(async (req, res) => {
    const host = req.headers.host;
    res.writeHead(301, { Location: `https://${host}${req.url}`, ...cors_headers });
    res.end();
  });
  http_server.listen(80, '0.0.0.0', () => {
    console.log(`Datamall proxy server listening on HTTP port 80`);
  });

  // Create & start HTTPS server
  const https_server = https.createServer(https_options, request_handler)
  https_server.listen(443, '0.0.0.0', () => {
    console.log(`Datamall proxy server listening on HTTPS port 443`);
  });
})();

async function post_ssl_verf_file(res, pathname) {
  try {
    const base_dir = path.resolve(root, '.well-known/pki-validation');
    const file_path = path.resolve(root, '.' + pathname);
    if (!file_path.toLowerCase().startsWith((base_dir + path.sep).toLowerCase())) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Forbidden');
    }
    const content = fs.readFileSync(file_path, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(content);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`Not found: Error: ${err}`);
  }
}

// Expose different endpoints for the proxies
async function datamall_endpoint(req, res, query) {
  const event = {httpMethod: req.method, queryStringParameters: query};
  try {
    const result = await datamall_proxy.handler(event);
    res.writeHead(result.statusCode, { ...result.headers, ...cors_headers });
    res.end(result.body);
  } catch (error) {
    console.error('Error handling request:', error);
    res.writeHead(500, { "Content-Type": "text/plain", ...cors_headers});
    res.end("Internal server error");
  }
}

async function repo_datamall_endpoint(res, query) {
  const { datamall_date, data_type, data_type2 } = query;
  try {
    var datamall_data = await fetch_datamall(datamall_date, data_type, data_type2);
    res.writeHead(datamall_data.statusCode, { ...datamall_data.headers, ...cors_headers });
    res.end(datamall_data.body);
  } catch (error) {
    console.error("Error fetching Datamall data from repository:", error);
    res.writeHead(500, { "Content-Type": "text/plain", ...cors_headers });
    res.end("Internal server error");
  }
}

async function repo_busrouter_endpoint(res, query) {
  const { busrouter_date, data_type } = query;
  try {
    // Fetches BusRouter or MRT line and station data from Google Drive based on the date parameters
    var json_data = await fetch_busrouter(busrouter_date, data_type);
    res.writeHead(200, { "Content-Type": "application/json", ...cors_headers });
    res.end(JSON.stringify(json_data));
  } catch (error) {
    console.error("Error fetching BusRouter data from repository:", error);
    res.writeHead(500, { "Content-Type": "text/plain", ...cors_headers });
    res.end("Internal server error");
  }
}

async function discord_data_endpoint(res, query) {
  const {
    datamall_date,
    datamall_data_source,
    busrouter_date,
    data_type,
    busrouter_data_source
  } = query;

  // Build two tasks in parallel
  const tasks = [];

  // 1. Datamall fetch
  if (!['bus','train'].includes(data_type)) {
    throw new Error(`invalid data type: ${data_type}`);
  }
  if (datamall_data_source === 'datamall') {
    tasks.push(
      datamall_proxy.handler(
        { httpMethod: 'GET', queryStringParameters: query },
        {}
      ).then(r => {
        // proxy returns {statusCode, headers, body}
        if (r.statusCode !== 200) 
          throw new Error(`proxy error ${r.statusCode}`);
        return r.body; // raw CSV string
      })
    );
  } else {
    tasks.push(
      fetch_datamall(datamall_date, data_type)
        .then(r => {
          if (r.statusCode !== 200) 
            throw new Error(`datamall fetch error ${r.statusCode}`);
          return r.body;
        })
    );
  }

  // 2) BusRouter fetch
  if (busrouter_data_source === 'busrouter') {
    // Direct public endpoints
    tasks.push(
      Promise.all([
        fetch('https://data.busrouter.sg/v1/services.json'),
        fetch('https://data.busrouter.sg/v1/stops.json')
      ]).then(async ([svc, stops]) => {
        if (!svc.ok || !stops.ok) throw new Error('busrouter HTTP error');
        return {
          data2: await svc.json(),
          data3: await stops.json()
        };
      })
    );
  } else {
    tasks.push(
      fetch_busrouter(busrouter_date, data_type)
    );
  }

  // Await both
  let datamall_data, busrouter_data;
  try {
    [ datamall_data, busrouter_data ] = await Promise.all(tasks);
  } catch (err) {
    console.error('[/data/discord] parallel fetch error', err);
    res.writeHead(500, { "Content-Type": "text/plain", ...cors_headers });
    return res.end('Internal server error');
  }

  // Package everything into JSON
  const payload = {
    datamall: datamall_data,          // CSV string
    busrouter:  busrouter_data        // JSON object
  };

  const body = JSON.stringify(payload);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...cors_headers
  });
  return res.end(body);
}

async function discord_heatmap_endpoint(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { ...cors_headers, 'Allow': 'POST' });
    return res.end();
  }

  // 1. Collect JSON body
  let buf = '';
  req.on('data', chunk => buf += chunk);
  req.on('end', async () => {
    let body;
    try {
      body = JSON.parse(buf);
    } catch (e) {
      res.writeHead(400, { ...cors_headers, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
    }

    const { session_id, image /* dataURI */, width, height, alt } = body;
    if (!session_id || !image) {
      res.writeHead(400, { ...cors_headers, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'error', message: 'Missing sessionId or image' }));
    }

    // 2. Decode & save the PNG
    const base64 = image.replace(/^data:image\/\w+;base64,/, '');
    const image_name = `${session_id}.png`;
    const image_path = path.join(heatmap_folder, image_name);
    try {
      fs.writeFileSync(image_path, Buffer.from(base64, 'base64'));
    } catch (err) {
      console.error('Failed writing heatmap PNG:', err);
      res.writeHead(500, { ...cors_headers, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'error', message: 'File write failed' }));
    }

    // 3. Build the public URL
    const image_url = `https://stcraft.myddns.me/data/heatmap/${image_name}`;

    // 4. Notify your bot process via its internal webhook
    try {
      await fetch('https://stcraft.myddns.me/discord/heatmap', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ session_id, image_url, width, height, alt })
      });
    } catch (err) {
      console.error('Error calling bot callback:', err);
      // we’ll still reply 200 to R-app, but your bot will log an error
    }

    // 5) respond to the R-app
    res.writeHead(200, { ...cors_headers, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'success', url: image_url }));
  });
}