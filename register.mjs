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
    description: "Try to mine for a bonus reward (one of 3 buttons is a hidden critical hit!)",
  },
  { name: "sell", description: "Check on your mined materials" },
  { name: "profile", description: "View your miner profile" },
  { name: "prestige", description: "Prestige for permanent bonuses (resets progress, raises max upgrade slots)" },
  { name: "leaderboard", description: "See the top players by balance" },
  {
    name: "coinflip",
    description: "Bet coins on a coin flip",
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
    options: [{ name: "amount", description: "Coins to bet", type: 4, required: true, min_value: 1 }],
  },
  { name: "daily", description: "Claim your daily reward" },
  { name: "weekly", description: "Claim your weekly reward" },
  { name: "monthly", description: "Claim your monthly reward" },
  {
    // No options anymore — this opens a button panel (Size/Miner/Workers),
    // each button opens a modal asking how many to buy. See src/commands/mine.ts.
    name: "upgrade",
    description: "Open the upgrade panel (Size / Miner / Workers)",
  },
  { name: "pethunt", description: "Go hunting for a pet" },
  { name: "petlist", description: "See all available pets" },
  {
    name: "petupgrade",
    description: "Level up one of your pets using pet shards",
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
  {
    name: "admin",
    description: "[Game Master] Idle Miner admin actions",
    options: [
      {
        name: "action",
        description: "What do you want to do?",
        type: 3,
        required: true,
        choices: [
          { name: "Start global booster (server-wide)", value: "globalboost" },
          { name: "Gift an income booster to a player", value: "gmboost" },
          { name: "Adjust Coins (+/-)", value: "adjustcoins" },
          { name: "Adjust Gems (+/-)", value: "adjustgems" },
          { name: "Adjust Shards (+/-)", value: "adjustshards" },
          { name: "Adjust Pet Shards (+/-)", value: "adjustpetshards" },
          { name: "Adjust XP (+/-)", value: "adjustxp" },
          { name: "Set Level", value: "setlevel" },
        ],
      },
      // Leave "user" blank on any action to target yourself (self-gift / self-booster).
      { name: "user", description: "Target player — leave blank to target yourself", type: 6, required: false },
      { name: "multiplier", description: "e.g. 2 for 2x income (boosters only)", type: 10, required: false },
      { name: "minutes", description: "Duration in minutes (boosters only)", type: 4, required: false },
      { name: "label", description: "What to call this event (global booster only)", type: 3, required: false },
      { name: "amount", description: "Positive to give, negative to take away (adjust actions); target value for Set Level", type: 4, required: false },
    ],
  },
  {
    name: "corp",
    description: "Corporations — team up, share a bank, and earn a group income buff",
    options: [
      {
        name: "create",
        description: "Found a new corporation (you become its leader)",
        type: 1,
        options: [{ name: "name", description: "Corporation name", type: 3, required: true, max_length: 32 }],
      },
      {
        name: "join",
        description: "Join an existing corporation by name",
        type: 1,
        options: [{ name: "name", description: "Corporation name", type: 3, required: true }],
      },
      { name: "leave", description: "Leave your current corporation", type: 1 },
      {
        name: "info",
        description: "View your corporation's (or a named one's) bank, buff, and roster",
        type: 1,
        options: [{ name: "name", description: "Leave blank to see your own corporation", type: 3, required: false }],
      },
      {
        name: "deposit",
        description: "Deposit coins or gems into your corporation's bank",
        type: 1,
        options: [
          { name: "amount", description: "Amount to deposit", type: 4, required: true, min_value: 1 },
          {
            name: "asset",
            description: "Coins or gems",
            type: 3,
            required: false,
            choices: [
              { name: "Coins", value: "coins" },
              { name: "Gems", value: "gems" },
            ],
          },
        ],
      },
      {
        name: "withdraw",
        description: "[Leader only] Withdraw coins or gems from the corporation bank",
        type: 1,
        options: [
          { name: "amount", description: "Amount to withdraw", type: 4, required: true, min_value: 1 },
          {
            name: "asset",
            description: "Coins or gems",
            type: 3,
            required: false,
            choices: [
              { name: "Coins", value: "coins" },
              { name: "Gems", value: "gems" },
            ],
          },
        ],
      },
      {
        name: "kick",
        description: "[Leader only] Remove a member from your corporation",
        type: 1,
        options: [{ name: "user", description: "Member to remove", type: 6, required: true }],
      },
      { name: "leaderboard", description: "Top corporations by bank balance", type: 1 },
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
