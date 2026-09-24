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
  ORE_FORM_ICON,
  HUNT_PET_CHANCE,
  HUNT_SHARD_REWARD,
  HUNT_PET_SHARD_REWARD,
  SHARDS_PER_PET_LEVEL,
  COOLDOWNS_MS,
  MINE_COOLDOWN_MS,
  XP_PER_LEVEL,
  icon,
  fmt,
} from "../game/data";
import { emojiPrefix } from "../game/emoji";
import {
  getOrCreatePlayer,
  savePlayer,
  accruePassiveIncome,
  effectiveIncomePerMinute,
  getUpgradeCounts,
  maxUpgradeSlots,
  nextUpgradeCost,
  buyUpgradeQty,
  getOwnedPets,
  getPlayerCorp,
  canPrestige,
  applyPrestige,
  PRESTIGE_MIN_BALANCE,
  rollMinePreview,
  applyMineClick,
  levelFromXp,
  awardRandomCrate,
  Player,
  MinePreview,
} from "../game/economy";

const COLOR = 0x2ecc71;
const COLOR_WARN = 0xe74c3c;

// UPGRADE_TYPES keys ("size"/"miner"/"workers") don't match the icon
// filenames used for their emoji (they reuse factory_icon/miner_icon/
// pet_golem placeholders — see UPGRADE_TYPES in data.ts) — this maps each
// upgrade key to the actual uploaded emoji name.
const UPGRADE_EMOJI_KEY: Record<string, string> = {
  size: "factory_icon",
  miner: "miner_icon",
  workers: "pet_golem",
};

// Server nickname > global display name > username, matching what
// actually shows in Discord's UI for that member.
function displayName(interaction: any): string {
  return (
    interaction.member?.nick ??
    interaction.member?.user?.global_name ??
    interaction.member?.user?.username ??
    interaction.user?.global_name ??
    interaction.user?.username ??
    "Unknown"
  );
}

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
    if (ADJUST_ACTIONS.includes(action)) return handleAdminAdjust(interaction, db, action, options, env.OWNER_USER_ID);
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
      return handleProfile(player, db, displayName(interaction));
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
      return handleUpgrade(player, db);
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
// for nuke_confirm_<channelId>). Includes a timestamp so a round expires
// after MINE_ROUND_EXPIRY_MS of inactivity.
function buildMineButtons(guildId: string, userId: string, preview: MinePreview) {
  const ts = Date.now();
  const payload = `${guildId}_${userId}_${preview.critIndex}_${preview.cash}_${preview.xp}_${preview.material}_${preview.oreKey}_${ts}`;
  return [
    { type: 1, components: [0, 1, 2].map((i) => ({
      type: 2,
      style: i === preview.critIndex ? 3 : 1, // 3 = green/success (the crit button, visibly marked), 1 = blurple for the rest
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
      `You can mine again in **${secs}s**.\nMeanwhile, you're earning **${fmt(Math.floor(rate))}/min** passively — balance: **${fmt(p.coins)}**.`,
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
          thumbnail: { url: ORE_FORM_ICON(preview.oreKey, 1) },
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
    `You have **${fmt(p.materials)}** materials banked from mining — deposit them into your corporation's bank with \`/corp deposit asset:materials\`. ` +
      `Your coin balance grows automatically from your $/min income — check \`/profile\`.`,
    { thumbnail: icon("shard") }
  );
}

async function handleProfile(p: Player, db: any, name: string) {
  // savePlayer + the three reads below are all independent of each other at
  // this point (p isn't mutated further before this), so run them together
  // instead of one-at-a-time — this alone was the main cause of /profile's
  // "bot didn't respond" timeouts (too many serial D1 round trips).
  const [, pets, rate, corp] = await Promise.all([
    savePlayer(db, p),
    getOwnedPets(db, p.guild_id, p.user_id),
    effectiveIncomePerMinute(db, p),
    getPlayerCorp(db, p.guild_id, p.user_id),
  ]);
  const petList = pets.length
    ? pets.map((o) => `${emojiPrefix(`pet_${o.pet_key}`)}${PETS.find((d) => d.key === o.pet_key)?.label ?? o.pet_key} (Lv.${o.level})`).join(", ")
    : "None yet — try `/pethunt`";
  const factoryAgeDays = Math.floor((Date.now() - p.created_at) / 86400000);
  const corpValue = corp ? `${corp.name}${corp.role === "leader" ? " (Leader)" : ""}` : "None";

  // Field order matches the real bot's /profile exactly: Factory Name,
  // Location, Corporation, Balance, Income per minute, Prestige, Level, Factory Age.
  // Location is still a placeholder until dimensions/locations are built.
  return reply({
    embeds: [
      {
        title: "Miner Profile",
        color: COLOR,
        thumbnail: { url: icon("factory_icon") },
        fields: [
          { name: "Factory Name", value: `${name}'s Factory`, inline: true },
          { name: "Location", value: "Garage", inline: true },
          { name: "Corporation", value: corpValue, inline: true },
          { name: "Balance", value: fmt(p.coins), inline: true },
          { name: "Income (per minute)", value: fmt(Math.floor(rate)), inline: true },
          { name: "Prestige", value: `${p.prestige}`, inline: true },
          { name: "Level", value: `${p.level}`, inline: true },
          { name: "Factory Age", value: `${factoryAgeDays} Days`, inline: true },
          { name: "Gems", value: fmt(p.gems), inline: true },
          { name: "Shards", value: fmt(p.shards), inline: true },
          { name: "Pet Shards", value: fmt(p.pet_shards), inline: true },
          { name: "Materials", value: fmt(p.materials), inline: true },
          { name: "Pets", value: petList, inline: false },
        ],
      },
    ],
  });
}

// -------------------------------------------------------------- UPGRADE ---
// /upgrade is now button-driven: the slash command just opens the panel
// (one button per upgrade type, showing its next price); clicking a button
// opens a modal asking for a quantity, and the modal submission buys up to
// that many in one batch. This is a shared, public panel — whoever clicks
// a button upgrades their OWN account, not necessarily whoever ran /upgrade.
async function buildUpgradePanel(p: Player, db: any) {
  const counts = await getUpgradeCounts(db, p.guild_id, p.user_id);
  const totalOwned = counts.size + counts.miner + counts.workers;
  const slots = maxUpgradeSlots(p);

  return {
    embeds: [
      {
        title: "Upgrades",
        description:
          `**Max Slots:** ${fmt(slots)} — shared across Size/Miner/Workers (+10 per Prestige)\n` +
          `**Used:** ${fmt(totalOwned)}/${fmt(slots)}\n` +
          `Tap an upgrade to buy it — you'll be asked how many.`,
        color: COLOR,
        fields: UPGRADE_TYPES.map((u) => ({
          name: `${emojiPrefix(UPGRADE_EMOJI_KEY[u.key] ?? u.key)}${u.label}`,
          value: `Owned: **${fmt(counts[u.key] ?? 0)}** (shared cap: **${fmt(slots)}**) | +${fmt(u.profitPerMin)}/min each\nNext price: **${fmt(nextUpgradeCost(u.baseCost, counts[u.key] ?? 0))}**`,
          inline: true,
        })),
      },
    ],
    components: [
      {
        type: 1,
        components: UPGRADE_TYPES.map((u) => ({
          type: 2,
          style: 1,
          label: `${u.label} — ${fmt(nextUpgradeCost(u.baseCost, counts[u.key] ?? 0))}`,
          custom_id: `upg_pick_${u.key}`,
        })),
      },
    ],
  };
}

async function handleUpgrade(p: Player, db: any) {
  await savePlayer(db, p);
  const panel = await buildUpgradePanel(p, db);
  return reply(panel);
}

// Button click ("upg_pick_<type>") -> opens a modal asking for quantity.
// No DB access needed here — nothing is spent until the modal is submitted.
export async function handleUpgradeButtonClick(interaction: any) {
  const customId: string = interaction.data?.custom_id ?? "";
  const match = customId.match(/^upg_pick_(size|miner|workers)$/);
  if (!match) {
    return { type: 4, data: { content: "That upgrade button isn't valid anymore — run `/upgrade` again.", flags: 64 } };
  }
  const key = match[1];
  const def = UPGRADE_TYPES.find((u) => u.key === key);
  return {
    type: 9, // MODAL
    data: {
      custom_id: `upg_modal_${key}`,
      title: `Buy ${def?.label ?? key}`,
      components: [
        {
          type: 1,
          components: [
            {
              type: 4, // TEXT_INPUT
              custom_id: "qty",
              style: 1, // short
              label: "How many do you want to buy?",
              placeholder: "1",
              value: "1",
              required: true,
              max_length: 6,
            },
          ],
        },
      ],
    },
  };
}

// Modal submission -> actually spends coins, then re-renders the panel in
// place (UPDATE_MESSAGE is allowed here since the modal was opened from the
// message's own button).
export async function handleUpgradeModalSubmit(interaction: any, env: { DB: any }) {
  const db = env.DB;
  const customId: string = interaction.data?.custom_id ?? "";
  const match = customId.match(/^upg_modal_(size|miner|workers)$/);
  if (!match) {
    return { type: 4, data: { content: "Something went wrong reading that upgrade.", flags: 64 } };
  }
  const key = match[1];
  const guildId = interaction.guild_id;
  const userId = interaction.member?.user?.id ?? interaction.user?.id;

  const qtyRaw = interaction.data?.components?.[0]?.components?.[0]?.value ?? "1";
  let qty = parseInt(qtyRaw, 10);
  if (!Number.isFinite(qty) || qty < 1) qty = 1;
  qty = Math.min(qty, 1000); // sanity cap — batches larger than this rarely matter

  let player = await getOrCreatePlayer(db, guildId, userId);
  player = await accruePassiveIncome(db, player);
  const result = await buyUpgradeQty(db, player, key, qty);
  await savePlayer(db, player);

  const panel = await buildUpgradePanel(player, db);
  const summary =
    result.purchased > 0
      ? `Bought **${result.purchased}x ${result.def?.label ?? key}** for **${fmt(result.totalCost)}**.${result.reason ? ` (${result.reason})` : ""}`
      : `Couldn't buy any — ${result.reason ?? "something went wrong."}`;

  return {
    type: 7, // UPDATE_MESSAGE
    data: {
      content: summary,
      embeds: panel.embeds,
      components: panel.components,
    },
  };
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
        // duplicate -> convert to pet shards (spent via /petupgrade) instead of a second copy
        p.pet_shards += HUNT_PET_SHARD_REWARD;
        await savePlayer(db, p);
        return simpleEmbed("Duplicate pet!", `You found another **${emojiPrefix(`pet_${chosen.key}`)}${chosen.label}** — converted to **${fmt(HUNT_PET_SHARD_REWARD)} pet shards** instead.`, { thumbnail: icon("pet_shard") });
      }
      await db
        .prepare("INSERT INTO player_pets (guild_id, user_id, pet_key, level, obtained_at) VALUES (?, ?, ?, 1, ?)")
        .bind(p.guild_id, p.user_id, chosen.key, now)
        .run();
      await savePlayer(db, p);
      return simpleEmbed("New pet!", `You found a **${emojiPrefix(`pet_${chosen.key}`)}${chosen.label}**! Check \`/profile\` to see it.`, { thumbnail: chosen.icon });
    } else {
      p.shards += HUNT_SHARD_REWARD;
      await savePlayer(db, p);
      return simpleEmbed("No pet this time", `Found **${fmt(HUNT_SHARD_REWARD)} shards** instead. Try again later!`, { thumbnail: icon("shard") });
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
            name: `${emojiPrefix(`pet_${pet.key}`)}${pet.label}`,
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
    if (p.pet_shards < SHARDS_PER_PET_LEVEL) {
      await savePlayer(db, p);
      return simpleEmbed("Not enough pet shards", `You need **${fmt(SHARDS_PER_PET_LEVEL)} pet shards** to level up a pet. You have **${fmt(p.pet_shards)}**. Hunt duplicates with \`/pethunt\` to earn more.`, { color: COLOR_WARN, thumbnail: icon("pet_shard") });
    }
    const owned = (await db
      .prepare("SELECT id, level FROM player_pets WHERE guild_id=? AND user_id=? AND pet_key=?")
      .bind(p.guild_id, p.user_id, petKey)
      .first()) as { id: number; level: number } | null;
    if (!owned) { await savePlayer(db, p); return simpleEmbed("You don't own this pet", "Hunt one first with `/pethunt`.", { color: COLOR_WARN }); }

    p.pet_shards -= SHARDS_PER_PET_LEVEL;
    await db.prepare("UPDATE player_pets SET level = level + 1 WHERE id = ?").bind(owned.id).run();
    await savePlayer(db, p);
    return simpleEmbed("Pet leveled up!", `Your **${emojiPrefix(`pet_${def.key}`)}${def.label}** is now level **${owned.level + 1}**.`, { thumbnail: def.icon });
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
  const lines = rows.map((r, i) => `#${i + 1}: <@${r.user_id}> - ${fmt(r.coins)}`);

  const callerRank = (await db
    .prepare("SELECT COUNT(*) as rank FROM players WHERE guild_id=? AND coins > ?")
    .bind(p.guild_id, p.coins)
    .first()) as { rank: number } | null;
  const myRank = (callerRank?.rank ?? 0) + 1;
  if (!rows.find((r) => r.user_id === p.user_id)) {
    lines.push(`—`, `#${myRank}: You - ${fmt(p.coins)}`);
  }

  return simpleEmbed("Balance Leaderboard", lines.join("\n") || "No one has any coins yet.", { thumbnail: icon("coin") });
}

// ------------------------------------------------------------- PRESTIGE ---
async function handlePrestige(p: Player, db: any) {
  if (!canPrestige(p)) {
    await savePlayer(db, p);
    return simpleEmbed(
      "Not ready to prestige",
      `You need at least ${fmt(PRESTIGE_MIN_BALANCE)} balance before you can prestige. You have ${fmt(p.coins)}. ` +
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
    `You reset your progress and earned **${fmt(gemsEarned)} gems**.\nPrestige: **${p.prestige}** | Max upgrade slots: **${p.prestige * 10 + 410}**` +
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
    `Landed on **${result}**. ${won ? `+${fmt(amount)}` : `-${fmt(amount)}`} coins. Balance: **${fmt(p.coins)}**.`,
    { color: won ? COLOR : COLOR_WARN }
  );
}

async function handleSlots(p: Player, db: any, options: any[]) {
  const amount = Number(optVal(options, "amount") ?? 0);
  if (!amount || amount <= 0 || amount > p.coins) {
    await savePlayer(db, p);
    return simpleEmbed("Invalid bet", "Enter an amount you actually have.", { color: COLOR_WARN });
  }
  const symbols = ["GEM", "STAR", "BELL", "CLOVER"]; // plain text symbols — no dedicated icon art for these yet
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
    `[ ${spin.join(" | ")} ]\n${winnings >= 0 ? `+${fmt(winnings)}` : `-${fmt(-winnings)}`} coins. Balance: **${fmt(p.coins)}**.`,
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

  // On top of the flat coins/gems above, every claim also rolls one random
  // crate — rarity odds get better the longer the cooldown (see
  // CLAIM_CRATE_ODDS in ../game/data). Open it later with /crate.
  const crateDef = await awardRandomCrate(db, p.guild_id, p.user_id, kind);

  return reply({
    embeds: [
      {
        title: `${kind[0].toUpperCase()}${kind.slice(1)} reward claimed!`,
        description:
          `+${fmt(rewards[kind])} coins${gemReward[kind] ? ` and +${fmt(gemReward[kind])} gems` : ""}.\n` +
          `You also got a **${emojiPrefix(`crate_${crateDef.key}`)}${crateDef.label}**! Open it with \`/crate\`.`,
        color: COLOR,
        thumbnail: { url: crateDef.icon },
      },
    ],
  });
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
  // Leave the user option blank to gift the booster to yourself.
  const targetId = optVal(options, "user") ?? callerId;
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

// Increase or decrease a target's currency/XP directly. Positive `amount`
// gives, negative takes away. Leave the `user` option blank to target
// yourself (self-gift). Values are clamped at 0 — this can't push anyone
// negative.
const ADJUST_ACTIONS = ["adjustcoins", "adjustgems", "adjustshards", "adjustpetshards", "adjustxp", "setlevel", "resetcooldown"];
const ADJUST_FIELD: Record<string, "coins" | "gems" | "shards" | "pet_shards"> = {
  adjustcoins: "coins",
  adjustgems: "gems",
  adjustshards: "shards",
  adjustpetshards: "pet_shards",
};
const ADJUST_LABEL: Record<string, string> = {
  adjustcoins: "Coins",
  adjustgems: "Gems",
  adjustshards: "Shards",
  adjustpetshards: "Pet Shards",
};
const RESET_COOLDOWN_FIELDS: Record<string, string> = {
  daily: "last_daily_at",
  weekly: "last_weekly_at",
  monthly: "last_monthly_at",
  hunt: "last_hunt_at",
  mine: "last_mine_click_at",
};

async function handleAdminAdjust(interaction: any, db: any, action: string, options: any[], ownerId: string) {
  const callerId = interaction.member?.user?.id ?? interaction.user?.id;
  if (callerId !== ownerId) {
    return simpleEmbed("Not allowed", "Only the Game Master can adjust a player's stats.", { color: COLOR_WARN });
  }
  const guildId = interaction.guild_id;
  const targetId = optVal(options, "user") ?? callerId; // leave user blank to target yourself

  let player = await getOrCreatePlayer(db, guildId, targetId);
  player = await accruePassiveIncome(db, player);

  if (action === "resetcooldown") {
    const which = optVal(options, "which") ?? "all";
    const keys = which === "all" ? Object.keys(RESET_COOLDOWN_FIELDS) : [which];
    const reset: string[] = [];
    for (const key of keys) {
      const field = RESET_COOLDOWN_FIELDS[key];
      if (!field) continue;
      (player as any)[field] = 0;
      reset.push(key);
    }
    await savePlayer(db, player);
    const description = reset.length
      ? `<@${targetId}>'s **${reset.join(", ")}** cooldown${reset.length > 1 ? "s are" : " is"} reset — ready to claim/hunt/mine again right away.`
      : `Nothing to reset — pick a valid "which" option (daily/weekly/monthly/hunt/mine/all).`;
    return reply({
      embeds: [{ title: "Admin Adjustment", description, color: reset.length ? COLOR : COLOR_WARN, thumbnail: { url: icon("booster_gm") } }],
    });
  }

  const amount = Number(optVal(options, "amount") ?? 0);
  let description: string;
  const signed = amount >= 0 ? `+${fmt(amount)}` : `-${fmt(-amount)}`;

  if (action === "setlevel") {
    const targetLevel = Math.max(1, Math.floor(amount));
    player.xp = (targetLevel - 1) * XP_PER_LEVEL;
    player.level = levelFromXp(player.xp);
    description = `<@${targetId}>'s level set to **${player.level}**.`;
  } else if (action === "adjustxp") {
    player.xp = Math.max(0, player.xp + amount);
    player.level = levelFromXp(player.xp);
    description = `<@${targetId}>'s XP adjusted by **${signed}** — now **${fmt(player.xp)} XP** (Level **${player.level}**).`;
  } else {
    const field = ADJUST_FIELD[action];
    (player as any)[field] = Math.max(0, (player as any)[field] + amount);
    description = `<@${targetId}>'s **${ADJUST_LABEL[action]}** adjusted by **${signed}** — now **${fmt((player as any)[field])}**.`;
  }

  await savePlayer(db, player);
  return reply({
    embeds: [
      {
        title: "Admin Adjustment",
        description,
        color: COLOR,
        thumbnail: { url: icon("booster_gm") },
      },
    ],
  });
}

// ------------------------------------------------------ MINE BUTTON CLICK ---
// Call this from index.ts when interaction.type === MESSAGE_COMPONENT and
// custom_id starts with "mine_". Parses the state encoded in the custom_id
// (see buildMineButtons above), so no DB session lookup is needed. The
// panel stays clickable indefinitely — each click rolls a fresh round and
// reposts live buttons with a reset expiry — but goes stale and stops
// responding after MINE_ROUND_EXPIRY_MS since the last click.
const MINE_ROUND_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

export async function handleMineButtonClick(interaction: any, env: { DB: any }) {
  const db = env.DB;
  const customId: string = interaction.data?.custom_id ?? "";
  const match = customId.match(/^mine_(\d)_(\d+)_(\d+)_(\d+)_(-?\d+)_(-?\d+)_(-?\d+)_([a-z]+)_(\d+)$/);
  if (!match) {
    return { type: 7, data: { content: "This mine round expired or is invalid.", embeds: [], components: [] } };
  }
  const [, clickedIndexStr, guildId, userId, critIndexStr, cashStr, xpStr, materialStr, oreKey, tsStr] = match;
  const clickerId = interaction.member?.user?.id ?? interaction.user?.id;

  if (clickerId !== userId) {
    // Discord requires SOME response; keep the original message untouched
    // for the actual owner by not editing it — send a private nudge instead.
    return {
      type: 4,
      data: { content: "This isn't your mine round — use `/mine` to start your own.", flags: 64 },
    };
  }

  // Stale panel — 30+ min since the last click. Stop responding to it
  // (edit it into a dead state so the buttons visibly no longer work).
  if (Date.now() - Number(tsStr) > MINE_ROUND_EXPIRY_MS) {
    return {
      type: 7,
      data: {
        embeds: [{ title: "Mine round expired", description: "This panel timed out from inactivity — use `/mine` to start a new one.", color: COLOR_WARN }],
        components: [],
      },
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
  const formNames = ["", "Raw", "Chunk", "Cluster", "Refined", "Block"];
  const formNote = result.crit ? ` — ${formNames[result.form]} quality!` : ` (${formNames[result.form]})`;

  // Roll the NEXT round immediately so the panel stays live — reposting
  // fresh buttons (new random crit position, reset 30-min expiry) instead
  // of removing them, per "the mine button can be used over and over again."
  const nextPreview = rollMinePreview(player);

  return {
    type: 7, // UPDATE_MESSAGE — edits the original mine-round message in place
    data: {
      embeds: [
        {
          title: `${oreLabel} Mine Rewards`,
          color: result.crit ? 0xf1c40f : COLOR,
          fields: [
            { name: "Coins", value: `+${result.cash}`, inline: true },
            { name: oreLabel, value: `+${result.material}${formNote}`, inline: true },
            { name: "XP", value: `+${result.xp}`, inline: true },
          ],
          description: result.crit ? "**Critical Hit! (2x Rewards)**" : undefined,
          thumbnail: { url: ORE_FORM_ICON(oreKey, result.form) },
        },
      ],
      components: buildMineButtons(guildId, userId, nextPreview),
    },
  };
}
