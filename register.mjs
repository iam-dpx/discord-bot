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
    name: "clear",
    description: "Delete recent messages in this channel (mod only)",
    default_member_permissions: "8192", // MANAGE_MESSAGES — visibility filter only; real check is the mod role in index.ts
    options: [
      {
        name: "amount",
        description: "How many messages to delete, 1-100 (default 100)",
        type: 4, // INTEGER
        required: false,
        min_value: 1,
        max_value: 100,
      },
    ],
  },
  {
    name: "nuke",
    description: "Delete and recreate this channel, wiping its entire history — owner only",
    default_member_permissions: "8",
  },
  {
    name: "rules",
    description: "Post (or refresh) the community rules in the rules channel — owner only",
    default_member_permissions: "8",
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
  {
    name: "mine",
    description: "Idle Miner game",
    options: [
      { name: "check", description: "Check your current mining progress", type: 1 },
      { name: "sell", description: "Sell your mined blocks for coins", type: 1 },
      { name: "profile", description: "View your miner profile", type: 1 },
      { name: "rebirth", description: "Rebirth for permanent bonuses (requires max gear + level 50)", type: 1 },
      {
        name: "coinflip",
        description: "Bet coins on a coin flip",
        type: 1,
        options: [
          { name: "amount", description: "Coins to bet", type: 4, required: true, min_value: 1 },
          {
            name: "side",
            description: "Pick a side",
            type: 3,
            required: true,
            choices: [
              { name: "Heads", value: "heads" },
              { name: "Tails", value: "tails" },
            ],
          },
        ],
      },
      {
        name: "slots",
        description: "Bet coins on the slots",
        type: 1,
        options: [{ name: "amount", description: "Coins to bet", type: 4, required: true, min_value: 1 }],
      },
      { name: "daily", description: "Claim your daily reward", type: 1 },
      { name: "weekly", description: "Claim your weekly reward", type: 1 },
      { name: "monthly", description: "Claim your monthly reward", type: 1 },
      {
        name: "upgrade",
        description: "Upgrade your gear",
        type: 2, // SUB_COMMAND_GROUP
        options: [
          { name: "pickaxe", description: "Upgrade your pickaxe to the next tier", type: 1 },
          { name: "backpack", description: "Upgrade your backpack to the next tier", type: 1 },
        ],
      },
      {
        name: "pet",
        description: "Pet system",
        type: 2, // SUB_COMMAND_GROUP
        options: [
          { name: "hunt", description: "Go hunting for a pet", type: 1 },
          { name: "list", description: "See all available pets", type: 1 },
          {
            name: "upgrade",
            description: "Level up one of your pets using shards",
            type: 1,
            options: [
              {
                name: "pet",
                description: "Which pet to level up",
                type: 3,
                required: true,
                choices: [
                  { name: "Mole", value: "mole" },
                  { name: "Bat", value: "bat" },
                  { name: "Owl", value: "owl" },
                  { name: "Slime", value: "slime" },
                  { name: "Golem", value: "golem" },
                  { name: "Crystal Fox", value: "crystalfox" },
                ],
              },
            ],
          },
        ],
      },
      {
        name: "globalboost",
        description: "[Owner] Start a server-wide income booster",
        type: 1,
        options: [
          { name: "multiplier", description: "e.g. 2 for 2x income", type: 10, required: true },
          { name: "minutes", description: "Duration in minutes", type: 4, required: true },
          { name: "label", description: "What to call this event", type: 3, required: false },
        ],
      },
      {
        name: "gmboost",
        description: "[Owner] Gift a booster to one player",
        type: 1,
        options: [
          { name: "user", description: "Who to gift", type: 6, required: true },
          { name: "multiplier", description: "e.g. 2 for 2x income", type: 10, required: true },
          { name: "minutes", description: "Duration in minutes", type: 4, required: true },
        ],
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
