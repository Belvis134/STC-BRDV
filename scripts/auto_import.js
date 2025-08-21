const {drive} = require('./drive_api_handler.js');
const { default: fetch } = require('node-fetch');
const {datamall_api_key_1, datamall_od_bus_folder_id, datamall_od_train_folder_id, datamall_spec_bus_folder_id, datamall_spec_train_folder_id,
services_folder_id, stops_folder_id, registry_file_id} = require('../config.js');
const type_to_folder_id = {
	'origin_destination_bus': datamall_od_bus_folder_id,
	'origin_destination_train': datamall_od_train_folder_id,
	'transport_node_bus': datamall_spec_bus_folder_id,
	'transport_node_train': datamall_spec_train_folder_id
}

// Upload a single file and return the Drive response
async function upload_to_drive(content, file_name, mime_type, folder_id) {
  try {
    const file_metadata = {
      name: file_name,
      parents: folder_id ? [folder_id] : []
    };
    const media = {
      mimeType: mime_type,
      body: content
    };
    const response = await drive.files.create({
      resource: file_metadata,
      media,
      fields: 'id'
    });
    console.log(`Uploaded "${file_name}" → folder ${folder_id}; File ID: ${response.data.id}`);
    return response;
  } catch (err) {
    console.error(`Error uploading "${file_name}":`, err);
    throw err;
  }
}

// Pull registry and write new entries in the registry, then push
async function update_registry(category, subcategory1, subcategory2, file_name, new_file_id) {
  try {
    // 1. Fetch current registry
    const res = await drive.files.get(
      { fileId: registry_file_id, alt: 'media' },
      { responseType: 'stream' }
    );
    let raw = '';
    await new Promise((resolve, reject) => {
      res.data.on('data', chunk => raw += chunk.toString());
      res.data.on('end', resolve);
      res.data.on('error', reject);
    });
    const registry = JSON.parse(raw);

    // 2. Ensure path exists
    registry[category] = registry[category] || {};
    if (subcategory1) {
      if (subcategory2) {
        registry[category][subcategory1][subcategory2] = registry[category][subcategory1][subcategory2] || {};
        registry[category][subcategory1][subcategory2][file_name] = new_file_id;
      } else {
        registry[category][subcategory1] = registry[category][subcategory1] || {};
        registry[category][subcategory1][file_name] = new_file_id;
      }
    } else {
      registry[category][file_name] = new_file_id;
    }

    // 3. Push update back
    const updated = JSON.stringify(registry, null, 2);
    await drive.files.update({
      fileId: registry_file_id,
      media: { mimeType: 'application/json', body: updated }
    });
    console.log(`Registry updated for [${category}${subcategory1?'.'+subcategory1:''}${subcategory2?'.'+subcategory2:''}].${file_name} with ID ${new_file_id}`);
    return registry;

  } catch (err) {
    console.error('Error updating registry due to ', err);
    throw err;
  }
}

// Format month as "MM", get previous month
function get_previous_month() {
  const now = new Date()
  const previous_month = now.getMonth() === 0 ? 12 : now.getMonth(); // Handle January (0)
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(); // Adjust year for January
	const formatted_month = previous_month < 10 ? '0' + previous_month : '' + previous_month
  return `${year}${formatted_month}`;
}
function format_month(m) {
  return m < 10 ? '0' + m : '' + m;
}

// 1. Auto-import from Datamall
async function auto_import_datamall() {
  try {
    const date = get_previous_month()
		const encoded_account_key = encodeURIComponent(datamall_api_key_1)
    const data_types1a = ['origin_destination','specific_stop'];
		const data_types1b = ['origin_destination','transport_node'];
		const data_types2 = ['bus', 'train']
		const zip_names = data_types1b.flatMap(type1 => data_types2.map(type2 => `${type1}_${type2}_${date}.zip`));
		const zip_types = data_types1b.flatMap(type1 => data_types2.map(type2 => `${type1}_${type2}`));
    const proxy_urls = data_types1a.flatMap(type1 => data_types2.map(type2 => `https://stc-brdv.fly.dev/datamall-proxy?date=${date}&account_key=${encoded_account_key}&data_type=${type1}&data_type2=${type2}`));

    console.log(`→ Fetching ZIPs from Datamall`);
    const responses = await Promise.all(proxy_urls.map(u => fetch(u)));

		for (let i = 0; i < responses.length; i++) {
			const r = responses[i];
			if (!r.ok) {
				const err = await r.text().catch(() => '');
				throw new Error(
					`Datamall ZIP ${zip_names[i]} fetch failed: ${r.status} ${r.statusText} - ${err}`
				);
			}
			console.log(`Datamall ZIP ${zip_names[i]} fetched`);
		}
    //  Upload each ZIP into its correct folder
    const drive_responses = await Promise.all(
      zip_names.map((name, i) =>
        upload_to_drive(
          responses[i].body,
          name,
          'application/zip',
					type_to_folder_id[zip_types[i]]
        )
      )
    );
    // Update registry with each new ID
    for (let i = 0; i < zip_types.length; i++) {
      if (zip_names[i].includes('bus')) {
        var type = 'bus'
      } else if (zip_names[i].includes('train')) {
        var type = 'train'
      }
			if (zip_names[i].includes('origin_destination')) {
      	await update_registry('datamall', 'origin_destination', type, zip_names[i], drive_responses[i].data.id);
			} else if (zip_names[i].includes('transport_node')) {
				await update_registry('datamall', 'transport_node', type, zip_names[i], drive_responses[i].data.id);
			}
    }
    console.log('Auto-importing from Datamall complete!');
  } catch (err) {
    console.error('Auto-import from Datamall failed due to', err);
  }
}

// 2. Auto-import from BusRouter
async function auto_import_busrouter() {
  try {
    const now  = new Date();
    const date = `${now.getFullYear()}${format_month(now.getMonth() + 1)}`;
    console.log('→ Fetching BusRouter services & stops JSON');
    const [ svc_res, stop_res ] = await Promise.all([
      fetch('https://data.busrouter.sg/v1/services.json'),
      fetch('https://data.busrouter.sg/v1/stops.json')
    ]);
    if (!svc_res.ok || !stop_res.ok) {
      throw new Error(`BusRouter fetch failed: services: ${svc_res.status}, stops: ${stop_res.status}`);
    }
    const [ svc_json, stops_json ] = await Promise.all([ svc_res.text(), stop_res.text() ]);
    console.log('BusRouter JSON fetched');
    const svc_name  = `services_${date}.json`;
    const stops_name= `stops_${date}.json`;

    // Upload service + stops files
    const svc_drive = await upload_to_drive(svc_json, svc_name, 'application/json', services_folder_id);
    const stops_drive = await upload_to_drive(stops_json, stops_name, 'application/json', stops_folder_id);

    // Record in registry
    await update_registry('busrouter', 'services', svc_name,  svc_drive.data.id);
    await update_registry('busrouter', 'stops',    stops_name, stops_drive.data.id);

    console.log('Auto-importing from BusRouter complete!');
  } catch (err) {
    console.error('Auto-importing from BusRouter failed due to ', err);
  }
}

module.exports = {
  auto_import_datamall,
  auto_import_busrouter
};