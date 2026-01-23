// THIS SCRIPT IS NOT NORMALLY INVOKED. THIS IS MEANT TO STORE DATA IN YOUR LOCAL STORAGE.

const fs = require('fs');
let existing_data = {};
let new_data = [{this_is: "a_placeholder"}];
let skip = 0;
const {datamall_api_key_1} = require('../config.js')

async function import_routes(account_key) {
  console.log(`Compiling bus route info.`)
  while(new_data.length > 0) {
    const res = await fetch(`https://datamall2.mytransport.sg/ltaodataservice/BusRoutes?$skip=${500*skip}`, {
      method: "GET",
      headers: {
        AccountKey: account_key,
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
  }  
  console.log(`Bus route info compile complete. Maximum skip reached is ${skip-1}*500.`)
  fs.writeFileSync('../data/routes.json', JSON.stringify(existing_data));
}

async function import_services(account_key) {
  console.log('Compiling bus service info.')
  while(new_data.length > 0) {
    const res = await fetch(`https://datamall2.mytransport.sg/ltaodataservice/BusServices?$skip=${500*skip}`, {
      method: "GET",
      headers: {
        AccountKey: account_key,
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
  fs.writeFileSync('../data/service_info.json', JSON.stringify(existing_data));
}

(async () => {
await import_services(datamall_api_key_1)})()