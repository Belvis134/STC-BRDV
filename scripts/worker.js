const {parentPort, workerData} = require('worker_threads');
const {auto_import_datamall, auto_import_busrouter} = require('./repository_proxy');

(async () => {
  switch (workerData.task) {
    case 'datamall':
      await auto_import_datamall(); break;
    case 'busrouter':
      await auto_import_busrouter(); break;
  }
  parentPort.postMessage('done');
})();