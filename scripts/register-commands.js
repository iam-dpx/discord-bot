// Run once (and again any time you change the command definitions below):
//   node scripts/register-commands.js
//
// Requires these environment variables set in your shell:
//   DISCORD_APPLICATION_ID
//   DISCORD_TOKEN   (bot token)
//   DISCORD_GUILD_ID (optional — omit to register globally, which takes up
//                      to an hour to propagate; include it to update instantly
//                      for just your server, good for testing)

const appId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

const commands = [
  {
    name: 'addserver',
    description: 'Submit a private server to the list',
    type: 1,
  },
  {
    name: 'serverlist',
    description: 'Browse submitted servers',
    type: 1,
    options: [
      {
        name: 'game_name',
        description: 'Filter by game',
        type: 3, // STRING
        required: false,
        autocomplete: true,
      },
    ],
  },
];

const url = guildId
  ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${appId}/commands`;

const res = await fetch(url, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  console.error('Failed to register commands:', res.status, await res.text());
  process.exit(1);
}

console.log('Commands registered:', await res.json());
