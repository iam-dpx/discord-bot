import {
  PICKAXE_TIERS,
  BACKPACK_TIERS,
  ORE_VALUE_PER_BLOCK,
  PETS,
  REBIRTH_MIN_LEVEL,
  PRESTIGE_EVERY_REBIRTHS,
} from "./data";

export interface Player {
  guild_id: string;
  user_id: string;
  coins: number;
  gems: number;
  shards: number;
  prestige_tokens: number;
  pickaxe_tier: number;
  backpack_tier: number;
  backpack_blocks: number;
  total_blocks_mined: number;
  level: number;
  rebirths: number;
  prestiges: number;
  last_collected_at: number;
  last_daily_at: number;
  last_weekly_at: number;
  last_monthly_at: number;
  last_hunt_at: number;
  created_at: number;
}

// D1 binding name — adjust this import site if your wrangler.toml uses a
// different binding (check the [[d1_databases]] "binding" field).
export async function getOrCreatePlayer(
  db: any,
  guildId: string,
  userId: string
): Promise<Player> {
  const existing = (await db
    .prepare("SELECT * FROM players WHERE guild_id = ? AND user_id = ?")
    .bind(guildId, userId)
    .first()) as Player | null;
  if (existing) return existing;

  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO players (guild_id, user_id, last_collected_at, created_at)
       VALUES (?, ?, ?, ?)`
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
    pickaxe_tier: 0,
    backpack_tier: 0,
    backpack_blocks: 0,
    total_blocks_mined: 0,
    level: 1,
    rebirths: 0,
    prestiges: 0,
    last_collected_at: now,
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
       pickaxe_tier=?, backpack_tier=?, backpack_blocks=?, total_blocks_mined=?,
       level=?, rebirths=?, prestiges=?, last_collected_at=?, last_daily_at=?,
       last_weekly_at=?, last_monthly_at=?, last_hunt_at=?
       WHERE guild_id=? AND user_id=?`
    )
    .bind(
      p.coins, p.gems, p.shards, p.prestige_tokens,
      p.pickaxe_tier, p.backpack_tier, p.backpack_blocks, p.total_blocks_mined,
      p.level, p.rebirths, p.prestiges, p.last_collected_at, p.last_daily_at,
      p.last_weekly_at, p.last_monthly_at, p.last_hunt_at,
      p.guild_id, p.user_id
    )
    .run();
}

export async function getOwnedPets(db: any, guildId: string, userId: string) {
  const rows = (await db
    .prepare("SELECT pet_key, level FROM player_pets WHERE guild_id=? AND user_id=?")
    .bind(guildId, userId)
    .all()) as { results: { pet_key: string; level: number }[] };
  return rows.results ?? [];
}

// Sums the % bonus for a given perk type across all owned pets.
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

export function levelFromBlocks(totalBlocks: number): number {
  // Simple curve: level = 1 + floor(sqrt(totalBlocks / 50))
  return 1 + Math.floor(Math.sqrt(totalBlocks / 50));
}

export function pickaxeBlocksPerMinute(tier: number): number {
  return PICKAXE_TIERS[Math.min(tier, PICKAXE_TIERS.length - 1)].value;
}

export function backpackCapacity(tier: number): number {
  return BACKPACK_TIERS[Math.min(tier, BACKPACK_TIERS.length - 1)].value;
}

// Applies idle-time accrual to a player's backpack, capped by capacity.
// Call this before reading backpack_blocks anywhere (check/sell/profile).
export async function accrueIdleBlocks(
  db: any,
  p: Player
): Promise<Player> {
  const now = Date.now();
  const elapsedMin = (now - p.last_collected_at) / 60000;
  if (elapsedMin <= 0) return p;

  const owned = await getOwnedPets(db, p.guild_id, p.user_id);
  const capacityBonus = 1 + petBonusPercent(owned, "capacity") / 100;
  const capacity = Math.floor(backpackCapacity(p.backpack_tier) * capacityBonus);

  const rate = pickaxeBlocksPerMinute(p.pickaxe_tier);
  const mined = Math.floor(elapsedMin * rate);

  const newBlocks = Math.min(capacity, p.backpack_blocks + mined);
  const actuallyGained = newBlocks - p.backpack_blocks;

  p.backpack_blocks = newBlocks;
  p.total_blocks_mined += actuallyGained;
  p.level = levelFromBlocks(p.total_blocks_mined);
  p.last_collected_at = now;
  return p;
}

export async function sellBackpack(
  db: any,
  p: Player
): Promise<{ coinsEarned: number; blocksSold: number }> {
  if (p.backpack_blocks <= 0) return { coinsEarned: 0, blocksSold: 0 };

  const owned = await getOwnedPets(db, p.guild_id, p.user_id);
  const incomeBonus = 1 + petBonusPercent(owned, "income") / 100;
  const boosterMult = await activeBoosterMultiplier(db, p.guild_id, p.user_id, "income");
  const rebirthBonus = 1 + p.rebirths * 0.1; // +10% per rebirth, permanent

  const baseValue = ORE_VALUE_PER_BLOCK[Math.min(p.pickaxe_tier, ORE_VALUE_PER_BLOCK.length - 1)];
  const blocksSold = p.backpack_blocks;
  const coinsEarned = Math.floor(blocksSold * baseValue * incomeBonus * boosterMult * rebirthBonus);

  p.coins += coinsEarned;
  p.backpack_blocks = 0;
  return { coinsEarned, blocksSold };
}

export function nextPickaxeUpgrade(p: Player) {
  return PICKAXE_TIERS[p.pickaxe_tier + 1] ?? null;
}
export function nextBackpackUpgrade(p: Player) {
  return BACKPACK_TIERS[p.backpack_tier + 1] ?? null;
}

export function canRebirth(p: Player): boolean {
  const maxTier = PICKAXE_TIERS.length - 1;
  return (
    p.pickaxe_tier >= maxTier &&
    p.backpack_tier >= maxTier &&
    p.level >= REBIRTH_MIN_LEVEL
  );
}

// Rebirth resets progress, grants gems based on lifetime coins earned.
export function applyRebirth(p: Player): number {
  const gemsEarned = Math.max(1, Math.floor(Math.log10(p.coins + 10) * 3));
  p.gems += gemsEarned;
  p.rebirths += 1;
  p.coins = 0;
  p.pickaxe_tier = 0;
  p.backpack_tier = 0;
  p.backpack_blocks = 0;
  p.total_blocks_mined = 0;
  p.level = 1;

  if (p.rebirths > 0 && p.rebirths % PRESTIGE_EVERY_REBIRTHS === 0) {
    p.prestiges += 1;
    p.prestige_tokens += 1;
  }
  return gemsEarned;
}
