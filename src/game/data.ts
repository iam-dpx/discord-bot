// Central game-balance config for the idle miner feature.
// Icon URLs assume icons were pushed to assets/icons/<name>.png on the repo's
// default branch. Update ICON_BASE if your branch/path differs.
export const ICON_BASE =
  "https://raw.githubusercontent.com/iam-dpx/discord-bot/main/assets/icons";
export const icon = (name: string) => `${ICON_BASE}/${name}.png`;

export interface UpgradeType {
  key: string;
  label: string;
  baseCost: number; // cost for your NEXT purchase at count 0
  profitPerMin: number; // flat +$/min per unit owned
  icon: string;
}

// Exact numbers confirmed from the real bot's /upgrades screen. Cost scaling
// per additional unit owned is NOT confirmed from a screenshot (we only saw
// each type at count 1) — using a modest 7% geometric increase per unit as a
// placeholder assumption; flag if the real bot's actual scaling differs.
export const UPGRADE_TYPES: UpgradeType[] = [
  { key: "size", label: "Size", baseCost: 1000, profitPerMin: 50, icon: icon("factory_icon") },
  { key: "miner", label: "Miner", baseCost: 750, profitPerMin: 35, icon: icon("miner_icon") },
  { key: "workers", label: "Workers", baseCost: 500, profitPerMin: 25, icon: icon("pet_golem") },
];
export const UPGRADE_COST_GROWTH = 1.07; // ASSUMPTION — not confirmed from a screenshot

// "1/420" on the real /upgrades screen — max TOTAL upgrades combined across
// all 3 types. Reverse-engineered from the one data point we have (prestige
// 1 -> cap 420) against the stated "+10 max upgrade slots per prestige
// level" -> implies a base of 410. ASSUMPTION, not confirmed directly.
export const BASE_UPGRADE_SLOTS = 410;
export const UPGRADE_SLOTS_PER_PRESTIGE = 10;

// How many minutes of passive income can accrue before you must check in
// (prevents unlimited AFK abuse). Not part of the real bot's confirmed
// mechanics — kept as a practical safeguard.
export const MAX_OFFLINE_MINUTES = 12 * 60; // 12 hours

// ---------------------------------------------------------- MINE MINIGAME ---
// Matches the real bot's /mine: 3 buttons, one randomly-positioned "critical"
// button worth 2x. Independent of the passive $/min income above — this is
// a manual bonus action on a cooldown.
export const MINE_COOLDOWN_MS = 45 * 1000; // 45 sec between /mine check uses
export const MINE_CRIT_MULTIPLIER = 2;
export const MINE_BASE_CASH = 12; // scales with player level now (no pickaxe tier)
export const MINE_BASE_XP = 10;
export const MINE_BASE_MATERIAL = 30;
export const XP_PER_LEVEL = 100; // flat curve for v1: level = floor(xp / 100)

// Ore unlocks now gate on player Level instead of a pickaxe tier (which no
// longer exists in the real bot's model).
// Each ore now has 5 art "forms" from the icon pack: 1 = raw (just mined)
// through 5 = refined block (highest quality). Form is decided at
// mine-click time: a normal hit gives a random raw-ish form (1-4), a
// Critical Hit always gives form 5 — ties the art progression to the
// existing crit mechanic instead of a separate refining system.
export const ORE_FORM_ICON = (oreKey: string, form: number) => icon(`ore_${oreKey}_${form}`);

export const ORES = [
  { key: "copper", label: "Copper Ore", minLevel: 1 },
  { key: "silver", label: "Silver Ore", minLevel: 8 },
  { key: "gold", label: "Gold Ore", minLevel: 16 },
  { key: "platinum", label: "Platinum Ore", minLevel: 26 },
  { key: "emerald", label: "Emerald Ore", minLevel: 40 },
  { key: "diamond", label: "Diamond Ore", minLevel: 60 },
];

export interface PetDef {
  key: string;
  label: string;
  icon: string;
  // Passive perk applied while owned. One perk type per pet for v1.
  perk: "income" | "capacity" | "luck";
  baseValue: number; // % bonus at level 1
  perLevel: number; // % bonus added per level above 1
  weight: number; // hunt drop weight (higher = more common)
}

export const PETS: PetDef[] = [
  { key: "mole", label: "Mole", icon: icon("pet_mole"), perk: "income", baseValue: 3, perLevel: 1, weight: 30 },
  { key: "bat", label: "Bat", icon: icon("pet_bat"), perk: "luck", baseValue: 2, perLevel: 1, weight: 25 },
  { key: "owl", label: "Owl", icon: icon("pet_owl"), perk: "capacity", baseValue: 5, perLevel: 1.5, weight: 20 },
  { key: "slime", label: "Slime", icon: icon("pet_slime"), perk: "income", baseValue: 4, perLevel: 1.2, weight: 15 },
  { key: "golem", label: "Golem", icon: icon("pet_golem"), perk: "capacity", baseValue: 8, perLevel: 2, weight: 7 },
  { key: "crystalfox", label: "Crystal Fox", icon: icon("pet_crystalfox"), perk: "luck", baseValue: 10, perLevel: 2.5, weight: 3 },
];

export const HUNT_SHARD_REWARD = 15; // shards given when a hunt whiffs (no pet)
export const HUNT_PET_SHARD_REWARD = 15; // pet shards given when a hunt finds a duplicate pet
export const HUNT_PET_CHANCE = 0.35; // 35% chance per /mine pet hunt to get a pet instead of shards
export const SHARDS_PER_PET_LEVEL = 40; // pet shards required to level a pet up by 1

export const CRATE_TYPES = [
  { key: "common", label: "Common Crate", icon: icon("crate_common") },
  { key: "rare", label: "Rare Crate", icon: icon("crate_rare") },
  { key: "epic", label: "Epic Crate", icon: icon("crate_epic") },
  { key: "legendary", label: "Legendary Crate", icon: icon("crate_legendary") },
];

// ------------------------------------------------------- CORPORATIONS ---
// Buff tier is looked up from the corp's total bank_coins — every member
// gets the multiplier applied to their passive income while they're in the
// corp. ASSUMPTION: thresholds/percentages are a fresh design (no reference
// screenshot for this system), tune later if needed.
export const CORP_BUFF_TIERS = [
  { minBank: 0, mult: 1.0, label: "No Buff" },
  { minBank: 5000, mult: 1.05, label: "+5% Income" },
  { minBank: 25000, mult: 1.1, label: "+10% Income" },
  { minBank: 100000, mult: 1.15, label: "+15% Income" },
  { minBank: 500000, mult: 1.25, label: "+25% Income" },
];
export function corpBuffForBank(bankCoins: number) {
  let tier = CORP_BUFF_TIERS[0];
  for (const t of CORP_BUFF_TIERS) if (bankCoins >= t.minBank) tier = t;
  return tier;
}
export const CORP_MAX_MEMBERS = 25; // ASSUMPTION — reasonable cap, not confirmed

export const COOLDOWNS_MS = {
  hunt: 30 * 60 * 1000, // 30 min
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export const REBIRTH_MIN_LEVEL = 50; // player level required to rebirth
export const PRESTIGE_EVERY_REBIRTHS = 25;

// ------------------------------------------------------ CRATES & BOOSTERS ---
// Booster tiers reuse the same rarity names as CRATE_TYPES above, so the
// whole chain stays consistent: crate rarity -> booster tier -> multiplier/
// duration. Every booster granted through this system is booster_type
// 'income' — the only type activeBoosterMultiplier() in economy.ts reads.
// ASSUMPTION: numbers are a fresh design (no reference screenshot for this
// feature) — tune later if needed.
export interface BoosterTierDef {
  key: string;
  label: string;
  multiplier: number;
  durationMinutes: number;
  icon: string;
}

export const BOOSTER_TIERS: BoosterTierDef[] = [
  { key: "common", label: "Income Booster I", multiplier: 1.5, durationMinutes: 30, icon: icon("booster_gm") },
  { key: "rare", label: "Income Booster II", multiplier: 2, durationMinutes: 60, icon: icon("booster_gm") },
  { key: "epic", label: "Income Booster III", multiplier: 3, durationMinutes: 120, icon: icon("booster_gm") },
  { key: "legendary", label: "Income Booster IV", multiplier: 5, durationMinutes: 240, icon: icon("booster_global") },
];

// What opening a crate of a given rarity can drop. One entry is picked by
// weight — "coins"/"gems" credit the player directly, "booster" adds ONE
// item of that tier to the player's booster inventory (player_booster_items)
// rather than activating it immediately.
export interface CrateRewardOption {
  type: "coins" | "gems" | "booster";
  weight: number;
  min?: number; // coins/gems only
  max?: number; // coins/gems only
  boosterTier?: string; // booster only — a BOOSTER_TIERS key
}

export const CRATE_REWARD_POOLS: Record<string, CrateRewardOption[]> = {
  common: [
    { type: "coins", weight: 55, min: 100, max: 300 },
    { type: "gems", weight: 15, min: 1, max: 2 },
    { type: "booster", weight: 30, boosterTier: "common" },
  ],
  rare: [
    { type: "coins", weight: 45, min: 400, max: 900 },
    { type: "gems", weight: 20, min: 2, max: 4 },
    { type: "booster", weight: 35, boosterTier: "rare" },
  ],
  epic: [
    { type: "coins", weight: 35, min: 1000, max: 2200 },
    { type: "gems", weight: 25, min: 4, max: 8 },
    { type: "booster", weight: 40, boosterTier: "epic" },
  ],
  legendary: [
    { type: "coins", weight: 25, min: 3000, max: 6000 },
    { type: "gems", weight: 30, min: 8, max: 15 },
    { type: "booster", weight: 45, boosterTier: "legendary" },
  ],
};

// Which crate rarity /daily /weekly /monthly hand out, and how often —
// weighted the same way as CRATE_REWARD_POOLS above. This is IN ADDITION to
// the existing flat coins/gems payout in handleClaim(), not a replacement.
export const CLAIM_CRATE_ODDS: Record<string, { key: string; weight: number }[]> = {
  daily: [
    { key: "common", weight: 70 },
    { key: "rare", weight: 25 },
    { key: "epic", weight: 5 },
  ],
  weekly: [
    { key: "common", weight: 35 },
    { key: "rare", weight: 45 },
    { key: "epic", weight: 18 },
    { key: "legendary", weight: 2 },
  ],
  monthly: [
    { key: "common", weight: 10 },
    { key: "rare", weight: 35 },
    { key: "epic", weight: 40 },
    { key: "legendary", weight: 15 },
  ],
};

// Shared weighted-random helper — picks one entry from a list of
// { weight, ... } options, proportional to weight.
export function weightedPick<T extends { weight: number }>(options: T[]): T {
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  let roll = Math.random() * total;
  for (const o of options) {
    if (roll < o.weight) return o;
    roll -= o.weight;
  }
  return options[options.length - 1];
}
