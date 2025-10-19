const express = require('express');
const body_parser = require('body-parser');
const cron = require('node-cron')
const {token, datamall_api_key_1, discord_port, copypastas_file_id, points_file_id, amendments_file_id, team_id, mg_id} = require('../config.js');
const {drive, sheets, run_handler} = require('./drive_api_handler.js')
const app = express();
app.use(body_parser.json());
app.listen(discord_port, () => {
  console.log(`STC-BRDV listening on port ${discord_port}`);
});

const { Client, GatewayIntentBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, AutoModerationRuleTriggerType, SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, Events} = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const user_sessions = new Map();
let copypasta_list = {};
let guesser_data = {};
let amendment_data = {amendments:{raw:{},json:{}},users:{}};
const guesser_settings = {
  monthly_reset: true,
  announce_leaderboard: false,
  show_leaderboard_until: 10
}
;(async function start_handler() {
  await run_handler()
  copypasta_list = await load_from_drive('copypastas', 'json')
  guesser_data = await load_from_drive('points', 'json')
  amendment_data.amendments.raw = await load_from_drive('amendments', 'spreadsheet')
  amendment_data.amendments.json = await col_names_to_json(amendment_data.amendments.raw)
  update_recent_amendments()
  console.log(amendment_data.amendments.json)
  console.log(amendment_data.amendments.recent)
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
  const current_month = Date().toLocaleString('default', {month: 'short'})
  const current_year = Date().getFullYear()
    console.log(`Guesser data has been successfully reset for ${current_month} ${current_year}`);
  }, {
    scheduled: true,
    timezone: 'Asia/Singapore'
  });

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
        announce_and_reset_answer('metro', guesser_data.settings.announcements.metro);
      }
    } catch (err) {
      console.error('metro_guesser round failed to automatically end due to:', err);
    }
  }, 1 * 60 * 1000);
})();

// ---Temporary Callback Server--- //

app.post('/discord/heatmap', async (req, res) => {
  const { session_id, image_url } = req.body;
  const server_session = user_sessions.get(session_id);
  if (!server_session) {
    res.sendStatus(404);
    return;
  }

  try {
    // This is your original deferred interaction
    await server_session.interaction.editReply({
      content: `<@!${server_session.user_id}>, your heatmap is ready!`,
      embeds: [{ title: 'Demand Heatmap', image: { url: image_url } }]
    });
    user_sessions.delete(session_id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to editReply for session', session_id, err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---Command Processing--- //

// Listen for slash command interactions
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand() && !interaction.isModalSubmit()) return;
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
        session.datamall_key = datamall_api_key_1
        await interaction.reply({ content: 'Datamall set to default key.', ephemeral: true });
      } else if (subcommand === 'own_key') {
        session.datamall_key = interaction.options.getString('key') ?? datamall_api_key_1;
        await interaction.reply({ content: `Your account key ${session.key} has been saved.`, ephemeral: true });
      } else if (subcommand === 'params') {
        session.year = interaction.options.getInteger('year');
        session.month = String(interaction.options.getInteger('month')).padStart(2, '0');
        session.date = `${session.year}${session.month}`
        session.datamall_data_type = interaction.options.getString('datamall_data_type') ?? "bus"
        await interaction.reply({ content: `Datamall parameters updated: ${session.year}/${session.month}`, ephemeral: true });
      }
    } else if (subcommand_group === 'type') {
        if (subcommand === 'by_bus_service') {
          session.svc = interaction.options.getString('bus_svc');
          session.dir = interaction.options.getInteger('direction') ?? 1;
          session.split_svc = interaction.options.getString('split_service') ?? "Full route";
          session.by_bus_svc_params_info = `\nBus service: ${session.svc} ${
            (session.split_svc !== null && session.split_svc !== undefined && session.split_svc !== "Full route")
            ? ` ${session.split_svc}`
            : ""
          }\nDirection: ${session.dir}`;
          await interaction.reply({ content: 'Your heatmap generation options for type "By bus service" are now:' + by_bus_svc_params_info, ephemeral: true });
        } else if (subcommand === 'by_specific_stops') {
          session.ori_stops = interaction.options.getString('origin_stops');
          session.dst_stops = interaction.options.getString('destination_stops');
          session.by_specific_stops_params_info = `\nOrigin stops: ${session.ori_stops}\nDestination stops: ${session.dst_stops}`
          await interaction.reply({ content: 'Your heatmap generation options for type "By specific stops" are now:' + by_specific_stops_params_info, ephemeral: true });
        } else if (subcommand === 'set') {
          const heatmap_type_names = {
            by_bus_svc: 'By bus service',
            by_specific_stops: 'By specific stops'
          }
          session.heatmap_type = interaction.options.getString('heatmap_type') ?? "by_bus_svc";
          const heatmap_type_name = heatmap_type_names[session.heatmap_type];
          if (session.heatmap_type === "by_bus_svc") {
            session.type_bool = false} else {
            session.type_bool = true
            }
          await interaction.reply({ content: `You have selected heatmap to be of type ${heatmap_type_name}`, ephemeral: true });
        }
    } else if (subcommand_group === 'stop_names') {
        if (subcommand === 'by_bus_service') {
        	session.rows = interaction.options.getBoolean('rows') ?? false;
          session.cols = interaction.options.getBoolean('columns') ?? false;
          await interaction.reply({ content: `Your heatmap bus stop dislays for type "By bus service" are now\nRows: ${session.rows}\nColumns: ${session.cols}`, ephemeral: true });
        } else if (subcommand === 'by_specific_stops') {
          session.cells = interaction.options.getBoolean('cells') ?? false;
          await interaction.reply({ content: `Your heatmap bus stop displays for type "By specific stops" are now\nIn cells: ${session.cells}`, ephemeral: true });
        }
    } else if (subcommand_group === 'filters') {
      if (subcommand === 'time_period') {
        const period = interaction.options.getString('period');  // e.g., "period1", "period2", etc.
        const time_since = interaction.options.getInteger('time_since');
        const time_until = interaction.options.getInteger('time_until');
      
        // Ensure the session property is initialized correctly
        session.time_periods = {};
        session.time_periods[period] = { time_since, time_until };
      
        // Formats time as "HH:00"
        const format_time = (value) => {
          return String(value).padStart(2, '0') + ":00";
        };
      
        let time_period_msg = "Your time period filters:\n";
        // Loop over the potential periods (assuming "period1" through "period4")
        if (session.time_periods !== null) {
          for (let i = 1; i <= 4; i++) {
            const period_key = `period${i}`;
            const period_num = session.time_periods[period_key];
            if (period_num && period_num.time_since !== null && period_num.time_until !== null) {
              time_period_msg += `Period ${i}: from ${format_time(period_num.time_since)} to ${format_time(period_num.time_until)}\n`;
            }
          }
        } else {
          time_period_msg = "No time period filters have been set.";
        }
        await interaction.reply({ content: time_period_msg, ephemeral: true });
      } else if (subcommand === 'day_type') {
          const day_type_names = {
            weekday: 'Weekday',
            weekend_ph: 'Weekend / Public Holidays',
            combined: 'Combined'
          }
          session.day_type = interaction.options.getString('type') ?? "combined";
          const day_type_name = day_type_names[session.day_type]
          await interaction.reply({ content: `Your day type filters are now ${day_type_name}`, ephemeral: true });
        }
      }
    else if (subcommand === 'check') {
      await interaction.reply({ content: `Check your params ah, make sure nothing is missing:\n- Datamall key: ${session.key}\n- Datamall params: ${session.year}/${session.month}\n- Heatmap type: ${session.heatmap_type}
        ${(session.heatmap_type === "by_bus_svc")
          ? `${session.by_bus_svc_params_info}`
          : `${session.by_specific_stops_params_info}`
        }\n- Stop names displayed for\n
        ${(session.heatmap_type === "by_bus_svc")
          ? `Rows: ${session.rows}\nColumns: ${session.cols}`
          : `Cells: ${session.cells}`
        }`, ephemeral: true})
    }
    else if (subcommand === 'generate') {
      // 1. Defer reply immediately
      await interaction.deferReply();
      try {
        // 2. Delete the user_id key
        user_sessions.delete(user_id);

        // 3. Create a session_id
        const session_id = `${user_id}-${Date.now()}`;
        session.session_id   = session_id;     // new job key
        session.interaction  = interaction;    // for your callback
        session.user_id      = user_id;        // keep the ping info

        // 4. Re-store the session under the session_id
        user_sessions.set(session_id, session);

        // 5. POST the session data (Contains all the params like .svc/.date/.cells/.heatmap_type…)
        await fetch('https://stc-brdv.fly.dev/data/discord', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(session)
        });

        // 6. Reply to user to wait
        return interaction.editReply({content: 'Generating heatmap, please wait...', ephemeral: false});
      } catch (err) {
        console.log('Error in heatmap generation due to ' + err)
        await interaction.reply({content: "Somewhere somehow something happened, and you ain't getting your heatmap...", ephemeral: false})
      }
    }
  }

  // --- Copypasta processing (/copypasta) ---
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
        await interaction.reply({content: `"${trigger}" copypasta doesn't exist, try something ele leh...`, ephemeral: false});
      }
    }
  }
  if (interaction.isModalSubmit() && interaction.customId === 'copypasta') {
    const trigger = interaction.fields.getTextInputValue('trigger').toLowerCase();
    const reply   = interaction.fields.getTextInputValue('reply');
    if (trigger in copypasta_list.copypastas || used_triggers.includes(trigger)) {
      await interaction.reply({content: `"${trigger} copypasta is already used, try something ele leh..."`, ephemeral: false});
    } else {
      update_copypastas(trigger, reply, 'add');
      await interaction.reply({content: `"${trigger}" copypasta will now send\n\n"${reply}"`, ephemeral: false});
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
        return interaction.reply({content: 'This command cannot be used by you. Think you can change your own points, reset points or see the leaderboard before the month ends? Nuh-uh.', ephemeral: true});
      }
    }
    if (subcommand_group === 'settings') {
      if (!interaction.member.roles.cache.some(admin_ids)) {
        return interaction.reply({content: 'This command cannot be used by you. Think you can change the guesser game settings? Nuh-uh.', ephemeral: true});
      }
    }
    if (subcommand_group === 'set_answer') {
      if (!interaction.member.roles.cache.some(admin_ids)) {
        return interaction.reply({content: 'This command cannot be used by you. Think you can change the answer of the guesser games? Nuh-uh.', ephemeral: true});
      }
    }
    if (subcommand_group === 'reset_answer') {
      if (!interaction.member.roles.cache.some(admin_ids)) {
        return interaction.reply({content: 'This command cannot be used by you. Think you can reset the answer of the guesser games? Nuh-uh.', ephemeral: true});
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
      if (!guesser_data.users[guesser_user] && guesser_user_req_types.includes(subcommand)) {
        const raw_id = guesser_user.replace(/[<@!>]/g, '');  
        const discord_user = 
          client.users.cache.get(raw_id) 
          || await client.users.fetch(raw_id);
        guesser_data.users[guesser_user] = {
          name: discord_user.username,
          bus: {points: 0, rank: 0},
          metro: {points: 0, rank: 0},
          metro_hard: {points: 0, rank: 0},
          overall: {rank: 0}
        };
      }
      const current_points = guesser_user_req_types.includes(subcommand) ? guesser_data.users[guesser_user][type].points : undefined
      const types = {'bus': 'for bus_geoguessr', 'metro': 'for metro_guesser', 'metro_hard': 'for hard metro_guesser', 'overall': 'overall', 'all': 'for all types'}
      if (defer_replies.includes(subcommand)) {
        await interaction.deferReply({ ephemeral: true });
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
            await interaction.reply({content: "You did not participate in this month's guesser games...", ephemeral: true});
          } else {
            const pts = guesser_data.users[wrapped_user_id][type].points
            await interaction.reply({content: `You have ${pts} points ${types[type]}. Keep competing, and stay tuned for future updates!`, ephemeral: true});
          }
      } else if (subcommand === 'check_others') {
        const rank = guesser_data.users[guesser_user][type].rank
        if (rank === 0 || rank === undefined) {
          await interaction.reply({content: `${guesser_user} has yet to participate in this month's guesser games.`, ephemeral: true, allowedMentions: {users:[]}})
        } else {
          await interaction.reply({content: `${guesser_user} ${type !== 'overall' ? `has ${current_points} points,` : 'is'} currently the top ${rank} ${types[type]}!`, ephemeral: true, allowedMentions: {users: []}})
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
          await interaction.reply({content: `The points for the guesser games will ${reset_points ? '' : 'not'} reset next month.`, ephemeral: true})
        } else if (subcommand === 'announce_leaderboard') {
          const announce = interaction.options.getBoolean('public_announce') ?? false
          guesser_data.settings.announce_leaderboard = announce
          await save_to_drive('points')
          await interaction.reply({content: `The leaderboard for the guesser games will ${announce ? '' : 'not'} be announced when command to show leaderboard is ran.`, ephemeral: true})
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
          await interaction.reply({content: message, ephemeral: true});
        } else if (subcommand === 'annc_channels') {
          if (!guesser_data.settings.announcements) guesser_data.settings.announcements = {}
          const types = {'bus': 'bus_geoguessr', 'metro': 'metro_guesser', 'metro_hard': 'hard metro_guesser'}
          const type = interaction.options.getString('type')
          const channel_id = interaction.options.getString('channel_id')
          guesser_data.settings.announcements[type] = channel_id
          await save_to_drive('points')
          await interaction.reply({content: `The announcement channel for ${types[type]} has been set to <#${channel_id}>.`, ephemeral: true})
        } else if (subcommand === 'show_leaderboard_until') {
          let rank = interaction.options.getInteger('rank') ?? 10
          if (rank === 0) rank = 1000;
          guesser_data.settings.show_leaderboard_until = rank
          await save_to_drive('points')
          await interaction.reply({content: `The leaderboard for the guesser games will be shown up to the ${ordinal(rank)} place.`, ephemeral: true})
        }
    } else if (subcommand_group === 'set_answer') {
      const types = {'bus_geoguessr': 'bus', 'metro_guesser': 'metro', 'hard_metro_guesser': 'metro_hard'}
      const correct_ans = guesser_data.answer[types[subcommand]]
      if (subcommand === "bus_geoguessr") {
        correct_ans.bus_svc = interaction.options.getString('bus_svc')
        correct_ans.stop_name = interaction.options.getString('stop_name')
        correct_ans.location = interaction.options.getString('location')
        correct_ans.twist = interaction.options.getString('twist')
        // bus_gueguessr processing here...
        if ('this is' === 'a placeholder') {
          await interaction.reply({content: "This does nothing yet leh...", ephemeral: true})
        } else {
          await interaction.reply({content: `bus_geoguessr answer has been set to bus ${correct_ans.bus_svc}, bus stop ${correct_ans.stop_name}, location is ${correct_ans.location}, and twist is ${correct_ans.twist}.`, ephemeral: true})
          await save_to_drive('points')
        }
      } else if (subcommand === "metro_guesser") {
        correct_ans.question_num = interaction.options.getInteger('question_num')
        correct_ans.city = interaction.options.getString('city')
        correct_ans.line1 = interaction.options.getString('line1')
        correct_ans.line2 = interaction.options.getString('line2') ?? null
        correct_ans.consec_length = interaction.options.getInteger('consec_length') ?? null
        correct_ans.threshold = 0.01 * interaction.options.getInteger('threshold') ?? 0.7
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
        if (correct_ans.difficulty === null && correct_ans.points === null) {
          return await interaction.reply({content: 'You need to provide either the difficulty + modifier and similarity threshold (both optional) or the number of points to award!', ephemeral: true})
        }
        if (correct_ans.line2 !== null) {
          if (correct_ans.consec_length === null) {
            return await interaction.reply({content: 'You need to provide the number of consecutive words that counts as a correct answer if you are using the long line name!', ephemeral: true})
          }
          const check_line2 = check_ans('', correct_ans.line2, correct_ans.consec_length)
          if (typeof(check_line2) === 'string') {
            return await interaction.reply({content: check_line2, ephemeral: true})
          } 
        }
        if (correct_ans.modifier === 'RW' && correct_ans.degree === null) {
          return await interaction.reply({content: "Today's modifier is Rotated Wednesdays, provide the degree of rotation!", ephemeral: true})
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
          return await interaction.reply({content: "You need to at least provide the city and the short line name!", ephemeral: true})
        } else {
          const msg = [
            `metro_guesser answer has been set to:`,
            ``,
            `City: "${correct_ans.city}"`,
            `Short line name: "${correct_ans.line1}"`,
            `Long line name: "${correct_ans.line2}"`,
            `Consecutive words: ${correct_ans.consec_length}`,
            `Line colour: "${correct_ans.line_col}"`,
            `Rotation degree: ${correct_ans.degree}`,
            `Difficulty: "${correct_ans.difficulty}"`,
            correct_ans.modifier ? `Today's modifier is "${correct_ans.modifier}".` : `There are no modifiers today.`,
            `Guess count: ${correct_ans.guess_count}`,
            `Time period: ${correct_ans.time_period / 60000 } minutes`,
            `Points: ${correct_ans.points}`,
            `Submitter of question: "${correct_ans.submitter}"`
          ].join('\n');
          console.log(msg)
          await interaction.reply({content: msg, ephemeral: true})
          await save_to_drive('points')
        }
      } else if (subcommand === "hard_metro_guesser") {
        // Hard metro_guesser processing here...
        await interaction.reply({content: "This does nothing yet leh...", ephemeral: true})
      }
    } else if (subcommand === 'reset_answer') {
      const types = {'bus': 'for bus_geoguessr', 'metro': 'for metro_guesser', 'metro_hard': 'for hard metro_guesser', 'all': 'for all guesser game questions'};
      const type = interaction.options.getString('type')
      reset_ans(type)
      await save_to_drive('points')
      await interaction.reply({content: `The answer ${types[type]} has been reset.`, ephemeral: true})
    } else if (subcommand_group === 'guess') {
      const types = {'bus_geoguessr': 'bus', 'metro_guesser': 'metro', 'hard_metro_guesser': 'metro_hard'}
      const correct_ans = guesser_data.answer[types[subcommand]]
      const guessers = correct_ans.guessers;
      if (Object.keys(correct_ans).length === 0) {
        return await interaction.reply({content: `There is currently no set answer to ${subcommand} leh...`, ephemeral: true})
      }
      if (Object.keys(guessers).includes(wrapped_user_id)) {
        await interaction.reply({content: 'You already answered correctly liao, answer again for what?', ephemeral: true})
      }
      if (!guessers[wrapped_user_id]) {
        guessers[wrapped_user_id] = { guesses: 1 };
      } else if (!('guesses' in guessers[wrapped_user_id])) {
        guessers[wrapped_user_id].guesses = 1;
      } else {
        if (guessers[wrapped_user_id].guesses === correct_ans.guess_count) {
          return await interaction.reply({ content: `You had your go at guessing this question liao. You have spent all ${correct_ans.guess_count}, no more guesses for you! Try again next round.`, ephemeral: true });
        } else {
          guessers[wrapped_user_id].guesses += 1;
        }
      }
      if (current_time - correct_ans.timestamp > correct_ans.time_period) {
        return await interaction.reply({content: `Aiyoh... the answer submission period has ended liao. You took too long.`, ephemeral: true});
      }
      if (subcommand === "bus_geoguessr") {
        await interaction.reply({content: 'Answering for bus_geoguessr is not available at the moment leh...', ephemeral: true})
      } else if (subcommand === "metro_guesser") {
        await interaction.deferReply({ephemeral: true})
        const city = interaction.options.getString('city')
        const line = interaction.options.getString('line')
        const degree = interaction.options.getInteger('degree')
        const points = calc_points('metro', degree, wrapped_user_id)
        if (correct_ans.line2 !== null) {
          var ans_match_line2 = check_ans(line, correct_ans.line2, correct_ans.consec_length, correct_ans.threshold, wrapped_user_id)
        } else {
          var ans_match_line2 = false
        }
        if (correct_ans.line_col !== null) {
          var ans_match_line_col = check_ans(line, correct_ans.line_col, 0, correct_ans.threshold, wrapped_user_id)
        } else {
          var ans_match_line_col = false
        }
        if (levenshtein_coefficient(city.toLowerCase(), correct_ans.city.toLowerCase()) >= 0.8 && (check_ans(line, correct_ans.line1, 0, correct_ans.threshold, wrapped_user_id) || ans_match_line2 || ans_match_line_col)) {
          const user_data = guesser_data.users[wrapped_user_id]?.['metro'];
          const user_points = user_data?.points ?? 0;
          if (wrapped_user_id !== correct_ans.submitter) {
            guessers[wrapped_user_id].attributes.points = points
            // await update_points(wrapped_user_id, types[subcommand], 'plus', points)
          }
          save_to_drive('points')
          await interaction.editReply({content: `${wrapped_user_id !== correct_ans.submitter ? `You guessed correctly! You have been awarded ${points} points. You now have ${user_points + points} points.` : `You cannot answer your own submission! Don't anyhow ah.`}`, ephemeral: true})
        } else {
          await interaction.editReply({content: `${wrapped_user_id !== correct_ans.submitter 
            ? `One of your input answers is incorrect. Your city is \"${city}\" and your line name/colour is \"${line}\". You used up ${guessers[wrapped_user_id].guesses} guesses, you have ${correct_ans.guess_count - guessers[wrapped_user_id].guesses} guesses left.`
            : `You cannot answer your own submission! Don't anyhow ah.`}`, ephemeral: true})
        }
      } else if (subcommand === "hard_metro_guesser") {
        await interaction.reply({content: 'Answering for hard metro_guesser is not available at the moment leh...', ephemeral: true})
      }
    }
  }

  // --- Amendment Explorer ---
  if (interaction.commandName === 'amendment') {
    const user_id = interaction.user.id;
    await menu_tab(interaction, user_id)
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  const [action, user_id] = interaction.customId.split('_');

  // Lock to the command invoker
  if (interaction.user.id !== user_id) {
    return interaction.reply({ content: 'This UI is not yours to use.', ephemeral: true });
  }

  if (action === 'help') {
    await interaction.reply({content: '**How to use Amendment Explorer**\n- Search: Find amendments by bus, user, or type.\n- Modify: Edit or delete your own amendments.\n- Repository Link: View the full Google Sheet.', ephemeral: false});
  }

  if (action === 'search') {
    // Trigger your search flow here
  }

  if (action === 'modify') {
    modify_tab(interaction, user_id)
  }

  if (action === 'home_search') {

  }

  if (action === 'home_modify') {
    
  }
});

client.on('messageCreate', message => {
  if (message.author.bot) return;
  const trigger = message.content.toLowerCase()
  if (trigger in copypasta_list.copypastas) {
    message.channel.send(copypasta_list.copypastas[trigger]);
  }
});

async function load_from_drive(file, type) {
  let requested_file_id = ''
  let range = ''
  if (file === 'copypastas') {requested_file_id = copypastas_file_id}
  if (file === 'points') {requested_file_id = points_file_id}
  if (file === 'amendments') {requested_file_id = amendments_file_id; range = 'Main Sheet!A:I'}
  try {
    // Check for file type.
    if (type === 'spreadsheet') {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: requested_file_id, range
      });
      return res.data.values;
    } else if (type === 'json') {
      // Request the file content by its file ID.
      const res = await drive.files.get(
        { fileId: requested_file_id, alt: 'media' },
        { responseType: 'stream' }
      );
      let data = '';
      await new Promise((resolve, reject) => {
        res.data.on('data', (chunk) => data += chunk.toString('utf8'));
        res.data.on('end', resolve);
        res.data.on('error', reject);
      });
      return JSON.parse(data);
    }
  } catch (error) {
    throw new Error(`Failed to load ${file} from Google Drive: ` + error.message);
  }
}

async function save_to_drive(file) {
  if (file === 'points') {
    save_json(points_file_id, guesser_data)
  } if (file === 'copypastas') {
    save_json(copypastas_file_id, copypasta_list)
  } if (file === 'amendments') {
    save_spreadsheet(amendments_file_id, amendment_data.amendments)
  }
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

async function save_spreadsheet(file_id, raw_data) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: file_id,
    range: 'Main Sheet!A1:I',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        ['Approval', 'Date', 'Contributor', 'Type', 'Service(s)', 'Channel', 'Platform', 'Ref. Number', 'Link'], // Header row
        [raw_data.rating, raw_data.date, raw_data.user_id, raw_data.amendment_type, raw_data.svcs.join(', '), 'N.A.', raw_data.platform, raw_data.ref_num, raw_data.link] // Data row
      ]
    }
  });
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
  let leaderboard = `The top-10 ${types[type]} of ${now.toLocaleString('default',{ month:'short', year:'numeric' })}:\n\n`;

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

function calc_points(type, degree, user) {
  const correct_ans = guesser_data.answer[type];
  let points = 0
  if (type === 'bus') {
    // bus_geoguessr points calculation
  } else if (type === 'metro') {
    const difficulty_points = {"easy": 5, "medium": 10, "hard": 20}
    init_guesser_data(user, correct_ans)
    var ans_attributes = correct_ans.guessers[user].attributes;
    const modifier = correct_ans.modifier
    if (correct_ans.difficulty) {
      points = difficulty_points[correct_ans.difficulty]
    } else if (typeof(correct_ans.points) === 'number') {
      points = correct_ans.points
    }
    if (Object.keys(correct_ans.guessers).length === 1) {
      points = points + 5
      ans_attributes.add('first')
    } else {
			if (modifier === "NCM") {
				points = points + 10
				ans_attributes.add('normal')
			} else if (modifier === "NSF") {
				points = points + 5
				ans_attributes.add('normal')
			} 
		}
		if (modifier === "RW" && degree !== null && correct_ans.degree !== null) {
      if (degree <= Math.round(correct_ans.degree) + 30 && degree >= Math.round(correct_ans.degree - 30)) {
        points = points + 10
        ans_attributes.add('RW_10')
      } else if (degree <= Math.round(correct_ans.degree) + 60 && degree >= Math.round(correct_ans.degree - 60)) {
        points = points + 5
        ans_attributes.add('RW_5')
      } else {
				ans_attributes.add('normal')
			}
    }
  } else if (type === 'metro_hard') {
    // Hard metro_guesser points calculation
  }
  correct_ans.guessers[user].attributes = Array.from(ans_attributes);
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
  if (input_list.length !== match_words.length) return false;

  let total_score = 0;
  for (let i = 0; i < input_list.length; i++) {
    const word_score = levenshtein_coefficient(input_list[i], match_words[i]);
    total_score += word_score;
  }
  // Console log
  const avg_score = total_score / input_list.length;
  console.log([
		`===== User Guess =====`,
		`User: ${user}`,
		`User input: "${input_ans.toLowerCase()}"`,
		`Correct answer: "${correct_ans.toLowerCase()}"`,
		`Average similarity score by word: ${avg_score}`,
		`Overall similarity score: ${best_match_rating}`,
		`Consecutive word length: ${part_length}`,
		`======================`].join(`\n`))
  return avg_score >= thr;
}

function reset_ans(type) {
  const params = {
    'bus': ['bus_svc', 'stop_name', 'location', 'twist'],
    'metro': ['question_num', 'city', 'line1', 'line2', 'consec_length', 'threshold', 'line_col', 'degree', 'difficulty', 'guess_count', 'time_period', 'timestamp', 'modifier', 'points', 'submitter'],
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
    await update_points(user, 'metro', 'plus', metro.guessers[user].attributes.points)
  }

  if (channel?.isTextBased()) {
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
      summary += `${modifier !== null ? `Modifier today is **${modifier}** (+${modifier === 'RW' ? '5/10' : `${modifier_bonus_points[modifier]}`} pts).` : `No modifiers today.`} Difficulty is **${correct_ans.difficulty}** (${difficulty_points[correct_ans.difficulty]} base points)\n\n`;
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
    answer_obj.guessers[user_id].attributes = new Set();
  }
  if (typeof answer_obj.guessers[user_id].guesses !== 'number') {
    answer_obj.guessers[user_id].guesses = 0;
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

function col_names_to_json(raw) {
  // Skip the first 2 rows (titles/notes), row 3 is headers
  const headers = raw[2];
  const dataRows = raw.slice(3);

  // Maps spreadsheet row names to workable JSON parameter names.
  const json_keys = {
    'Approval': 'rating',
    'Date': 'date',
    'Contributor': 'username',
    'Type': 'amendment_type',
    'Service(s)': 'svcs',
    'Platform': 'platform',
    'Ref. Number': 'ref_num',
    'Link': 'link'
  };

  return dataRows.map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      const key = json_keys[h];
      if (!key) return; // Skip unmapped columns

      let value = row[i] || '';

      // Normalise types
      if (key === 'rating') value = value ? Number(value) : null;
      if (key === 'svcs') value = value ? value.split(',').map(s => s.trim()) : [];
      if (key === 'amendment_type') value = value ? value.split(',').map(s => s.trim()) : [];
      if (key === 'date' && value) value = new Date(value).toISOString().split('T')[0];

      obj[key] = typeof value === 'string' ? value.trim() : value;
    });
    return obj;
  });
}

async function update_recent_amendments() {
  amendment_data.amendments.raw = await load_from_drive('amendments', 'spreadsheet')
  amendment_data.amendments.json = await col_names_to_json(amendment_data.amendments.raw)
  if (!Array.isArray(amendment_data.amendments.json)) {
    amendment_data.amendments.recent = [];
    return;
  }

  // Sort by date descending
  const sorted = [...amendment_data.amendments.json].sort((a, b) => {
    const da = new Date(a.date);
    const db = new Date(b.date);
    return db - da;
  });

  // Take top 10
  amendment_data.amendments.recent = sorted.slice(0, 10);
}

function amendments_repo_edit(user, routes, params, rating, link) {

}

async function menu_tab(interaction, user_id) {
  const user_info = amendment_data.users?.[user_id] ?? { total: 0, big: 0 };
  const amendments = amendment_data.amendments

  const recent = (amendments.json || [])
    .filter(a => a.recent)
    .slice(0, 10)
    .map(a => `• **${a.amendment_type}** on ${a.svcs.join(', ')} by <@${a.user_id}> (${a.date})`)
    .join('\n') || 'No recent activity.';

  const embed = new EmbedBuilder()
    .setTitle('🚌 Amendment Explorer')
    .setDescription(`Welcome to the Amendment Explorer!`)
    .addFields(
      { name: 'Your Stats', value: `Total amendments: **${user_info.total}**\nBig amendments: **${user_info.big}**`, inline: true },
      { name: 'Recent Activity', value: recent }
    )
    .setFooter({ text: 'Use the buttons below to navigate.' });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`help_${user_id}`)
      .setLabel('Help')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`search_${user_id}`)
      .setLabel('Search Amendments')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`modify_${user_id}`)
      .setLabel('Modify Amendments')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setLabel('Repository Link')
      .setStyle(ButtonStyle.Link)
      .setURL('https://docs.google.com/spreadsheets/d/1_eQ17i1LbnkGAaZHopSMwsOQCBVVhsper0gwyV132uU/edit')
  );
  await interaction.reply({ embeds: [embed], components: [buttons], ephemeral: false });
}

async function modify_tab(interaction, user_id) {
  // Filter amendments belonging to this user
  const user_amendments = amendment_data.amendments.filter(a => a.user_id === user_id);

  const embed = new EmbedBuilder()
    .setTitle('📝 Modify Your Amendments')
    .setDescription(user_amendments.length 
      ? 'Select one of your amendments from the dropdown below.'
      : 'You have no amendments yet. Use **Add** to create one.');

  // Dropdown menu
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`amendment_select_${user_id}`)
    .setPlaceholder('Select an amendment')
    .addOptions(
      user_amendments.map((a, idx) => ({
        label: `${a.svcs.join(', ')} — ${a.amendment_type}`,
        description: `Submitted on ${a.date}`,
        value: String(idx) // Index in amendment_data.amendments
      }))
    );

  // Buttons
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`menu_${user_id}`)
      .setLabel('Back to Menu')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`add_${user_id}`)
      .setLabel('Add')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`modify_${user_id}`)
      .setLabel('Modify')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(user_amendments.length === 0), // Disable if nothing to modify
    new ButtonBuilder()
      .setCustomId(`remove_${user_id}`)
      .setLabel('Remove')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(user_amendments.length === 0)
  );

  const components = [];
  if (user_amendments.length > 0) components.push(new ActionRowBuilder().addComponents(menu));
  components.push(buttons);

  await interaction.update({ embeds: [embed], components, ephemeral: true });
}

client.login(token);
client.once('ready', () => {
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
setInterval(() => {
  update_recent_amendments()
}, 120000)