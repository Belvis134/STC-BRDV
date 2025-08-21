const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const {drive_client_id, drive_client_secret, drive_redirect_URI, drive_token_path} = require('../config.js');
const token_file = path.resolve(drive_token_path);

// 1. Init OAuth2 client
const OAuth2_client = new google.auth.OAuth2(drive_client_id, drive_client_secret, drive_redirect_URI);

// 2. Read & set only the refresh token
function load_refresh_token() {
  if (!fs.existsSync(token_file)) {
    console.error('drive_auth.js is invalid, please redo OAuth flow.');
    process.exit(1);
  }
  const { refresh_token } = JSON.parse(fs.readFileSync(token_file, 'utf8'));
  OAuth2_client.setCredentials({ refresh_token });
	console.log("Drive authentication successful!")
}

// 3. On any refresh, write full credentials (AT + RT) back
OAuth2_client.on('tokens', (tokens) => {
  const saved = fs.existsSync(token_file)
    ? JSON.parse(fs.readFileSync(token_file, 'utf8'))
    : {};
  const updated = {
    ...saved,
    access_token: tokens.access_token || saved.access_token,
    expiry_date: tokens.expiry_date || saved.expiry_date,
    refresh_token: tokens.refresh_token || saved.refresh_token,
  };
  fs.writeFileSync(token_file, JSON.stringify(updated, null, 2));
  console.log('Token updated for ', token_file);
});

// 4. Force-refresh function
async function force_refresh() {
  try {
    // Using refreshAccessToken ensures we hit the token endpoint each time
    const { credentials } = await OAuth2_client.refreshAccessToken();
    console.log(`Forced token refresh with new expiry date: ${credentials.expiry_date}`);
    return credentials;
  } catch (err) {
    console.error('Error refreshing token:', err);
    throw err;
  }
}

// 5. Bootstrap: load RT and immediately force-refresh
function run_handler() {
  load_refresh_token();
  return force_refresh();
}

// 6. Prepare a drive object to be directly used
const drive = google.drive({ version: 'v3', auth: OAuth2_client });

// 7. Export run handler function and OAuth2 client
module.exports = {drive, run_handler, force_refresh};