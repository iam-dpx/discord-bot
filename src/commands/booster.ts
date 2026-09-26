// /booster — view active boosters + your unactivated booster inventory,
// and activate one via buttons.
// Boosters have no tier/name — each is just a rolled (multiplier, duration)
// pair, so the panel below lists whatever the player actually has, not a
// fixed set of categories.
// Call handleBoosterCommand(interaction, env) from the slash-command router,
// and handleBoosterButtonClick(interaction, env) for MESSAGE_COMPONENT
// interactions whose custom_id starts with "boost_use_".

import { icon, formatMinutes } from "../game/data";
import { emojiPrefix } from "../game/emoji";
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
const MAX_BUTTONS = 20; // Discord caps at 5 rows x 5 buttons

function reply(content: any) {
  return { type: 4, data: content };
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  return formatMinutes(ms / 60000);
}

// Builds the booster panel: an "Active Boosters" summary (personal +
// server-wide, with time remaining) plus a plain list of every distinct
// (multiplier, duration) combo currently in inventory, with an Activate
// button per combo (capped at MAX_BUTTONS — extras just don't get a button
// this time around; re-run /booster after activating some to see more).
async function buildBoosterPanel(p: Player, db: any) {
  const now = Date.now();
  const active = await getActiveBoosters(db, p.guild_id, p.user_id);
  const inventory = await getBoosterInventory(db, p.guild_id, p.user_id);

  const activeLines = active.length
    ? active.map((b) =>
        b.scope === "global"
          ? `**${b.label ?? "Event Booster"}** (server-wide) — x${b.multiplier} income, **${formatRemaining(b.expires_at - now)}** left`
          : `${b.source === "gm" ? emojiPrefix("booster_gm") : ""}**x${b.multiplier} booster**${b.source === "gm" ? " (gifted by Game Master)" : ""} — **${formatRemaining(b.expires_at - now)}** left`
      )
    : ["No active boosters right now."];

  const inventoryLines = inventory.length
    ? inventory.map((b) => `**x${b.multiplier} booster** — ${formatMinutes(b.duration_minutes)} (qty: **${b.quantity}**)`)
    : ["No unactivated boosters — open some crates with `/crate`."];

  const shown = inventory.slice(0, MAX_BUTTONS);
  const components: any[] = [];
  for (let i = 0; i < shown.length; i += 5) {
    components.push({
      type: 1,
      components: shown.slice(i, i + 5).map((b) => ({
        type: 2,
        style: 1,
        label: `Activate x${b.multiplier} (${formatMinutes(b.duration_minutes)})`,
        custom_id: `boost_use_${p.guild_id}_${p.user_id}_${b.multiplier}_${b.duration_minutes}`,
      })),
    });
  }

  return {
    embeds: [
      {
        title: "Boosters",
        color: COLOR,
        thumbnail: { url: icon("booster_gm") },
        description: inventory.length ? "Tap a button below to activate one." : undefined,
        fields: [
          { name: "Active Boosters", value: activeLines.join("\n"), inline: false },
          { name: "Booster Inventory", value: inventoryLines.join("\n"), inline: false },
        ],
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
  const match = customId.match(/^boost_use_(\d+)_(\d+)_([\d.]+)_(\d+)$/);
  if (!match) {
    return { type: 4, data: { content: "That booster button isn't valid anymore — run `/booster` again.", flags: 64 } };
  }
  const [, guildId, ownerId, multiplierStr, durationStr] = match;
  const multiplier = parseFloat(multiplierStr);
  const durationMinutes = parseInt(durationStr, 10);
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

  const result = await activateBoosterItem(db, guildId, ownerId, multiplier, durationMinutes);

  const summary = result.ok
    ? `Activated **x${result.multiplier} booster** for **${formatMinutes(result.durationMinutes ?? 0)}**!`
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
          thumbnail: { url: icon("booster_gm") },
        },
        ...panel.embeds,
      ],
      components: panel.components,
    },
  };
}
