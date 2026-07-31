const express = require('express');
const body_parser = require('body-parser');
const cron = require('node-cron')
const fs = require('fs')
const {token, datamall_api_key_1, discord_port, copypastas_file_id, points_file_id, amendments_file_id, team_id, mg_id, datamall_api_key_2, discord_guild_id, 
  spottings_file_id, bus_geoguessr_folder_id, metro_guesser_folder_id, msg_relay_id, msg_id_repository_file_id} = require('../config.js');
const {drive, sheets, run_handler, load_from_drive} = require('./drive_api_handler.js')
const {post_heatmap, service_weighing} = require('./heatmap_generation.js')
const {format_date, format_time} = require('./date_time_functions')
const {amendment_main, amendment_buttons, update_recent_amendments} = require('./amendment_explorer')
const {spotrep_main_embed, spotrep_buttons, spotrep_processes, spotrep_selects, data_rows} = require('./spot_n_report')
const app = express();
app.use(body_parser.json());
app.listen(discord_port, () => {
  console.log(`STC-BRDV listening on port ${discord_port}`);
});

const { Client, GatewayIntentBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags, 
  AutoModerationRuleTriggerType, AttachmentBuilder, SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, Events,
  Message} = require('discord.js');
const { format } = require('path');
const { wrap } = require('module');
const { integrations } = require('googleapis/build/src/apis/integrations/index.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const user_sessions = new Map();
let copypasta_list = {}, guesser_data = {};
let msg_id_repository = {map: {}, order: [], channels: {}};
let edit_ref_num = null
let spotrep_sessions = {}
const guesser_settings = {
  monthly_reset: true,
  announce_leaderboard: false,
  show_leaderboard_until: 10
}
;(async function start_handler() {
  await run_handler()
  copypasta_list = await load_from_drive('json', copypastas_file_id)
  guesser_data = await load_from_drive('json', points_file_id)
  msg_id_repository = await load_from_drive('json', msg_id_repository_file_id)
  update_recent_amendments()
  for (const [key, val] of Object.entries(guesser_settings)) {
    if (!(key in guesser_data.settings)) {
      guesser_data.settings[key] = val;
      await save_to_drive('points')
    }
  }
  // Clear the users’ points and ranks
  cron.schedule('0 0 1 * *', async () => {
  if (!guesser_data.settings.monthly_reset) return;
  await reset_points(null, 'all', 'all');
  const date = format_date(new Date(), ['MMM', 'yyyy'], ' ')
    console.log(`Guesser data has been successfully reset for ${date}`);
  }, {
    scheduled: true,
    timezone: 'Asia/Singapore'
  });

  // Ends a bus_geoguessr game
  // setInterval(async () => {
  //   try {
  //     const now = Date.now();
  //     const bus = guesser_data.answer.bus;
  //     const durations = {
  //         "easy": 15 * 60 * 1000, // 15 min
  //         "medium": 30 * 60 * 1000, // 30 min
  //         "hard": 60 * 60 * 1000 // 60 min
  //     };
  //     if (guesser_data.answer.bus.time_period !== null) {
  //       var duration = guesser_data.answer.bus.time_period
  //     } else {
  //       var duration = durations[bus.difficulty]
  //     }
  //     if (bus.timestamp && now - bus.timestamp >= duration) {
  //       await announce_and_reset_answer('metro', guesser_data.settings.announcements.bus);
  //     }
  //   } catch (err) {
  //     console.error('bus_geoguessr round failed to automatically end due to:', err);
  //   }
  // }, 1 * 60 * 1000);

  // Ends a metro_guesser game
  setInterval(async () => {
    try {
      const now = Date.now();
      const metro = guesser_data.answer.metro;
      const durations = {
          "easy": 15 * 60 * 1000, // 15 min
          "medium": 30 * 60 * 1000, // 30 min
          "hard": 60 * 60 * 1000 // 60 min
      };
      if (guesser_data.answer.metro.time_period !== null) {
        var duration = guesser_data.answer.metro.time_period
      } else {
        var duration = durations[metro.difficulty]
      }
      if (metro.timestamp && now - metro.timestamp >= duration) {
        await announce_and_reset_answer('metro', guesser_data.settings.announcements.metro);
      }
    } catch (err) {
      console.error('metro_guesser round failed to automatically end due to:', err);
    }
  }, 1 * 60 * 1000);
})();

// ---Command Processing--- //

// Listen for slash command interactions
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand() && !interaction.isAutocomplete() && !interaction.isChatInputCommand()) return;
  const user_id = interaction.user.id; // Get user ID once

  // Create or update the user's session
  if (!user_sessions.has(user_id)) {
    // Initialize session with user_id
    user_sessions.set(user_id, {
      user_id,
      application_id: interaction.applicationId,
      token: interaction.token,
    });
  }
  const session = user_sessions.get(user_id);
  const used_triggers = [
    'derailment', 'long island', '666', 'zhongtong', 'aiscream', 'tunnel', 'traffic', 'ng chee meng', 'tengah', 'lrt']

  // --- Heatmap processing (/heatmap) ---
  if (interaction.commandName === 'heatmap') {
    const subcommand_group = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();

    // Handle different top-level branches.
    if (subcommand_group === 'datamall') {
      if (subcommand === 'default_key') {
        const datamall_keys = {1: datamall_api_key_1, 2: datamall_api_key_2}
        const key_num = interaction.options.getInteger('key_num')
        session.datamall_key = datamall_keys[key_num]
        await interaction.reply({ content: `Datamall set to default key ${key_num}.`, flags: MessageFlags.Ephemeral });
      } else if (subcommand === 'own_key') {
        session.datamall_key = interaction.options.getString('key') ?? datamall_api_key_1;
        await interaction.reply({ content: `Your account key ${session.datamall_key} has been saved.`, flags: MessageFlags.Ephemeral });
      } else if (subcommand === 'params') {
        session.year = interaction.options.getInteger('year');
        session.month = String(interaction.options.getInteger('month')).padStart(2, '0');
        session.source = interaction.options.getString('source') ?? 'datamall';
        session.datamall_date = `${session.year}${session.month}`
        await interaction.reply({ content: `Datamall parameters updated:\n- Date: ${session.year}/${session.month}\n- Source: ${session.source}`, flags: MessageFlags.Ephemeral });
      }
    } else if (subcommand_group === 'busrouter') {
      if (subcommand === 'params') {
        session.year2 = interaction.options.getInteger('year')
        session.month2 = String(interaction.options.getInteger('month')).padStart(2, '0');
        session.busrouter_date = `${session.year2}${session.month2}`;
        await interaction.reply({ content: `BusRouter parameters updated:\n- Date: ${session.year2}/${session.month2}`, flags: MessageFlags.Ephemeral });
      }
    } else if (subcommand_group === 'type') {
      if (subcommand === 'by_bus_service') {
        session.heatmap_type = "by_bus_svc";
        session.svc = interaction.options.getString('bus_svc');
        session.dir = interaction.options.getInteger('direction') ?? 1;
        session.split_svc = interaction.options.getString('split_service') ?? "Full route";
        session.weightage = interaction.options.getBoolean('weightage') ?? false;
        session.freq = interaction.options.getString('freq') ?? "avg";
        const freq_names = {
          avg: "Average",
          am: "AM Average", 
          pm: "PM Average",
          am_peak: "AM Peak",
          pm_peak: "PM Peak",
          am_offpeak: "AM Off-peak",
          pm_offpeak: "PM Off-peak"
        }
        session.by_bus_svc_params_info = [`- Bus service: ${session.svc} ${
          (session.split_svc && session.split_svc !== "Full route")
          ? ` ${session.split_svc}`
          : ""}`,
        `- Direction: ${session.dir}`,
        `- Service weightage: ${session.weightage}`,
        `- Frequency type: ${freq_names[session.freq]}`].join('\n');
        await interaction.reply({ content: 'You have selected heatmap generation of type "By Bus Service" with parameters:\n' + session.by_bus_svc_params_info, flags: MessageFlags.Ephemeral });
      } else if (subcommand === 'by_mrt_line') {
        session.heatmap_type = "by_mrt_line";
        session.svc = interaction.options.getString('line_1');
        session.svc2 = interaction.options.getString('line_2') ?? session.svc;
        session.dir = interaction.options.getInteger('direction_1') ?? 1;
        session.dir2 = interaction.options.getInteger('direction_2') ?? session.dir;
        session.weightage = interaction.options.getBoolean('weightage') ?? false;
        session.freq = interaction.options.getString('freq') ?? "avg";
        session.by_mrt_line_params_info = [`- MRT/LRT line 1: ${session.svc}`,
        `- MRT/LRT line 2: ${session.svc2}`,
        `- Direction of line 1: ${session.dir}`,
        `- Direction of line 2: ${session.dir2}`].join('\n');
        await interaction.reply({ content: 'You have selected heatmap generation of type "By MRT/LRT Line" with parameters:\n' + session.by_mrt_line_params_info, flags: MessageFlags.Ephemeral });
      } else if (subcommand === 'by_specific_stops') {
        session.heatmap_type = "by_specific_stops";
        const ori_stops = interaction.options.getString('origin_stops');
        session.ori_stops = ori_stops.replace(/\s+/g, '').split(',')
        const dst_stops = interaction.options.getString('destination_stops');
        session.dst_stops = dst_stops.replace(/\s+/g, '').split(',')
        session.by_specific_stops_params_info = `- Origin stops: ${session.ori_stops}\n- Destination stops: ${session.dst_stops}`
        await interaction.reply({ content: 'You have selected heatmap generation of type "By Specific Bus Stops" with parameters:\n' + session.by_specific_stops_params_info, flags: MessageFlags.Ephemeral });
      } else if (subcommand === 'by_specific_stns') {
        session.heatmap_type = "by_specific_stns";
        const ori_stops = interaction.options.getString('origin_stations');
        session.ori_stops = ori_stops.toUpperCase().replace(/\s+/g, '').split(',')
        const dst_stops = interaction.options.getString('destination_stations');
        session.dst_stops = dst_stops.toUpperCase().replace(/\s+/g, '').split(',')
        session.by_specific_stop_params_info = `- Origin stations: ${session.ori_stops}\n- Destination stations: ${session.dst_stops}`
        await interaction.reply({ content: 'You have selected heatmap generation of type "By Specific MRT/LRT Stations" with parameters:\n' + session.by_specific_stns_params_info, flags: MessageFlags.Ephemeral });
      } else if (subcommand === 'by_specific_stop') {
        session.heatmap_type = "by_specific_stop";
        const ori_stops = interaction.options.getString('stops');
        session.ori_stops = ori_stops.toUpperCase().replace(/\s+/g, '').split(',')
        session.by_specific_stop_params_info = `- Stops: ${session.ori_stops}`
        await interaction.reply({ content: 'You have selected heatmap generation of type "By Specific Bus Stop Tap In/Out Volume" with parameters:\n' + session.by_specific_stop_params_info, flags: MessageFlags.Ephemeral });
      } else if (subcommand === 'by_specific_stn') {
        session.heatmap_type = "by_specific_stn";
        const ori_stops = interaction.options.getString('stations');
        session.ori_stops = ori_stops.toUpperCase().replace(/\s+/g, '').split(',')
        session.by_specific_stn_params_info = `- Stations: ${session.ori_stops}`
        await interaction.reply({ content: 'You have selected heatmap generation of type "By Specific MRT/LRT Station Tap In/Out Volume" with parameters:\n' + session.by_specific_stn_params_info, flags: MessageFlags.Ephemeral });
      }
    } else if (subcommand_group === 'stop_names') {
        await interaction.reply({content: 'This does nothing yet for now lah.', flags: MessageFlags.Ephemeral},)
        // if (subcommand === 'by_bus_service') {
        // 	session.rows = interaction.options.getBoolean('rows') ?? false;
        //   session.cols = interaction.options.getBoolean('columns') ?? false;
        //   await interaction.reply({ content: `Your heatmap bus stop dislays for type "By bus service" are now\nRows: ${session.rows}\nColumns: ${session.cols}`, flags: MessageFlags.Ephemeral });
        // } else if (subcommand === 'by_specific_stops') {
        //   session.cells = interaction.options.getBoolean('cells') ?? false;
        //   await interaction.reply({ content: `Your heatmap bus stop displays for type "By specific stops" are now\nIn cells: ${session.cells}`, flags: MessageFlags.Ephemeral });
        // }
    } else if (subcommand_group === 'filters') {
      if (subcommand === 'time_period') {
        const period = interaction.options.getString('period');  // e.g., "period1", "period2", etc.
        const time_since = interaction.options.getInteger('time_since');
        const time_until = interaction.options.getInteger('time_until');
      
        // Ensure the session property is initialized correctly
        session.time_periods = {};
        if (time_since === null || time_until === null) {
          delete session.time_periods[period]
        } else {
          session.time_periods[period] = [time_since, time_until];
        }
      
        let time_period_msg = "Your time period filters:\n";
        // Loop over the potential periods (assuming "period1" through "period4")
        if (session.time_periods !== null && Object.keys(session.time_periods).length > 0) {
          for (let i = 1; i <= 4; i++) {
            const period_key = `period${i}`;
            const period_num = session.time_periods[period_key];
            if (period_num && period_num[0] !== null && period_num[1] !== null) {
              time_period_msg += `Period ${i}: From ${format_time(period_num[0], ['mm'])} to ${format_time(period_num[1], ['mm'])}\n`;
            }
          }
        } else {
          time_period_msg = "No time period filters have been set.";
        }
        await interaction.reply({ content: time_period_msg, flags: MessageFlags.Ephemeral });
      } else if (subcommand === 'day_type') {
          const day_type_names = {
            weekday: 'Weekday',
            weekend_ph: 'Weekend / Public Holidays',
            combined: 'Combined'
          }
          session.day_type = interaction.options.getString('type') ?? "combined";
          const day_type_name = day_type_names[session.day_type]
          await interaction.reply({ content: `Your day type filters are now ${day_type_name}`, flags: MessageFlags.Ephemeral });
        }
      }
    else if (subcommand === 'check') {
      const datamall_key = session.datamall_key === datamall_api_key_1 ? 'Using default key 1' : session.datamall_key === datamall_api_key_2 ? 'Using default key 2' : session.datamall_key
      let formatted_period = {};
      for (period in session.time_periods) {
        const hours = session.time_periods[period].map(hour => String(hour).padStart(2, '0') + ":00")
        formatted_period[period] = `From ${hours.join(' to ')}`
      }
      const heatmap_type_names = {
        by_bus_svc: 'By Bus Service',
        by_mrt_line: 'By MRT/LRT Line',
        by_specific_stops: 'By Specific Bus Stops',
        by_specific_stns: 'By Specific MRT/LRT Stations',
        by_specific_stop: 'By Specific Bus Stop Tap In/Out volume',
        by_specific_stns: 'By Specific MRT/LRT Station Tap In/Out Volume'
      }
      await interaction.reply({ content: `${
        [`Check your params ah, make sure nothing is missing:`,
          `--- General Settings ---`,
          `- Datamall Key: ${datamall_key}`,
          `- Datamall Date: ${session.year}/${session.month}`,
          `- Datamall Source: ${session.source}`,
          `- BusRouter Date: ${session.year2}/${session.month2}`,
          `- Heatmap Type: ${heatmap_type_names[session.heatmap_type]}`,
          `--- Heatmap Type Settings ---`,
          session[`${[session.heatmap_type]}_params_info`] ? `${session[`${[session.heatmap_type]}_params_info`]}` : "**There isn't any heatmap type defined!**",
          `--- Filter Settings ---`,
          `${(session.day_type)
            ? `- Day Type: ${session.day_type}`: '- Day Type: Combined'}`,
          `${(session.time_periods)
            ? [`- Time Periods:`,
              formatted_period?.period1 ? `  - Period 1: ${formatted_period?.['period1']}` : null,
              formatted_period?.period2 ? `  - Period 2: ${formatted_period?.['period2']}` : null,
              formatted_period?.period3 ? `  - Period 3: ${formatted_period?.['period3']}` : null,
              formatted_period?.period4 ? `  - Period 4: ${formatted_period?.['period4']}` : null].filter(c => c !== 'null' && c !== null).join('\n')
            : '- Time Periods: Full Day' }`,
          // `- Stop names displayed for`,
          // `${(session.heatmap_type === "by_bus_svc" || session.heatmap_type === 'by_mrt_line')
          //   ? `Rows: ${session.rows}\nColumns: ${session.cols}`
          //   : `Cells: ${session.cells}` }`
        ].join('\n')}`, flags: MessageFlags.Ephemeral})
    }
    else if (subcommand === 'services') {
      await interaction.deferReply({flags: MessageFlags.Ephemeral});
      if (!session.datamall_key) {
        await interaction.editReply({content: 'Where is your Datamall API key? Indicate with either `/heatmap datamall own_key` or `/heatmap datamall default_key` pls.'})
        return
      }
      const ori = interaction.options.getString('origin_stop');
      const dst = interaction.options.getString('destination_stop');
      const freq = interaction.options.getString('freq') ?? "avg";
      try {
        const data2 = await (await fetch('https://data.busrouter.sg/v1/services.json')).json()
        const data3 = await (await fetch('https://data.busrouter.sg/v1/stops.json')).json()
        const data4 = await (await fetch(`https://stcraft.myddns.me/datamall-proxy?data_type=services&data_type2=bus&account_key=${encodeURIComponent(session.datamall_key)}`)).json()
        const cfm_routes = await service_weighing(data2, data4, ori, dst, freq)
        let msg = `From ${data3[ori][2]} (${ori}) to ${data3[dst][2]} (${dst}):`
        for (svc in cfm_routes) {
          for (dir in cfm_routes[svc]) {
            if (freq === 'avg') {var freq_msg = 'on average'}
            else {var freq_msg = `for the ${freq.toUpperCase()} period`}
            msg = msg + `\n- ${svc} direction ${dir}: ${cfm_routes[svc][dir].diff_dist} km, frequency is ${Number(cfm_routes[svc][dir].freq)} min ${freq_msg}.`
          }
        }
        await interaction.editReply({content: msg})
      } catch (err) {
        await interaction.editReply({content: `Somewhere somehow something happened, and you ain't getting your service information...\n${err.name}: ${err.message}`})
      }
    }
    else if (subcommand === 'generate') {
      // 1. Defer reply immediately
      await interaction.deferReply();
      if (!session.datamall_date) {
        await interaction.editReply({content: 'Where is your Datamall date? Indicate the year/month with `/heatmap datamall params` pls.'})
        return
      }
      if (!session.busrouter_date) {
        await interaction.editReply({content: 'Where is your BusRouter date? Indicate the year/month with `/heatmap busrouter params` pls.'})
        return
      }
      if (!session.datamall_key) {
        await interaction.editReply({content: 'Where is your Datamall API key? Indicate with either `/heatmap datamall own_key` or `/heatmap datamall default_key` pls.'})
        return
      }
      if (!session.heatmap_type) {
        await interaction.editReply({content: 'Where is your heatmap type? Key in your heatmap parameters with `/heatmap type` pls.'})
        return
      }
      try {  
        session.user_profile = client.users.cache.get(user_id) || await client.users.fetch(user_id)
        // Encrypt Datamall acc key so that special chars appear
        const encoded_account_key = encodeURIComponent(session.datamall_key)
        // Pack the things nicely
        const data = {
          service: session.svc,
          direction: session.dir,
          service_2: session.svc2,
          direction_2: session.dir2, 
          origin_stops: session.ori_stops, 
          destination_stops: session.dst_stops,
          day_type_filter: session.day_type,
          time_period_filters: session.time_periods,
          user_id: user_id,
          username: session.user_profile.username,
          heatmap_type: session.heatmap_type,
          datamall_date: session.datamall_date,
          busrouter_date: session.busrouter_date,
          source: session.source,
          svc_weighing: session.weightage,
          freq: session.freq,
          encoded_account_key
        }
        // Run the heatmap generator
        const response = await post_heatmap(data, interaction)
        // Reply to user to wait
        return interaction.editReply({content: response, ephemeral: false});
      } catch (err) {
        console.log('Error in heatmap generation due to ' + err)
        await interaction.editReply({content: `Somewhere somehow something happened, and you ain't getting your heatmap...\nError: ${err.stack}`, ephemeral: false})
      }
    }
  }

  // --- Copypasta Processing (/copypasta) ---
  if (interaction.commandName === 'copypasta') {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'add') {
      const modal = new ModalBuilder()
      .setCustomId('copypasta')
      .setTitle('Modify copypastas')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('trigger')
            .setLabel('The trigger of the copypasta')
            .setStyle(TextInputStyle.Short)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reply')
            .setLabel('The reply of the copypasta')
            .setStyle(TextInputStyle.Paragraph)
        )
      );
      return interaction.showModal(modal);
    } else if (subcommand === 'remove') {
      const trigger = interaction.options.getString('trigger').toLowerCase();
      if (trigger.toLowerCase() in copypasta_list.copypastas) {
        try {
          update_copypastas(trigger, null, 'remove')
          await interaction.reply({content: `"${trigger}" copypasta gone liao"`, ephemeral: false});
        } catch (err) {
          console.error('Error removing copypasta due to ', err.message);
          await interaction.reply({content: "Sorry ah, your copypasta cannot be deleted cause of this lor: " + err.message, ephemeral: false});
          throw err;
        }
      } else {
        await interaction.reply({content: `"${trigger}" copypasta doesn't exist, try something else leh...`, ephemeral: false});
      }
    }
  }

  // --- Point system for guesser games (/guesser) ---
  if (interaction.commandName === 'guesser') {
    const current_time = Date.now()
    const subcommand_group = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();
    const restricted_commands = ['plus', 'minus', 'set', 'reset_user', 'reset_all', 'check_others', 'leaderboard']
    const wrapped_user_id = `<@${user_id}>`
    const admin_ids = [team_id, mg_id]
    if (subcommand_group === 'points' && restricted_commands.includes(subcommand)) {
      if (!interaction.member.roles.cache.some(role => admin_ids.includes(role.id)) || !interaction.member.roles) {
        return interaction.reply({content: 'This command cannot be used by you. Think you can change your own points, reset points or see the leaderboard before the month ends? Nuh-uh.', flags: MessageFlags.Ephemeral});
      }
    }
    if (subcommand_group === 'settings') {
      if (!interaction.member.roles.cache.some(role => admin_ids.includes(role.id)) || !interaction.member.roles) {
        return interaction.reply({content: 'This command cannot be used by you. Think you can change the guesser game settings? Nuh-uh.', flags: MessageFlags.Ephemeral});
      }
    }
    if (subcommand_group === 'set_answer') {
      if (!interaction.member.roles.cache.some(role => admin_ids.includes(role.id)) || !interaction.member.roles) {
        return interaction.reply({content: 'This command cannot be used by you. Think you can change the answer of the guesser games? Nuh-uh.', flags: MessageFlags.Ephemeral});
      }
    }
    if (subcommand_group === 'reset_answer') {
      if (!interaction.member.roles.cache.some(role => admin_ids.includes(role.id)) || !interaction.member.roles) {
        return interaction.reply({content: 'This command cannot be used by you. Think you can reset the answer of the guesser games? Nuh-uh.', flags: MessageFlags.Ephemeral});
      }
    }
    if (subcommand_group === 'points') {
      const type_req_types = ['plus', 'minus', 'set', 'check', 'check_others', 'reset_user', 'reset_all', 'leaderboard']
      const value_req_types = ['plus', 'minus', 'set']
      const guesser_user_req_types = ['plus', 'minus', 'set', 'check_others']
      const defer_replies = ['plus', 'minus', 'set', 'reset_user', 'reset_all']
      const type = type_req_types.includes(subcommand) ? interaction.options.getString('type') : undefined
      const value = value_req_types.includes(subcommand) ? interaction.options.getInteger('value') : undefined
      const guesser_user = guesser_user_req_types.includes(subcommand) ? interaction.options.getString('guesser_user') : undefined
      // Add a new user profile if there isn't one
      await new_guesser_profile(wrapped_user_id)
      const current_points = guesser_user_req_types.includes(subcommand) ? guesser_data.users[guesser_user][type].points : undefined
      const types = {'bus': 'for bus_geoguessr', 'metro': 'for metro_guesser', 'metro_hard': 'for hard metro_guesser', 'overall': 'overall', 'all': 'for all types'}
      if (defer_replies.includes(subcommand)) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      }
      if (subcommand === 'plus') {
        await update_points(guesser_user, type, 'plus', value)
        await interaction.editReply({content: `Added ${value} points to ${guesser_user} ${types[type]}, they had ${current_points} points, now they have ${guesser_data.users[guesser_user][type].points} points.`, allowedMentions: {users: []}})
      } else if (subcommand === 'minus') {
        if (current_points - value < 0) {
          await interaction.editReply({content: `You cannot remove ${value} points from this user since their points will be below 0! They currently have ${current_points} points.`})
          return
        }
        await update_points(guesser_user, type, 'minus', value)
        await interaction.editReply({content: `Removed ${value} points from ${guesser_user} ${types[type]}, they had ${current_points} points, now they have ${guesser_data.users[guesser_user][type].points} points.`, allowedMentions: {users: []}})
      } else if (subcommand === 'set') {
        await update_points(guesser_user, type, 'set', value)
        await interaction.editReply({content: `Set ${guesser_user}'s points to ${value} ${types[type]}, they had ${current_points} points, now they have ${guesser_data.users[guesser_user][type].points} points.`, allowedMentions: {users: []}})
      } else if (subcommand === 'reset_user') {
        const guesser_user = interaction.options.getString('guesser_user')
        const type = interaction.options.getString('type')
        const current_points = guesser_data.users[guesser_user][type].points
        await reset_points(guesser_user, type, 'user')
        await interaction.editReply({content: `Reset ${guesser_user}'s points to 0 ${types[type]}${type !== 'all' ? `, they had ${current_points} points.` : '.'} `, allowedMentions: {users: []}})
      } else if (subcommand === 'reset_all') {
        await reset_points(null, type, 'all')
        await interaction.editReply({content: `The points have been reset for all users ${types[type]}.`})
      } else if (subcommand === 'check') {
          const rank = guesser_data.users[wrapped_user_id]?.overall.rank ?? 0
          if (rank === 0) {
            await interaction.reply({content: "You did not participate in this month's guesser games...", flags: MessageFlags.Ephemeral});
          } else {
            const pts = guesser_data.users[wrapped_user_id][type].points
            await interaction.reply({content: `You have ${pts} points ${types[type]}. Keep competing, and stay tuned for future updates!`, flags: MessageFlags.Ephemeral});
          }
      } else if (subcommand === 'check_others') {
        const rank = guesser_data.users[guesser_user][type].rank
        if (rank === 0 || rank === undefined) {
          await interaction.reply({content: `${guesser_user} has yet to participate in this month's guesser games.`, flags: MessageFlags.Ephemeral, allowedMentions: {users:[]}})
        } else {
          await interaction.reply({content: `${guesser_user} ${type !== 'overall' ? `has ${current_points} points,` : 'is'} currently the top ${rank} ${types[type]}!`, flags: MessageFlags.Ephemeral, allowedMentions: {users: []}})
        }
      } else if (subcommand === 'leaderboard') {
        const announce = guesser_data.settings.announce_leaderboard
        await interaction.deferReply({ephemeral: !announce})
        const leaderboard = check_leaderboard(type)
        await interaction.editReply({content: leaderboard, allowedMentions: {users: []}})
      }
    } else if (subcommand_group === 'settings') {
        if (subcommand === 'monthly_reset') {
          const reset_points = interaction.options.getBoolean('reset_points') ?? true
          guesser_data.settings.monthly_reset = reset_points
          await save_to_drive('points')
          await interaction.reply({content: `The points for the guesser games will${reset_points ? ' ' : ' not '}reset next month.`, flags: MessageFlags.Ephemeral})
        } else if (subcommand === 'announce_leaderboard') {
          const announce = interaction.options.getBoolean('public_announce') ?? false
          guesser_data.settings.announce_leaderboard = announce
          await save_to_drive('points')
          await interaction.reply({content: `The leaderboard for the guesser games will${announce ? ' ' : ' not '}be announced when command to show leaderboard is ran.`, flags: MessageFlags.Ephemeral})
        } else if (subcommand === 'check') {
          let lines = Object.entries(guesser_data.settings).map(([key, val]) => `- ${key}: ${val}`);
          const annc_index = lines.indexOf('announcements')
          lines = lines.splice(annc_index, 1)
          lines = lines.splice(annc_index, 0, [`- announcements:` +
          `  - bus_geoguessr: <#${guesser_data.settings.announcements.bus}>` +
          `  - metro_guesser: <#${guesser_data.settings.announcements.metro}>` +
          `  - hard metro_guesser: <#${guesser_data.settings.announcements.metro_hard}>`
          ].join('\n'))
          const message = `--- Guesser Settings ---\n\n${lines.join('\n')}`;
          await interaction.reply({content: message, flags: MessageFlags.Ephemeral});
        } else if (subcommand === 'annc_channels') {
          if (!guesser_data.settings.announcements) guesser_data.settings.announcements = {}
          const types = {'bus': 'bus_geoguessr', 'metro': 'metro_guesser', 'metro_hard': 'hard metro_guesser'}
          const type = interaction.options.getString('type')
          const channel_id = interaction.options.getString('channel_id')
          guesser_data.settings.announcements[type] = channel_id
          await save_to_drive('points')
          await interaction.reply({content: `The announcement channel for ${types[type]} has been set to <#${channel_id}>.`, flags: MessageFlags.Ephemeral})
        } else if (subcommand === 'show_leaderboard_until') {
          let rank = interaction.options.getInteger('rank') ?? 10
          if (rank === 0) rank = 1000;
          guesser_data.settings.show_leaderboard_until = rank
          await save_to_drive('points')
          await interaction.reply({content: `The leaderboard for the guesser games will be shown up to the ${ordinal(rank)} place.`, flags: MessageFlags.Ephemeral})
        }
    } else if (subcommand_group === 'set_answer') {
      const types = {'bus_geoguessr': 'bus', 'metro_guesser': 'metro', 'hard_metro_guesser': 'metro_hard'}
      const correct_ans = guesser_data.answer[types[subcommand]]
      if (subcommand === "bus_geoguessr") {
        let stop_list = null
        correct_ans.question_num = interaction.options.getInteger('question_num')
        correct_ans.accuracy = interaction.options.getString('accuracy') ?? null
        if (correct_ans.accuracy === 'Bus stop name') stop_list = await (await fetch('https://data.busrouter.sg/v1/stops.json')).json()
        correct_ans.bus_svc = interaction.options.getString('bus_svc') ?? null
        correct_ans.road1 = interaction.options.getString('road1') ?? null
        correct_ans.road2 = interaction.options.getString('road2') ?? null
        correct_ans.bus_stop_code = interaction.options.getString('bus_stop_code') ?? null
        correct_ans.accuracy === 'Bus stop name' ? correct_ans.bus_stop_name = stop_list[correct_ans.bus_stop_code][2] : correct_ans.bus_stop_name = null
        correct_ans.twist_ans = interaction.options.getString('twist_ans') ?? null
        correct_ans.twist_desc = interaction.options.getString('twist_desc') ?? null
        correct_ans.difficulty = interaction.options.getString('difficulty') ?? null
        correct_ans.threshold = interaction.options.getInteger('threshold')/100 ?? 0.7
        correct_ans.time_period = interaction.options.getInteger('minutes') ?? null
        correct_ans.timestamp = current_time
        correct_ans.points = interaction.options.getInteger('points') ?? null
        correct_ans.guess_count = interaction.options.getInteger('guess_count') ?? 1
        correct_ans.submitter = interaction.options.getString('submitter') ?? '<@1444181274955747479>'
        correct_ans.desc = interaction.options.getString('description') ?? [
          `${correct_ans.question_num} (${correct_ans.difficulty})`,`${correct_ans.accuracy ? `Degree of accuracy: ${correct_ans.accuracy}` : 'There is no specific degree of accuracy this time.'}`,
          `${correct_ans.road2 ? '2 road names are needed since degree of accuracy requires it. Whichever road the bus was on is **always** the first.' : null}`,
          `${correct_ans.twist_ans ? `Twist: ${correct_ans.twist_desc}` : null}`
        ].filter(c => c !== 'null' && c !== null).join('\n\n')
        if (correct_ans.twist_ans !== null && correct_ans.twist_desc === null) {
          return await interaction.reply({content: 'Twist answers must come with twist descriptions!', flags: MessageFlags.Ephemeral})
        }
        correct_ans.guessers = {}
        const files = await list_files(bus_geoguessr_folder_id)
        const image_file = files.find(n => [`${correct_ans.question_num}.png`, `${correct_ans.question_num}.jpg`].includes(n.name));
        const image_file_id = image_file.id ?? null
        if (!image_file_id) {
          return await interaction.reply({content: `You do not have an image in the [Bus Geoguessr](https://drive.google.com/drive/folders/1WZUdKz6zW5yrfDsEpbps5NcmKqjCl6ip) folder that is named ${correct_ans.question_num}.png/jpg !`, flags: MessageFlags.Ephemeral})
        }
        const image_buffer = await load_from_drive('image', image_file_id)
        const image = new AttachmentBuilder(image_buffer, {name: 'image.png'})
        const channel = await client.channels.fetch(guesser_data.settings.announcements.bus);
        // const durations = {
        //     "easy": 15 * 60 * 1000, // 15 min
        //     "medium": 30 * 60 * 1000, // 30 min
        //     "hard": 60 * 60 * 1000 // 60 min
        // };
        if (correct_ans.difficulty === null) { // && correct_ans.points === null) {
          return await interaction.reply({content: 'You need to provide the difficulty!', flags: MessageFlags.Ephemeral}) // or the number of points to award! If custom points is used, the default points awarded by the diffucilty **overrides** it.
        }
        // if (correct_ans.time_period !== null) {
        //   correct_ans.time_period = correct_ans.time_period * 60 * 1000
        // } else {
        //   correct_ans.time_period = durations[correct_ans.difficulty]
        // }
        const msg = [
          `bus_geoguessr answer has been set to:`,
          ``,
          `Accuracy: ${correct_ans.accuracy}`,
          `Bus serivce: ${correct_ans.bus_svc}`,
          `Road name 1: "${correct_ans.road1}"`,
          `Road name 2: "${correct_ans.road2}"`,
          `Twist answer: ${correct_ans.twist_ans}`,
          `Twist description: ${correct_ans.twist_desc}`,
          `Difficulty: ${correct_ans.difficulty}`,
          // correct_ans.modifier ? `Today's modifier is "${correct_ans.modifier}".` : `There are no modifiers today.`,
          `Threshold: ${correct_ans.threshold}`,
          `Guess count: **Unimplemented**`, // ${correct_ans.guess_count}
          `Time period: **Unimplemented**`, // ${correct_ans.time_period / 60000 } minutes
          `Points: **Unimplemented**`, // ${correct_ans.points}
          `Submitter of question: ${correct_ans.submitter}`
        ].join('\n');
        await interaction.reply({content: msg, flags: MessageFlags.Ephemeral})
        await channel.send({content: correct_ans.desc, files: [image]})
        await save_to_drive('points')
      } else if (subcommand === "metro_guesser") {
        correct_ans.question_num = interaction.options.getInteger('question_num')
        correct_ans.city = interaction.options.getString('city')
        correct_ans.region = interaction.options.getString('region')
        correct_ans.transport_mode = interaction.options.getString('mode')
        correct_ans.line1 = interaction.options.getString('line1')
        correct_ans.line2 = interaction.options.getString('line2') ?? null
        correct_ans.consec_length = interaction.options.getInteger('consec_length') ?? 0
        correct_ans.threshold = interaction.options.getInteger('threshold')/100 ?? 0.7
        correct_ans.time_period = interaction.options.getInteger('minutes') ?? null
        correct_ans.guess_count = interaction.options.getInteger('guess_count') ?? 1
        correct_ans.line_col = interaction.options.getString('line_col') ?? null
        correct_ans.degree = interaction.options.getInteger('degree') ?? null
        const now = new Date()
        const today = now.toLocaleString('default',{weekday:'short'})
        const modifiers = {'Mon': 'NCM', 'Wed': 'RW', 'Fri': 'NSF'};
        correct_ans.difficulty = interaction.options.getString('difficulty') ?? null
        correct_ans.timestamp = current_time
        correct_ans.modifier = modifiers[today] ?? null
        correct_ans.points = interaction.options.getInteger('points') ?? null
        correct_ans.submitter = interaction.options.getString('submitter')
        correct_ans.guessers = {}
        const files = await list_files(metro_guesser_folder_id)
        const image_file = files.find(n => [`${correct_ans.question_num}.png`, `${correct_ans.question_num}.jpg`].includes(n.name));
        const image_file_id = image_file.id ?? null
        if (!image_file_id) {
          return await interaction.reply({content: `You do not have an image in the [Metroguesser](https://drive.google.com/drive/folders/1Zy_lRi3AwW_XBoTcjmDjDPzTgM4wZZgR) folder that is named ${correct_ans.question_num}.png/jpg !`, flags: MessageFlags.Ephemeral})
        }
        const image_buffer = await load_from_drive('image', image_file_id)
        const image = new AttachmentBuilder(image_buffer, {name: 'image.png'})
        const channel = await client.channels.fetch(guesser_data.settings.announcements.metro);
        if (correct_ans.difficulty === null && correct_ans.points === null) {
          return await interaction.reply({content: 'You need to provide either the difficulty or the number of points to award! If custom points is used, the default points awarded by the difficulty **overrides** it.', flags: MessageFlags.Ephemeral})
        }
        if (correct_ans.line2 !== null) {
          const check_line2 = check_ans('', correct_ans.line2, correct_ans.consec_length)
          if (typeof(check_line2) === 'string') {
            return await interaction.reply({content: check_line2, flags: MessageFlags.Ephemeral})
          } 
        }
        if (correct_ans.modifier === 'RW' && correct_ans.degree === null) {
          return await interaction.reply({content: "Today's modifier is Rotated Wednesdays, provide the degree of rotation!", flags: MessageFlags.Ephemeral})
        }
        const durations = {
            "easy": 15 * 60 * 1000, // 15 min
            "medium": 30 * 60 * 1000, // 30 min
            "hard": 60 * 60 * 1000 // 60 min
        };
        if (correct_ans.time_period !== null) {
          correct_ans.time_period = correct_ans.time_period * 60 * 1000
        } else {
          correct_ans.time_period = durations[correct_ans.difficulty]
        }
        if (correct_ans.city === null || correct_ans.line1 === null) {
          return await interaction.reply({content: "You need to at least provide the city and the short line name!", flags: MessageFlags.Ephemeral})
        } else {
          const difficulty_format = {
            'easy': 'Easy',
            'normal': 'Normal',
            'hard': 'Hard'
          }
          let accepted_names = 'Short'
          if (correct_ans.line2) accepted_names += ' and long'
          if (correct_ans.line2) accepted_names += ' line names'; else accepted_names += ' line name'
          if (correct_ans.line_col) accepted_names += ', line colour'
          const msg = [
            `metro_guesser answer has been set to:`,
            ``,
            `City: ${correct_ans.city}`,
            `Short line name: ${correct_ans.line1}`,
            `Long line name: ${correct_ans.line2}`,
            `Consecutive words: ${correct_ans.consec_length}`,
            `Line colour: ${correct_ans.line_col}`,
            `Rotation degree: ${correct_ans.degree}`,
            `Difficulty: ${correct_ans.difficulty}`,
            correct_ans.modifier ? `Today's modifier is ${correct_ans.modifier}.` : `There are no modifiers today.`,
            `Guess count: ${correct_ans.guess_count}`,
            `Time period: ${correct_ans.time_period / 60000 } minutes`,
            `Points: ${correct_ans.points}`,
            `Submitter of question: ${correct_ans.submitter}`
          ].join('\n');
          console.log(msg)
          const qn_content = [
            `# Line No. ${correct_ans.question_num}`,
            `**Difficulty**: ${difficulty_format[correct_ans.difficulty]}`,
            `**Region**: ${correct_ans.region}`,
            `**Mode**: ${correct_ans.transport_mode}`,
            `**Accepted names**: ${accepted_names}`,
            `**Guesses available**: ${correct_ans.guess_count}\n`,
            `**Deadline for guess**: <t:${Math.round((correct_ans.timestamp + correct_ans.time_period)/1000)}:R>`
          ].join('\n')
          await interaction.reply({content: msg, flags: MessageFlags.Ephemeral})
          await channel.send({content: qn_content, files: [image]})
          await save_to_drive('points')
        }
      } else if (subcommand === "hard_metro_guesser") {
        // Hard metro_guesser processing here...
        await interaction.reply({content: "This does nothing yet leh...", flags: MessageFlags.Ephemeral})
      }
    } else if (subcommand === 'reset_answer') {
      const types = {'bus': 'for bus_geoguessr', 'metro': 'for metro_guesser', 'metro_hard': 'for hard metro_guesser', 'all': 'for all guesser game questions'};
      const type = interaction.options.getString('type')
      reset_ans(type)
      await save_to_drive('points')
      await interaction.reply({content: `The answer ${types[type]} has been reset.`, flags: MessageFlags.Ephemeral})
    } else if (subcommand_group === 'guess') {
      const types = {'bus_geoguessr': 'bus', 'metro_guesser': 'metro', 'hard_metro_guesser': 'metro_hard'}
      const correct_ans = guesser_data.answer[types[subcommand]]
      const guessers = correct_ans.guessers;
      if (Object.keys(correct_ans).length === 0) {
        return await interaction.reply({content: `There is currently no set answer to ${subcommand} leh...`, flags: MessageFlags.Ephemeral})
      }
      if (guessers[wrapped_user_id]?.correct && !['RW'].includes(correct_ans?.modifier)) {
        return await interaction.reply({content: 'You already answered correctly liao, answer again for what?', flags: MessageFlags.Ephemeral})
      }
      if (!guessers[wrapped_user_id]) {
        guessers[wrapped_user_id] = { guesses: 1 };
      } else {
        if (guessers[wrapped_user_id].guesses === correct_ans.guess_count) {
          return await interaction.reply({ content: `You had your go at guessing this question liao. You have spent all ${correct_ans.guess_count}, no more guesses for you! Try again next round.`, flags: MessageFlags.Ephemeral });
        } else {
          guessers[wrapped_user_id].guesses += 1;
        }
      }
      if (correct_ans.time_period && current_time - correct_ans.timestamp > correct_ans.time_period) {
        return await interaction.reply({content: `Aiyoh... the answer submission period has ended liao. You took too long.`, flags: MessageFlags.Ephemeral});
      }
      if (!guesser_data.users?.[wrapped_user_id]) await new_guesser_profile(wrapped_user_id)
      if (subcommand === "bus_geoguessr") {
        await interaction.deferReply({flags: MessageFlags.Ephemeral})
        const bus_svc = interaction.options.getString('bus_svc') ?? null
        const road1 = interaction.options.getString('road1') ?? null
        const road2 = interaction.options.getString('road2') ?? null
        const bus_stop_code = interaction.options.getString('bus_stop_code') ?? null
        const bus_stop_name = interaction.options.getString('bus_stop_name') ?? null
        const twist = interaction.options.getString('twist') ?? null
        let ans_match_bus_svc, ans_match_road1, ans_match_road2, ans_match_twist, ans_match_stop_name
        if (correct_ans.bus_svc !== null) ans_match_bus_svc = bus_svc === correct_ans.bus_svc
        else ans_match_bus_svc = true
        if (correct_ans.road1 !== null) ans_match_road1 = check_ans(road1, correct_ans.road1, 0, correct_ans.threshold, wrapped_user_id)
        else ans_match_road1 = true
        if (correct_ans.road2 !== null) ans_match_road2 = check_ans(road2, correct_ans.road2, 0, correct_ans.threshold, wrapped_user_id)
        else ans_match_road2 = true
        if (correct_ans.twist_ans !== null) ans_match_twist = check_ans(twist, correct_ans.twist_ans, 0, correct_ans.threshold, wrapped_user_id)
        else ans_match_twist = true
        if (correct_ans.bus_stop_name !== null) ans_match_stop_name = check_ans(bus_stop_name, correct_ans.bus_stop_name, 0, wrapped_user_id)
        else ans_match_stop_name = true
        if (ans_match_bus_svc && ans_match_road1 && ans_match_road2 && ans_match_stop_name) {
          correct_ans.guessers[wrapped_user_id].correct = true
          assign_attribute('bus', wrapped_user_id, {ans_match_twist})
          save_to_drive('points')
          await interaction.editReply({content: `${wrapped_user_id !== correct_ans.submitter
            ? `You guessed ${ans_match_twist
              ? 'both answers' 
              : 'only the main answer'} correctly! Keep up the good work.` 
            : `You cannot answer your own submission! Don't anyhow ah.`
          }`, flags: MessageFlags.Ephemeral}) // You have been awarded ${points} points. You now have ${user_points + points} points.
        } else {
          correct_ans.guessers[wrapped_user_id].correct = false
          const content = `${wrapped_user_id !== correct_ans.submitter 
            ? [
              `Your answers excluding twist are incorrect. Did you use the abbreviated forms for road names? Use the full name of the bus stop.`,
              bus_svc ? `- Bus service: ${bus_svc}` : null,
              road1 ? `- Road 1: ${road1}` : null,
              road2 ? `- Road 2: ${road2}` : null,
              bus_stop_code ? `- Bus stop code: ${bus_stop_code}` : null,
              twist ? `- Twist: ${twist}` : null,
              `You used up ${guessers[wrapped_user_id].guesses} guesses, you have ${correct_ans.guess_count - guessers[wrapped_user_id].guesses} guesses left.`
            ].filter(c => c !== 'null' && c !== null).join('\n')
            : `You cannot answer your own submission! Don't anyhow ah.`}`
          await interaction.editReply({content, flags: MessageFlags.Ephemeral})
        }
      } else if (subcommand === "metro_guesser") {
        await interaction.deferReply({flags: MessageFlags.Ephemeral})
        const city = interaction.options.getString('city')
        const line = interaction.options.getString('line')
        const degree = interaction.options.getInteger('degree')
        let ans_match_line2
        let ans_match_line_col
        if (correct_ans.line2 !== null) ans_match_line2 = check_ans(line, correct_ans.line2, correct_ans.consec_length, correct_ans.threshold, wrapped_user_id)
        else ans_match_line2 = false
        if (correct_ans.line_col !== null) ans_match_line_col = check_ans(line, correct_ans.line_col, 0, correct_ans.threshold, wrapped_user_id)
        else ans_match_line_col = false
        if (levenshtein_coefficient(city.toLowerCase(), correct_ans.city.toLowerCase()) >= 0.8 && (check_ans(line, correct_ans.line1, 0, correct_ans.threshold, wrapped_user_id) || ans_match_line2 || ans_match_line_col)) {
          correct_ans.guessers[wrapped_user_id].correct = true
          assign_attribute('bus', wrapped_user_id, {ans_match_twist})
          save_to_drive('points')
          await interaction.editReply({content: `${wrapped_user_id !== correct_ans.submitter ? `You guessed correctly! Keep up the good work.` : `You cannot answer your own submission! Don't anyhow ah.`}`, flags: MessageFlags.Ephemeral})
        } else {
          correct_ans.guessers[wrapped_user_id].correct = false
          save_to_drive('points')
          await interaction.editReply({content: `${wrapped_user_id !== correct_ans.submitter 
            ? `One of your input answers is incorrect. Your city is \"${city}\" and your line name/colour is \"${line}\". You used up ${guessers[wrapped_user_id].guesses} guesses, you have ${correct_ans.guess_count - guessers[wrapped_user_id].guesses} guesses left.`
            : `You cannot answer your own submission! Don't anyhow ah.`}`, flags: MessageFlags.Ephemeral})
        }
      } else if (subcommand === "hard_metro_guesser") {
        await interaction.reply({content: 'Answering for hard metro_guesser is not available at the moment leh...', flags: MessageFlags.Ephemeral})
      }
    } else if (subcommand === "end_game") {
      const game_type = interaction.options.getString('game_type')
      const game_type_names = {
        bus: "Bus Geoguessr",
        metro: "Metroguesser",
        metro_hard: "Hard Metroguesser"
      }
      await announce_and_reset_answer(game_type, guesser_data.settings.announcements[game_type])
      await interaction.reply({content: `A ${game_type_names[game_type]} game has ended.`, flags: MessageFlags.Ephemeral})
    }
  }
  
  if (interaction.commandName === 'bus_models') {
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused();
      const results = await search_models(focused);
      return await interaction.respond(results);
    } else if (interaction.isChatInputCommand()) {
      const model = interaction.options.getString('model')
      if (!data_rows?.[user_id]) return await interaction.reply({content: 'You are not adding a spotting or cameo at the moment!', flags: MessageFlags.Ephemeral})
      data_rows[user_id][6] = model
      return await interaction.reply({content: `Selected ${model}`, flags: MessageFlags.Ephemeral})
    }
  }

  if (interaction.commandName === 'cameo' || interaction.commandName === 'spotting') {
    const subcommand_group = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'add') {
      const modal = new ModalBuilder()
      .setCustomId(`add_bus_${interaction.commandName}`)
      .setTitle(`New bus ${interaction.commandName}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('bus_service')
            .setLabel('The bus service')
            .setStyle(TextInputStyle.Short)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reg_num')
            .setLabel('The registration plate')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('bus_stop')
            .setLabel('The bus stop code or name')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('direction')
            .setLabel('The direction. Put dest bus stop code or name')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('bus_model')
            .setLabel('The bus model (if reg plate unclear)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        )
      );
      return interaction.showModal(modal)
    } else if (subcommand === 'edit') {
      edit_ref_num = interaction.options.getString('ref_num')
      const modal = new ModalBuilder()
      .setCustomId(`edit_bus_${interaction.commandName}`)
      .setTitle(`Edit bus ${interaction.commandName}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('bus_service')
            .setLabel('The bus service')
            .setStyle(TextInputStyle.Short)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reg_num')
            .setLabel('The registration plate')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('bus_stop')
            .setLabel('The bus stop code or name')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('direction')
            .setLabel('The direction. Put dest bus stop code or name')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('bus_model')
            .setLabel('The bus model (if reg plate unclear)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        )
      );
      return interaction.showModal(modal)
    } else if (subcommand === 'delete') {
      edit_ref_num = interaction.options.getString('ref_num')
      const ref_num_list = (res.data.values ?? []).map(row => row[0]);
      const idx = ref_num_list.indexOf(edit_ref_num)
      if (!idx || !edit_ref_num) return await interaction.reply({content: `Invalid reference number ${edit_ref_num}!`})
      await sheets.spreadsheets.values.update({
    
      })
    }
  }

  // --- Amendment Explorer ---
  if (interaction.commandName === 'amendment') {
    const user_id = interaction.user.id;
    await amendment_main(interaction, user_id)
  }

  if (interaction.commandName === 'spotrep') {
    const user_id = interaction.user.id;
    spotrep_sessions[user_id] = [Date.now(), interaction]
    await spotrep_main_embed(interaction, user_id)
  }

  // --- STCraft Verification ---
  if (interaction.commandName === 'verify') {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'minecraft') {
      await interaction.deferReply({flags: MessageFlags.Ephemeral})
      const res = await fetch('http://127.0.0.1:32700/stc-verif', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({user_id: user_id, type: 'add'})
      }) 
      const text = await res.text()
      await interaction.editReply({content: text, flags: MessageFlags.Ephemeral})
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit()) return
  
  if (interaction.customId === 'copypasta') {
    const trigger = interaction.fields.getTextInputValue('trigger').toLowerCase();
    const reply   = interaction.fields.getTextInputValue('reply');
    if (trigger in copypasta_list.copypastas || used_triggers.includes(trigger)) {
      await interaction.reply({content: `"${trigger} copypasta is already used, try something else leh..."`, ephemeral: false});
    } else {
      update_copypastas(trigger, reply, 'add');
      await interaction.reply({content: `"${trigger}" copypasta will now send\n\n"${reply}"`, ephemeral: false});
    }
  }

  if (interaction.customId === 'add_bus_cameo' || interaction.customId === 'add_bus_spotting') {
    let bus_stop_name = null;
    const bus_svc = interaction.fields.getTextInputValue('bus_service')
    const bus_stop = interaction.fields.getTextInputValue('bus_stop') ?? null
    const direction = interaction.fields.getTextInputValue('direction') ?? null
    const reg_num = interaction.fields.getTextInputValue('reg_num') ?? null
    const bus_model = interaction.fields.getTextInputValue('bus_model') ?? null
    const type = interaction.customId === 'add_bus_cameo' ? 'cameo' : 'spotting'
    const type_spr = interaction.customId === 'add_bus_cameo' ? 'Cameos' : 'Spottings'
    const ref_num = get_ref_num(type, user_id)
    if (!await check_bus_svc(bus_svc)) return await interaction.reply({content: `There is no such bus service ${bus_svc}!`})
    if (bus_stop) bus_stop_name = await check_bus_stop(bus_stop)
    if (bus_stop && !bus_stop_name) return await interaction.reply({content: `There is no such bus stop ${bus_stop_name}!`})
    const report_const_list = [ref_num, bus_svc, reg_num, bus_stop_name, direction, bus_model]
    await interaction.reply({content: [
      `Reported a new ${type}!`,
      `- Bus Service: ${bus_svc}${direction ? ` towards ${direction}` : ''}`,
      `${reg_num ? `- Registration Number: ${reg_num}` : null}`,
      `${bus_model ? `- Bus Model: ${bus_model}` : null}`,
      `${bus_stop ? `- Bus Stop: ${bus_stop}` : null}`,
      `- Reference Number: ${ref_num}`
    ].filter(s => s !== null && s !== 'null').join('\n')})
    await save_spreadsheet_row('append', spottings_file_id, [report_const_list], `${type_spr}!A:F`)
  } else if (interaction.customId === 'edit_bus_cameo' || interaction.customId === 'edit_bus_spotting') {
    const bus_svc = interaction.fields.getTextInputValue('bus_service')
    const bus_stop = interaction.fields.getTextInputValue('bus_stop') ?? null
    const direction = interaction.fields.getTextInputValue('direction') ?? null
    const reg_num = interaction.fields.getTextInputValue('reg_num') ?? null
    const bus_model = interaction.fields.getTextInputValue('bus_model') ?? null
    const type = interaction.customId === 'edit_bus_cameo' ? 'cameo' : 'spotting'
    const type_spr = interaction.customId === 'edit_bus_cameo' ? 'Cameos' : 'Spottings'
    if (!await check_bus_svc(bus_svc)) return await interaction.reply({content: `There is no such bus service ${bus_svc}!`})
    const bus_stop_name = await check_bus_stop(bus_stop)
    if (!bus_stop_name) return await interaction.reply({content: `There is no such bus stop ${bus_stop_name}!`})
    const ref_num_list = (res.data.values ?? []).map(row => row[0]);
    const idx = ref_num_list.indexOf(edit_ref_num)
    if (!idx || !edit_ref_num) return await interaction.reply({content: `Invalid reference number ${edit_ref_num}!`})
    if (user_id.slice(user_id.length-5, user_id.length) !== edit_ref_num.slice(1, 6)) return await interaction.reply({content: `You are not the one who reported this ${type}!`}) 
    const report_const_list = [edit_ref_num, bus_svc, reg_num, bus_stop_name, direction, bus_model]
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: spottings_file_id,
      range: `${type_spr}!A:A`
    })
    await save_spreadsheet_row('update', spottings_file_id, [report_const_list], `${type_spr}!A${idx+1}`)
    return await interaction.reply({content: [
      `Your ${type} with reference number ${edit_ref_num} has been updated!`,
      `- Bus Service: ${bus_svc}${direction ? ` towards ${direction}` : ''}`,
      `${reg_num ? `- Registration Number: ${reg_num}` : null}`,
      `${bus_model ? `- Bus Model: ${bus_model}` : null}`,
      `${bus_stop ? `- Bus Stop: ${bus_stop}` : null}`
    ].filter(s => s !== null && s !== 'null').join('\n')})
  }
  
  if (interaction.customId.includes('spotrep')) {
    await spotrep_processes(interaction, interaction.user.id, interaction.customId)
  }
})

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  const type = interaction.customId.split('_')[0]

  // --- Spot-n-Report ---
  if (type === 'spotrep') {
    await spotrep_buttons(interaction)
  }

  // --- Amendment Explorer ---
  if (type === 'amendment') {
    await amendment_buttons(interaction)
  }
});

client.on('interactionCreate', async interaction => {
  // --- Role Info --- DOES NOT WORK
  if (!interaction.isStringSelectMenu()) return
  if (interaction.customId === 'role_select') {
    const roleId = interaction.values[0];
    const role = roles.get(roleId);

    if (!role) {
      return interaction.update({ content: 'Role not found!', components: [] });
    }

    // Prepare role info
    const info = `**${role.name}**\n` +
                `Permissions: ${role.permissions.toArray().join(', ') || 'None'}\n` +
                `Members: ${role.members.map(m => m.user.username).join(', ') || 'None'}`;

    // Update message above dropdown
    await interaction.update({
      content: info,
      components: interaction.message.components // keep dropdown intact
    });
  }
  if (interaction.customId.includes('spotrep')) {
    await spotrep_selects(interaction, interaction.user.id, interaction.customId)
  }
})

client.on('messageCreate', async(message) => {
  if (message.author.bot) return;
  const trigger = message.content.toLowerCase()
  if (trigger in copypasta_list.copypastas) {
    message.channel.send(copypasta_list.copypastas[trigger]);
  }
  if (['1092353498814885948', '1093039702824722532'].includes(message.channelId)) {
    let msg_split = message.content.split(' ')
    const msg_split_alt = message.content.split('. ')
    if (![2, 3].includes(msg_split.length) && !message.content.includes('. ')) return
    if (![2, 3].includes(msg_split.length) && msg_split_alt.length !== 2) return
    if (msg_split_alt.length === 2) msg_split = msg_split_alt[1].split(' ')
    let px_length = null, prefix = null, type = null; type_spr = null;
    if (message.channelId === '1092353498814885948') {type = 'cameo', type_spr = 'Cameos'};
    if (message.channelId === '1093039702824722532') {type = 'spotting', type_spr = 'Spottings'}
    const bus_stop = msg_split_alt.length === 2 ? String(msg_split_alt[0]) : msg_split.length === 3 ? String(msg_split[0]) : null
    const reg_num = msg_split.length === 2 ? String(msg_split[0]) : String(msg_split[1])
    const bus_svc = msg_split.length === 2 ? String(msg_split[1]) : String(msg_split[2])
    if (reg_num.slice(0, 2).toUpperCase() === 'SG') {px_length = 2; prefix = 'SG'};
    if (reg_num.slice(0, 3).toUpperCase() === 'SBS') {px_length = 3; prefix = 'SBS'};
    if (reg_num.slice(0, 3).toUpperCase() === 'SMB') {px_length = 3; prefix = 'SMB'};
    if (!px_length) return;
    const tr_reg_num = reg_num.slice(px_length, reg_num.length)
    const num = tr_reg_num.slice(0, tr_reg_num.length-1).padStart(4, '0')
    if (Number(num) < 1 || !Number(num)) return;
    if (num.length > 4) return;
    const checksum_info = calc_checksum(reg_num, px_length, prefix)
    if(!checksum_info[0]) return await message.reply({content: `Your letter checksum is wrong! The correct checksum is ${checksum_info[1]}`, allowedMentions: {users: []}})
    const ref_num = get_ref_num(type, message.author.id)
    if (!await check_bus_svc(bus_svc)) return await message.reply({content: `There is no such bus service ${bus_svc}!`, allowedMentions: {users: []}})
    const bus_stop_name = await check_bus_stop(bus_stop)
    if (bus_stop && !bus_stop_name) return await message.reply({content: `There is no such bus stop ${bus_stop_name}!`})
    const report_const_list = [ref_num, bus_svc, reg_num, bus_stop_name, null, null]
    await save_spreadsheet_row('append', spottings_file_id, [report_const_list], `${type_spr}!A:F`)
    return await message.reply({content: `Ref num: ${ref_num}`, allowedMentions: {users: []}})
  }
});

client.on('guildMemberRemove', async user => {
  const user_id = user.id
  await fetch('http://127.0.0.1:32700/stc-verif', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({user_id: user_id, type: 'delete'})
  })
})

async function save_to_drive(file) {
  if (file === 'points') {
    save_json(points_file_id, guesser_data)
  } if (file === 'copypastas') {
    save_json(copypastas_file_id, copypasta_list)
  } if (file === 'msg_id_repository') {
    save_json(msg_id_repository_file_id, msg_id_repository)
  } if (file === 'spottings') {
    save_spreadsheet(spottings_file_id, spottings.cameo, 'Cameos!A:F')
    save_spreadsheet(spottings_file_id, spottings.normal, 'Spottings!A:F')
  }
}

async function list_files(id) {
  const res = await drive.files.list({
    q: `'${id}' in parents`,
    fields: 'files(id, name, mimeType)'
  });
  return res.data.files;
}

async function save_json(file_id, raw_data) {
  await drive.files.update({
    fileId: file_id,
    media: {
      mimeType: 'application/json',
      body: JSON.stringify(raw_data, null, 2)
    }
  });
}

async function save_spreadsheet(file_id, raw_data, range) {
  let values = []
  if (file_id === amendments_file_id) {values = [
    ['Approval', 'Date', 'Contributor', 'Type', 'Service(s)', 'Channel', 'Platform', 'Ref. Number', 'Link'], // Header row
    ...raw_data.rating.map((_, i) => [
      raw_data.rating[i], raw_data.date[i], raw_data.user_id[i], raw_data.amendment_type[i], 
      raw_data.svcs[i], 'N.A.', raw_data.platform[i], raw_data.ref_num[i], raw_data.link[i]] // Data row
  )]} else if (file_id === spottings_file_id) {values = [
    ['Ref Num', 'Service', 'Direction', 'Bus Stop', 'Reg Num', 'Bus Model'],
    ...raw_data.report_num.map((_, i) => [
      raw_data.ref_num[i], raw_data.bus_svc[i], raw_data.direction[i], raw_data.bus_stop[i], raw_data.reg_num[i], raw_data.bus_model[i]
    ])
  ]}
  await sheets.spreadsheets.values.update({
    spreadsheetId: file_id,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: {values}
  });
}

async function save_spreadsheet_row(opr, file_id, raw_data, range) {
  if (opr === 'update') {
    await sheets.spreadsheets.values.update({
      spreadsheetId: file_id,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {values: raw_data}
    })
  } else if (opr === 'append') {
    await sheets.spreadsheets.values.append({
      spreadsheetId: file_id,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {values: raw_data}
    })
  }
}

async function update_copypastas(trigger, content, mode) {
  // 1. Either add or remove copypasta
  if (mode === 'add') {
    copypasta_list.copypastas[trigger] = content;
  } else if (mode === 'remove') {
    delete copypasta_list.copypastas[trigger]
  }

  // 2. Push update back and push update back to Drive
  await save_to_drive('copypastas')
  console.log(`Copypasta updated, ${mode = 'add' ? 'added: ' + trigger : 'removed: ' + trigger}`);
}

function calc_checksum(reg_num, px_length, prefix) {
  let prefix_list;
  const tr_reg_num = reg_num.slice(px_length, reg_num.length)
  const checksum = tr_reg_num.slice(tr_reg_num.length-1, tr_reg_num.length).toUpperCase()
  const num = tr_reg_num.slice(0, tr_reg_num.length-1).padStart(4, '0')
  const num_list = num.split('').map(n => Number(n))
  switch (prefix) {
    case 'SG': prefix_list = [19, 7]; break;
    case 'SBS': prefix_list = [2, 19]; break;
    case 'SMB': prefix_list = [13, 2]; break;
  }
  const comb_list = [...prefix_list, ...num_list]
  let total = 0
  for (n in comb_list) {
    let v = 0;
    if (n === '0') v = comb_list[0] * 9;
    if (n === '1' || n === '3') v = comb_list[n] * 4;
    if (n === '2') v = comb_list[2] * 5;
    if (n === '4') v = comb_list[4] * 3;
    if (n === '5') v = comb_list[5] * 2;
    total = total + v;
  }
  const rem = (total % 19)
  const letters = ['A','Z','Y','X','U','T','S','R','P','M','L','K','J','H','G','E','D','C','B']
  if (checksum === letters[rem]) return [true]
  return [false, letters[rem]]
}

function get_ref_num(type, user_id) {
  const user_id_comp = user_id.slice(user_id.length-5, user_id.length)
  const date_comp = format_date(new Date(), ['yyyy', 'mm', 'dd'], '')
  const time_comp = format_time(new Date(), ['HH', 'mm', 'ss'], false, '')
  return type.slice(0,1).toUpperCase() + user_id_comp + date_comp + time_comp
}

async function check_bus_svc(bus_svc) {
  const svc_res = await (await fetch('https://data.busrouter.sg/v1/services.json')).json()
  const svc_list = Object.keys(svc_res)
  return svc_list.includes(bus_svc)
}

async function check_bus_stop(bus_stop) {
  let bus_stop_name = null
  if (Number(bus_stop) && bus_stop.length === 5) {
    const bus_stop_list = await (await fetch('https://data.busrouter.sg/v1/stops.json')).json()
    bus_stop_name = bus_stop_list?.[bus_stop][2]
  } else bus_stop_name = bus_stop
  return bus_stop_name
}

async function update_points(user, type, mode, value) {
  // 1. Add, remove, set or reset points
  const types_path = guesser_data.users[user][type]
  if (mode === 'plus') {
    types_path.points += value
  } else if (mode === 'minus') {
    types_path.points -= value
  } else if (mode === 'set') {
    types_path.points = value
  }

  // 2. Update username, ranks and push update back to Drive
  for (const id of Object.keys(guesser_data.users)) {
    const raw_id = id.replace(/[<@!>]/g, ''); 
    const u = await client.users.fetch(raw_id);
    guesser_data.users[id].name = u.username;
  }
  update_ranks()
  await save_to_drive('points')
  console.log(`${value} points ${mode === 'plus' ? 'added' : mode === 'minus' ? 'removed' : 'set'} for ${user} under category ${type}`);
}

async function reset_points(user_id, type, scope) {
  const categories = ['bus','metro','metro_hard'];
  // If all, selects all categories
  const selected_categories = (type === 'all') ? categories : [type];

  if (scope === 'user' && user_id) {
    // Reset this one user’s selected categories
    for (const cat of selected_categories) {
      guesser_data.users[user_id][cat].points = 0;
    }

  } else if (scope === 'all') {
    // Reset all users in those categories
    for (const uid of Object.keys(guesser_data.users)) {
      for (const cat of selected_categories) {
        guesser_data.users[uid][cat].points = 0;
      }
    }
  }

  // re‐compute every rank (non‐zerod users get ranked, zeros stay at 0)
  update_ranks();
  await save_to_drive('points');
}

function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

function update_ranks() {
  const categories = ['bus','metro','metro_hard'];

  // 0. Alear all previous ranks
  for (const user of Object.values(guesser_data.users)) {
    for (const cat of categories) user[cat].rank = 0;
    user.overall.rank = 0;
  }

  // 1. Determine who did any activity at all
  const eligible = Object.entries(guesser_data.users)
    .filter(([, user]) => categories.some(cat => user[cat].points > 0))
    .map(([id]) => id);

  // 2. Per-category competition ranking
  for (const category of categories) {
    // Only eligible users, even if they have 0 points in a particular category
    const sorted = eligible
      .map(id => [id, guesser_data.users[id][category].points])
      .sort((a, b) => b[1] - a[1]);

    // Temp ranking
    let last_pts = null, last_rank = 0;
    sorted.forEach(([id, pts], idx) => {
      if (pts === last_pts) {
        guesser_data.users[id][category].rank = last_rank;
      } else {
        last_pts   = pts;
        last_rank  = idx + 1;
        guesser_data.users[id][category].rank = last_rank;
      }
    });
  }

  // Apply proper category rankings
  eligible.forEach(id => {
    guesser_data.users[id]._score = categories
      .reduce((sum, category) => sum + guesser_data.users[id][category].rank, 0);
  });

  // 3. Overall ranking, only those eligible get a rank
  const overall_sorted = eligible
    .map(id => [id, guesser_data.users[id]._score])
    .sort((a, b) => a[1] - b[1]);

  let last_score = null, last_overall_rank = 0;
  overall_sorted.forEach(([id, score], idx) => {
    if (score === last_score) {
      guesser_data.users[id].overall.rank = last_overall_rank;
    } else {
      last_score   = score;
      last_overall_rank   = idx + 1;
      guesser_data.users[id].overall.rank = last_overall_rank;
    }
  });

  // Clean up
  eligible.forEach(id => delete guesser_data.users[id]._score);
}

function check_leaderboard(type) {
  const users      = guesser_data.users;
  const categories = ['bus','metro','metro_hard'];

  // 1. List types
  const types = {'bus': 'for bus_geoguessr', 'metro': 'for metro_guesser', 'metro_hard': 'for hard metro_guesser', 'overall': 'overall'};

  // 2. Header for leaderboard msg
  const now = new Date();
  let leaderboard = `The top-10 ${types[type]} of ${format_date(new Date(), ['MMM', 'yyyy'], ' ')}:\n\n`;

  // 3. Determine type of leaderboard, filter and sort accordingly
  let list;
  if (type !== 'overall') {
    // By category: collect user_id, rank, points
    list = Object.entries(users)
      .map(([id,u]) => [ id, u[type].rank, u[type].points ])
      // only ranks 1–10
      .filter(([,rank]) => rank > 0 && rank <= guesser_data.settings.show_leaderboard_until)
      // sort by ascending rank
      .sort((a,b) => a[1] - b[1]);

  } else {
    // Overall: just id, overall_rank
    list = Object.entries(users)
      .map(([id,u]) => [ id, u.overall.rank ])
      .filter(([,rank]) => rank > 0 && rank <= 10)
      .sort((a,b) => a[1] - b[1]);
  }

  if (!list.length) {
    return leaderboard + 'No one has scored any points yet.';
  }

  // 5. Construct the ranking lines
  const lines = list.map(entry => {
    if (type !== 'overall') {
      const [id, rank, pts] = entry;
      return `**${ordinal(rank)} place: ${id}** — ${pts} points`;
    } else {
      const [id, rank] = entry;
      const breakdown = categories
        .map(cat => `${ordinal(users[id][cat].rank)} ${types[cat]}`)
        .join(', ');
      return `**${ordinal(rank)} place: ${id}** — ${breakdown}`;
    }
  });

  return leaderboard + lines.join('\n');
}

async function new_guesser_profile(user) {
  if (!guesser_data.users[user]) {
    const raw_id = user.replace(/[<@!>]/g, '');  
    const discord_user = 
      client.users.cache.get(raw_id) 
      || await client.users.fetch(raw_id);
    guesser_data.users[user] = {
      name: discord_user.username,
      bus: {points: 0, rank: 0},
      metro: {points: 0, rank: 0},
      metro_hard: {points: 0, rank: 0},
      overall: {rank: 0}
    };
  }
}

function assign_attribute(type, user, points_params) {
  const correct_ans = guesser_data.answer[type];
  init_guesser_data(user, correct_ans)
  let ans_attributes = correct_ans.guessers[user].attributes;
  ans_attributes = new Set(ans_attributes)
  const modifier = correct_ans?.modifier
  const correct_scorers = Object.values(correct_ans.guessers)
  .filter(guesser => guesser.correct)
  .length;
  if (type === 'bus') {
    const ans_match_twist = points_params?.ans_match_twist
    if (correct_scorers === 1) {
      ans_attributes.add('first')
      if (ans_match_twist) ans_attributes.add('twist_correct')
    } else {
      ans_attributes.add('normal')
      if (ans_match_twist) ans_attributes.add('twist_correct')
    }
  } else if (type === 'metro') {
    const degree = points_params?.degree
    if (correct_scorers === 1) {
      ans_attributes.add('first')
    } else {
      ans_attributes.add('normal')
    }
    if (modifier === "RW" && degree != null && correct_ans.degree != null) {
      if (degree <= Math.round(correct_ans.degree) + 30 && degree >= Math.round(correct_ans.degree) - 30) {
        ans_attributes.add('RW_10')
      } else if (degree <= Math.round(correct_ans.degree) + 60 && degree >= Math.round(correct_ans.degree) - 60) {
        ans_attributes.add('RW_5')
      } else {
        ans_attributes.add('normal')
      }
    }
  }
  correct_ans.guessers[user].attributes = Array.from(ans_attributes);
}

function calc_points(type, user) {
  const correct_ans = guesser_data.answer[type];
  let points = 0
  const correct_scorers = Object.values(correct_ans.guessers)
  .filter(guesser => guesser.correct)
  .length;
  if (type === 'bus') {
  } else if (type === 'metro') {
    const difficulty_points = {"easy": 5, "medium": 10, "hard": 20}
    const modifier = correct_ans.modifier
    if (typeof(correct_ans.points) === 'number') {
      points = correct_ans.points
    } else if (correct_ans.difficulty) {
      points = difficulty_points[correct_ans.difficulty]
    }
    if (correct_scorers === 1) {
      points = points + 5
    } else {
			if (modifier === "NCM") {
				points = points + 10
			} else if (modifier === "NSF") {
				points = points + 5
			} 
		}
    const degree = correct_ans?.degree
		if (modifier === "RW" && degree !== null && correct_ans.degree !== null) {
      if (degree <= Math.round(correct_ans.degree) + 30 && degree >= Math.round(correct_ans.degree) - 30) {
        points = points + 10
      } else if (degree <= Math.round(correct_ans.degree) + 60 && degree >= Math.round(correct_ans.degree) - 60) {
        points = points + 5
      }
    }
  } else if (type === 'metro_hard') {
    // Hard metro_guesser points calculation
  }
  return points
}

function check_ans(input_ans, correct_ans, part_length, thr = 0.7, user) {
  // Trim whitespace + trim double space
  input_ans = input_ans.trim().replace(/\s+/g, ' ')
  // Split the answer into an array with each index split by " "
  const answer_list = correct_ans?.toLowerCase().split(" ") ?? [];
  // Split the input into an array with each index split by " "
  const input_list = input_ans?.toLowerCase().split(" ") ?? [];

  // If "line" is included as the first or last word, then ignore
  if (input_list.at(-1) === 'line') input_list.pop();
  if (input_list[0] === 'line') input_list.shift();
  if (answer_list.at(-1) === 'line') answer_list.pop();
  if (answer_list[0] === 'line') answer_list.shift();

  // Check if the consecutive indices is "n", if so consecutive indices is the length of the correct answer
  if (part_length === 0) part_length = answer_list.length;

  // Check if the input and correct answer has at least part_length number of consecutive indices
  if (answer_list.length < part_length) {
    return `Your minimum consecutive words number is longer than the length of the correct answer that you set! The answer you set is ${answer_list.length} words long, without counting the word 'line' at the front and/or back!`;
  }

  // Generate all valid consecutive indices of the array (length >= part_length)
  const valid_ans = new Set();
  for (let start = 0; start < answer_list.length; start++) {
    for (let end = start + part_length; end <= answer_list.length; end++) {
      const ans = answer_list.slice(start, end).join(' ');
      valid_ans.add(ans);
    }
  }

  // Check if any valid sequence matches the input string exactly.
  const input_str = input_list.join(' ');
  if (valid_ans.has(input_str)) return true;

  // User guess log.
  const guess_log = [
		`===== User Guess =====`,
		`User: ${user}`,
		`User input: "${input_ans.toLowerCase()}"`,
		`Correct answer: "${correct_ans.toLowerCase()}"`,
		`Consecutive word length: ${part_length}`,
		`======================`]

  // If there is a spelling mistake, then...
  const candidates = Array.from(valid_ans);
	let coefficients = []
	for (let k = 0; k < candidates.length; k++) {
		coefficients.push(levenshtein_coefficient(input_str, candidates[k]))
	};
	const best_match_rating = Math.max(...coefficients)
	const best_match_str = candidates[coefficients.indexOf(best_match_rating)]

  // Word-by-word similarity comparison
  const match_words = best_match_str.split(' ');
  if (input_list.length !== match_words.length) {
    console.log(guess_log.join('\n'))
    return false
  };

  let total_score = 0;
  for (let i = 0; i < input_list.length; i++) {
    const word_score = levenshtein_coefficient(input_list[i], match_words[i]);
    total_score += word_score;
  }
  const avg_score = total_score / input_list.length;
  guess_log.splice(4, 0, `Average similarity score by word: ${avg_score}`).join('\n')
  guess_log.splice(5, 0, `Overall similarity score: ${best_match_rating}`).join('\n')
  console.log(guess_log)
  return avg_score >= thr;
}

function reset_ans(type) {
  const params = {
    'bus': ['question_num', 'accuracy', 'bus_svc', 'road1', 'road2', 'bus_stop_code', 'bus_stop_name', 'twist_ans', 'twist_desc',
      "difficulty", "threshold", "time_period", "timestamp", "points", "guess_count", "submitter", "desc"
    ],
    'metro': [
      'question_num', 'city', 'region', 'mode', 'line1', 'line2', 'consec_length', 'threshold', 'line_col', 'degree', 'difficulty', 'guess_count', 'time_period', 'timestamp',
      'modifier', 'points', 'submitter'
    ],
    'metro_hard': []
  }
  if (type === 'bus' || type === 'metro' || type === 'metro_hard') {
    for (let n = 0; n < params[type].length; n++) {
      guesser_data.answer[type][params[type][n]] = null
    }
    guesser_data.answer[type].guessers = {}
  } else if (type === 'all') {
    const types = ['bus', 'metro', 'metro_hard']
    for (let n = 0; n < types.length; n++) {
      for (let k = 0; k < params[types[n]].length; k++) {
        guesser_data.answer[types[n]][params[types[n]][k]] = null
      }
      guesser_data.answer[types[n]].guessers = {}
    }
  }
}

async function announce_and_reset_answer(type, channel_id) { 
  const channel = await client.channels.fetch(channel_id);
  const correct_ans = guesser_data.answer[type];
  const modifier = correct_ans.modifier;
  const guessers = correct_ans.guessers;

  // Award points
  for (user of Object.keys(guessers)) {
    if (user?.correct) {
      const points = calc_points(type, user)
      const user_data = guesser_data.users[user]?.[type];
      const user_points = user_data?.points ?? 0;
      if (user !== correct_ans.submitter) {
        await update_points(user, type, 'plus', points)
      }
    }
  }

  if (channel?.isTextBased()) {
    if (type === 'bus') {
      // const difficulty_points = {'easy': 5, 'medium': 10, 'hard': 20};
      let accuracy_ans = null
      switch (correct_ans.accuracy) {
        case 'Bus stop code': accuracy_ans = correct_ans.bus_stop_code; break;
        case 'Bus stop name': accuracy_ans = correct_ans.bus_stop_name; break;
        case 'Bus service': accuracy_ans = correct_ans.bus_svc; break;
        case 'Road name': accuracy_ans = correct_ans.road_1; break;
        case 'Road names at the junction': accuracy_ans = `Junction between ${correct_ans.road1} and ${correct_ans.road2}`
      }
      let summary = [
        `Answer ${correct_ans.question_num}: ${accuracy_ans}`,
        `${correct_ans.twist_ans ? `Twist: ${correct_ans.twist_ans}` : 'There is no twist this round.'}`
      ].join('\n\n');
      // const modifier_bonus_points = {};
      // summary += `${modifier !== null ? `Modifier today is **${modifier}** (+${modifier_bonus_points[modifier]} pts).` : `No modifiers today.`} Difficulty is **${correct_ans.difficulty}** (${difficulty_points[correct_ans.difficulty]} base points)\n\n`;
      if (Object.entries(guessers).length === 0) {
        summary += '\n\n' + 'Nobody guessed, or guessed correctly sia...';
      } else {
        const first = users_with_attribute('bus', 'first')[0] ?? null;
        const normals = new Set(users_with_attribute('bus', 'normal'));
        const twist_correct = new Set(users_with_attribute('bus', 'twist_correct'));
        if (first) {
          if (twist_correct.has(first)) summary += '\n\n' + `First: ${first} (All correct)`;
          else summary += '\n\n' + `First: ${first} (Correct)`
        }
        if (normals.size > 0) {
          const normal_only = normals.difference(twist_correct)
          if (normal_only.size > 0) summary += '\n\n' + `Correct:\n${[...normal_only].join('\n')}`;
          const twist_n_normal = normals.intersection(twist_correct)
          if (twist_n_normal.size > 0) summary += '\n\n' + `All correct:\n${[...twist_n_normal].join('\n')}`;
        }
        await channel.send({content: summary, allowedMentions: {users: []}});
      }
    }
    if (type === 'metro') {
      const difficulty_points = {'easy': 5, 'medium': 10, 'hard': 20};
      const pre_line1 = correct_ans.line1?.split(' ') ?? [];
      if (pre_line1[0]?.toLowerCase() === 'line') pre_line1.shift();
      if (pre_line1.at(-1)?.toLowerCase() === 'line') pre_line1.pop();
      const line1 = pre_line1.join(' ');
      const pre_line2 = correct_ans.line2?.split(' ') ?? [];
      if (pre_line2[0]?.toLowerCase() === 'line') pre_line2.shift();
      if (pre_line2.at(-1)?.toLowerCase() === 'line') pre_line2.pop();
      const line2 = pre_line2.join(' ');

      let summary = `#${correct_ans.question_num} is the **${correct_ans.city} Line ${line1}**${correct_ans.line2 ? ` or the **${line2} line**` : ''}${correct_ans.line_col ? ` or the **${correct_ans.line_col} line**` : ``}!\n\n`;
      if (correct_ans.degree !== null) summary += `Rotation angle: **${correct_ans.degree}°**\n\n`;
      const modifier_bonus_points = {'NCM': 10, 'NSF': 5};
      summary += `${modifier !== null ? `Modifier today is **${modifier}** (+`+
      `${modifier === 'RW'? '5/10' : `${modifier_bonus_points[modifier]}`} pts).` : `No modifiers today.`} Difficulty is **${correct_ans.difficulty}** (${difficulty_points[correct_ans.difficulty]} base points)\n\n`;
      if (Object.entries(guessers).length === 0) {
        summary += 'How did no one get this correct sia...';
      } else {
        summary += `Metroguessed by:\n\n`
        const first = users_with_attribute('metro', 'first');
        if (first.length) {
          summary += `**First to answer** (+5 bonus): ${first}\n\n`;
        }
        if (modifier === 'RW') {
          const rw10 = users_with_attribute('metro', 'RW_10');
          const rw5 = users_with_attribute('metro', 'RW_5')
          if (rw10.length) {
            summary += `**Guessed within ±30°** (+10 bonus):\n${rw10.join('\n')}\n\n`;
          }
          if (rw5.length) {
            summary += `**Guessed within ±60°** (+5 bonus):\n${rw5.join('\n')}\n\n`;
          }
        }
        const normals = users_with_attribute('metro', 'normal');
        if (normals.length) {
          summary += `Others who got it correct:\n${normals.join('\n')}`;
        }
      }
      await channel.send({content: summary, allowedMentions: {users: []}});
    }
  }

  reset_ans(type);
  await save_to_drive('points');
}

function users_with_attribute(type, attribute) {
  const data = guesser_data.answer[type].guessers
  return Object.entries(data)
    .filter(([name, details]) => details.attributes.includes(attribute))
    .map(([name]) => name); // Return only the user names
};

function init_guesser_data(user_id, answer_obj) {
  if (!(user_id in answer_obj.guessers)) {
    answer_obj.guessers[user_id] = { attributes: new Set(), guesses: 0 };
  }
  if (!(answer_obj.guessers[user_id].attributes instanceof Set)) {
    answer_obj.guessers[user_id].attributes = new Set(answer_obj.guessers[user_id].attributes ?? []);
  }
}

function levenshtein_coefficient(input_ans, correct_ans) {
  // Levenshtein matrix
  const matrix = Array.from({ length: input_ans.length + 1 }, (_, i) =>
    Array.from({ length: correct_ans.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  // Levenshtein calculations
  for (let i = 1; i <= input_ans.length; i++) {
    for (let j = 1; j <= correct_ans.length; j++) {
      const cost = input_ans[i - 1] === correct_ans[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // Deletion
        matrix[i][j - 1] + 1, // Insertion
        matrix[i - 1][j - 1] + cost // Substitution
      );
    }
  }
  const levenshtein_dist = matrix[input_ans.length][correct_ans.length]
  // Return Levenshtein coefficient
  return 1 - (levenshtein_dist/input_ans.length);
}

function search_models(part) {
  const bus_models = {
    'Alexander Dennis Enviro500 2d1s': 'Enviro500 2d1s',
    'Alexander Dennis Enviro500 3d2s': 'Enviro500 3d2s',
    'BYD B12DS': 'BYD B12DS',
    'BYD B70A02': 'BYD B70A02',
    'BYD BC12A04': 'BYD BC12A04',
    'BYD C6': 'BYD C6',
    'BYD K9': 'BYD K9',
    'CRRC ED12': 'CRRC ED12',
    'LINKKER LM312': 'LINKKER LM312',
    'MAN A22 Euro V': 'MAN A22 Euro V',
    'MAN A22 Euro VI': 'MAN A22 Euro VI',
    'MAN A24': 'MAN A24',
    'MAN A95 Euro V 2d1s': 'MAN A95 Euro V 2d1s',
    'MAN A95 Euro VI 2d1s': 'MAN A95 Euro VI 2d1s',
    'MAN A95 Euro V 3d2s': 'MAN A95 Euro V 3d2s',
    'MAN A95 Euro VI 3d2s': 'MAN A95 Euro VI 3d2s',
    'Mercedes-Benz Citaro': 'Mercedes-Benz Citaro',
    'Mercedes-Benz OC500LE': 'Mercedes-Benz OC500LE',
    'Scania K230UB': 'Scania K230UB',
    'Scania K310UD': 'Scania K310UD',
    'Volvo B5LH': 'Volvo B5LH',
    'Volvo B9TL Gemilang': 'Volvo B9TL Gemilang',
    'Volvo B9TL Wright': 'Volvo B9TL Wright',
    'Yutong E12 SD': 'Yutong E12 SD',
    'Yutong E12 DD': 'Yutong E12 DD',
    'Zhongtong LCK6126EVGS': 'Zhongtong LCK6126EVGS',
    'Zhongtong N12': 'Zhongtong N12'
  }
  return Object.keys(bus_models)
    .filter(m => m.toLowerCase().includes(part.toLowerCase()))
    .slice(0, 25)
    .map(m => ({
      name: m,
      value: bus_models[m] 
    }))
}

async function update_data_cache() {
  const file_path = 'C:/R Projects/Websites/Bus-Route-Demand-Visualiser/data/storage/temp'
  fs.readdir(file_path, (err, files) => {
    if (!files) return
    for (const file of files) {
      const full_path = `${file_path}/${file}`
      if (Date.now() - fs.statSync(full_path).mtimeMs > 120 * 60 * 1000) {
        fs.unlink(full_path, (err) => {
          if (err) {console.log(err)}
          else {console.log(`Deleted ${full_path}`)}
        })
      }
    }
  })
}

async function del_session() {
  if ((Object.keys(spotrep_sessions)).length === 0) return
  for (user in spotrep_sessions) {
    const [timestamp, interaction] = spotrep_sessions[user]
    if (Date.now() - timestamp >= 5 * 60 * 1000) {
      await interaction.deleteReply()
      return delete data_rows[user]
    }
  }
}

client.login(token);
client.once('clientReady', () => {
  console.log(`${client.user.tag} connected to Team STC Discord server!`);
});

process.on('SIGINT', () => {
  console.log("stc-brdv shutting down...");
  client.destroy(); // This disconnects the WebSocket from Discord.
  process.exit();
});
process.on('SIGTERM', () => {
  console.log("stc-brdv shutting down...");
  client.destroy();
  process.exit();
});

// Keeps the Discord bot alive.
setInterval(async () => {
  update_recent_amendments();
  update_data_cache();
  await del_session()
}, 120000)