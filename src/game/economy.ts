import {
  UPGRADE_TYPES,
  UPGRADE_COST_GROWTH,
  BASE_UPGRADE_SLOTS,
  UPGRADE_SLOTS_PER_PRESTIGE,
  PETS,
  ORES,
  MAX_OFFLINE_MINUTES,
  MINE_BASE_CASH,
  MINE_BASE_XP,
  MINE_BASE_MATERIAL,
  MINE_CRIT_MULTIPLIER,
  XP_PER_LEVEL,
  corpBuffForBank,
  CRATE_TYPES,
  CRATE_REWARD_POOLS,
  rollBooster,
  CLAIM_CRATE_ODDS,
  weightedPick,
  fmt,
} from "./data";

export interface Player {
  guild_id: string;
  user_id: string;
  coins: number;
  gems: number;
  shards: number;
  pet_shards: number;
  prestige_tokens: number;
  materials: number;
  xp: number;
  level: number;
  prestige: number; // renamed conceptually from "rebirths" — matches real bot term
  last_collected_at: number; // passive income accrual checkpoint
  last_mine_click_at: number; // /mine minigame cooldown
  last_daily_at: number;
  last_weekly_at: number;
  last_monthly_at: number;
  last_hunt_at: number;
  created_at: number;
}

// D1 binding is `any` in this repo (no @cloudflare/workers-types).
export async function getOrCreatePlayer(
  db: any,
  guildId: string,
  userId: string
): Promise<Player> {
  const existing = (await db
    .prepare("SELECT * FROM players WHERE guild_id = ? AND user_id = ?")
    .bind(guildId, userId)
    .first()) as any;
  if (existing) {
    return {
      ...existing,
      prestige: existing.prestige ?? existing.rebirths ?? 0,
    } as Player;
  }

  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO players (guild_id, user_id, last_collected_at, last_mine_click_at, created_at)
       VALUES (?, ?, ?, 0, ?)`
    )
    .bind(guildId, userId, now, now)
    .run();

  return {
    guild_id: guildId,
    user_id: userId,
    coins: 0,
    gems: 0,
    shards: 0,
    pet_shards: 0,
    prestige_tokens: 0,
    materials: 0,
    xp: 0,
    level: 1,
    prestige: 0,
    last_collected_at: now,
    last_mine_click_at: 0,
    last_daily_at: 0,
    last_weekly_at: 0,
    last_monthly_at: 0,
    last_hunt_at: 0,
    created_at: now,
  };
}

export async function savePlayer(db: any, p: Player) {
  await db
    .prepare(
      `UPDATE players SET coins=?, gems=?, shards=?, pet_shards=?, prestige_tokens=?,
       materials=?, xp=?, level=?, rebirths=?, last_collected_at=?, last_mine_click_at=?,
       last_daily_at=?, last_weekly_at=?, last_monthly_at=?, last_hunt_at=?
       WHERE guild_id=? AND user_id=?`
    )
    .bind(
      p.coins, p.gems, p.shards, p.pet_shards, p.prestige_tokens,
      p.materials, p.xp, p.level, p.prestige, p.last_collected_at, p.last_mine_click_at,
      p.last_daily_at, p.last_weekly_at, p.last_monthly_at, p.last_hunt_at,
      p.guild_id, p.user_id
    )
    .run();
}

// ------------------------------------------------------------ UPGRADES ---
export async function getUpgradeCounts(db: any, guildId: string, userId: string) {
  const rows = (await db
    .prepare("SELECT upgrade_key, count FROM player_upgrades WHERE guild_id=? AND user_id=?")
    .bind(guildId, userId)
    .all()) as { results: { upgrade_key: string; count: number }[] };
  const map: Record<string, number> = { size: 0, miner: 0, workers: 0 };
  for (const row of rows.results ?? []) map[row.upgrade_key] = row.count;
  return map;
}

export function maxUpgradeSlots(p: Player): number {
  return BASE_UPGRADE_SLOTS + p.prestige * UPGRADE_SLOTS_PER_PRESTIGE;
}

export function nextUpgradeCost(baseCost: number, owned: number): number {
  return Math.floor(baseCost * Math.pow(UPGRADE_COST_GROWTH, owned));
}

export async function buyUpgrade(
  db: any,
  p: Player,
  upgradeKey: string
): Promise<{ ok: boolean; reason?: string; cost?: number }> {
  const def = UPGRADE_TYPES.find((u) => u.key === upgradeKey);
  if (!def) return { ok: false, reason: "Unknown upgrade type." };

  const counts = await getUpgradeCounts(db, p.guild_id, p.user_id);
  const totalOwned = counts.size + counts.miner + counts.workers;
  if (totalOwned >= maxUpgradeSlots(p)) {
    return { ok: false, reason: `You're at your max upgrade slots (${maxUpgradeSlots(p)}). Prestige to raise the cap.` };
  }

  const cost = nextUpgradeCost(def.baseCost, counts[upgradeKey] ?? 0);
  if (p.coins < cost) return { ok: false, reason: `You need $${cost}, you have $${p.coins}.`, cost };

  p.coins -= cost;
  await db
    .prepare(
      `INSERT INTO player_upgrades (guild_id, user_id, upgrade_key, count) VALUES (?, ?, ?, 1)
       ON CONFLICT (guild_id, user_id, upgrade_key) DO UPDATE SET count = count + 1`
    )
    .bind(p.guild_id, p.user_id, upgradeKey)
    .run();

  return { ok: true, cost };
}

// Buys up to `qty` units of one upgrade type in a single batch, stopping
// early if coins run out or the max upgrade slot cap is hit. Used by the
// /upgrade button + quantity modal flow (buyUpgrade above still exists for
// any single-purchase caller).
export async function buyUpgradeQty(
  db: any,
  p: Player,
  upgradeKey: string,
  qty: number
): Promise<{ purchased: number; totalCost: number; reason?: string; def?: UpgradeTypeLike }> {
  const def = UPGRADE_TYPES.find((u) => u.key === upgradeKey);
  if (!def) return { purchased: 0, totalCost: 0, reason: "Unknown upgrade type." };

  const counts = await getUpgradeCounts(db, p.guild_id, p.user_id);
  let totalOwned = counts.size + counts.miner + counts.workers;
  const maxSlots = maxUpgradeSlots(p);

  let purchased = 0;
  let totalCost = 0;
  let stoppedReason: string | undefined;

  for (let i = 0; i < qty; i++) {
    if (totalOwned >= maxSlots) {
      stoppedReason = `Hit your max upgrade slots (${fmt(maxSlots)}).`;
      break;
    }
    const cost = nextUpgradeCost(def.baseCost, counts[upgradeKey] ?? 0);
    if (p.coins < cost) {
      stoppedReason = `Ran out of coins (next one costs ${fmt(cost)}).`;
      break;
    }
    p.coins -= cost;
    counts[upgradeKey] = (counts[upgradeKey] ?? 0) + 1;
    totalOwned += 1;
    totalCost += cost;
    purchased += 1;
  }

  if (purchased > 0) {
    await db
      .prepare(
        `INSERT INTO player_upgrades (guild_id, user_id, upgrade_key, count) VALUES (?, ?, ?, ?)
         ON CONFLICT (guild_id, user_id, upgrade_key) DO UPDATE SET count = count + ?`
      )
      .bind(p.guild_id, p.user_id, upgradeKey, purchased, purchased)
      .run();
  } else if (!stoppedReason) {
    stoppedReason = "Couldn't afford even one.";
  }

  return { purchased, totalCost, reason: purchased < qty ? stoppedReason : undefined, def };
}

type UpgradeTypeLike = { key: string; label: string; baseCost: number; profitPerMin: number; icon: string };

// ------------------------------------------------------- PASSIVE INCOME ---
export async function getOwnedPets(db: any, guildId: string, userId: string) {
  const rows = (await db
    .prepare("SELECT pet_key, level FROM player_pets WHERE guild_id=? AND user_id=?")
    .bind(guildId, userId)
    .all()) as { results: { pet_key: string; level: number }[] };
  return rows.results ?? [];
}

export function petBonusPercent(
  owned: { pet_key: string; level: number }[],
  perk: "income" | "capacity" | "luck"
): number {
  let total = 0;
  for (const o of owned) {
    const def = PETS.find((p) => p.key === o.pet_key);
    if (!def || def.perk !== perk) continue;
    total += def.baseValue + def.perLevel * (o.level - 1);
  }
  return total;
}

export async function activeBoosterMultiplier(
  db: any,
  guildId: string,
  userId: string,
  type: string
): Promise<number> {
  const now = Date.now();
  const [personal, global] = await Promise.all([
    db
      .prepare(
        `SELECT multiplier FROM player_boosters
         WHERE guild_id=? AND user_id=? AND booster_type=? AND expires_at > ?`
      )
      .bind(guildId, userId, type, now)
      .all() as Promise<{ results: { multiplier: number }[] }>,
    db
      .prepare(`SELECT multiplier FROM global_boosters WHERE guild_id=? AND expires_at > ?`)
      .bind(guildId, now)
      .all() as Promise<{ results: { multiplier: number }[] }>,
  ]);

  let mult = 1;
  for (const row of personal.results ?? []) mult *= row.multiplier;
  for (const row of global.results ?? []) mult *= row.multiplier;
  return mult;
}

// ------------------------------------------------------- CORPORATIONS ---
export interface CorpRow {
  id: number;
  guild_id: string;
  name: string;
  leader_id: string;
  bank_coins: number;
  bank_gems: number;
  bank_materials: number;
  created_at: number;
  role: string;
}

export async function getPlayerCorp(db: any, guildId: string, userId: string): Promise<CorpRow | null> {
  return (await db
    .prepare(
      `SELECT c.*, cm.role as role FROM corp_members cm
       JOIN corporations c ON c.id = cm.corp_id
       WHERE cm.guild_id = ? AND cm.user_id = ?`
    )
    .bind(guildId, userId)
    .first()) as CorpRow | null;
}

export function levelFromXp(xp: number): number {
  return 1 + Math.floor(xp / XP_PER_LEVEL);
}

export function baseIncomePerMinute(counts: Record<string, number>): number {
  return UPGRADE_TYPES.reduce((sum, u) => sum + u.profitPerMin * (counts[u.key] ?? 0), 0);
}

// Full effective $/min including pet income bonus, active boosters, and
// permanent prestige bonus (ASSUMPTION: +10% per prestige level — not
// confirmed from a screenshot, matches the pattern real bots typically use).
export async function effectiveIncomePerMinute(db: any, p: Player): Promise<number> {
  // These four reads are independent of each other — fire them concurrently
  // instead of one-at-a-time so this stays well under Discord's 3s reply
  // window (this function gets called at least once per game command).
  const [counts, owned, boosterMult, corp] = await Promise.all([
    getUpgradeCounts(db, p.guild_id, p.user_id),
    getOwnedPets(db, p.guild_id, p.user_id),
    activeBoosterMultiplier(db, p.guild_id, p.user_id, "income"),
    getPlayerCorp(db, p.guild_id, p.user_id),
  ]);
  const petMult = 1 + petBonusPercent(owned, "income") / 100;
  const prestigeMult = 1 + p.prestige * 0.1;
  const corpMult = corp ? corpBuffForBank(corp.bank_coins).mult : 1;
  return baseIncomePerMinute(counts) * petMult * boosterMult * prestigeMult * corpMult;
}

export async function accruePassiveIncome(db: any, p: Player): Promise<Player> {
  const now = Date.now();
  const elapsedMin = Math.min(MAX_OFFLINE_MINUTES, (now - p.last_collected_at) / 60000);
  if (elapsedMin <= 0) return p;

  const rate = await effectiveIncomePerMinute(db, p);
  p.coins += Math.floor(rate * elapsedMin);
  p.last_collected_at = now;
  return p;
}

// --------------------------------------------------------------- PRESTIGE ---
// UNCONFIRMED: the real bot's actual minimum requirement to prestige isn't
// shown in the screenshots we have (the profile shown had prestige=1 while
// only owning 1 of each upgrade — nowhere near maxed), so this placeholder
// requires only a minimum balance rather than maxed gear. Needs a real
// example of /prestige unlock to nail down the actual formula.
export const PRESTIGE_MIN_BALANCE = 10000; // ASSUMPTION

export function canPrestige(p: Player): boolean {
  return p.coins >= PRESTIGE_MIN_BALANCE;
}

// ASSUMPTION: gems/tokens earned scale with lifetime balance at prestige
// time — real formula unconfirmed.
export async function applyPrestige(db: any, p: Player): Promise<number> {
  const gemsEarned = Math.max(1, Math.floor(Math.log10(p.coins + 10) * 3));
  p.gems += gemsEarned;
  p.prestige += 1;
  p.coins = 0;
  p.materials = 0;
  p.xp = 0;
  p.level = 1;
  await db.prepare("DELETE FROM player_upgrades WHERE guild_id=? AND user_id=?").bind(p.guild_id, p.user_id).run();

  // Milestone unlocks, per the real bot's Prestige Info screen:
  // P2 Tokens, P3 Investments, P5 Robbing, P10 Stocks, P15 Leaderboard Quick View
  if (p.prestige === 2) p.prestige_tokens += 1;

  return gemsEarned;
}

// ------------------------------------------------------- MINE MINIGAME ---
export interface MinePreview {
  critIndex: number;
  cash: number;
  xp: number;
  material: number;
  oreKey: string;
  oreLabel: string;
}

export function rollMinePreview(p: Player): MinePreview {
  const levelMult = 1 + (p.level - 1) * 0.08;
  const unlockedOres = ORES.filter((o) => o.minLevel <= p.level);
  const ore = unlockedOres[Math.floor(Math.random() * unlockedOres.length)] ?? ORES[0];

  return {
    critIndex: Math.floor(Math.random() * 3),
    cash: Math.floor(MINE_BASE_CASH * levelMult),
    xp: Math.floor(MINE_BASE_XP * levelMult),
    material: Math.floor(MINE_BASE_MATERIAL * levelMult),
    oreKey: ore.key,
    oreLabel: ore.label,
  };
}

export function applyMineClick(
  p: Player,
  preview: MinePreview,
  clickedIndex: number
): { cash: number; xp: number; material: number; crit: boolean; form: number } {
  const crit = clickedIndex === preview.critIndex;
  const mult = crit ? MINE_CRIT_MULTIPLIER : 1;
  const cash = preview.cash * mult;
  const xp = preview.xp * mult;
  const material = preview.material * mult;
  // Crit always yields the highest-quality form (5, the refined block);
  // a normal hit yields a random raw-to-near-refined form (1-4).
  const form = crit ? 5 : 1 + Math.floor(Math.random() * 4);

  p.coins += cash;
  p.xp += xp;
  p.materials += material;
  p.level = levelFromXp(p.xp);
  p.last_mine_click_at = Date.now();

  return { cash, xp, material, crit, form };
}

// -------------------------------------------------------- CRATE INVENTORY ---
export interface CrateInventoryRow {
  crate_type: string;
  quantity: number;
}

export async function getCrateInventory(db: any, guildId: string, userId: string): Promise<CrateInventoryRow[]> {
  const rows = (await db
    .prepare("SELECT crate_type, quantity FROM player_crates WHERE guild_id=? AND user_id=? AND quantity > 0")
    .bind(guildId, userId)
    .all()) as { results: CrateInventoryRow[] };
  return rows.results ?? [];
}

export async function addCrateToInventory(db: any, guildId: string, userId: string, crateKey: string, qty = 1) {
  await db
    .prepare(
      `INSERT INTO player_crates (guild_id, user_id, crate_type, quantity) VALUES (?, ?, ?, ?)
       ON CONFLICT (guild_id, user_id, crate_type) DO UPDATE SET quantity = quantity + ?`
    )
    .bind(guildId, userId, crateKey, qty, qty)
    .run();
}

// Rolls a random crate rarity for a /daily /weekly /monthly claim (odds in
// CLAIM_CRATE_ODDS) and adds it to inventory. Returns the crate def so the
// caller can show its label/icon in the claim embed.
export async function awardRandomCrate(
  db: any,
  guildId: string,
  userId: string,
  kind: "daily" | "weekly" | "monthly"
) {
  const picked = weightedPick(CLAIM_CRATE_ODDS[kind]);
  await addCrateToInventory(db, guildId, userId, picked.key, 1);
  return CRATE_TYPES.find((c) => c.key === picked.key)!;
}

export interface CrateOpenResult {
  ok: boolean;
  reason?: string;
  rewardType?: "coins" | "gems" | "booster";
  amount?: number;
  multiplier?: number;
  durationMinutes?: number;
}

// Opens ONE crate of crateKey: decrements inventory by 1, rolls a reward
// from CRATE_REWARD_POOLS (credits coins/gems directly, or rolls a fresh
// multiplier/duration via rollBooster and adds it to booster inventory —
// never auto-activates it), and always persists the player row (covers any
// passive income the caller already accrued, even on a failure path).
// Returns ok:false on a stale/double-clicked button rather than throwing,
// matching this repo's existing error-handling style.
export async function openCrateForPlayer(db: any, p: Player, crateKey: string): Promise<CrateOpenResult> {
  const row = (await db
    .prepare("SELECT quantity FROM player_crates WHERE guild_id=? AND user_id=? AND crate_type=?")
    .bind(p.guild_id, p.user_id, crateKey)
    .first()) as { quantity: number } | null;
  if (!row || row.quantity < 1) {
    await savePlayer(db, p);
    return { ok: false, reason: "You don't have one of those anymore." };
  }

  const pool = CRATE_REWARD_POOLS[crateKey];
  if (!pool) {
    await savePlayer(db, p);
    return { ok: false, reason: "Unknown crate type." };
  }

  await db
    .prepare("UPDATE player_crates SET quantity = quantity - 1 WHERE guild_id=? AND user_id=? AND crate_type=?")
    .bind(p.guild_id, p.user_id, crateKey)
    .run();

  const reward = weightedPick(pool);
  let result: CrateOpenResult;

  if (reward.type === "coins") {
    const amount = Math.floor((reward.min ?? 0) + Math.random() * ((reward.max ?? 0) - (reward.min ?? 0)));
    p.coins += amount;
    result = { ok: true, rewardType: "coins", amount };
  } else if (reward.type === "gems") {
    const amount = Math.floor((reward.min ?? 0) + Math.random() * ((reward.max ?? 0) - (reward.min ?? 0)));
    p.gems += amount;
    result = { ok: true, rewardType: "gems", amount };
  } else {
    const rolled = rollBooster(crateKey);
    await addBoosterItemToInventory(db, p.guild_id, p.user_id, rolled.multiplier, rolled.durationMinutes, 1);
    result = { ok: true, rewardType: "booster", multiplier: rolled.multiplier, durationMinutes: rolled.durationMinutes };
  }

  await savePlayer(db, p);
  return result;
}

// ----------------------------------------------------- BOOSTER INVENTORY ---
// Unactivated boosters pulled from crates. Separate from player_boosters,
// which only ever holds ACTIVE, ticking boosters (real expires_at). Each row
// here is one distinct (multiplier, duration) combo — there's no tier name,
// the numbers ARE the identity.
export interface BoosterInventoryRow {
  multiplier: number;
  duration_minutes: number;
  quantity: number;
}

export async function getBoosterInventory(db: any, guildId: string, userId: string): Promise<BoosterInventoryRow[]> {
  const rows = (await db
    .prepare(
      `SELECT multiplier, duration_minutes, quantity FROM player_booster_items
       WHERE guild_id=? AND user_id=? AND quantity > 0 ORDER BY multiplier DESC, duration_minutes DESC`
    )
    .bind(guildId, userId)
    .all()) as { results: BoosterInventoryRow[] };
  return rows.results ?? [];
}

export async function addBoosterItemToInventory(
  db: any,
  guildId: string,
  userId: string,
  multiplier: number,
  durationMinutes: number,
  qty = 1
) {
  await db
    .prepare(
      `INSERT INTO player_booster_items (guild_id, user_id, multiplier, duration_minutes, quantity) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (guild_id, user_id, multiplier, duration_minutes) DO UPDATE SET quantity = quantity + ?`
    )
    .bind(guildId, userId, multiplier, durationMinutes, qty, qty)
    .run();
}

export interface ActivateBoosterResult {
  ok: boolean;
  reason?: string;
  multiplier?: number;
  durationMinutes?: number;
}

// Moves ONE booster item from inventory into an ACTIVE player_boosters row
// (booster_type 'income'). Stacks with anything already active — same as
// GM-gifted boosters already do, since activeBoosterMultiplier() multiplies
// every non-expired row together.
export async function activateBoosterItem(
  db: any,
  guildId: string,
  userId: string,
  multiplier: number,
  durationMinutes: number
): Promise<ActivateBoosterResult> {
  const row = (await db
    .prepare("SELECT quantity FROM player_booster_items WHERE guild_id=? AND user_id=? AND multiplier=? AND duration_minutes=?")
    .bind(guildId, userId, multiplier, durationMinutes)
    .first()) as { quantity: number } | null;
  if (!row || row.quantity < 1) return { ok: false, reason: "You don't have one of those anymore." };

  await db
    .prepare(
      "UPDATE player_booster_items SET quantity = quantity - 1 WHERE guild_id=? AND user_id=? AND multiplier=? AND duration_minutes=?"
    )
    .bind(guildId, userId, multiplier, durationMinutes)
    .run();

  const expiresAt = Date.now() + durationMinutes * 60000;
  await db
    .prepare(
      "INSERT INTO player_boosters (guild_id, user_id, booster_type, multiplier, expires_at, source) VALUES (?, ?, 'income', ?, ?, 'crate')"
    )
    .bind(guildId, userId, multiplier, expiresAt)
    .run();

  return { ok: true, multiplier, durationMinutes };
}

// -------------------------------------------------------- ACTIVE BOOSTERS ---
export interface ActiveBoosterRow {
  multiplier: number;
  expires_at: number;
  scope: "personal" | "global";
  label?: string;
}

// Everything currently boosting this player's income: their own personal
// boosters (from GM gifts or activated crate items) plus any server-wide
// global booster running in this guild.
export async function getActiveBoosters(db: any, guildId: string, userId: string): Promise<ActiveBoosterRow[]> {
  const now = Date.now();
  const personal = (await db
    .prepare(
      `SELECT multiplier, expires_at FROM player_boosters
       WHERE guild_id=? AND user_id=? AND booster_type='income' AND expires_at > ? ORDER BY expires_at ASC`
    )
    .bind(guildId, userId, now)
    .all()) as { results: { multiplier: number; expires_at: number }[] };
  const global = (await db
    .prepare(`SELECT multiplier, expires_at, label FROM global_boosters WHERE guild_id=? AND expires_at > ? ORDER BY expires_at ASC`)
    .bind(guildId, now)
    .all()) as { results: { multiplier: number; expires_at: number; label: string }[] };

  return [
    ...(personal.results ?? []).map((r) => ({ ...r, scope: "personal" as const })),
    ...(global.results ?? []).map((r) => ({ ...r, scope: "global" as const, label: r.label })),
  ];
}
