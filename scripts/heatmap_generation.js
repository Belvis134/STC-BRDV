const _ = require('lodash');
const fs = require('fs')
const path = require('path')
const unzipper = require('unzipper')
const {parse} = require('csv-parse')
const {sheets} = require('./drive_api_handler.js')
const {heatmap_expl_file_id, template_sheet_id, top_left_bound, bottom_right_bound} = require('../config.js');
const fetch = require('node-fetch')

let raw_data = {data1: {}, data2: {}, data3: {}}

// Request data (with Google Drive integration planned for Datamall data)
async function load_data(datamall_date, busrouter_date, encoded_account_key, data_type, data_type2) {
  const cache_key = `${data_type}_${data_type2}_${datamall_date}`;
  const temp_file_path = path.join('C:/R Projects/Websites/Bus-Route-Demand-Visualiser/data/storage/temp', `${cache_key}.zip`);
  const cache_fresh = fs.existsSync(temp_file_path) && (Date.now() - fs.statSync(temp_file_path).mtimeMs < 120 * 60 * 1000);

  // Fetch BusRouter reference data first
  const busrouter_res = await fetch(`https://stcraft.myddns.me/repository/busrouter?busrouter_date=${busrouter_date}&data_type=${data_type2}`);
  if (!busrouter_res.ok) throw new Error(`BusRouter fetch failed: ${busrouter_res.status} ${busrouter_res.statusText}`);
  const { data2, data3 } = await busrouter_res.json();
  raw_data.data2 = data2;
  raw_data.data3 = data3;

  // If cache exists, reuse it
  if (cache_fresh) {
    console.log(`Using cached ZIP from temp file: ${temp_file_path}`);
    raw_data.data1 = temp_file_path;  // Now it's a path to the cached file
    return;
  }

  // Otherwise fetch new ZIP data
  console.log(`Fetching new Datamall ZIP data for ${cache_key}`);
  const url = `https://stcraft.myddns.me/datamall-proxy?date=${datamall_date}&account_key=${encoded_account_key}&data_type=${data_type}&data_type2=${data_type2}&format=zip`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch data: ${res.status} ${res.statusText}`);

  // Create a writable stream for saving the raw ZIP to a file
  const temp_file_stream = fs.createWriteStream(temp_file_path, { flags: 'w' });

  // Pipe the fetched ZIP stream to the file
  res.body.pipe(temp_file_stream);

  // Wait for the file stream to finish writing
  await new Promise((resolve, reject) => {
    temp_file_stream.on('finish', resolve);
    temp_file_stream.on('error', reject);
  });

  // Now that the file is saved, set raw_data.data1 to the file path
  raw_data.data1 = temp_file_path;  // The path to the saved ZIP file

  console.log(`Datamall ZIP ${cache_key} has been written to temp storage.`);
}

// Stop code processing (name not added for now)
function process_stop_code(type, code, data3) {
  if (type === 'name') {
    return data3[code]?.[2] || String(code);
  } else if (type === 'code') {
    return `'${String(code).padStart(5, '0')}`; // Prepend ' to force string in Sheets
  }
}

// Precompute compound mapping
function compound_mapping(data, heatmap_type) {
  const compoundMapping = {};
  let codes = []
  if (!['by_specific_stop', 'by_specific_stn'].includes(heatmap_type)) {
    codes = [
      ...data.map(r => r.ORIGIN_PT_CODE),
      ...data.map(r => r.DESTINATION_PT_CODE)
    ];
  } else {
    codes = [
      ...data.map(r => r.PT_CODE)
    ]
  }

  codes.forEach(entry => {
    if (!entry) return; // skip undefined/null
    if (entry.includes('/')) {
      const parts = entry.split('/');
      parts.forEach(part => {
        if (!(part in compoundMapping)) {
          compoundMapping[part] = entry;
        }
      });
    } else {
      if (!(entry in compoundMapping)) {
        compoundMapping[entry] = entry;
      }
    }
  });

  return compoundMapping;
}

function apply_comp_mapping(code, mapping) {
  return mapping[code] || code;
}

async function unzip_and_filter(filters) {
  const filtered_data = {};
  // Open the ZIP
  const directory = await unzipper.Open.file(raw_data.data1);
  const { heatmap_type } = filters;

  let stop_cur, stop_cur2;

  if (heatmap_type === 'by_bus_svc' || heatmap_type === 'by_mrt_line') {
    stop_cur = raw_data.data2[filters.service]?.routes?.[filters.direction - 1];
    if (!stop_cur) {
      console.error(`❌ Could not find route info for service/line ${filters.service}, direction ${filters.direction}`);
      return [];
    }

    stop_cur2 = [];
    if (heatmap_type === 'by_mrt_line' && filters.service_2) {
      stop_cur2 = raw_data.data2[filters.service_2]?.routes?.[filters.direction_2 - 1] || [];
      if (!stop_cur2) {
        console.error(`❌ Could not find route info for ${filters.service} line, direction ${filters.direction}`);
        return [];
      }
    }
  }

  // Determine origin/destination sets once
  let origin, destination;
  switch (heatmap_type) {
    case 'by_bus_svc':       origin = destination = stop_cur; break;
    case 'by_mrt_line':      origin = stop_cur; destination = stop_cur2; break;
    case 'by_specific_stops':
    case 'by_specific_stns': origin = filters.origin_stops; destination = filters.destination_stops; break;
    case 'by_specific_stop':
    case 'by_specific_stn':  origin = filters.origin_stops; destination = null; break;
  }

  const mapping = !['by_specific_stop', 'by_specific_stn'].includes(heatmap_type)
    ? compound_mapping([...origin, ...(destination || [])].map(code => ({ ORIGIN_PT_CODE: code, DESTINATION_PT_CODE: code })), heatmap_type)
    : compound_mapping(origin.map(code => ({ PT_CODE: code })), heatmap_type);

  const origin_set = new Set(origin.map(x => apply_comp_mapping(x, mapping)));
  const destination_set = destination ? new Set(destination.map(x => apply_comp_mapping(x, mapping))) : null;

  const precomputed_periods = filters.time_period_filters
    ? Object.values(filters.time_period_filters).map(p => p.map(Number))
    : null;

  // Loop through ZIP files
  for (const fileEntry of directory.files) {
    if (!fileEntry.path.endsWith('.csv')) continue;
    console.log('CSV file detected in ZIP.')
    const stream = fileEntry.stream();
    let header_row = null;

    // Stream CSV file
    await new Promise((resolve, reject) => {
      stream
        .pipe(parse({ delimiter: ',', trim: true, relax_quotes: true, relax_column_count: true }))
        .on('data', (row) => {
          if (!header_row) {
            header_row = row;
            header_row.forEach((col, idx) => {
              if (idx === 0 || idx === 3) return;
              filtered_data[col] = [];
            });
          } else {
            if (filter_data(origin_set, destination_set, row, filters, precomputed_periods)) {
              header_row.forEach((col, idx) => {
                if (idx === 0 || idx === 3) return;
                filtered_data[col].push(row[idx]);
              });
            }
          }
        })
        .on('end', resolve)
        .on('error', (error) => {
          console.error('Error unzipping file:', error);
          reject(error);
        });
    });
  }
  return {filtered_data, stop_cur, stop_cur2};
}

// Filter function no longer relies on outer scope
function filter_data(origin, destination, row, filters = {}, periods = null) {
  const o = row[4];
  const d = row[5];

  if (!origin.has(o)) return false;
  if (destination && !destination.has(d)) return false;

  if (filters.day_type_filter && filters.day_type_filter !== 'combined') {
    const day = row[1];
    if (filters.day_type_filter === 'weekday' && day !== 'WEEKDAY') return false;
    if (filters.day_type_filter === 'weekend_ph' && day !== 'WEEKENDS/HOLIDAY') return false;
  }

  if (periods) {
    const hour = Number(row[2]);
    let ok = false;
    for (const [start, end] of periods) {
      if (start === end ||
          (start < end && hour >= start && hour < end) ||
          (start > end && (hour >= start || hour < end))) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }

  return true; // Row passes all filters
}

function object_of_arrays_to_rows(obj) {
  const keys = Object.keys(obj);
  const n = obj[keys[0]]?.length || 0;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const row = {};
    for (const key of keys) {
      row[key] = obj[key][i];
    }
    rows.push(row);
  }
  return rows;
}

// --- Build O-D matrix or Tap In/Out table ---
async function create_matrix(filtered_data, filters, stop_cur, stop_cur2) {
  const {heatmap_type} = filters
  // Get unique origins & destinations from filtered_data
  let origins = [];
  let dests = [];
  if (heatmap_type === 'by_bus_svc') {
    origins = dests = stop_cur; // Ordered by the route
  } else if (heatmap_type === 'by_mrt_line') {
    origins = stop_cur;
    dests = stop_cur2;
  } else if (heatmap_type === 'by_specific_stops' || heatmap_type === 'by_specific_stns') {
    origins = filters.origin_stops;       // Preserve user-provided order
    dests = filters.destination_stops;    // Preserve user-provided order
  } else if (heatmap_type === 'by_specific_stop' || heatmap_type === 'by_specific_stn') {
    origins = filters.origin_stops;       // Preserve user-provided order
  }
  const compound_map = compound_mapping(filtered_data, heatmap_type);
  // --- O-D Heatmaps --- 
  if (heatmap_type === 'by_bus_svc' || heatmap_type === 'by_mrt_line') {
    // 1. Aggregate data by O-D pairs (using compound codes for aggregation)
    const grouped = {};
    for (const r of filtered_data) {
      const ori = apply_comp_mapping(r.ORIGIN_PT_CODE, compound_map);
      const dst = apply_comp_mapping(r.DESTINATION_PT_CODE, compound_map);
      const key = `${ori}_${dst}`;
      grouped[key] = (grouped[key] || 0) + (Number(r.TOTAL_TRIPS) || 0);
    }

    // 2. Build matrix: Destinations as rows, Origins as columns
    const matrix = dests.map(dest =>
      origins.map(orig => grouped[`${apply_comp_mapping(orig, compound_map)}_${apply_comp_mapping(dest, compound_map)}`] || 0)
    );

    // 3. Prepare header and final grid
    const header_row = ['Dest|Orgn', ...origins.map(o => process_stop_code('code', o, raw_data.data3))];
    const grid = [header_row, ...dests.map((d, i) => [process_stop_code('code', d, raw_data.data3), ...matrix[i]])];

    return grid;
  }

  // --- Table for specific stops/stations ---
  if (heatmap_type === 'by_specific_stops' || heatmap_type === 'by_specific_stns') {
    // 1. Aggregate data by O-D pairs (using compound codes for aggregation)
    const grouped = _.groupBy(filtered_data, r =>
      `${apply_comp_mapping(r.ORIGIN_PT_CODE, compound_map)}_${apply_comp_mapping(r.DESTINATION_PT_CODE, compound_map)}`
    );

    // 2. Build grid using the original stop codes for display
    const grid = [['Origin', 'Destination', 'Total Trips']];
    origins.forEach(ori => {
      dests.forEach(dst => {
        const key = `${apply_comp_mapping(ori, compound_map)}_${apply_comp_mapping(dst, compound_map)}`;
        const rows = grouped[key] || [];
        const total = _.sumBy(rows, r => Number(r.TOTAL_TRIPS) || 0);
        grid.push([process_stop_code('code', ori, raw_data.data3), process_stop_code('code', dst, raw_data.data3), total]);
      });
    });

    return grid;
  }

  // --- Tap In/Out Heatmaps ---
  if (['by_specific_stop', 'by_specific_stn'].includes(heatmap_type)) {
    // 1. Aggregate data by stop code (using compound codes for aggregation)
    const grouped = _.groupBy(filtered_data, r => apply_comp_mapping(r.PT_CODE, compound_map));

    // 2. Build Tap In/Out table for all nodes in filered_data
    const grid = [['Stop Name', 'Tap Ins', 'Tap Outs']];
    origins.forEach(stopCode => {
      const rows = grouped[apply_comp_mapping(stopCode, compound_map)] || [];
      const tapIns = _.sumBy(rows, r => Number(r.TOTAL_TAP_IN_VOL) || 0);
      const tapOuts = _.sumBy(rows, r => Number(r.TOTAL_TAP_OUT_VOL) || 0);
      grid.push([process_stop_code('code', stopCode, raw_data.data3), tapIns, tapOuts]);
    });

    return grid;
  }

  // Error handling for unknown heatmap type
  console.warn(`⚠️ Unknown or unsupported heatmap_type: ${heatmap_type}`);
  return [];
}

// Convert to JSON row lists
function matrix_to_rows(grid, heatmap_type) {
  let final_grid = grid
  if (heatmap_type === 'by_bus_svc') { 
    // Remove redundant second row
    const trimmed_grid = grid.filter((_, i) => i !== 1);
    // Remove redundant last column
    final_grid = trimmed_grid.map(row => row.slice(0, -1));
  }
  const json_rows = [];
  final_grid.forEach((row) => {
    json_rows.push(row);
  });

  return json_rows;
}

// Find a user's sheet
async function find_user_sheet(spreadsheetId, userId) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  for (const s of spreadsheet.data.sheets) {
    const title = s.properties.title;
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${title}!C2`,
      });
      const cellVal = res.data.values?.[0]?.[0];
      if (cellVal === userId) {
        return { sheetId: s.properties.sheetId, sheetName: title };
      }
    } catch (err) {
      // ignore sheets without that cell
    }
  }
  return null; // not found
}

// Clone spreadsheet
async function clone_template(spreadsheetId, templateSheetId, username) {
  templateSheetId = Number(templateSheetId)
  // 1. Duplicate template sheet
  const copyResponse = await sheets.spreadsheets.sheets.copyTo({
    spreadsheetId,
    sheetId: templateSheetId,
    requestBody: { destinationSpreadsheetId: spreadsheetId }
  });

  const new_sheet_id = copyResponse.data.sheetId;

  // 2. Rename duplicated sheet to Discord username
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId: new_sheet_id, title: username },
            fields: 'title'
          }
        }
      ]
    }
  });
  return { new_sheet_id, new_sheet_name: username };
}

async function delete_sheet(spreadsheetId, sheetId) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteSheet: { sheetId }
      }]
    }
  });
}

function write_to_cell(req, metadata, new_sheet_id, param, row, col) {
  const value = metadata[param];
  req.push({
    updateCells: {
      rows: [{
        values: [{
          userEnteredValue: (
            typeof value === 'number'
              ? { numberValue: value }
              : { stringValue: String(value) }
          )
        }]
      }],
      fields: 'userEnteredValue',
      start: { sheetId: new_sheet_id, rowIndex: row, columnIndex: col }
    }
  });
}

// --- Post to Google Sheets ---
async function write_to_sheet(spreadsheetId, templateSheetId, matrix_values, metadata) {
  // 1a. Clone template + rename sheet
  // Check if an existing sheet for the user exists, if not, create new.
  let new_sheet_id, new_sheet_name;
  const existing = await find_user_sheet(spreadsheetId, metadata.user_id);
  if (existing) {
    await delete_sheet(spreadsheetId, existing.sheetId);
    const clone_res = await clone_template(spreadsheetId, templateSheetId, metadata.username);
    new_sheet_id = clone_res.new_sheet_id;
    new_sheet_name = clone_res.new_sheet_name;
    console.log(`Updating existing heatmap for ${metadata.username}`);
  } else {
    const clone_res = await clone_template(spreadsheetId, templateSheetId, metadata.username);
    new_sheet_id = clone_res.new_sheet_id;
    new_sheet_name = clone_res.new_sheet_name;
    console.log(`Created new heatmap sheet for ${metadata.username}`);
  }
  metadata.new_sheet_id = new_sheet_id;
  // 1b. Some formatting thingies.
  const heatmap_types = {
    "by_bus_svc": "By Bus Service",
    "by_mrt_line": "By MRT/LRT Line",
    "by_specific_stops": "By Specific Bus Stops",
    "by_specific_stns": "By Specific MRT/LRT Stations",
    "by_specific_stop": "By Specific Bus Stop",
    "by_mrt_line": "By Specific MRT/LRT Station"
  }

  // 2. Write metadata to specific cells
  let metadata_requests = [];
  write_to_cell(metadata_requests, metadata, new_sheet_id, 'username', 0, 2);
  write_to_cell(metadata_requests, metadata, new_sheet_id, 'user_id', 1, 2);
  write_to_cell(metadata_requests, metadata, new_sheet_id, 'heatmap_date', 2, 2);
  if (metadata.heatmap_type === 'by_bus_svc' || metadata.heatmap_type === 'by_mrt_line') {
    write_to_cell(metadata_requests, metadata, new_sheet_id, 'service', 0, 7);
    write_to_cell(metadata_requests, metadata, new_sheet_id, 'direction', 1, 7);
  }
  if (metadata.heatmap_type === 'by_mrt_line') {
    write_to_cell(metadata_requests, metadata, new_sheet_id, 'service_2', 2, 7);
    write_to_cell(metadata_requests, metadata, new_sheet_id, 'direction_2', 3, 7); 
  }
  metadata.heatmap_type = heatmap_types[metadata.heatmap_type]
  write_to_cell(metadata_requests, metadata, new_sheet_id, 'heatmap_type', 3, 2);
  if (metadata.day_type_filter) {
    write_to_cell(metadata_requests, metadata, new_sheet_id, 'day_type_filter', 0, 15);
  } else {
    const override = {day_type_filter: "Combined"}
    write_to_cell(metadata_requests, override, new_sheet_id, 'day_type_filter', 0, 15);
  }
  if (metadata.time_period_filters) {
    for (let p = 0; p < metadata.time_period_filters.length; p++) {
      write_to_cell(metadata_requests, metadata, new_sheet_id, `${String(metadata.time_period_filters[p][0]).padStart(2, '0')}:00 to ${String(metadata.time_period_filters[p][1]).padStart(2, '0')}:00`, p, 11);
    }
  } else {
    const override = {time_period_filters: "Full Day"}
    write_to_cell(metadata_requests, override, new_sheet_id, 'time_period_filters', 0, 11);    
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: metadata_requests }
  });

  // 3. Clear old data in the range A6:AT100
  const rangeToClear = `${new_sheet_name}!${top_left_bound}:${bottom_right_bound}`;
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: rangeToClear
  });
  console.log('Old data cleared.');

  // 4. Write new matrix values starting from A6
  console.log('Inserting new heatmap data...');
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${new_sheet_name}!${top_left_bound}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: matrix_values }
  });
  console.log(`Heatmap successfully written and table updated for ${metadata.username}`);
}

// --- Exported command to run with bot ---
async function post_heatmap(data) {
  const {service, direction, service_2, direction_2, origin_stops, destination_stops, day_type_filter,
    time_period_filters, user_id, username, heatmap_type, datamall_date, busrouter_date, encoded_account_key} = data
  const data_types1 = {
    'by_bus_svc': 'origin_destination',
    'by_mrt_line': 'origin_destination',
    'by_specific_stops': 'origin_destination',
    'by_specific_stns': 'origin_destination',
    'by_specific_stop': 'specific_stop',
    'by_specific_stn': 'specific_stop'
  }
  const data_types2 = {
    'by_bus_svc': 'bus',
    'by_mrt_line': 'train',
    'by_specific_stops': 'bus',
    'by_specific_stns': 'train',
    'by_specific_stop': 'bus',
    'by_specific_stn': 'train' 
  }
  const data_type = data_types1[heatmap_type]
  const data_type2 = data_types2[heatmap_type]
  await load_data(datamall_date, busrouter_date, encoded_account_key, data_type, data_type2);
  const params = {'service': service, 'direction': direction, 'service_2': service_2, 'direction_2': direction_2, 'heatmap_type': heatmap_type, 
		'day_type_filter': day_type_filter, 'time_period_filters': time_period_filters, 'origin_stops': origin_stops, 'destination_stops': destination_stops};

  console.log('Load data successful. Data unzipping and parsing started.')
  const {filtered_data, stop_cur, stop_cur2} = await unzip_and_filter(params)
  console.log('ZIP reading and data filtering successful. Creating matrix.')
  // Convert filtered_data object -> array of row objects for create_matrix
  const filtered_rows = object_of_arrays_to_rows(filtered_data);
  const grid = await create_matrix(filtered_rows, params, stop_cur, stop_cur2);
  console.log('Create matrix successful.')

	const date = new Date();
	const formatted_date = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${date.toLocaleString('default',{'hour':'numeric','minute':'numeric','second':'numeric','hour12':false})}`;

  const metadata = {'username': username, 'user_id': user_id, 'heatmap_type': heatmap_type, 'heatmap_date': formatted_date, 'service':service, 
		'direction': direction, 'service_2': service_2, 'direction_2': direction_2, 'day_type_filter': day_type_filter, 'time_period_filters': time_period_filters}

  if (!grid.length) {
    console.error(`⚠️ No data returned for heatmap of type ${metadata.heatmap_type}.`);
    return `No data returned for heatmap of type ${metadata.heatmap_type}. You did something wrong liao.`;
  }

  const json_output = matrix_to_rows(grid, heatmap_type);
  await write_to_sheet(heatmap_expl_file_id, template_sheet_id, json_output, metadata)
	return `Heatmap has been written to [STC-BRDV Heatmap Explorer](https://docs.google.com/spreadsheets/d/${heatmap_expl_file_id}/edit?gid=${metadata.new_sheet_id}#gid=${metadata.new_sheet_id}).`
}

// Export
module.exports = {post_heatmap}