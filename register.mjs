/*
  register.mjs
  Dead Pixel — registers this bot's slash commands with Discord
  Written by Dead Pixel (iamreal.dpx@gmail.com)

  Run once, and again any time the command list below changes:
    DISCORD_TOKEN=xxx DISCORD_APPLICATION_ID=xxx node register.mjs
*/

const token = process.env.DISCORD_TOKEN;
const appId = process.env.DISCORD_APPLICATION_ID;

if (!token || !appId) {
  console.error("Set DISCORD_TOKEN and DISCORD_APPLICATION_ID environment variables first.");
  process.exit(1);
}

// Discord permission bit flags used below:
//   ADMINISTRATOR    = 8
//   MANAGE_NICKNAMES = 134217728
const commands = [
  {
    name: "setnickname",
    description: "Change the bot's nickname in this server only",
    default_member_permissions: "134217728",
    options: [
      {
        name: "nickname",
        description: "New nickname for this server",
        type: 3, // STRING
        required: true,
      },
    ],
  },
  {
    name: "setname",
    description: "Change the bot's username everywhere it's added (admin only, rate-limited)",
    default_member_permissions: "8",
    options: [
      {
        name: "username",
        description: "New username",
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "setavatar",
    description: "Change the bot's avatar everywhere it's added (admin only, rate-limited)",
    default_member_permissions: "8",
    options: [
      {
        name: "url",
        description: "Direct link to an image (png/jpg)",
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "setdescription",
    description: "Change the bot's \"About Me\" text everywhere it's added (admin only)",
    default_member_permissions: "8",
    options: [
      {
        name: "text",
        description: "New description text",
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "addserver",
    description: "Submit a private server to the list",
    options: [
      {
        name: "game_name",
        description: "Which game is this server for?",
        type: 3, // STRING
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: "serverlist",
    description: "Browse submitted servers",
    options: [
      {
        name: "game_name",
        description: "Filter by game",
        type: 3, // STRING
        required: false,
        autocomplete: true,
      },
    ],
  },
];

const res = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  console.error("Failed to register commands:", res.status, await res.text());
  process.exit(1);
}

console.log("Commands registered successfully.");
