const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const {token} = require('../info.json')
const channel_id = '1003156510127427624';

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(channel_id);
  if (!channel) {
    console.error('Channel not found!');
    process.exit(1);
  }

  const channel_name = channel.name || `thread-${channel.id}`;
  console.log(`Initialised channel backup for channel ${channel_name}.`)
  let all_messages = [];
  let last_id;

  // First, get the latest message so we know the total count
  const total_msgs = channel.messageCount ?? null; 
  // Note: messageCount is only available for threads. For regular channels,
  // Discord does not expose the total count, so progress is shown by number fetched.

  while (true) {
    const options = { limit: 100 };
    if (last_id) options.before = last_id;

    const messages = await channel.messages.fetch(options);
    if (messages.size === 0) break;
    messages.forEach(msg => {
      all_messages.push({
        username: msg.author.username,   // Username, not nickname
        content: msg.content,
        timestamp: msg.createdAt
      });
    });
    last_id = messages.last().id;

    // Progress display
    const current_fetched = all_messages.length;
    if (total_msgs) {
      const percent = ((current_fetched / total_msgs) * 100).toFixed(2);
      process.stdout.write(
        `\rProgress: ${percent}% (${current_fetched}/${total_msgs} messages)`
      );
    } else {
      process.stdout.write(
        `\rFetched ${current_fetched} messages so far...`
      );
    }

    // Delay to avoid hammering the API (in ms)
    await new Promise(res => setTimeout(res, 50));
  }
	all_messages.sort((a,b) => a.timestamp - b.timestamp);
	for (const msg of all_messages) {
		msg.timestamp = format_date(msg.timestamp)
	}
  console.log('\nAll messages fetched! Saving file...');
	// Check for ILLEGAL chars, turn them to "-"
	const channel_name2 = replace_characters(channel_name,`/<>"?*|:`,'-')
  // Save as JSON file named after channel
  fs.writeFileSync(`../STC Channel Backup/${channel_name2}.json`,JSON.stringify(all_messages, null, 2));
  console.log(`Saved ${all_messages.length} messages to ${channel_name}.json`);
  process.exit(0);
});

client.login(token);

function format_date(date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0'); // Ensure 2 digits
	const day = String(date.getDate()).padStart(2, '0'); // Ensure 2 digits
	const time = date.toLocaleString('default',{'hour':'numeric','minute':'numeric','second':'numeric'})
	return `${year}/${month}/${day} ${time}`;
}

function replace_characters(input_string, chars_to_replace, replacement) {
    if (typeof input_string !== 'string' || typeof chars_to_replace !== 'string' || typeof replacement !== 'string') {
        throw new Error('All inputs must be strings.');
    }
    const regex = new RegExp(`[${chars_to_replace}]`, 'g');
    // Replace the matched characters with the replacement character
    return input_string.replace(regex, replacement);
}