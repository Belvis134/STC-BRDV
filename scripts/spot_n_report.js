const {load_from_drive, sheets} = require('./drive_api_handler');
const {format_date, format_time} = require('./date_time_functions')
const {spottings_file_id} = require('../config')
const { Client, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags, AttachmentBuilder,
  SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, Events, Message,
  ActionRow,
  StringSelectMenuBuilder} = require('discord.js');
const ver_num = 'Alpha 0.2.4'
let spotrep_time = NaN
let data_rows = {};

async function spotrep_main_embed(intr, user_id, ret) {
  if (!data_rows?.[user_id]) data_rows[user_id] = [null, null, null, null, null, null, null, null, null, null, null]
  // ref_num, bus_svc, reg_num, status, bus_stop, direction, bus_model, prev_dept, cur_dept, advert, livery
  const embed = new EmbedBuilder()
    .setTitle(`Spot-n-Report ${ver_num}`)
    .setDescription([
      `Welcome to Spot-n-Report, the Discord spottings and cameos reporting service!`,
      `This UI will automatically be deleted after **5 minutes**. Make the most use out of it!`
    ].join('\n'))
    .addFields(
      {name: 'Your spottings:', value: `Bar`},
      {name: 'Your cameos:', value: 'Bar'}
    )
    .setFooter({ text: 'Use the buttons below to navigate.' });
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`spotrep_spotting_main_na_${user_id}`)
      .setLabel('Spottings')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`spotrep_cameo_main_na_${user_id}`)
      .setLabel('Cameos')
      .setStyle(ButtonStyle.Primary)
  );
  spotrep_time = Date.now()
  if (ret) {
    await intr.deferUpdate()
    return await intr.editReply({embeds: [embed], components: [buttons]})
  } else return await intr.reply({embeds: [embed], components: [buttons]});
}

async function spotrep_buttons(intr) {
  const [type, c1, c2, c3, user_id] = intr.customId.split('_');
  // Lock to command invoker
  if (intr.user.id !== user_id) {
    return intr.reply({content: 'This UI is not yours to use.', flags: MessageFlags.Ephemeral});
  }

  // Main functions
  if (c1 === 'return') await spotrep_main_embed(intr, user_id, true)
  if (c2 === 'main') await spotting_main_embed(intr, user_id, c1); // Spottings main page
  if (c2 === 'add') {
    if (c3 === 'main') await add_embed(intr, user_id, c1) // Add page
    if (c3 === 'key-info') await key_info_modal(intr) // Key info
    if (c3 === 'status') await status_modal(intr, c1) // Statuses
    if (c3 === 'loc-info') await loc_info_modal_text(intr, user_id) // Location info
    if (c3 === 'misc-info') await misc_info_modal(intr, c1) // Misc info, i.e. ads, rojak etc.
    if (c3 === 'depot-trf') await depot_trf_modal(intr, c1) // Depot transfer
    if (c3 === 'conf') await conf(intr, user_id, c1) // Confirmation
  };
  if (c2 === 'browse') {
    if (c3 === 'main') await browse_embed(intr, user_id, c1); // Spotting modify
    if (c3 === 'filters') await filters_modal(intr, user_id, c1) // Spotting filters
    if (c3 === 'edit') await edit_modal(intr, user_id, c1) // Spotting selection
    if (c3 === 'delete') await delete_modal(intr, user_id, c1) // Spotting delete
  }
}

async function spotrep_selects(intr, user_id, custom_id) {
  if (custom_id.includes('direction')) await loc_info_sel(intr, user_id)
}

async function spotrep_processes(intr, user_id, custom_id) {
  if (custom_id.includes('key_info')) await key_info_process(intr, user_id)
  if (custom_id.includes('loc_info_text')) await loc_info_process(intr, user_id)
  if (custom_id.includes('status')) await status_process(intr, user_id)
  if (custom_id.includes('misc_info')) await misc_process(intr, user_id)
}

async function spotting_main_embed(intr, user_id, c1) {
  const embed = new EmbedBuilder()
  .setTitle(`Spot-n-Report ${ver_num}`)
  .setDescription(`Add or browse ${c1}s! You can modify and delete your **own** ${c1}s when browsing.`)
  .addFields(
    {name: `Your ${c1}s:`, value: 'Bar'}
  )
  .setFooter({ text: 'Use the buttons below to navigate.' });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`spotrep_${c1}_add_main_${user_id}`)
      .setLabel(`Add ${capt(c1)}`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`spotrep_${c1}_browse_main_${user_id}`)
      .setLabel(`Browse ${capt(c1)}s`)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`spotrep_return_na_na_${user_id}`)
      .setLabel('Return to Main Page')
      .setStyle(ButtonStyle.Secondary)
  );
  spotrep_time = Date.now()
  await intr.deferUpdate()
  return await intr.editReply({embeds: [embed], components: [buttons]});
}

async function add_embed(intr, user_id, c1) {
  const embed = new EmbedBuilder()
  .setTitle(`Spot-n-Report ${ver_num}`)
  .setDescription([
    `To add a ${c1}, you need to minimally provide the key information!`,
    `Provide the bus model if registration plate is unclear. Run the command \`/bus-models\` to find and select!`,
    `When providing statuses, filling up the box means status present, empty means absent, **EXCEPT** off.`
  ].join('\n'))
  .setFooter({ text: 'Use the buttons below to navigate.' });

  const buttons1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`spotrep_${c1}_add_key-info_${user_id}`)
      .setLabel(`Key Info`)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`spotrep_${c1}_add_status_${user_id}`)
      .setLabel(`Status`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`spotrep_${c1}_add_loc-info_${user_id}`)
      .setLabel(`Location`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`spotrep_${c1}_add_misc-info_${user_id}`)
      .setLabel(`Misc`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`spotrep_${c1}_add_depot-trf_${user_id}`)
      .setLabel(`Depot Trfs`)
      .setStyle(ButtonStyle.Secondary),
  )
  const buttons2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`spotrep_${c1}_add_conf_${user_id}`)
      .setLabel(`Confirm`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`spotrep_${c1}_main_na_${user_id}`)
      .setLabel(`Cancel`)
      .setStyle(ButtonStyle.Danger),
  );
  spotrep_time = Date.now()
  await intr.deferUpdate()
  return await intr.editReply({embeds: [embed], components: [buttons1, buttons2]});
}

async function browse_embed(intr, user_id, c1) {
  const embed = new EmbedBuilder()
  .setTitle(`Spot-n-Report ${ver_num}`)
  .setDescription(`Here you can browse all the ${c1}s!, Only 20 is shown per page.`)
  .setFooter({ text: 'Use the buttons below to navigate.' });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`spotrep_${c1}_browse_filters_${user_id}`)
      .setLabel(`Filters`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`spotrep_${c1}_browse_edit_${user_id}`)
      .setLabel(`Edit`)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`spotrep_${c1}_browse_delete_${user_id}`)
      .setLabel(`Delete`)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`spotrep_${c1}_main_na_${user_id}`)
      .setLabel(`Return`)
      .setStyle(ButtonStyle.Secondary),
  );
  spotrep_time = Date.now()
  await intr.deferUpdate()
  return await intr.editReply({embeds: [embed], components: [buttons]});
}

async function key_info_modal(intr) {
  const modal = new ModalBuilder()
  .setCustomId(`spotrep_key_info`)
  .setTitle(`Key Information`)
  .addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("bus_service")
        .setLabel("Bus Service")
        .setStyle(TextInputStyle.Short)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("reg_num")
        .setLabel("Registration Number")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
    )
  )
  return await intr.showModal(modal)
}

async function status_modal(intr, user_id, c1) {
  const modal = new ModalBuilder()
  .setCustomId(`spotrep_status`)
  .setTitle(`Status`)
  .addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("poi")
        .setLabel("KIV/POI")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("rare")
        .setLabel("Rare Cameo")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("off")
        .setLabel("Off/Off Soon (o/s)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("disputed")
        .setLabel("Disputed")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
    )
  )
  return await intr.showModal(modal);
}

async function loc_info_modal_text(intr, user_id) {
  const bus_svc = data_rows[user_id][1]
  if (!bus_svc) return await intr.reply({content: 'You need to add the bus service before adding location information!', flags: MessageFlags.Ephemeral});
  const modal = new ModalBuilder()
  .setCustomId(`spotrep_loc_info_text`)
  .setTitle(`Location Information`)
  .addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('bus_stop')
        .setLabel('Bus Stop')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
    )
  );
  return await intr.showModal(modal);
}

async function misc_info_modal(intr, user_id, c1) {
  const modal = new ModalBuilder()
  .setCustomId(`spotrep_misc_info`)
  .setTitle(`Miscellaneous Information`)
  .addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("advert")
        .setLabel("Advertisement")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("livery")
        .setLabel("Livery (SMRT/SBST/LG/Ad/Ad FB)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("logo")
        .setLabel("Logo (SMRT/SBST/TTS/GAS)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
    )
  )
  return await intr.showModal(modal);
}

async function depot_trf_modal(intr, user_id, c1) {
  return await intr.reply({content: 'This feature has yet been implemented!', flags: MessageFlags.Ephemeral});
}

async function filters_modal(intr, user_id, c1) {
  return await intr.reply({content: 'This feature has yet been implemented!', flags: MessageFlags.Ephemeral});
}

async function edit_modal(intr, user_id, c1) {
  return await intr.reply({content: 'This feature has yet been implemented!', flags: MessageFlags.Ephemeral});
}

async function delete_modal(intr, user_id, c1) {
  return await intr.reply({content: 'This feature has yet been implemented!', flags: MessageFlags.Ephemeral});
}

async function conf(intr, user_id, c1) {
  const ref_num = get_ref_num(c1, user_id)
  data_rows[user_id][0] = ref_num
  await save_spreadsheet_row('append', spottings_file_id, [data_rows[user_id]], `${capt(c1)}s!A:Z`)
  delete data_rows[user_id]
  return await intr.reply({content: `Ref Num: ${ref_num}`});
}

async function loc_info_modal_sel(intr, user_id) {
  const bus_svc = data_rows[user_id][1]
  const svc_termini = (await(await fetch('https://data.busrouter.sg/v1/services.json')).json())[bus_svc].name
  let termini_list = []
  if (svc_termini.includes('→')) termini_list = svc_termini.split(' → ')
  if (svc_termini.includes('⇄')) termini_list = svc_termini.split(' ⇄ ')
  if (svc_termini.includes('⟲')) termini_list = svc_termini.split(' ⟲ ')
  const t1 = svc_termini.includes('⟲') ? `1st half to ${termini_list[1]}` : `To ${termini_list[1]}`
  const t2 = svc_termini.includes('⟲')
    ? `2nd half to ${termini_list[0]}`
    : `${svc_termini.includes('→') ? null : `To ${termini_list[0]}`}`
  const termini_opt = ['None', t1, t2].filter(t => t !== null && t !== 'null').map(ter => {
    return {label: ter, value: ter};
  });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('spotrep_direction')
      .setPlaceholder('Pick a direction')
      .addOptions(termini_opt)
      .setRequired(false)
  )
}

async function key_info_process(intr, user_id) {
  const bus_svc = intr.fields.getTextInputValue('bus_service')
  const reg_num = intr.fields.getTextInputValue('reg_num') ?? null
  if (!await check_bus_svc(bus_svc)) return await intr.reply({content: `There is no such bus service ${bus_svc}!`, flags: MessageFlags.Ephemeral})
  if (reg_num.slice(0, 2).toUpperCase() === 'SG') {px_length = 2; prefix = 'SG'};
  if (reg_num.slice(0, 3).toUpperCase() === 'SBS') {px_length = 3; prefix = 'SBS'};
  if (reg_num.slice(0, 3).toUpperCase() === 'SMB') {px_length = 3; prefix = 'SMB'};
  if (!px_length) return await intr.reply({content: `Invalid prefix! Must be one of 'SG', 'SBS' or 'SMB'.`});
  const tr_reg_num = reg_num.slice(px_length, reg_num.length)
  const num = tr_reg_num.slice(0, tr_reg_num.length-1).padStart(4, '0')
  if (Number(num) < 1 || !Number(num)) return;
  if (num.length > 4) return;
  const checksum_info = calc_checksum(reg_num, px_length, prefix)
  if(!checksum_info[0]) return await intr.reply({content: `Your letter checksum is wrong! The correct checksum is ${checksum_info[1]}`, flags: MessageFlags.Ephemeral})
  data_rows[user_id][1] = bus_svc
  data_rows[user_id][2] = reg_num
  return await intr.reply({content: [
    `--- **Basic Information** ---`,
    `- Bus Service: ${bus_svc}`,
    `${reg_num ? `- Registration Number: ${reg_num}` : null}`
  ].filter(n => n !== null && n !== 'null').join('\n'), flags: MessageFlags.Ephemeral})
}

async function loc_info_process(intr, user_id) {
  let bus_stop_name = null
  const bus_stop = intr.fields.getTextInputValue('bus_stop') ?? null
  if (bus_stop) {bus_stop_name = await check_bus_stop(bus_stop)};
  if (bus_stop && !bus_stop_name) {return await intr.reply({content: `There is no such bus stop ${bus_stop_name}!`})};
  data_rows[user_id][4] = bus_stop_name;
  const modal = await loc_info_modal_sel(intr, user_id);
  return await intr.reply({content: [
    `You have provided a valid bus stop: ${bus_stop_name}`,
    `Please select the direction of the bus (can select none)`
  ].filter(n => n !== null && n !== 'null').join('\n'), components: [modal], flags: MessageFlags.Ephemeral})
}

async function status_process(intr, user_id) {
  let status = []
  const poi = intr.fields.getTextInputValue('poi') ?? null
  const rare = intr.fields.getTextInputValue('rare') ?? null
  const off = intr.fields.getTextInputValue('off') ?? null
  const off_stat_text = {o: 'OFF', s: 'OFF Soon'}
  const disputed = intr.fields.getTextInputValue('disputed') ?? null
  if (!['o', 's'].includes(off) && off !== '') return await intr.reply({content: `'${off}' is invalid off status! Use either 'o' for off or 's' for off soon.`, flags: MessageFlags.Ephemeral})
  if (poi) status.push('POI')
  if (rare) status.push('Rare')
  if (off) status.push(off_stat_text[off])
  if (disputed) status.push('Disputed')
  data_rows[user_id][3] = status.join('\n')
  return await intr.reply({content: [
    `--- **Statuses** ---\n${poi ? 'POI' : ''}`,
    `${rare ? 'Rare' : null}`,
    `${off ? off_stat_text[off] : null}`,
    `${disputed ? 'Disputed' : null}`
  ].filter(s => s !== null && s !== 'null').join(','), flags: MessageFlags.Ephemeral})
}

async function misc_process(intr, user_id) {
  const advert = intr.fields.getTextInputValue('advert') ?? null
  const livery = intr.fields.getTextInputValue('livery') ?? null
  const logo = intr.fields.getTextInputValue('logo') ?? null
  if (!['SBST', 'SMRT', 'LG', 'Ad', 'Ad FB'].includes(livery)) return await intr.reply({content: `Invalid livery! must be one of 'SBST', 'SMRT', 'LG', 'Ad' or 'Ad FB' (Ad Full Body).`, flags: MessageFlags.Ephemeral})
  if (!['SBST', 'SMRT', 'TTS', 'GAS'].includes(livery)) return await intr.reply({content: `Invalid logo! must be one of 'SBST', 'SMRT', 'TTS' or 'GAS'.`, flags: MessageFlags.Ephemeral})
  data_rows[user_id][9] = advert
  data_rows[user_id][10] = [`${livery ? `${livery} livery` : null}`, `${logo ? `${logo} logo` : null}`].filter(m => m !== null && m !== 'null').join('\n')
  await intr.reply({content: [
    `--- **Miscellaneous Information** ---`,
    `${advert ? `- Advertisement: ${advert}` : null}`,
    `${livery ? `- Livery: ${livery}` : null}`,
    `${logo ? `- Logo: ${logo}` : null}`
  ].filter(m => m !== null && m !== 'null').join('\n'), flags: MessageFlags.Ephemeral})
}

async function loc_info_sel(intr, user_id) {
  let direction;
  direction = intr.values[0]
  if (direction === 'None') direction = null
  data_rows[user_id][5] = direction;
  return await intr.reply({content: [
    `--- **Location Information** ---`,
    `${data_rows[user_id][4] !== 'bus_stop' ? `- Bus Stop: ${data_rows[user_id][4]}` : null}`,
    `${direction ? `- Bus Direction: ${direction}` : null}`
  ].filter(n => n !== null && n !== 'null').join('\n'), flags: MessageFlags.Ephemeral})
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
  let bus_stop_name = null; verify = false
  if (Number(bus_stop) && bus_stop.length === 5) {
    bus_stop_name = (await (await fetch('https://data.busrouter.sg/v1/stops.json')).json())[bus_stop]?.[2]
  } else if (bus_stop !== null) {
    const bus_stop_name_list = (Object.values(await (await fetch('https://data.busrouter.sg/v1/stops.json')).json())).map(m => m[2])
    bus_stop_name = bus_stop_name_list?.[bus_stop_name_list.map(m => m.toLowerCase()).indexOf(bus_stop.toLowerCase())]
  }
  return bus_stop_name
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

function capt(str) {
  const first = str.slice(0,1).toUpperCase()
  return first + str.slice(1, str.length)
}

module.exports = {spotrep_buttons, spotrep_main_embed, spotrep_processes, spotrep_selects, data_rows}