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
} from "./data";

export interface Player {
  guild_id: string;
  user_id: string;
  coins: number;
  gems: number;
  shards: number;
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
      `UPDATE players SET coins=?, gems=?, shards=?, prestige_tokens=?,
       materials=?, xp=?, level=?, rebirths=?, last_collected_at=?, last_mine_click_at=?,
       last_daily_at=?, last_weekly_at=?, last_monthly_at=?, last_hunt_at=?
       WHERE guild_id=? AND user_id=?`
    )
    .bind(
      p.coins, p.gems, p.shards, p.prestige_tokens,
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
  const personal = (await db
    .prepare(
      `SELECT multiplier FROM player_boosters
       WHERE guild_id=? AND user_id=? AND booster_type=? AND expires_at > ?`
    )
    .bind(guildId, userId, type, now)
    .all()) as { results: { multiplier: number }[] };
  const global = (await db
    .prepare(`SELECT multiplier FROM global_boosters WHERE guild_id=? AND expires_at > ?`)
    .bind(guildId, now)
    .all()) as { results: { multiplier: number }[] };

  let mult = 1;
  for (const row of personal.results ?? []) mult *= row.multiplier;
  for (const row of global.results ?? []) mult *= row.multiplier;
  return mult;
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
  const counts = await getUpgradeCounts(db, p.guild_id, p.user_id);
  const owned = await getOwnedPets(db, p.guild_id, p.user_id);
  const petMult = 1 + petBonusPercent(owned, "income") / 100;
  const boosterMult = await activeBoosterMultiplier(db, p.guild_id, p.user_id, "income");
  const prestigeMult = 1 + p.prestige * 0.1;
  return baseIncomePerMinute(counts) * petMult * boosterMult * prestigeMult;
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
