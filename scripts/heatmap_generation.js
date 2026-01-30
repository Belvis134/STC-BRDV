const fs = require('fs')
const path = require('path')
const unzipper = require('unzipper')
const {parse} = require('csv-parse')
const {sheets} = require('./drive_api_handler.js')
const {heatmap_expl_file_id, template_sheet_id, top_left_bound, bottom_right_bound} = require('../config.js');
const fetch = require('node-fetch')

let raw_data = {data1: {}, data2: {}, data3: {}, data4: {}}

// Progress bar
function bar(done, total) {
  const filled = '█'.repeat(done);
  const empty  = '░'.repeat(total - done);
  return `[${filled}${empty}]`;
}

// Request data (with Google Drive integration planned for Datamall data)
async function load_data(datamall_date, busrouter_date, encoded_account_key, data_type, data_type2, svc_weighing) {
  const cache_key = `${data_type}_${data_type2}_${datamall_date}`;
  if (['origin_destination', 'specific_stop'].includes(data_type)) {
    var temp_file_path = path.join('C:/R Projects/Websites/Bus-Route-Demand-Visualiser/data/storage/temp',`${cache_key}.zip`);
    var cache_fresh = fs.existsSync(temp_file_path)
  } else if (['services'].includes(data_type)) {
    var temp_file_path_2 = path.join('C:/R Projects/Websites/Bus-Route-Demand-Visualiser/data/storage/temp',`services_info_${datamall_date}.json`);
    var cache_fresh_2 = fs.existsSync(temp_file_path_2)
  }

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
  if (cache_fresh_2) {
    console.log(`Using cached JSON from temp file: ${temp_file_path_2}`);
    raw_data.data4 = temp_file_path_2;  // Now it's a path to the cached file
    return;
  }

  // Otherwise fetch new ZIP data
  console.log(`Fetching new Datamall ZIP data for ${cache_key}`);
  const url = `https://stcraft.myddns.me/datamall-proxy?date=${datamall_date}&account_key=${encoded_account_key}&data_type=${data_type}&data_type2=${data_type2}&format=zip`;
  const res = await fetch(url);
  if (!res.ok) {
    const msg = await res.body().text()
    throw new Error(msg);
  }
  if (svc_weighing) {
    const url_2 = `https://stcraft.myddns.me/datamall-proxy?date=${datamall_date}&account_key=${encoded_account_key}&data_type=services`;
    const res_2 = await fetch(url_2);
    if (!res_2.ok) {
      const msg = await res_2.body().text()
      throw new Error(msg);
    }
    fs.writeFileSync(temp_file_path_2, JSON.stringify((await res_2.json()), null, 2));
    raw_data.data4 = temp_file_path_2;
    console.log(`Datamall JSON services_info_${datamall_date} has been written to temp storage.`)
  }

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
function process_stop_code(type, heatmap_type, code, data3) {
  if (type === 'name') {
    return data3[code]?.[2] || String(code);
  } else if (type === 'code') {
    if (["by_bus_svc","by_specific_stops","by_specific_stop"].includes(heatmap_type)) {
      return `'${String(code).padStart(5, '0')}`; // Prepend ' to force string in Sheets
    } else return code
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

async function open_and_filter(filters, interaction) {
  const filtered_data = {};
  // Open the ZIP
  const directory = await unzipper.Open.file(raw_data.data1); // Unzip and read the file path of data1
  if (filters.svc_weighing) {
    raw_data.data4 = fs.readFileSync(raw_data.data4) // Read the file path of data4
  }
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

  let mapping = !['by_specific_stop', 'by_specific_stn'].includes(heatmap_type)
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
    interaction.editReply({content: `${bar(2,3)} Mapping complete, CSV found in ZIP. Filtering data now.`})
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

  if (![...origin].some(i => o.includes(i))) return false;
  if (destination && ![...destination].some(j => d.includes(j))) return false;

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

// --- Service weightage ---
async function service_weighing(data2, data4, ori, dst, freq_type) {
  const cfm_routes = {};
  console.log(`Origin: ${ori}, Destination:${dst}`);

  for (const svc of Object.keys(data2)) {
    for (const dir_key of Object.keys(data2[svc].routes).map(Number)) {
      const route = data2[svc].routes[dir_key];
      if (!(route.includes(ori) && route.includes(dst))) continue;

      const dir = dir_key + 1;
      cfm_routes[svc] ??= {};
      cfm_routes[svc][dir] ??= {};

      // Find origin and destination distances
      for (const stop of data4[svc][dir].routes) {
        const [ , stopName, stopDist ] = stop;
        if (stopName === ori && cfm_routes[svc][dir].ori_dist == null) {
          cfm_routes[svc][dir].ori_dist = stopDist;
        }
        if (stopName === dst && cfm_routes[svc][dir].dst_dist == null) {
          cfm_routes[svc][dir].dst_dist = stopDist;
        }
        if (cfm_routes[svc][dir].ori_dist && cfm_routes[svc][dir].dst_dist) break;
      }

      // Distance difference
      cfm_routes[svc][dir].diff_dist = (
        cfm_routes[svc][dir].dst_dist - cfm_routes[svc][dir].ori_dist
      ).toFixed(1);

      // Frequency calculation
      const freq_list = data4[svc][dir].freq.map(Number);
      let freq;
      switch (freq_type) {
        case 'avg': {
          const valid = freq_list.filter(n => n > 0);
          freq = (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(3);
          break;
        }
        case 'am': {
          const valid = freq_list.slice(0, 2).filter(n => n > 0);
          freq = (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(3);
          break;
        }
        case 'pm': {
          const valid = freq_list.slice(2).filter(n => n > 0);
          freq = (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(3);
          break;
        }
        case 'am_peak': freq = freq_list[0]; break;
        case 'am_offpeak': freq = freq_list[1]; break;
        case 'pm_peak': freq = freq_list[2]; break;
        case 'pm_offpeak': freq = freq_list[3]; break;
      }
      cfm_routes[svc][dir].freq = freq;
    }
  }
  return cfm_routes;
}

// --- Build O-D matrix or Tap In/Out table ---
async function create_matrix(filtered_data, data, stop_cur, stop_cur2) {
  const {heatmap_type} = data
  // Get unique origins & destinations from filtered_data
  let origins = [];
  let dests = [];
  let weightage = {}
  switch (heatmap_type) {
    case 'by_bus_svc': origins = dests = stop_cur; break; // Route order
    case 'by_mrt_line': origins = stop_cur; dests = stop_cur2; break; // Route order
    case 'by_specific_stops':
    case 'by_specific_stns': origins = data.origin_stops; dests = data.destination_stops; break; // User-provided order
    case 'by_specific_stop':
    case 'by_specific_stn': origins = data.origin_stops; break; // User-provided order
  }
  const compound_map = compound_mapping(filtered_data, heatmap_type);
  if (data.svc_weighing) {
    for (const o of origins) {
      for (const d of dests) {
        const service_info = service_weighing(raw_data.data2, raw_data.data4, origins, dests, data.freq);
        let total = 0
        weightage[`${o}_${d}`] = {};
        if (service_info[data.service]) {
          // Since only one dir, just take the first entry
          const [dir] = Object.keys(service_info[data.service]);
          const info = service_info[data.service][dir];
          const weight = 1 / ((Number(info.diff_dist) ** 2) * Number(info.freq));
          weightage[`${o}_${d}`][data.service] = { weight };
          total += weight;
        }
        weightage[`${o}_${d}`].total = total
      }
    }
  }
  // --- O-D Heatmaps --- 
  if (heatmap_type === 'by_bus_svc' || heatmap_type === 'by_mrt_line') {
    // 1. Aggregate data by O-D pairs (using compound codes for aggregation)
    const grouped = {};
    for (const r of filtered_data) {
      const ori = r.ORIGIN_PT_CODE;
      const dst = r.DESTINATION_PT_CODE;
      const key = `${ori}_${dst}`;
      grouped[key] = (grouped[key] || 0) + (Number(r.TOTAL_TRIPS) || 0);
      if (data.svc_weighing) {
        grouped[key] = grouped[key] * (weightage[key][data.service].weight / weightage[key].total)
      }
    }
    const normalised_origins = origins.map(o => apply_comp_mapping(o, compound_map));
    const normalised_dests = dests.map(d => apply_comp_mapping(d, compound_map));

    // 2. Build matrix: Destinations as rows, Origins as columns
    const matrix = normalised_dests.map(dest => normalised_origins.map(orig => { const key = `${orig}_${dest}`; return grouped[key] || 0; }) );

    // 3. Prepare header and final grid
    const header_row = ['Dest|Orgn', ...origins.map(o => process_stop_code('code', heatmap_type, o, raw_data.data3))];
    const grid = [header_row, ...dests.map((d, i) => [process_stop_code('code', heatmap_type, d, raw_data.data3), ...matrix[i]])];

    return grid;
  }

  // --- Table for specific stops/stations ---
  if (heatmap_type === 'by_specific_stops' || heatmap_type === 'by_specific_stns') {
    // 1. Aggregate data by O-D pairs (using compound codes for aggregation)
    const grouped = {};
    for (const r of filtered_data) {
      const ori = r.ORIGIN_PT_CODE;
      const dst = r.DESTINATION_PT_CODE;
      const key = `${ori}_${dst}`;
      grouped[key] = (grouped[key] || 0) + (Number(r.TOTAL_TRIPS) || 0);
    }

    // 2. Build grid using the original stop codes for display
    const grid = [['Org', 'Dst', 'Trips']];
    const normalised_origins = origins.map(o => apply_comp_mapping(o, compound_map)); 
    const normalised_dests = dests.map(d => apply_comp_mapping(d, compound_map));
    origins.forEach((ori,i) => {
      dests.forEach((dst,j) => {
        const key = `${normalised_origins[i]}_${normalised_dests[j]}`;
        const total = grouped[key] || 0;
        grid.push([process_stop_code('code', heatmap_type, ori, raw_data.data3), process_stop_code('code', heatmap_type, dst, raw_data.data3), total]);
      });
    });
    return grid;
  }

  // --- Tap In/Out Heatmaps ---
  if (['by_specific_stop', 'by_specific_stn'].includes(heatmap_type)) {
    // 1. Aggregate data by stop code (using compound codes for aggregation)
    const grouped = {}
    for (const r of filtered_data) {
      const ori = r.PT_CODE;
      if (!grouped[ori]) {grouped[ori] = [0, 0]}
      grouped[ori][0] += Number(r.TOTAL_TAP_IN_VOLUME) || 0;
      grouped[ori][1] += Number(r.TOTAL_TAP_OUT_VOLUME) || 0;
    }

    // 2. Build Tap In/Out table for all nodes in filered_data
    const grid = [['Stop', 'Tap Ins', 'Tap Outs']];
    const normalised_origins = origins.map(o => apply_comp_mapping(o, compound_map)); 
    origins.forEach((stop_code, i) => {
      const rows = grouped[normalised_origins[i]] || [];
      grid.push([process_stop_code('code', heatmap_type, stop_code, raw_data.data3), rows[0], rows[1]]);
    });

    return grid;
  }

  // Error handling for unknown heatmap type
  console.warn(`⚠️ Unknown or unsupported heatmap_type: ${heatmap_type}`);
  return [];
}

// Convert to JSON row lists
function matrix_to_rows(grid, heatmap_type, service, service_2) {
  let final_grid = grid
  if (heatmap_type === 'by_bus_svc') { 
    // Remove redundant second row
    const trimmed_grid = grid.filter((_, i) => i !== 1);
    // Remove redundant last column
    final_grid = trimmed_grid.map(row => row.slice(0, -1));
  } else if (heatmap_type === 'by_mrt_line' && service === service_2) {
    const trimmed_grid = grid.filter((_, i) => i !== 1);
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
  metadata.svc_weighing = metadata.service_weighing.toUpperCase()
  // 1b. Some formatting thingies.
  const heatmap_types = {
    "by_bus_svc": "By Bus Service",
    "by_mrt_line": "By MRT/LRT Line",
    "by_specific_stops": "By Specific Bus Stops",
    "by_specific_stns": "By Specific MRT/LRT Stations",
    "by_specific_stop": "By Specific Bus Stop",
    "by_specific_stm": "By Specific MRT/LRT Station"
  }

  // 2. Write metadata to specific cells
  let metadata_requests = [];
  write_to_cell(metadata_requests, metadata, new_sheet_id, 'username', 0, 2);
  write_to_cell(metadata_requests, metadata, new_sheet_id, 'user_id', 1, 2);
  write_to_cell(metadata_requests, metadata, new_sheet_id, 'heatmap_date', 2, 2);
  write_to_cell(metadata.requests, metadata, new_sheet_id, 'svc_weighing', 2, 15);
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
async function post_heatmap(data, interaction) {
  interaction.editReply({content: `${bar(0,3)} Loading data.`})
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
  const data_type = data_types1[data.heatmap_type]
  const data_type2 = data_types2[data.heatmap_type]
  await load_data(data.datamall_date, data.busrouter_date, data.encoded_account_key, data_type, data_type2);

  interaction.editReply({content: `${bar(1,3)} Load data successful. Applying mapping.`})
  const {filtered_data, stop_cur, stop_cur2} = await open_and_filter(data, interaction)
  // Convert filtered_data object -> array of row objects for create_matrix
  const filtered_rows = object_of_arrays_to_rows(filtered_data);
  const grid = await create_matrix(filtered_rows, data, stop_cur, stop_cur2);

	const date = new Date();
	const formatted_date = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${date.toLocaleString('default',{'hour':'numeric','minute':'numeric','second':'numeric','hour12':false})}`;
  data.heatmap_date = formatted_date

  if (!grid.length) {
    console.error(`⚠️ No data returned for heatmap of type ${data.heatmap_type}.`);
    return `No data returned for heatmap of type ${data.heatmap_type}. You did something wrong liao.`;
  }

  const json_output = matrix_to_rows(grid, data.heatmap_type, data.service, data.service_2);
  await write_to_sheet(heatmap_expl_file_id, template_sheet_id, json_output, data)
	return `${bar(3,3)} Heatmap has been written to [STC-BRDV Heatmap Explorer](https://docs.google.com/spreadsheets/d/${heatmap_expl_file_id}/edit?gid=${data.new_sheet_id}#gid=${data.new_sheet_id}).`
}

// Export
module.exports = {post_heatmap, service_weighing}