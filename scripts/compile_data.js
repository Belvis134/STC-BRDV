// THIS SCRIPT IS NOT NORMALLY INVOKED. THIS IS MEANT TO STORE DATA IN YOUR LOCAL STORAGE.

const {datamall_api_key_1} = require('../config.js')

function freq_avg(freq) {
  let sum = 0
  freq = freq.split('-');
  freq.forEach(num => {sum = sum + Number(num)})
  freq = (sum / freq.length).toFixed(1); 
  return freq
}

async function combined_import(account_key) {
  try {
    let existing_data = {};
    let new_data = [{this_is: "a_placeholder"}];
    let new_data2 = [{this_is: "a_placeholder"}];
    let skip = 0;
    const headers = {
      AccountKey: account_key,
      accept: 'application/json'
    }
    console.log('Compiling bus route info.')
    while(new_data.length > 0) {
      const routes = await  fetch(`https://datamall2.mytransport.sg/ltaodataservice/BusRoutes?$skip=${500*skip}`, {method: "GET", headers: headers});
      const raw = await routes.json();
      new_data = raw.value
      for (data of new_data) {
        const svc = data.ServiceNo;
        const dir = data.Direction;
        const stop_seq = data.StopSequence;
        const dist = data.Distance;
        const stop_code = data.BusStopCode;
        if (!existing_data[svc]) {existing_data[svc] = {}};
        if (!existing_data[svc][dir]) {existing_data[svc][dir] = {}};
        if (!existing_data[svc][dir].routes) {existing_data[svc][dir].routes = []};
        existing_data[svc][dir].routes.push([stop_seq, stop_code, dist])
      };
      skip++;
    };
    console.log(`Bus route info compile complete. Maximum skip reached is ${skip-1}*500.`);
    skip = 0;
    while(new_data2.length > 0) {
      const services = await fetch(`https://datamall2.mytransport.sg/ltaodataservice/BusServices?$skip=${500*skip}`, {method: "GET", headers: headers});
      const raw = await services.json()
      new_data2 = raw.value
      for (data of new_data2) {
        const svc = data.ServiceNo;
        const dir = data.Direction;
        const category = data.Category;
        const am_peak = freq_avg(data.AM_Peak_Freq);
        const am_off_peak = freq_avg(data.AM_Offpeak_Freq);
        const pm_peak = freq_avg(data.PM_Peak_Freq);
        const pm_off_peak = freq_avg(data.PM_Offpeak_Freq);
        if (!existing_data[svc]) existing_data[svc] = {};
        if (!existing_data[svc][dir]) existing_data[svc][dir] = {};
        if (!existing_data[svc].type) {existing_data[svc].type = category};
        existing_data[svc][dir].freq = [am_peak, am_off_peak, pm_peak, pm_off_peak];
      };
      skip++;
  };
    return existing_data
  } catch (error) {
    console.error('Error in compiling data:', error);
  }
}

async function service_weighing(data2, data4, ori, dst, freq_type) {
  const cfm_routes = {};
  console.log(`Origin: ${ori}, Destination:${dst}`);

  for (const svc of Object.keys(data2)) {
    for (const dir of Object.keys(data2[svc].routes).map(Number)) {
      const route = data2[svc].routes[dir];
      if (!(route.includes(ori) && route.includes(dst))) continue;

      const dirKey = dir + 1;
      cfm_routes[svc] ??= {};
      cfm_routes[svc][dirKey] ??= {};

      // Find origin and destination distances
      for (const stop of data4[svc][dirKey].routes) {
        const [ , stopName, stopDist ] = stop;
        if (stopName === ori && cfm_routes[svc][dirKey].ori_dist == null) {
          cfm_routes[svc][dirKey].ori_dist = stopDist;
        }
        if (stopName === dst && cfm_routes[svc][dirKey].dst_dist == null) {
          cfm_routes[svc][dirKey].dst_dist = stopDist;
        }
        if (cfm_routes[svc][dirKey].ori_dist && cfm_routes[svc][dirKey].dst_dist) break;
      }

      // Distance difference
      cfm_routes[svc][dirKey].diff_dist = (
        cfm_routes[svc][dirKey].dst_dist - cfm_routes[svc][dirKey].ori_dist
      ).toFixed(1);

      // Frequency calculation
      const freq_list = data4[svc][dirKey].freq.map(Number);
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
      cfm_routes[svc][dirKey].freq = freq;
    }
  }
  return cfm_routes;
}


(async () => {
  const ori = '43009';
  const dst = '43511';
  const freq = 'avg'
  const data2 = await (await fetch('https://data.busrouter.sg/v1/services.json')).json()
  const data3 = await (await fetch('https://data.busrouter.sg/v1/stops.json')).json()
  const data4 = await (await fetch(`https://stcraft.myddns.me/datamall-proxy?data_type=services&data_type2=bus&account_key=${encodeURIComponent(datamall_api_key_1)}`)).json()
  console.log(data4['676']['2'].freq)
  const cfm_routes = await service_weighing(data2, data4, ori, dst, freq)
  let msg = `From ${data3[ori][2]} (${ori}) to ${data3[dst][2]} (${dst}):`
  for (svc in cfm_routes) {
    for (dir in cfm_routes[svc]) {
      if (freq === 'avg') {var freq_msg = 'on average'}
      else {var freq_msg = `for the ${freq.toUpperCase()} period`}
      msg = msg + `\n- ${svc} direction ${dir}: ${cfm_routes[svc][dir].diff_dist} km, frequency is ${Number(cfm_routes[svc][dir].freq)} min ${freq_msg}.`
    }
  }
  console.log(cfm_routes)
  console.log(msg)
})()