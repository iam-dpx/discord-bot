// Central game-balance config for the idle miner feature.
// Icon URLs assume icons were pushed to assets/icons/<name>.png on the repo's
// default branch. Update ICON_BASE if your branch/path differs.
export const ICON_BASE =
  "https://raw.githubusercontent.com/iam-dpx/discord-bot/main/assets/icons";
export const icon = (name: string) => `${ICON_BASE}/${name}.png`;

export interface Tier {
  key: string;
  label: string; // e.g. "Iron Pickaxe"
  cost: number; // coins to upgrade INTO this tier from the previous one
  // Pickaxe: blocksPerMinute. Backpack: capacity (max blocks held).
  value: number;
}

// Index 0 = starting tier (free), already owned by new players.
export const PICKAXE_TIERS: Tier[] = [
  { key: "wooden", label: "Wooden Pickaxe", cost: 0, value: 2 },
  { key: "stone", label: "Stone Pickaxe", cost: 500, value: 5 },
  { key: "iron", label: "Iron Pickaxe", cost: 4000, value: 12 },
  { key: "gold", label: "Gold Pickaxe", cost: 25000, value: 28 },
  { key: "diamond", label: "Diamond Pickaxe", cost: 150000, value: 65 },
  { key: "emerald", label: "Emerald Pickaxe", cost: 800000, value: 150 },
  { key: "netherite", label: "Netherite Pickaxe", cost: 4000000, value: 350 },
];

export const BACKPACK_TIERS: Tier[] = [
  { key: "wooden", label: "Wooden Backpack", cost: 0, value: 500 },
  { key: "stone", label: "Stone Backpack", cost: 500, value: 1500 },
  { key: "iron", label: "Iron Backpack", cost: 4000, value: 4000 },
  { key: "gold", label: "Gold Backpack", cost: 25000, value: 10000 },
  { key: "diamond", label: "Diamond Backpack", cost: 150000, value: 25000 },
  { key: "emerald", label: "Emerald Backpack", cost: 800000, value: 60000 },
  { key: "netherite", label: "Netherite Backpack", cost: 4000000, value: 150000 },
];

// Average coin value per block, scales with pickaxe tier (represents better
// ore quality unlocked by better pickaxes). v1 simplification: backpack
// holds a single "blocks" count rather than per-ore-type inventory.
export const ORE_VALUE_PER_BLOCK = [1, 2.2, 5, 11, 24, 52, 110];

export const ORES = [
  { key: "coal", label: "Coal Ore", minTier: 0, icon: icon("ore_coal") },
  { key: "copper", label: "Copper Ore", minTier: 1, icon: icon("ore_copper") },
  { key: "iron", label: "Iron Ore", minTier: 2, icon: icon("ore_iron") },
  { key: "gold", label: "Gold Ore", minTier: 3, icon: icon("ore_gold") },
  { key: "diamond", label: "Diamond Ore", minTier: 4, icon: icon("ore_diamond") },
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
