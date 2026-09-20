// Handler for the /mine command tree. Call handleMineCommand(interaction, env)
// from your existing interaction router when interaction.data.name === "mine".
//
// NOTE: adjust `env.DB` below if your D1 binding has a different name
// (check wrangler.toml [[d1_databases]] "binding" value).
// Owner check reuses env.OWNER_USER_ID — same source of truth as the rest
// of the bot's owner-only commands (setname/setavatar/nuke/rules).

import {
  PICKAXE_TIERS,
  BACKPACK_TIERS,
  PETS,
  HUNT_PET_CHANCE,
  HUNT_SHARD_REWARD,
  SHARDS_PER_PET_LEVEL,
  COOLDOWNS_MS,
  CRATE_TYPES,
  icon,
} from "../game/data";
import {
  getOrCreatePlayer,
  savePlayer,
  accrueIdleBlocks,
  sellBackpack,
  getOwnedPets,
  nextPickaxeUpgrade,
  nextBackpackUpgrade,
  canRebirth,
  applyRebirth,
  backpackCapacity,
  pickaxeBlocksPerMinute,
  Player,
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
function resolveSub(interaction: any) {
  const opts = interaction.data.options ?? [];
  if (opts.length === 0) return { name: "", options: [] };
  const first = opts[0];
  if (first.type === 2) {
    // SUB_COMMAND_GROUP -> next level is the actual subcommand
    const inner = first.options?.[0];
    return { group: first.name, name: inner?.name ?? "", options: inner?.options ?? [] };
  }
  return { group: undefined, name: first.name, options: first.options ?? [] };
}

function optVal(options: any[], name: string) {
  return options.find((o) => o.name === name)?.value;
}

export async function handleMineCommand(interaction: any, env: { DB: any; OWNER_USER_ID: string }) {
  const db = env.DB;
  const guildId = interaction.guild_id;
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  const sub = resolveSub(interaction);

  let player = await getOrCreatePlayer(db, guildId, userId);
  player = await accrueIdleBlocks(db, player);

  switch (sub.group ?? sub.name) {
    case "check":
      return handleCheck(player, db);
    case "sell":
      return handleSell(player, db);
    case "profile":
      return handleProfile(player, db);
    case "rebirth":
      return handleRebirth(player, db);
    case "coinflip":
      return handleCoinflip(player, db, sub.options);
    case "slots":
      return handleSlots(player, db, sub.options);
    case "daily":
      return handleClaim(player, db, "daily");
    case "weekly":
      return handleClaim(player, db, "weekly");
    case "monthly":
      return handleClaim(player, db, "monthly");
    case "upgrade":
      return handleUpgrade(player, db, sub.name, sub.options);
    case "pet":
      return handlePet(player, db, sub.name, sub.options);
    case "globalboost":
      return handleGlobalBoost(interaction, db, sub.options, env.OWNER_USER_ID);
    case "gmboost":
      return handleGmBoost(interaction, db, sub.options, env.OWNER_USER_ID);
    default:
      await savePlayer(db, player);
      return simpleEmbed("Unknown subcommand", "That /mine subcommand isn't wired up yet.", { color: COLOR_WARN });
  }
}

// ------------------------------------------------------------ CORE LOOP ---
async function handleCheck(p: Player, db: any) {
  await savePlayer(db, p);
  const capacity = backpackCapacity(p.backpack_tier);
  const rate = pickaxeBlocksPerMinute(p.pickaxe_tier);
  const pct = Math.min(100, Math.floor((p.backpack_blocks / capacity) * 100));
  return simpleEmbed(
    "Mining Report",
    `You've mined **${p.backpack_blocks}/${capacity}** blocks (${pct}% full).\n` +
      `Mining rate: **${rate} blocks/min**.\n` +
      (pct >= 100 ? "\nBackpack full — sell soon or you'll stop gaining blocks!" : "\nUse `/mine sell` to convert blocks into coins."),
    { thumbnail: icon(`backpack_${BACKPACK_TIERS[p.backpack_tier].key}`) }
  );
}

async function handleSell(p: Player, db: any) {
  const { coinsEarned, blocksSold } = await sellBackpack(db, p);
  await savePlayer(db, p);
  if (blocksSold === 0) {
    return simpleEmbed("Nothing to sell", "Your backpack is empty — check back later or use `/mine check`.", {
      color: COLOR_WARN,
    });
  }
  return simpleEmbed(
    "Sold!",
    `Sold **${blocksSold}** blocks for **${coinsEarned}** coins.\nBalance: **${p.coins}** coins.`,
    { thumbnail: icon("coin") }
  );
}

async function handleProfile(p: Player, db: any) {
  await savePlayer(db, p);
  const pets = await getOwnedPets(db, p.guild_id, p.user_id);
  const petList = pets.length
    ? pets.map((o) => `${PETS.find((d) => d.key === o.pet_key)?.label ?? o.pet_key} (Lv.${o.level})`).join(", ")
    : "None yet — try `/mine pet hunt`";

  return reply({
    embeds: [
      {
        title: "Miner Profile",
        color: COLOR,
        thumbnail: { url: icon(`pickaxe_${PICKAXE_TIERS[p.pickaxe_tier].key}`) },
        fields: [
          { name: "Level", value: `${p.level}`, inline: true },
          { name: "Coins", value: `${p.coins}`, inline: true },
          { name: "Gems", value: `${p.gems}`, inline: true },
          { name: "Shards", value: `${p.shards}`, inline: true },
          { name: "Rebirths", value: `${p.rebirths}`, inline: true },
          { name: "Prestiges", value: `${p.prestiges}`, inline: true },
          { name: "Pickaxe", value: PICKAXE_TIERS[p.pickaxe_tier].label, inline: true },
          { name: "Backpack", value: BACKPACK_TIERS[p.backpack_tier].label, inline: true },
          { name: "Pets", value: petList, inline: false },
        ],
      },
    ],
  });
}

// -------------------------------------------------------------- UPGRADE ---
async function handleUpgrade(p: Player, db: any, kind: string, options: any[]) {
  if (kind === "pickaxe") {
    const next = nextPickaxeUpgrade(p);
    if (!next) return simpleEmbed("Maxed out", "Your pickaxe is already Netherite tier — the best there is (until you rebirth).", { color: COLOR_WARN });
    if (p.coins < next.cost) return simpleEmbed("Not enough coins", `You need **${next.cost}** coins for the ${next.label}. You have **${p.coins}**.`, { color: COLOR_WARN });
    p.coins -= next.cost;
    p.pickaxe_tier += 1;
    await savePlayer(db, p);
    return simpleEmbed("Pickaxe upgraded!", `You now have the **${next.label}** (${next.value} blocks/min).`, { thumbnail: icon(`pickaxe_${next.key}`) });
  }
  if (kind === "backpack") {
    const next = nextBackpackUpgrade(p);
    if (!next) return simpleEmbed("Maxed out", "Your backpack is already Netherite tier — the best there is (until you rebirth).", { color: COLOR_WARN });
    if (p.coins < next.cost) return simpleEmbed("Not enough coins", `You need **${next.cost}** coins for the ${next.label}. You have **${p.coins}**.`, { color: COLOR_WARN });
    p.coins -= next.cost;
    p.backpack_tier += 1;
    await savePlayer(db, p);
    return simpleEmbed("Backpack upgraded!", `You now have the **${next.label}** (holds ${next.value} blocks).`, { thumbnail: icon(`backpack_${next.key}`) });
  }
  await savePlayer(db, p);
  return simpleEmbed("Unknown upgrade", "Use `/mine upgrade pickaxe` or `/mine upgrade backpack`.", { color: COLOR_WARN });
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
      return simpleEmbed("New pet!", `You found a **${chosen.label}**! Check \`/mine profile\` to see it.`, { thumbnail: chosen.icon });
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
    if (!def) { await savePlayer(db, p); return simpleEmbed("Unknown pet", "Check `/mine pet list` for valid pet names.", { color: COLOR_WARN }); }
    if (p.shards < SHARDS_PER_PET_LEVEL) {
      await savePlayer(db, p);
      return simpleEmbed("Not enough shards", `You need **${SHARDS_PER_PET_LEVEL} shards** to level up a pet. You have **${p.shards}**.`, { color: COLOR_WARN });
    }
    const owned = (await db
      .prepare("SELECT id, level FROM player_pets WHERE guild_id=? AND user_id=? AND pet_key=?")
      .bind(p.guild_id, p.user_id, petKey)
      .first()) as { id: number; level: number } | null;
    if (!owned) { await savePlayer(db, p); return simpleEmbed("You don't own this pet", "Hunt one first with `/mine pet hunt`.", { color: COLOR_WARN }); }

    p.shards -= SHARDS_PER_PET_LEVEL;
    await db.prepare("UPDATE player_pets SET level = level + 1 WHERE id = ?").bind(owned.id).run();
    await savePlayer(db, p);
    return simpleEmbed("Pet leveled up!", `Your **${def.label}** is now level **${owned.level + 1}**.`, { thumbnail: def.icon });
  }

  await savePlayer(db, p);
  return simpleEmbed("Unknown pet action", "Use `/mine pet hunt`, `/mine pet list`, or `/mine pet upgrade`.", { color: COLOR_WARN });
}

// ------------------------------------------------------------- REBIRTH ---
async function handleRebirth(p: Player, db: any) {
  if (!canRebirth(p)) {
    await savePlayer(db, p);
    return simpleEmbed(
      "Not ready to rebirth",
      "You need max-tier pickaxe & backpack (Netherite) and level 50+ before you can rebirth.",
      { color: COLOR_WARN }
    );
  }
  const gemsEarned = applyRebirth(p);
  await savePlayer(db, p);
  return simpleEmbed(
    "Rebirth complete!",
    `You reset your progress and earned **${gemsEarned} gems**.\nRebirths: **${p.rebirths}** | Permanent income bonus: **+${p.rebirths * 10}%**` +
      (p.prestiges > 0 ? `\nPrestige unlocked! Prestige tokens: **${p.prestige_tokens}**` : ""),
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
