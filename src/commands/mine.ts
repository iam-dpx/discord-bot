// Handler for the flattened game commands (/mine /sell /profile /rebirth
// /coinflip /slots /daily /weekly /monthly /upgrade /pethunt /petlist
// /petupgrade /admin). Call handleGameCommand(interaction, env) from your
// existing interaction router.
//
// NOTE: adjust `env.DB` below if your D1 binding has a different name
// (check wrangler.toml [[d1_databases]] "binding" value).
// Owner check reuses env.OWNER_USER_ID — same source of truth as the rest
// of the bot's owner-only commands (setname/setavatar/nuke/rules).

import {
  UPGRADE_TYPES,
  PETS,
  ORES,
  HUNT_PET_CHANCE,
  HUNT_SHARD_REWARD,
  SHARDS_PER_PET_LEVEL,
  COOLDOWNS_MS,
  MINE_COOLDOWN_MS,
  icon,
} from "../game/data";
import {
  getOrCreatePlayer,
  savePlayer,
  accruePassiveIncome,
  effectiveIncomePerMinute,
  getUpgradeCounts,
  maxUpgradeSlots,
  nextUpgradeCost,
  buyUpgrade,
  getOwnedPets,
  canPrestige,
  applyPrestige,
  PRESTIGE_MIN_BALANCE,
  rollMinePreview,
  applyMineClick,
  Player,
  MinePreview,
} from "../game/economy";

const COLOR = 0x2ecc71;
const COLOR_WARN = 0xe74c3c;

function reply(content: any) {
  return { type: 4, data: content };
}
function simpleEmbed(title: string, description: string, opts: { thumbnail?: string; color?: number } = {}) {
  return reply({
    embeds: [
      {
        title,
        description,
        color: opts.color ?? COLOR,
        thumbnail: opts.thumbnail ? { url: opts.thumbnail } : undefined,
      },
    ],
  });
}

// Walks interaction options to find the deepest subcommand name + its options,
// handling both plain subcommands and one level of subcommand group.
// Still used internally for the "pet" trio, kept as top-level commands now
// but sharing this same simple options-array reader.
function optVal(options: any[], name: string) {
  return options.find((o) => o.name === name)?.value;
}

// Flat top-level commands: /mine /sell /profile /rebirth /coinflip /slots
// /daily /weekly /monthly /upgrade /pethunt /petlist /petupgrade /admin
export async function handleGameCommand(interaction: any, env: { DB: any; OWNER_USER_ID: string }) {
  const db = env.DB;
  const guildId = interaction.guild_id;
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  const name = interaction.data?.name;
  const options = interaction.data?.options ?? [];

  // /admin doesn't need a player row loaded — it acts on the guild or a
  // target user, not the caller's own progress.
  if (name === "admin") {
    const action = optVal(options, "action");
    if (action === "globalboost") return handleGlobalBoost(interaction, db, options, env.OWNER_USER_ID);
    if (action === "gmboost") return handleGmBoost(interaction, db, options, env.OWNER_USER_ID);
    return simpleEmbed("Unknown admin action", "Pick a valid action from the dropdown.", { color: COLOR_WARN });
  }

  let player = await getOrCreatePlayer(db, guildId, userId);
  player = await accruePassiveIncome(db, player);

  switch (name) {
    case "mine":
      return handleCheck(player, db);
    case "sell":
      return handleSell(player, db);
    case "profile":
      return handleProfile(player, db);
    case "prestige":
      return handlePrestige(player, db);
    case "leaderboard":
      return handleLeaderboard(player, db);
    case "coinflip":
      return handleCoinflip(player, db, options);
    case "slots":
      return handleSlots(player, db, options);
    case "daily":
      return handleClaim(player, db, "daily");
    case "weekly":
      return handleClaim(player, db, "weekly");
    case "monthly":
      return handleClaim(player, db, "monthly");
    case "upgrade":
      return handleUpgrade(player, db, optVal(options, "type"), options);
    case "pethunt":
      return handlePet(player, db, "hunt", options);
    case "petlist":
      return handlePet(player, db, "list", options);
    case "petupgrade":
      return handlePet(player, db, "upgrade", options);
    default:
      await savePlayer(db, player);
      return simpleEmbed("Unknown command", "That command isn't wired up yet.", { color: COLOR_WARN });
  }
}

// ------------------------------------------------------------ CORE LOOP ---
// Encodes the mine-round state directly in each button's custom_id, since
// slash-command -> button-click are two separate stateless interactions and
// this avoids needing a session table (same pattern this repo already uses
// for nuke_confirm_<channelId>).
function buildMineButtons(guildId: string, userId: string, preview: MinePreview) {
  const payload = `${guildId}_${userId}_${preview.critIndex}_${preview.cash}_${preview.xp}_${preview.material}_${preview.oreKey}`;
  return [
    { type: 1, components: [0, 1, 2].map((i) => ({
      type: 2,
      style: 1, // blurple; the actual crit button looks identical until clicked, matching the real bot's random "which one is green" surprise
      label: "Mine",
      custom_id: `mine_${i}_${payload}`,
    })) },
  ];
}

async function handleCheck(p: Player, db: any) {
  const now = Date.now();
  const sinceLast = now - p.last_mine_click_at;

  if (sinceLast < MINE_COOLDOWN_MS) {
    await savePlayer(db, p);
    const secs = Math.ceil((MINE_COOLDOWN_MS - sinceLast) / 1000);
    const rate = await effectiveIncomePerMinute(db, p);
    return simpleEmbed(
      "Still cooling down",
      `You can mine again in **${secs}s**.\nMeanwhile, you're earning **${Math.floor(rate)}/min** passively — balance: **${p.coins}**.`,
      { color: COLOR_WARN }
    );
  }

  await savePlayer(db, p);
  const preview = rollMinePreview(p);
  return {
    type: 4,
    data: {
      embeds: [
        {
          title: "Mine",
          description: "Click a Mine button — one of them is a hidden critical hit worth 2x!",
          color: COLOR,
          thumbnail: { url: icon(`ore_${preview.oreKey}`) },
        },
      ],
      components: buildMineButtons(p.guild_id, p.user_id, preview),
    },
  };
}

async function handleSell(p: Player, db: any) {
  await savePlayer(db, p);
  return simpleEmbed(
    "Materials aren't sold directly",
    `You have **${p.materials}** materials banked from mining — these will feed into crafting/corporation features later. ` +
      `Your coin balance grows automatically from your $/min income — check \`/profile\`.`,
    { thumbnail: icon("shard") }
  );
}

async function handleProfile(p: Player, db: any) {
  await savePlayer(db, p);
  const pets = await getOwnedPets(db, p.guild_id, p.user_id);
  const petList = pets.length
    ? pets.map((o) => `${PETS.find((d) => d.key === o.pet_key)?.label ?? o.pet_key} (Lv.${o.level})`).join(", ")
    : "None yet — try `/pethunt`";
  const rate = await effectiveIncomePerMinute(db, p);
  const factoryAgeDays = Math.floor((Date.now() - p.created_at) / 86400000);

  // Field order matches the real bot's /profile exactly: Factory Name,
  // Location, Corporation, Balance, Income/min, Prestige, Level, Factory Age.
  // Location/Corporation are placeholders until those systems are built.
  return reply({
    embeds: [
      {
        title: "Miner Profile",
        color: COLOR,
        thumbnail: { url: icon("factory_icon") },
        fields: [
          { name: "Factory Name", value: `${p.user_id}'s Factory`, inline: true },
          { name: "Location", value: "Garage", inline: true },
          { name: "Corporation", value: "None", inline: true },
          { name: "Balance", value: `$${p.coins}`, inline: true },
          { name: "Income (per minute)", value: `$${Math.floor(rate)}`, inline: true },
          { name: "Prestige", value: `${p.prestige}`, inline: true },
          { name: "Level", value: `${p.level}`, inline: true },
          { name: "Factory Age", value: `${factoryAgeDays} Days`, inline: true },
          { name: "Gems", value: `${p.gems}`, inline: true },
          { name: "Shards", value: `${p.shards}`, inline: true },
          { name: "Materials", value: `${p.materials}`, inline: true },
          { name: "Pets", value: petList, inline: false },
        ],
      },
    ],
  });
}

// -------------------------------------------------------------- UPGRADE ---
async function handleUpgrade(p: Player, db: any, kind: string, options: any[]) {
  const def = UPGRADE_TYPES.find((u) => u.key === kind);
  if (!def) {
    await savePlayer(db, p);
    return simpleEmbed("Unknown upgrade", "Use `/upgrade type:size`, `type:miner`, or `type:workers`.", { color: COLOR_WARN });
  }

  const result = await buyUpgrade(db, p, kind);
  await savePlayer(db, p);
  if (!result.ok) {
    return simpleEmbed("Can't upgrade", result.reason ?? "Something went wrong.", { color: COLOR_WARN });
  }
  return simpleEmbed(
    `${def.label} upgraded!`,
    `Cost: $${result.cost}. +$${def.profitPerMin}/min income.`,
    { thumbnail: def.icon }
  );
}

// ------------------------------------------------------------------ PETS ---
async function handlePet(p: Player, db: any, action: string, options: any[]) {
  if (action === "hunt") {
    const now = Date.now();
    if (now - p.last_hunt_at < COOLDOWNS_MS.hunt) {
      const mins = Math.ceil((COOLDOWNS_MS.hunt - (now - p.last_hunt_at)) / 60000);
      await savePlayer(db, p);
      return simpleEmbed("On cooldown", `You can hunt again in **${mins} min**.`, { color: COLOR_WARN });
    }
    p.last_hunt_at = now;

    if (Math.random() < HUNT_PET_CHANCE) {
      const totalWeight = PETS.reduce((s, x) => s + x.weight, 0);
      let roll = Math.random() * totalWeight;
      let chosen = PETS[0];
      for (const pet of PETS) {
        if (roll < pet.weight) { chosen = pet; break; }
        roll -= pet.weight;
      }
      const owned = await getOwnedPets(db, p.guild_id, p.user_id);
      const already = owned.find((o) => o.pet_key === chosen.key);
      if (already) {
        // duplicate -> convert to shards instead of a second copy
        p.shards += HUNT_SHARD_REWARD;
        await savePlayer(db, p);
        return simpleEmbed("Duplicate pet!", `You found another **${chosen.label}** — converted to **${HUNT_SHARD_REWARD} shards** instead.`, { thumbnail: chosen.icon });
      }
      await db
        .prepare("INSERT INTO player_pets (guild_id, user_id, pet_key, level, obtained_at) VALUES (?, ?, ?, 1, ?)")
        .bind(p.guild_id, p.user_id, chosen.key, now)
        .run();
      await savePlayer(db, p);
      return simpleEmbed("New pet!", `You found a **${chosen.label}**! Check \`/profile\` to see it.`, { thumbnail: chosen.icon });
    } else {
      p.shards += HUNT_SHARD_REWARD;
      await savePlayer(db, p);
      return simpleEmbed("No pet this time", `Found **${HUNT_SHARD_REWARD} shards** instead. Try again later!`, { thumbnail: icon("shard") });
    }
  }

  if (action === "list") {
    await savePlayer(db, p);
    return reply({
      embeds: [
        {
          title: "Available Pets",
          color: COLOR,
          fields: PETS.map((pet) => ({
            name: pet.label,
            value: `Perk: ${pet.perk} +${pet.baseValue}% (+${pet.perLevel}%/level)`,
            inline: true,
          })),
        },
      ],
    });
  }

  if (action === "upgrade") {
    const petKey = optVal(options, "pet");
    const def = PETS.find((x) => x.key === petKey);
    if (!def) { await savePlayer(db, p); return simpleEmbed("Unknown pet", "Check `/petlist` for valid pet names.", { color: COLOR_WARN }); }
    if (p.shards < SHARDS_PER_PET_LEVEL) {
      await savePlayer(db, p);
      return simpleEmbed("Not enough shards", `You need **${SHARDS_PER_PET_LEVEL} shards** to level up a pet. You have **${p.shards}**.`, { color: COLOR_WARN });
    }
    const owned = (await db
      .prepare("SELECT id, level FROM player_pets WHERE guild_id=? AND user_id=? AND pet_key=?")
      .bind(p.guild_id, p.user_id, petKey)
      .first()) as { id: number; level: number } | null;
    if (!owned) { await savePlayer(db, p); return simpleEmbed("You don't own this pet", "Hunt one first with `/pethunt`.", { color: COLOR_WARN }); }

    p.shards -= SHARDS_PER_PET_LEVEL;
    await db.prepare("UPDATE player_pets SET level = level + 1 WHERE id = ?").bind(owned.id).run();
    await savePlayer(db, p);
    return simpleEmbed("Pet leveled up!", `Your **${def.label}** is now level **${owned.level + 1}**.`, { thumbnail: def.icon });
  }

  await savePlayer(db, p);
  return simpleEmbed("Unknown pet action", "Use `/pethunt`, `/petlist`, or `/petupgrade`.", { color: COLOR_WARN });
}

// ---------------------------------------------------------- LEADERBOARD ---
async function handleLeaderboard(p: Player, db: any) {
  await savePlayer(db, p);
  const top = (await db
    .prepare("SELECT user_id, coins FROM players WHERE guild_id=? ORDER BY coins DESC LIMIT 10")
    .bind(p.guild_id)
    .all()) as { results: { user_id: string; coins: number }[] };

  const rows = top.results ?? [];
  const lines = rows.map((r, i) => `#${i + 1}: <@${r.user_id}> - $${r.coins}`);

  const callerRank = (await db
    .prepare("SELECT COUNT(*) as rank FROM players WHERE guild_id=? AND coins > ?")
    .bind(p.guild_id, p.coins)
    .first()) as { rank: number } | null;
  const myRank = (callerRank?.rank ?? 0) + 1;
  if (!rows.find((r) => r.user_id === p.user_id)) {
    lines.push(`—`, `#${myRank}: You - $${p.coins}`);
  }

  return simpleEmbed("Balance Leaderboard", lines.join("\n") || "No one has any coins yet.", { thumbnail: icon("coin") });
}

// ------------------------------------------------------------- PRESTIGE ---
async function handlePrestige(p: Player, db: any) {
  if (!canPrestige(p)) {
    await savePlayer(db, p);
    return simpleEmbed(
      "Not ready to prestige",
      `You need at least $${PRESTIGE_MIN_BALANCE} balance before you can prestige. You have $${p.coins}. ` +
        `(This requirement is an assumption — the real bot's exact threshold isn't confirmed yet.)`,
      { color: COLOR_WARN }
    );
  }
  const gemsEarned = await applyPrestige(db, p);
  await savePlayer(db, p);
  const milestoneNote =
    p.prestige === 2 ? "\nUnlocked: Prestige Tokens!" :
    p.prestige === 3 ? "\nUnlocked: Investments! (not built yet)" :
    p.prestige === 5 ? "\nUnlocked: Robbing! (not built yet)" :
    p.prestige === 10 ? "\nUnlocked: Stocks! (not built yet)" :
    p.prestige === 15 ? "\nUnlocked: Leaderboard Quick View! (not built yet)" : "";
  return simpleEmbed(
    "Prestige complete!",
    `You reset your progress and earned **${gemsEarned} gems**.\nPrestige: **${p.prestige}** | Max upgrade slots: **${p.prestige * 10 + 410}**` +
      milestoneNote,
    { thumbnail: icon("rebirth_icon") }
  );
}

// ----------------------------------------------------------- MINIGAMES ---
async function handleCoinflip(p: Player, db: any, options: any[]) {
  const amount = Number(optVal(options, "amount") ?? 0);
  const choice = optVal(options, "side"); // "heads" | "tails"
  if (!amount || amount <= 0 || amount > p.coins) {
    await savePlayer(db, p);
    return simpleEmbed("Invalid bet", "Enter an amount you actually have.", { color: COLOR_WARN });
  }
  const result = Math.random() < 0.5 ? "heads" : "tails";
  const won = result === choice;
  p.coins += won ? amount : -amount;
  await savePlayer(db, p);
  return simpleEmbed(
    won ? "You won!" : "You lost",
    `Landed on **${result}**. ${won ? `+${amount}` : `-${amount}`} coins. Balance: **${p.coins}**.`,
    { color: won ? COLOR : COLOR_WARN }
  );
}

async function handleSlots(p: Player, db: any, options: any[]) {
  const amount = Number(optVal(options, "amount") ?? 0);
  if (!amount || amount <= 0 || amount > p.coins) {
    await savePlayer(db, p);
    return simpleEmbed("Invalid bet", "Enter an amount you actually have.", { color: COLOR_WARN });
  }
  const symbols = ["GEM", "STAR", "BELL", "CLOVER"]; // plain text — no emoji per project preference
  const spin = [0, 1, 2].map(() => symbols[Math.floor(Math.random() * symbols.length)]);
  const allMatch = spin[0] === spin[1] && spin[1] === spin[2];
  const twoMatch = spin[0] === spin[1] || spin[1] === spin[2] || spin[0] === spin[2];
  let winnings = 0;
  if (allMatch) winnings = amount * 5;
  else if (twoMatch) winnings = Math.floor(amount * 1.5);
  else winnings = -amount;

  p.coins += winnings;
  await savePlayer(db, p);
  return simpleEmbed(
    winnings > 0 ? "Winner!" : "No luck",
    `[ ${spin.join(" | ")} ]\n${winnings >= 0 ? `+${winnings}` : winnings} coins. Balance: **${p.coins}**.`,
    { color: winnings > 0 ? COLOR : COLOR_WARN }
  );
}

// ------------------------------------------------------- CLAIM REWARDS ---
async function handleClaim(p: Player, db: any, kind: "daily" | "weekly" | "monthly") {
  const field = kind === "daily" ? "last_daily_at" : kind === "weekly" ? "last_weekly_at" : "last_monthly_at";
  const cd = COOLDOWNS_MS[kind];
  const last = (p as any)[field] as number;
  const now = Date.now();
  if (now - last < cd) {
    await savePlayer(db, p);
    const hrs = Math.ceil((cd - (now - last)) / 3600000);
    return simpleEmbed("Already claimed", `Come back in about **${hrs}h** for your next ${kind} reward.`, { color: COLOR_WARN });
  }
  const rewards = { daily: 200, weekly: 1800, monthly: 8000 };
  const gemReward = { daily: 0, weekly: 1, monthly: 5 };
  p.coins += rewards[kind];
  p.gems += gemReward[kind];
  (p as any)[field] = now;
  await savePlayer(db, p);
  return simpleEmbed(
    `${kind[0].toUpperCase()}${kind.slice(1)} reward claimed!`,
    `+${rewards[kind]} coins${gemReward[kind] ? ` and +${gemReward[kind]} gems` : ""}.`,
    { thumbnail: icon("coin") }
  );
}

// --------------------------------------------------- OWNER-ONLY BOOSTS ---
async function handleGlobalBoost(interaction: any, db: any, options: any[], ownerId: string) {
  const callerId = interaction.member?.user?.id ?? interaction.user?.id;
  if (callerId !== ownerId) {
    return simpleEmbed("Not allowed", "Only the Game Master can start a global booster.", { color: COLOR_WARN });
  }
  const multiplier = Number(optVal(options, "multiplier") ?? 1);
  const minutes = Number(optVal(options, "minutes") ?? 60);
  const label = optVal(options, "label") ?? "Event Booster";
  const guildId = interaction.guild_id;
  const expiresAt = Date.now() + minutes * 60000;

  await db
    .prepare("INSERT INTO global_boosters (guild_id, multiplier, expires_at, label, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(guildId, multiplier, expiresAt, label, callerId, Date.now())
    .run();

  return reply({
    embeds: [
      {
        title: "Global Booster Started",
        description: `**${label}**: everyone's income is boosted **x${multiplier}** for **${minutes} minutes**!`,
        color: COLOR,
        thumbnail: { url: icon("booster_global") },
      },
    ],
  });
}

async function handleGmBoost(interaction: any, db: any, options: any[], ownerId: string) {
  const callerId = interaction.member?.user?.id ?? interaction.user?.id;
  if (callerId !== ownerId) {
    return simpleEmbed("Not allowed", "Only the Game Master can gift a booster.", { color: COLOR_WARN });
  }
  const targetId = optVal(options, "user");
  const multiplier = Number(optVal(options, "multiplier") ?? 2);
  const minutes = Number(optVal(options, "minutes") ?? 60);
  const guildId = interaction.guild_id;
  const expiresAt = Date.now() + minutes * 60000;

  await db
    .prepare("INSERT INTO player_boosters (guild_id, user_id, booster_type, multiplier, expires_at, source) VALUES (?, ?, 'income', ?, ?, 'gm')")
    .bind(guildId, targetId, multiplier, expiresAt)
    .run();

  return reply({
    embeds: [
      {
        title: "Gifted by the Game Master",
        description: `<@${targetId}> received a **x${multiplier}** income booster for **${minutes} minutes**!`,
        color: COLOR,
        thumbnail: { url: icon("booster_gm") },
      },
    ],
  });
}

// ------------------------------------------------------ MINE BUTTON CLICK ---
// Call this from index.ts when interaction.type === MESSAGE_COMPONENT and
// custom_id starts with "mine_". Parses the state encoded in the custom_id
// (see buildMineButtons above), so no DB session lookup is needed.
export async function handleMineButtonClick(interaction: any, env: { DB: any }) {
  const db = env.DB;
  const customId: string = interaction.data?.custom_id ?? "";
  const match = customId.match(/^mine_(\d)_(\d+)_(\d+)_(\d+)_(-?\d+)_(-?\d+)_(-?\d+)_([a-z]+)$/);
  if (!match) {
    return { type: 7, data: { content: "This mine round expired or is invalid.", embeds: [], components: [] } };
  }
  const [, clickedIndexStr, guildId, userId, critIndexStr, cashStr, xpStr, materialStr, oreKey] = match;
  const clickerId = interaction.member?.user?.id ?? interaction.user?.id;

  if (clickerId !== userId) {
    // Discord requires SOME response; keep the original message untouched
    // for the actual owner by not editing it — send a private nudge instead.
    return {
      type: 4,
      data: { content: "This isn't your mine round — use `/mine` to start your own.", flags: 64 },
    };
  }

  let player = await getOrCreatePlayer(db, guildId, userId);
  player = await accruePassiveIncome(db, player);

  const preview: MinePreview = {
    critIndex: Number(critIndexStr),
    cash: Number(cashStr),
    xp: Number(xpStr),
    material: Number(materialStr),
    oreKey,
    oreLabel: oreKey,
  };
  const clickedIndex = Number(clickedIndexStr);
  const result = applyMineClick(player, preview, clickedIndex);
  await savePlayer(db, player);

  const oreDef = ORES.find((o) => o.key === oreKey);
  const oreLabel = oreDef?.label ?? oreKey;

  return {
    type: 7, // UPDATE_MESSAGE — edits the original mine-round message in place
    data: {
      embeds: [
        {
          title: `${oreLabel} Mine Rewards`,
          color: result.crit ? 0xf1c40f : COLOR,
          fields: [
            { name: "Coins", value: `+${result.cash}`, inline: true },
            { name: oreLabel, value: `+${result.material}`, inline: true },
            { name: "XP", value: `+${result.xp}`, inline: true },
          ],
          description: result.crit ? "**Critical Hit! (2x Rewards)**" : undefined,
          thumbnail: { url: icon(`ore_${oreKey}`) },
        },
      ],
      components: [], // buttons removed after one use, matching the real bot
    },
  };
}
