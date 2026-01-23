module.exports = {
    apps : [
      {
        name   : "stc-brdv",
        script : "scripts/command_functions.js",
      	watch: false,
        env: {
          PORT: 3001
        }
      },
      {
        name   : "bluey",
        script : "scripts/command_functions_bluey.js",
        watch: false,
        env: {
          PORT: 336
        }
      },
      {
        name   : "datamall-proxy",
        script : "scripts/proxy_server.js",
        watch : false,
        env: {
          PORT: 3000
        }
      }
    ]
  }