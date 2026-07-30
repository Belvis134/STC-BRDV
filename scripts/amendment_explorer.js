const { amendments_file_id } = require('../config');
const {load_from_drive, load_refresh_token} = require('./drive_api_handler');
const amendment_data = {amendments:{raw:{},json:{}},users:{}};

(async function main() {
  load_refresh_token();
  amendment_data.amendments.raw = await load_from_drive('spreadsheet', amendments_file_id, {range: 'Main Sheet!A:I'})
  amendment_data.amendments.json = await col_names_to_json(amendment_data.amendments.raw)
})();
const { Client, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags, AttachmentBuilder,
  SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, Events, Message} = require('discord.js');

async function amendment_main(interaction, user_id) {
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

async function amendment_modify(interaction, user_id) {
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

  await interaction.update({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
}

function amendment_repo_edit(user, routes, params, rating, link) {

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
  amendment_data.amendments.raw = await load_from_drive('spreadsheet', amendments_file_id, {range: 'Main Sheet!A:I'})
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

async function amendment_buttons() {
  const [type, c1, c2, c3, user_id] = interaction.customId.split('_');
  if (c1 === 'help') await interaction.reply({content: [
    '**How to use Amendment Explorer**',
    '- Search: Find amendments by bus, user, or type.',
    '- Modify: Edit or delete your own amendments.',
    '- Repository Link: View the full Google Sheet.'
  ].join('\n'), flags: MessageFlags.Ephemeral});
  if (c1 === 'search') {};
  if (c1 === 'modify') await amendment_modify(interaction, user_id);
  if (c1 === 'search') {};
  if (c1 === 'home_modify') {};
}

module.exports = {amendment_main, amendment_buttons, update_recent_amendments}