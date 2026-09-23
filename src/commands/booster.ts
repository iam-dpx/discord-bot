// /booster — view active boosters + your unactivated booster inventory,
// and activate one via buttons.
// Call handleBoosterCommand(interaction, env) from the slash-command router,
// and handleBoosterButtonClick(interaction, env) for MESSAGE_COMPONENT
// interactions whose custom_id starts with "boost_use_".

import { BOOSTER_TIERS, icon } from "../game/data";
import {
  getOrCreatePlayer,
  savePlayer,
  accruePassiveIncome,
  getBoosterInventory,
  activateBoosterItem,
  getActiveBoosters,
  Player,
} from "../game/economy";

const COLOR = 0x2ecc71;
const COLOR_WARN = 0xe74c3c;

function reply(content: any) {
  return { type: 4, data: content };
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "expired";
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Builds the booster panel: an "Active Boosters" summary (personal +
// server-wide, with time remaining) plus one field per tier showing how
// many unactivated items are in inventory, with an Activate button per
// owned tier. Same stateless custom_id pattern as crate.ts.
async function buildBoosterPanel(p: Player, db: any) {
  const now = Date.now();
  const active = await getActiveBoosters(db, p.guild_id, p.user_id);
  const inventory = await getBoosterInventory(db, p.guild_id, p.user_id);
  const qtyByTier = new Map(inventory.map((r) => [r.booster_tier, r.quantity]));

  const activeLines = active.length
    ? active.map((b) =>
        b.scope === "global"
          ? `**${b.label ?? "Event Booster"}** (server-wide) — x${b.multiplier} income, **${formatDuration(b.expires_at - now)}** left`
          : `**Income Booster** — x${b.multiplier}, **${formatDuration(b.expires_at - now)}** left`
      )
    : ["No active boosters right now."];

  const inventoryFields = BOOSTER_TIERS.map((t) => ({
    name: t.label,
    value: `Owned: **${qtyByTier.get(t.key) ?? 0}** (x${t.multiplier} income for ${t.durationMinutes}min when activated)`,
    inline: true,
  }));

  const ownedTiers = BOOSTER_TIERS.filter((t) => (qtyByTier.get(t.key) ?? 0) > 0);
  const components = ownedTiers.length
    ? [
        {
          type: 1,
          components: ownedTiers.slice(0, 5).map((t) => ({
            type: 2,
            style: 1,
            label: `Activate ${t.label} (${qtyByTier.get(t.key)})`,
            custom_id: `boost_use_${p.guild_id}_${p.user_id}_${t.key}`,
          })),
        },
      ]
    : [];

  return {
    embeds: [
      {
        title: "Boosters",
        color: COLOR,
        thumbnail: { url: icon("booster_gm") },
        description: ownedTiers.length ? "Tap a button below to activate one." : undefined,
        fields: [{ name: "Active Boosters", value: activeLines.join("\n"), inline: false }, ...inventoryFields],
      },
    ],
    components,
  };
}

export async function handleBoosterCommand(interaction: any, env: { DB: any }) {
  const db = env.DB;
  const guildId = interaction.guild_id;
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  let player = await getOrCreatePlayer(db, guildId, userId);
  player = await accruePassiveIncome(db, player);
  await savePlayer(db, player);

  const panel = await buildBoosterPanel(player, db);
  return reply(panel);
}

export async function handleBoosterButtonClick(interaction: any, env: { DB: any }) {
  const db = env.DB;
  const customId: string = interaction.data?.custom_id ?? "";
  const match = customId.match(/^boost_use_(\d+)_(\d+)_(common|rare|epic|legendary)$/);
  if (!match) {
    return { type: 4, data: { content: "That booster button isn't valid anymore — run `/booster` again.", flags: 64 } };
  }
  const [, guildId, ownerId, tier] = match;
  const clickerId = interaction.member?.user?.id ?? interaction.user?.id;

  if (clickerId !== ownerId) {
    return {
      type: 4,
      data: { content: "This isn't your booster panel — use `/booster` to manage your own.", flags: 64 },
    };
  }

  // Accrue + persist first so any passive income banked since the last
  // interaction isn't lost — activating a booster itself doesn't touch
  // coins/gems, so there's no second save needed after it.
  let player = await getOrCreatePlayer(db, guildId, ownerId);
  player = await accruePassiveIncome(db, player);
  await savePlayer(db, player);

  const result = await activateBoosterItem(db, guildId, ownerId, tier);
  const def = BOOSTER_TIERS.find((t) => t.key === tier);

  const summary = result.ok
    ? `Activated **${def?.label}** — **x${result.multiplier}** income for **${result.durationMinutes} minutes**!`
    : result.reason ?? "Couldn't activate that booster.";

  const panel = await buildBoosterPanel(player, db);

  return {
    type: 7, // UPDATE_MESSAGE — edits the original /booster panel in place
    data: {
      embeds: [
        {
          title: result.ok ? "Booster Activated" : "Nothing to activate",
          description: summary,
          color: result.ok ? COLOR : COLOR_WARN,
          thumbnail: { url: def?.icon ?? icon("booster_gm") },
        },
        ...panel.embeds,
      ],
      components: panel.components,
    },
  };
}
