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
export const ORES = [
  { key: "coal", label: "Coal Ore", minLevel: 1, icon: icon("ore_coal") },
  { key: "copper", label: "Copper Ore", minLevel: 5, icon: icon("ore_copper") },
  { key: "iron", label: "Iron Ore", minLevel: 10, icon: icon("ore_iron") },
  { key: "gold", label: "Gold Ore", minLevel: 20, icon: icon("ore_gold") },
  { key: "diamond", label: "Diamond Ore", minLevel: 35, icon: icon("ore_diamond") },
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
export const HUNT_PET_CHANCE = 0.35; // 35% chance per /mine pet hunt to get a pet instead of shards
export const SHARDS_PER_PET_LEVEL = 40; // cost to level a pet up by 1

export const CRATE_TYPES = [
  { key: "common", label: "Common Crate", icon: icon("crate_common") },
  { key: "rare", label: "Rare Crate", icon: icon("crate_rare") },
  { key: "legendary", label: "Legendary Crate", icon: icon("crate_legendary") },
];

export const COOLDOWNS_MS = {
  hunt: 30 * 60 * 1000, // 30 min
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export const REBIRTH_MIN_LEVEL = 50; // player level required to rebirth
export const PRESTIGE_EVERY_REBIRTHS = 25;
