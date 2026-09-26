// /crate — view crate inventory and open crates via buttons.
// Call handleCrateCommand(interaction, env) from the slash-command router,
// and handleCrateButtonClick(interaction, env) for MESSAGE_COMPONENT
// interactions whose custom_id starts with "crate_open_".

import { CRATE_TYPES, icon, formatMinutes, fmt } from "../game/data";
import { emojiPrefix } from "../game/emoji";
import {
  getOrCreatePlayer,
  savePlayer,
  accruePassiveIncome,
  getCrateInventory,
  openCrateForPlayer,
  Player,
} from "../game/economy";

const COLOR = 0x2ecc71;
const COLOR_WARN = 0xe74c3c;

function reply(content: any) {
  return { type: 4, data: content };
}

// Builds the crate panel: one field per crate type showing quantity owned,
// one button per type the player actually owns (>0) to open it. custom_id
// encodes guild/user/crateKey directly — same stateless pattern as the
// mine_ and upg_pick_ buttons elsewhere in this repo — so a click only needs
// an ownership re-check against the caller, not a separate session lookup.
async function buildCratePanel(p: Player, db: any) {
  const inventory = await getCrateInventory(db, p.guild_id, p.user_id);
  const qtyByKey = new Map(inventory.map((r) => [r.crate_type, r.quantity]));

  const ownedTypes = CRATE_TYPES.filter((c) => (qtyByKey.get(c.key) ?? 0) > 0);
  const fields = ownedTypes.map((c) => ({
    name: `${emojiPrefix(`crate_${c.key}`)}${c.label}`,
    value: `Owned: **${qtyByKey.get(c.key)}**`,
    inline: true,
  }));


  const components = ownedTypes.length
    ? [
        {
          type: 1,
          // Discord caps an action row at 5 buttons — there are only 4
          // crate rarities today, so the slice is just a safety net.
          components: ownedTypes.slice(0, 5).map((c) => ({
            type: 2,
            style: 1,
            label: `Open ${c.label} (${qtyByKey.get(c.key)})`,
            custom_id: `crate_open_${p.guild_id}_${p.user_id}_${c.key}`,
          })),
        },
      ]
    : [];

  return {
    embeds: [
      {
        title: "Your Crates",
        description: ownedTypes.length
          ? "Tap a button below to open one."
          : "You don't have any crates yet — earn them from `/daily`, `/weekly`, and `/monthly`.",
        color: COLOR,
        thumbnail: { url: icon("crate_common") },
        fields,
      },
    ],
    components,
  };
}

export async function handleCrateCommand(interaction: any, env: { DB: any }) {
  const db = env.DB;
  const guildId = interaction.guild_id;
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  let player = await getOrCreatePlayer(db, guildId, userId);
  player = await accruePassiveIncome(db, player);
  await savePlayer(db, player);

  const panel = await buildCratePanel(player, db);
  return reply(panel);
}

export async function handleCrateButtonClick(interaction: any, env: { DB: any }) {
  const db = env.DB;
  const customId: string = interaction.data?.custom_id ?? "";
  const match = customId.match(/^crate_open_(\d+)_(\d+)_(common|rare|epic|legendary)$/);
  if (!match) {
    return { type: 4, data: { content: "That crate button isn't valid anymore — run `/crate` again.", flags: 64 } };
  }
  const [, guildId, ownerId, crateKey] = match;
  const clickerId = interaction.member?.user?.id ?? interaction.user?.id;

  if (clickerId !== ownerId) {
    return {
      type: 4,
      data: { content: "This isn't your crate panel — use `/crate` to open your own.", flags: 64 },
    };
  }

  let player = await getOrCreatePlayer(db, guildId, ownerId);
  player = await accruePassiveIncome(db, player);
  const result = await openCrateForPlayer(db, player, crateKey);

  const crateDef = CRATE_TYPES.find((c) => c.key === crateKey);
  let summary: string;
  let color = COLOR;
  let thumb = crateDef?.icon;

  if (!result.ok) {
    summary = result.reason ?? "Couldn't open that crate.";
    color = COLOR_WARN;
  } else if (result.rewardType === "coins") {
    summary = `You opened a **${crateDef?.label}** and got **+${fmt(result.amount ?? 0)} coins**!`;
    thumb = icon("coin");
  } else if (result.rewardType === "gems") {
    summary = `You opened a **${crateDef?.label}** and got **+${fmt(result.amount ?? 0)} gems**!`;
    thumb = icon("gem");
  } else {
    summary = `You opened a **${crateDef?.label}** and got a **x${result.multiplier} booster (${formatMinutes(
      result.durationMinutes ?? 0
    )})**! Check \`/booster\` to activate it.`;
    thumb = icon("booster_gm");
  }

  const panel = await buildCratePanel(player, db);

  return {
    type: 7, // UPDATE_MESSAGE — edits the original /crate panel in place
    data: {
      embeds: [
        {
          title: result.ok ? "Crate Opened" : "Nothing to open",
          description: summary,
          color,
          thumbnail: thumb ? { url: thumb } : undefined,
        },
        ...panel.embeds,
      ],
      components: panel.components,
    },
  };
}
