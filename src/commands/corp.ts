// Handler for the /corp command (create, join, leave, info, deposit,
// withdraw, kick, leaderboard). Call handleCorpCommand(interaction, env)
// from index.ts's interaction router, same pattern as handleGameCommand.
//
// Design notes:
//  - A player can be in at most one corporation per guild (corp_members'
//    PK is (guild_id, user_id)).
//  - Joining is open by exact name — no invite step for v1. Anyone can
//    join any corp they know the name of, up to CORP_MAX_MEMBERS.
//  - Only the leader can withdraw from the bank or kick members, to keep
//    the shared bank from being drained by anyone who joins. Depositing
//    is open to every member.
//  - The corp's buff (see corpBuffForBank in data.ts) is based on
//    bank_coins only — gems sit in the bank but don't affect the buff.
//  - Leaving: if the leader leaves and others remain, the longest-tenured
//    remaining member is promoted. If the corp is left empty, it's deleted.

import { CORP_MAX_MEMBERS, corpBuffForBank, icon, fmt } from "../game/data";
import { emojiPrefix } from "../game/emoji";
import { getOrCreatePlayer, savePlayer, accruePassiveIncome, getPlayerCorp, CorpRow } from "../game/economy";

const COLOR = 0x2ecc71;
const COLOR_WARN = 0xe74c3c;

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

function subOptVal(subOptions: any[], name: string) {
  return subOptions.find((o: any) => o.name === name)?.value;
}

export async function handleCorpCommand(interaction: any, env: { DB: any }) {
  const db = env.DB;
  const guildId: string = interaction.guild_id;
  const userId: string = interaction.member?.user?.id ?? interaction.user?.id;
  const options = interaction.data?.options ?? [];
  const sub: string | undefined = options[0]?.name;
  const subOptions: any[] = options[0]?.options ?? [];

  switch (sub) {
    case "create":
      return handleCreate(db, guildId, userId, subOptVal(subOptions, "name"));
    case "join":
      return handleJoin(db, guildId, userId, subOptVal(subOptions, "name"));
    case "leave":
      return handleLeave(db, guildId, userId);
    case "info":
      return handleInfo(db, guildId, userId, subOptVal(subOptions, "name"));
    case "deposit":
      return handleDeposit(db, guildId, userId, Number(subOptVal(subOptions, "amount") ?? 0), subOptVal(subOptions, "asset") ?? "coins");
    case "withdraw":
      return handleWithdraw(db, guildId, userId, Number(subOptVal(subOptions, "amount") ?? 0), subOptVal(subOptions, "asset") ?? "coins");
    case "kick":
      return handleKick(db, guildId, userId, subOptVal(subOptions, "user"));
    case "leaderboard":
      return handleLeaderboard(db, guildId);
    default:
      return simpleEmbed("Unknown corp action", "Use `/corp create`, `join`, `leave`, `info`, `deposit`, `withdraw`, `kick`, or `leaderboard`.", { color: COLOR_WARN });
  }
}

async function handleCreate(db: any, guildId: string, userId: string, name: string | undefined) {
  if (!name || !name.trim()) return simpleEmbed("Name required", "Give your corporation a name.", { color: COLOR_WARN });
  const trimmed = name.trim().slice(0, 32);

  const existing = await getPlayerCorp(db, guildId, userId);
  if (existing) {
    return simpleEmbed("Already in a corporation", `You're already in **${existing.name}** — leave it first with \`/corp leave\`.`, { color: COLOR_WARN });
  }

  const taken = await db.prepare("SELECT id FROM corporations WHERE guild_id=? AND name=?").bind(guildId, trimmed).first();
  if (taken) return simpleEmbed("Name taken", `A corporation named **${trimmed}** already exists here.`, { color: COLOR_WARN });

  const now = Date.now();
  await db
    .prepare("INSERT INTO corporations (guild_id, name, leader_id, bank_coins, bank_gems, created_at) VALUES (?, ?, ?, 0, 0, ?)")
    .bind(guildId, trimmed, userId, now)
    .run();
  const corp = (await db.prepare("SELECT id FROM corporations WHERE guild_id=? AND name=?").bind(guildId, trimmed).first()) as { id: number };
  await db
    .prepare("INSERT INTO corp_members (guild_id, user_id, corp_id, role, joined_at) VALUES (?, ?, ?, 'leader', ?)")
    .bind(guildId, userId, corp.id, now)
    .run();

  return simpleEmbed("Corporation founded!", `**${trimmed}** is open for business. Others can join with \`/corp join name:${trimmed}\`.`, { thumbnail: icon("corp_icon") });
}

async function handleJoin(db: any, guildId: string, userId: string, name: string | undefined) {
  if (!name || !name.trim()) return simpleEmbed("Name required", "Which corporation do you want to join?", { color: COLOR_WARN });
  const trimmed = name.trim();

  const existing = await getPlayerCorp(db, guildId, userId);
  if (existing) return simpleEmbed("Already in a corporation", `Leave **${existing.name}** first with \`/corp leave\`.`, { color: COLOR_WARN });

  const corp = (await db.prepare("SELECT * FROM corporations WHERE guild_id=? AND name=?").bind(guildId, trimmed).first()) as CorpRow | null;
  if (!corp) return simpleEmbed("Not found", `No corporation named **${trimmed}** here — check \`/corp leaderboard\` for names.`, { color: COLOR_WARN });

  const countRow = (await db.prepare("SELECT COUNT(*) as c FROM corp_members WHERE corp_id=?").bind(corp.id).first()) as { c: number };
  if ((countRow?.c ?? 0) >= CORP_MAX_MEMBERS) {
    return simpleEmbed("Corporation full", `**${corp.name}** is at the ${CORP_MAX_MEMBERS}-member cap.`, { color: COLOR_WARN });
  }

  await db
    .prepare("INSERT INTO corp_members (guild_id, user_id, corp_id, role, joined_at) VALUES (?, ?, ?, 'member', ?)")
    .bind(guildId, userId, corp.id, Date.now())
    .run();
  return simpleEmbed("Joined!", `You're now a member of **${corp.name}**.`, { thumbnail: icon("corp_icon") });
}

async function handleLeave(db: any, guildId: string, userId: string) {
  const corp = await getPlayerCorp(db, guildId, userId);
  if (!corp) return simpleEmbed("Not in a corporation", "Join one first with `/corp join`.", { color: COLOR_WARN });

  await db.prepare("DELETE FROM corp_members WHERE guild_id=? AND user_id=?").bind(guildId, userId).run();

  const remaining = ((await db
    .prepare("SELECT user_id FROM corp_members WHERE corp_id=? ORDER BY joined_at ASC")
    .bind(corp.id)
    .all()) as { results: { user_id: string }[] }).results ?? [];

  if (remaining.length === 0) {
    await db.prepare("DELETE FROM corporations WHERE id=?").bind(corp.id).run();
    return simpleEmbed("Left the corporation", `**${corp.name}** had no members left, so it was disbanded.`);
  }

  if (corp.role === "leader") {
    const newLeader = remaining[0].user_id;
    await db.prepare("UPDATE corp_members SET role='leader' WHERE corp_id=? AND user_id=?").bind(corp.id, newLeader).run();
    await db.prepare("UPDATE corporations SET leader_id=? WHERE id=?").bind(newLeader, corp.id).run();
    return simpleEmbed("Left the corporation", `You left **${corp.name}**. <@${newLeader}> is the new leader.`);
  }

  return simpleEmbed("Left the corporation", `You're no longer a member of **${corp.name}**.`);
}

async function handleInfo(db: any, guildId: string, userId: string, name: string | undefined) {
  let corp: (CorpRow & { role?: string }) | null;
  if (name && name.trim()) {
    corp = (await db
      .prepare(
        `SELECT c.*, (SELECT role FROM corp_members WHERE corp_id=c.id AND user_id=?) as role
         FROM corporations c WHERE c.guild_id=? AND c.name=?`
      )
      .bind(userId, guildId, name.trim())
      .first()) as (CorpRow & { role?: string }) | null;
  } else {
    corp = await getPlayerCorp(db, guildId, userId);
  }
  if (!corp) {
    return simpleEmbed("Not found", name ? `No corporation named **${name}** here.` : "You're not in a corporation — try `/corp info name:<name>`.", { color: COLOR_WARN });
  }

  const memberRows = ((await db
    .prepare("SELECT user_id, role FROM corp_members WHERE corp_id=? ORDER BY role DESC, joined_at ASC")
    .bind(corp.id)
    .all()) as { results: { user_id: string; role: string }[] }).results ?? [];
  const buff = corpBuffForBank(corp.bank_coins);
  const memberList = memberRows.map((m) => `<@${m.user_id}>${m.role === "leader" ? " (Leader)" : ""}`).join(", ") || "None";

  return reply({
    embeds: [
      {
        title: corp.name,
        color: COLOR,
        thumbnail: { url: icon("corp_icon") },
        fields: [
          { name: "Leader", value: `<@${corp.leader_id}>`, inline: true },
          { name: "Members", value: `${memberRows.length}/${CORP_MAX_MEMBERS}`, inline: true },
          { name: `${emojiPrefix("corp_buff_icon")}Buff`, value: buff.label, inline: true },
          { name: `${emojiPrefix("coin")}Bank (Coins)`, value: fmt(corp.bank_coins), inline: true },
          { name: `${emojiPrefix("gem")}Bank (Gems)`, value: fmt(corp.bank_gems), inline: true },
          { name: `${emojiPrefix("materials_icon")}Bank (Materials)`, value: fmt(corp.bank_materials), inline: true },
          { name: "Roster", value: memberList, inline: false },
        ],
      },
    ],
  });
}

type CorpAsset = "coins" | "gems" | "materials";
const ASSET_LABEL: Record<CorpAsset, string> = { coins: "coins", gems: "gems", materials: "materials" };
function normalizeAsset(asset: string | undefined): CorpAsset {
  return asset === "gems" ? "gems" : asset === "materials" ? "materials" : "coins";
}

async function handleDeposit(db: any, guildId: string, userId: string, amount: number, assetRaw: string) {
  if (!amount || amount <= 0) return simpleEmbed("Invalid amount", "Enter a positive amount to deposit.", { color: COLOR_WARN });
  const corp = await getPlayerCorp(db, guildId, userId);
  if (!corp) return simpleEmbed("Not in a corporation", "Join one first with `/corp join`.", { color: COLOR_WARN });
  const asset = normalizeAsset(assetRaw);

  let player = await getOrCreatePlayer(db, guildId, userId);
  player = await accruePassiveIncome(db, player);
  const balance = asset === "gems" ? player.gems : asset === "materials" ? player.materials : player.coins;
  if (balance < amount) {
    await savePlayer(db, player);
    return simpleEmbed("Not enough", `You only have **${fmt(balance)} ${ASSET_LABEL[asset]}**.`, { color: COLOR_WARN });
  }
  if (asset === "gems") player.gems -= amount;
  else if (asset === "materials") player.materials -= amount;
  else player.coins -= amount;
  await savePlayer(db, player);

  if (asset === "gems") await db.prepare("UPDATE corporations SET bank_gems = bank_gems + ? WHERE id = ?").bind(amount, corp.id).run();
  else if (asset === "materials") await db.prepare("UPDATE corporations SET bank_materials = bank_materials + ? WHERE id = ?").bind(amount, corp.id).run();
  else await db.prepare("UPDATE corporations SET bank_coins = bank_coins + ? WHERE id = ?").bind(amount, corp.id).run();

  const newCoinBank = asset === "coins" ? corp.bank_coins + amount : corp.bank_coins;
  const buff = corpBuffForBank(newCoinBank);
  return simpleEmbed(
    "Deposited",
    `You deposited **${fmt(amount)} ${ASSET_LABEL[asset]}** into **${corp.name}**'s bank.${asset === "coins" ? ` New buff: **${buff.label}**.` : ""}`,
    { thumbnail: icon("corp_icon") }
  );
}

async function handleWithdraw(db: any, guildId: string, userId: string, amount: number, assetRaw: string) {
  if (!amount || amount <= 0) return simpleEmbed("Invalid amount", "Enter a positive amount to withdraw.", { color: COLOR_WARN });
  const corp = await getPlayerCorp(db, guildId, userId);
  if (!corp) return simpleEmbed("Not in a corporation", "Join one first with `/corp join`.", { color: COLOR_WARN });
  if (corp.role !== "leader") return simpleEmbed("Leader only", "Only the corporation leader can withdraw from the bank.", { color: COLOR_WARN });
  const asset = normalizeAsset(assetRaw);

  const bankBalance = asset === "gems" ? corp.bank_gems : asset === "materials" ? corp.bank_materials : corp.bank_coins;
  if (bankBalance < amount) {
    return simpleEmbed("Not enough in the bank", `The bank only has **${fmt(bankBalance)} ${ASSET_LABEL[asset]}**.`, { color: COLOR_WARN });
  }

  if (asset === "gems") await db.prepare("UPDATE corporations SET bank_gems = bank_gems - ? WHERE id = ?").bind(amount, corp.id).run();
  else if (asset === "materials") await db.prepare("UPDATE corporations SET bank_materials = bank_materials - ? WHERE id = ?").bind(amount, corp.id).run();
  else await db.prepare("UPDATE corporations SET bank_coins = bank_coins - ? WHERE id = ?").bind(amount, corp.id).run();

  let player = await getOrCreatePlayer(db, guildId, userId);
  player = await accruePassiveIncome(db, player);
  if (asset === "gems") player.gems += amount;
  else if (asset === "materials") player.materials += amount;
  else player.coins += amount;
  await savePlayer(db, player);

  return simpleEmbed("Withdrawn", `You withdrew **${fmt(amount)} ${ASSET_LABEL[asset]}** from **${corp.name}**'s bank.`, { thumbnail: icon("corp_icon") });
}

async function handleKick(db: any, guildId: string, userId: string, targetId: string | undefined) {
  if (!targetId) return simpleEmbed("User required", "Pick a member to kick.", { color: COLOR_WARN });
  const corp = await getPlayerCorp(db, guildId, userId);
  if (!corp) return simpleEmbed("Not in a corporation", "You're not in a corporation.", { color: COLOR_WARN });
  if (corp.role !== "leader") return simpleEmbed("Leader only", "Only the corporation leader can kick members.", { color: COLOR_WARN });
  if (targetId === userId) return simpleEmbed("Can't kick yourself", "Use `/corp leave` instead.", { color: COLOR_WARN });

  const target = (await db.prepare("SELECT corp_id FROM corp_members WHERE guild_id=? AND user_id=?").bind(guildId, targetId).first()) as { corp_id: number } | null;
  if (!target || target.corp_id !== corp.id) return simpleEmbed("Not a member", "That user isn't in your corporation.", { color: COLOR_WARN });

  await db.prepare("DELETE FROM corp_members WHERE guild_id=? AND user_id=?").bind(guildId, targetId).run();
  return simpleEmbed("Kicked", `<@${targetId}> was removed from **${corp.name}**.`, { thumbnail: icon("corp_icon") });
}

async function handleLeaderboard(db: any, guildId: string) {
  const rows = ((await db
    .prepare("SELECT name, bank_coins, leader_id FROM corporations WHERE guild_id=? ORDER BY bank_coins DESC LIMIT 10")
    .bind(guildId)
    .all()) as { results: { name: string; bank_coins: number; leader_id: string }[] }).results ?? [];

  if (!rows.length) return simpleEmbed("No corporations yet", "Be the first — `/corp create name:<name>`.", { thumbnail: icon("corp_icon") });

  const lines = rows.map((r, i) => `#${i + 1}: **${r.name}** — ${fmt(r.bank_coins)} bank (led by <@${r.leader_id}>)`);
  return simpleEmbed("Corporation Leaderboard", lines.join("\n"), { thumbnail: icon("corp_icon") });
}
