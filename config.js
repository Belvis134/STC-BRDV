const fs = require('fs');
var config = JSON.parse(fs.readFileSync('./info.json', 'utf8'));

// Use environment variables if available; fallback to info.json values
// Discord bot authentication
const token = process.env.DISCORD_TOKEN || config.token;
const token_2 = process.env.DISCORD_TOKEN_2 || config.token_2;
const discord_client_id = process.env.CLIENT_ID || config.discord_client_id;
const discord_client_id_2 = process.env.CLIENT_ID_2 || config.discord_client_id_2;
const discord_guild_id = process.env.GUILD_ID || config.discord_guild_id;
const discord_guild_id_2 = process.env.GUILD_ID_2 || config.discord_guild_id_2;
const team_id = process.env.TEAM_ID || config.team_id
const mod_id = process.env.TEAM_ID_2 || config.team_id_2
const mg_id = process.env.MG_ID || config.mg_id
const blue_gamer_id = process.env.MG_ID_2 || config.mg_id_2
const director_id = process.env.DIRECTOR_ID || config.director_id
// Discord channels
const amendments_id = process.env.AMENDMENTS_CHANNEL_ID || config.amendments_id
const btc_masterplan_id = process.env.BTC_MASTERPLAN_ID || config.btc_masterplan_id
const msg_relay_id = process.env.MSG_RELAY_ID || config.msg_relay_id;
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
// Template sheet ID and bounds
const template_sheet_id = process.env.TEMPLATE_SHEET_ID || config.template_sheet_id;
const top_left_bound = process.env.TOP_LEFT_BOUND || config.top_left_bound
const bottom_right_bound = process.env.BOTTOM_RIGHT_BOUND || config.bottom_right_bound
// Keep tab of file IDs
const services_folder_id = process.env.SERVICES_FOLDER_ID || config.services_folder_id;
const stops_folder_id = process.env.STOPS_FOLDER_ID || config.stops_folder_id;
const bus_geoguessr_folder_id = process.env.BUS_GEOGUESSR_FOLDER_ID || config.bus_geoguessr_folder_id;
const metro_guesser_folder_id = process.env.METRO_GUESSER_FOLDER_ID || config.metro_guesser_folder_id;
const wtb_images_folder_id = process.env.WTB_IMAGES_FOLDER_ID || config.wtb_images_folder_id
const amendments_file_id = process.env.AMENDMENTS_FILE_ID || config.amendments_file_id;
const spottings_file_id = process.env.SPOTTINGS_FILE_ID || config.spottings_file_id;
const heatmap_expl_file_id = process.env.HEATMAP_EXPL_ID || config.heatmap_expl_file_id;
const registry_file_id = process.env.REGISTRY_FILE_ID || config.registry_file_id;
const copypastas_file_id = process.env.COPYPASTAS_FILE_ID || config.copypastas_file_id;
const points_file_id = process.env.POINTS_FILE_ID || config.points_file_id;
const copypastas_file_id_2 = process.env.COPYPASTAS_FILE_ID_2 || config.copypastas_file_id_2;
const points_file_id_2 = process.env.POINTS_FILE_ID_2 || config.points_file_id;
const msg_id_repository_file_id = process.env.MSG_REPOSITORY_ID || config.msg_id_repository_file_id;
// Ports
const discord_port = process.env.DISCORD_PORT || config.discord_port;
const discord_port_2 = process.env.DISCORD_PORT_2 || config.discord_port_2;
const proxy_port = process.env.PROXY_PORT || config.proxy_port;

module.exports = {
  token, discord_client_id, discord_guild_id, team_id, mg_id, datamall_api_key_1, datamall_api_key_2, drive_client_id, drive_client_secret, drive_redirect_URI,
  datamall_od_bus_folder_id, datamall_od_train_folder_id, datamall_spec_bus_folder_id, datamall_spec_train_folder_id, drive_token_path, services_folder_id, 
  stops_folder_id, bus_geoguessr_folder_id, metro_guesser_folder_id, amendments_file_id, registry_file_id, copypastas_file_id, points_file_id, 
  heatmap_expl_file_id, template_sheet_id, spottings_file_id, top_left_bound, bottom_right_bound, discord_port, proxy_port,
  // Bluey shit
  token_2, discord_client_id_2, discord_guild_id_2, mod_id, blue_gamer_id, copypastas_file_id_2, points_file_id_2, discord_port_2, amendments_id, btc_masterplan_id,
  msg_relay_id, msg_id_repository_file_id, wtb_images_folder_id, director_id
};