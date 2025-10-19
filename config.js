const fs = require('fs');
var config = JSON.parse(fs.readFileSync('./info.json', 'utf8'));

// Use environment variables if available; fallback to info.json values
// Discord bot authentication
const token = process.env.DISCORD_TOKEN || config.token;
const discord_client_id = process.env.CLIENT_ID || config.discord_client_id;
const discord_guild_id = process.env.GUILD_ID || config.discord_guild_id;
const team_id = process.env.TEAM_ID || config.team_id
const mg_id = process.env.MG_ID || config.mg_id
// Datamall authentication
const datamall_api_key_1 = process.env.DATAMALL_API_KEY_1 || config.datamall_api_key_1;
const datamall_api_key_2 = process.env.DATAMALL_API_KEY_2 || config.datamall_api_key_2;
// Google Drive authentication
const drive_client_id = process.env.DRIVE_CLIENT_ID || config.drive_client_id;
const drive_client_secret = process.env.DRIVE_CLIENT_SECRET || config.drive_client_secret;
const drive_redirect_URI = process.env.DRIVE_REDIRECT_URI || config.drive_redirect_URI;
const drive_token_path = config.drive_token_path
// For writing files to Google Drive
const datamall_od_bus_folder_id = process.env.DATAMALL_OD_BUS_FOLDER_ID || config.datamall_od_bus_folder_id;
const datamall_od_train_folder_id = process.env.DATAMALL_OD_TRAIN_FOLDER_ID || config.datamall_od_train_folder_id;
const datamall_spec_bus_folder_id = process.env.DATAMALL_SPEC_BUS_FOLDER_ID || config.datamall_spec_bus_folder_id;
const datamall_spec_train_folder_id = process.env.DATAMALL_SPEC_TRAIN_FOLDER_ID || config.datamall_spec_train_folder_id;
const services_folder_id = process.env.SERVICES_FOLDER_ID || config.services_folder_id;
const stops_folder_id = process.env.STOPS_FOLDER_ID || config.stops_folder_id;
const amendments_file_id = process.env.AMENDMENTS_FILE_ID || config.amendments_file_id;
// Keep tab of file IDs
const registry_file_id = process.env.REGISTRY_FILE_ID || config.registry_file_id;
const copypastas_file_id = process.env.COPYPASTAS_FILE_ID || config.copypastas_file_id;
const points_file_id = process.env.POINTS_FILE_ID || config.points_file_id;
// Ports
const discord_port = process.env.DISCORD_PORT || config.discord_port;
const proxy_port = process.env.PROXY_PORT || config.proxy_port;

module.exports = {
  token, discord_client_id, discord_guild_id, team_id, mg_id, datamall_api_key_1, datamall_api_key_2, drive_client_id, drive_client_secret, drive_redirect_URI,
  datamall_od_bus_folder_id, datamall_od_train_folder_id, datamall_spec_bus_folder_id, datamall_spec_train_folder_id,
  drive_token_path, services_folder_id, stops_folder_id, amendments_file_id, registry_file_id, copypastas_file_id, points_file_id, discord_port, proxy_port
};