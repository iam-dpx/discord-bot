/*
  index.ts
  Dead Pixel — Discord customizer bot (Cloudflare Worker)
  Written by Dead Pixel (iamreal.dpx@gmail.com)

  Discord uses the "HTTP Interactions" model here: instead of a persistent
  gateway/WebSocket connection, Discord POSTs every slash command straight
  to this Worker's URL. See README.md in this folder for full setup.
*/

import {
  verifyKey,
  InteractionType,
  InteractionResponseType,
} from "discord-interactions";
// @ts-ignore — plain JS module, no types; see src/serverlist/*.js
import { handleServerListInteraction } from "./serverlist/index.js";
import { discordApi, ephemeralReply, jsonResponse } from "./shared";
import { handleRulesCommand } from "./rules";
import {
  handleGameCommand,
  handleMineButtonClick,
  handleUpgradeButtonClick,
  handleUpgradeModalSubmit,
} from "./commands/mine";
import { handleCorpCommand } from "./commands/corp";
import { handleCrateCommand, handleCrateButtonClick } from "./commands/crate";
import { handleBoosterCommand, handleBoosterButtonClick } from "./commands/booster";

export interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
  // guild allowlist — the only server this bot is allowed to be in;
  // it auto-leaves anywhere else (see handleGuildAllowlist below)
  ALLOWED_GUILD_ID: string;
  // owner-only commands (setname/setnickname/setavatar/setdescription/rules)
  OWNER_USER_ID: string;
  RULES_CHANNEL_ID: string;
  // server list feature
  DB: any; // D1Database — typed as `any` to avoid pulling in @cloudflare/workers-types
  AI: any; // Ai — same reasoning
  APPROVAL_CHANNEL_ID: string;
  PUBLIC_CHANNEL_ID: string;
  MOD_ROLE_ID: string;
}

const EPHEMERAL = 64; // Discord message flag: only the command's caller sees the reply

/* ---------- small helpers ---------- */

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

// Leaves any guild that isn't the one allowed server. Making the app a
// "private" bot in the Discord Developer Portal (Bot → Public Bot: off) is
// the main defense — it stops anyone else from generating a working invite
// link in the first place. This is a backup for the HTTP-Interactions-only
// case: this bot has no gateway connection, so it can't detect a new guild
// the moment it's added (no GUILD_CREATE event) — it only finds out once
// that server sends its first interaction, at which point this kicks it out.
function isDisallowedGuild(env: Env, guildId: string | undefined): guildId is string {
  return !!guildId && !!env.ALLOWED_GUILD_ID && guildId !== env.ALLOWED_GUILD_ID;
}

async function leaveGuild(env: Env, guildId: string): Promise<void> {
  try {
    await discordApi(env, `/users/@me/guilds/${guildId}`, { method: "DELETE" });
  } catch (err) {
    console.error(`Failed to leave disallowed guild ${guildId}:`, err);
  }
}

/* ---------- command handlers ---------- */
/* Each of these hits Discord's REST API directly — see README.md for the
   rate limits and "this is global, not per-server" caveats on setname
   and setavatar specifically. */

async function handleSetNickname(env: Env, guildId: string, nickname: string): Promise<Response> {
  const res = await discordApi(env, `/guilds/${guildId}/members/@me`, {
    method: "PATCH",
    body: JSON.stringify({ nick: nickname }),
  });

  if (!res.ok) {
    return ephemeralReply(`Couldn't change the nickname (Discord said: ${res.status}). Try again in a bit.`);
  }
  return ephemeralReply(`Nickname in this server is now **${nickname}**.`);
}

async function handleSetDescription(env: Env, description: string): Promise<Response> {
  const res = await discordApi(env, `/applications/@me`, {
    method: "PATCH",
    body: JSON.stringify({ description }),
  });

  if (res.status === 429) {
    return ephemeralReply("Rate limited by Discord — try again in a bit.");
  }
  if (!res.ok) {
    return ephemeralReply(`Couldn't change the description (Discord said: ${res.status}).`);
  }
  return ephemeralReply(
    "Bot's \"About Me\" description updated — heads up, this changes everywhere the bot is added, not just here."
  );
}

async function handleSetName(env: Env, username: string): Promise<Response> {
  const res = await discordApi(env, `/users/@me`, {
    method: "PATCH",
    body: JSON.stringify({ username }),
  });

  if (res.status === 429) {
    return ephemeralReply(
      "Rate limited — Discord only allows a couple of username changes per hour, across every server the bot is in. Try again later."
    );
  }
  if (!res.ok) {
    return ephemeralReply(`Couldn't change the username (Discord said: ${res.status}).`);
  }
  return ephemeralReply(
    `Bot username changed to **${username}** — heads up, this changes it everywhere the bot is added, not just here.`
  );
}

async function handleSetAvatar(env: Env, imageUrl: string): Promise<Response> {
  let imgRes: Response;
  try {
    imgRes = await fetch(imageUrl);
  } catch {
    return ephemeralReply("Couldn't fetch that image URL.");
  }

  const contentType = imgRes.headers.get("content-type") || "";
  if (!imgRes.ok || !contentType.startsWith("image/")) {
    return ephemeralReply("That doesn't look like a valid, publicly-accessible image URL.");
  }

  const buffer = await imgRes.arrayBuffer();
  const dataUri = `data:${contentType};base64,${arrayBufferToBase64(buffer)}`;

  const res = await discordApi(env, `/users/@me`, {
    method: "PATCH",
    body: JSON.stringify({ avatar: dataUri }),
  });

  if (res.status === 429) {
    return ephemeralReply(
      "Rate limited — Discord only allows an avatar change roughly every 10 minutes, across every server the bot is in. Try again shortly."
    );
  }
  if (!res.ok) {
    return ephemeralReply(`Couldn't change the avatar (Discord said: ${res.status}).`);
  }
  return ephemeralReply("Avatar updated — heads up, this changes it everywhere the bot is added, not just here.");
}

// Bulk-deletes recent messages in the channel the command was run in.
// Two real limits from Discord's own API, not this code:
//   - bulk-delete only accepts messages younger than 14 days; anything
//     older is silently skipped here (reported in the reply) rather than
//     erroring the whole command.
//   - bulk-delete needs 2+ message IDs; exactly 1 falls back to a normal
//     single DELETE.
async function handleClear(env: Env, channelId: string, amount: number): Promise<Response> {
  const clamped = Math.min(Math.max(amount, 1), 100);

  const listRes = await discordApi(env, `/channels/${channelId}/messages?limit=${clamped}`, { method: "GET" });
  if (!listRes.ok) {
    return ephemeralReply(`Couldn't fetch messages to delete (Discord said: ${listRes.status}).`);
  }
  const messages = (await listRes.json()) as { id: string; timestamp: string }[];

  if (messages.length === 0) {
    return ephemeralReply("Nothing to delete — this channel has no recent messages.");
  }

  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const deletable = messages.filter((m) => new Date(m.timestamp).getTime() > fourteenDaysAgo);
  const tooOld = messages.length - deletable.length;

  if (deletable.length === 0) {
    return ephemeralReply(
      "All of those messages are older than 14 days — Discord doesn't allow bulk-deleting messages that old."
    );
  }

  if (deletable.length === 1) {
    const res = await discordApi(env, `/channels/${channelId}/messages/${deletable[0].id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      return ephemeralReply(`Couldn't delete that message (Discord said: ${res.status}).`);
    }
  } else {
    const res = await discordApi(env, `/channels/${channelId}/messages/bulk-delete`, {
      method: "POST",
      body: JSON.stringify({ messages: deletable.map((m) => m.id) }),
    });
    if (!res.ok) {
      return ephemeralReply(`Couldn't delete messages (Discord said: ${res.status}).`);
    }
  }

  const skippedNote = tooOld > 0 ? ` (${tooOld} skipped — older than 14 days)` : "";
  return ephemeralReply(`Deleted ${deletable.length} message${deletable.length === 1 ? "" : "s"}.${skippedNote}`);
}

/* ---------- /nuke: delete + recreate a channel (bypasses the 14-day bulk-delete limit) ---------- */
/* Discord has no single call to wipe a channel's full history regardless of
   age — the only instant way is delete-and-recreate, which gives the
   channel a NEW ID. That's destructive and irreversible (pins, webhooks,
   and the ID itself are gone for good), so this always confirms first
   instead of acting on the slash command directly. */

function protectedChannelNames(env: Env, channelId: string): string[] {
  const names: string[] = [];
  if (channelId === env.APPROVAL_CHANNEL_ID) names.push("APPROVAL_CHANNEL_ID");
  if (channelId === env.PUBLIC_CHANNEL_ID) names.push("PUBLIC_CHANNEL_ID");
  if (channelId === env.RULES_CHANNEL_ID) names.push("RULES_CHANNEL_ID");
  return names;
}

function buildNukeConfirmation(env: Env, channelId: string): Response {
  const protectedNames = protectedChannelNames(env, channelId);
  const warning = protectedNames.length
    ? `\n\n⚠️ This channel is set as **${protectedNames.join(", ")}** in \`wrangler.toml\` — nuking it changes its ID, which will break that config until you update it.`
    : "";

  return jsonResponse({
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE (ephemeral)
    data: {
      content:
        `This deletes <#${channelId}> and recreates it empty with the same name and settings. ` +
        `Every message, pin, and webhook tied to it is gone for good — there's no undo.${warning}\n\nAre you sure?`,
      flags: EPHEMERAL,
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 4, label: "Nuke it", custom_id: `nuke_confirm_${channelId}` }, // style 4 = danger (red)
            { type: 2, style: 2, label: "Cancel", custom_id: `nuke_cancel_${channelId}` }, // style 2 = secondary (grey)
          ],
        },
      ],
    },
  });
}

async function editOriginalResponse(env: Env, interactionToken: string, body: unknown): Promise<void> {
  const res = await discordApi(env, `/webhooks/${env.DISCORD_APPLICATION_ID}/${interactionToken}/messages/@original`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Failed to edit the nuke confirmation message: ${res.status} ${await res.text()}`);
  }
}

async function cloneAndDeleteChannel(env: Env, channelId: string): Promise<{ oldName: string; newChannelId: string }> {
  const getRes = await discordApi(env, `/channels/${channelId}`, { method: "GET" });
  if (!getRes.ok) {
    throw new Error(`fetching channel failed: ${getRes.status} ${await getRes.text()}`);
  }
  const channel = (await getRes.json()) as Record<string, unknown> & { id: string; guild_id: string; name: string };

  // Carry over everything that matters for how the channel looks/behaves.
  // Only include fields that were actually present — sending explicit
  // `undefined`/nulls for things like bitrate on a text channel can trip
  // up channel creation.
  const createBody: Record<string, unknown> = {
    name: channel.name,
    type: channel.type,
    position: channel.position,
    permission_overwrites: channel.permission_overwrites,
  };
  for (const field of ["topic", "nsfw", "parent_id", "rate_limit_per_user", "bitrate", "user_limit"] as const) {
    if (channel[field] !== undefined) createBody[field] = channel[field];
  }

  const createRes = await discordApi(env, `/guilds/${channel.guild_id}/channels`, {
    method: "POST",
    body: JSON.stringify(createBody),
  });
  if (!createRes.ok) {
    throw new Error(`creating replacement channel failed: ${createRes.status} ${await createRes.text()}`);
  }
  const newChannel = (await createRes.json()) as { id: string };

  const deleteRes = await discordApi(env, `/channels/${channelId}`, { method: "DELETE" });
  if (!deleteRes.ok) {
    // The replacement already exists at this point, so don't throw here —
    // just log it. Worst case there are briefly two channels instead of one.
    console.error(`Created the replacement but failed to delete the old channel ${channelId}: ${deleteRes.status} ${await deleteRes.text()}`);
  }

  return { oldName: channel.name, newChannelId: newChannel.id };
}

async function handleNukeButton(env: Env, ctx: ExecutionContext, interaction: DiscordInteraction): Promise<Response> {
  if (!isOwner(env, interaction)) return ephemeralReply("Only the bot owner can use this command.");

  const match = (interaction.data?.custom_id ?? "").match(/^nuke_(confirm|cancel)_(\d+)$/);
  if (!match) return ephemeralReply("Something went wrong reading that button.");
  const [, action, channelId] = match;

  if (action === "cancel") {
    return jsonResponse({
      type: 7, // UPDATE_MESSAGE
      data: { content: "Cancelled — nothing was deleted.", components: [] },
    });
  }

  const token = interaction.token;
  if (token) {
    ctx.waitUntil(
      cloneAndDeleteChannel(env, channelId)
        .then(({ oldName, newChannelId }) =>
          editOriginalResponse(env, token, {
            content: `Done — **#${oldName}** was recreated as <#${newChannelId}>.`,
            components: [],
          })
        )
        .catch((err) => {
          console.error(`Nuke failed for channel ${channelId}:`, err.stack || err.message || err);
          return editOriginalResponse(env, token, {
            content: `Nuke failed: ${err.message || err}`,
            components: [],
          });
        })
    );
  }

  return jsonResponse({ type: 6 }); // DEFERRED_UPDATE_MESSAGE — the edit above lands once the clone/delete finishes
}

/* ---------- interaction routing ---------- */

interface DiscordOption {
  name: string;
  value?: string | number;
}

interface DiscordInteraction {
  type: number;
  guild_id?: string;
  channel_id?: string;
  token?: string;
  member?: { user?: { id: string }; roles?: string[] };
  user?: { id: string };
  data?: {
    name?: string;
    options?: DiscordOption[];
    custom_id?: string;
  };
}

function isOwner(env: Env, interaction: DiscordInteraction): boolean {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  return !!userId && !!env.OWNER_USER_ID && userId === env.OWNER_USER_ID;
}

function isMod(env: Env, interaction: DiscordInteraction): boolean {
  return !!env.MOD_ROLE_ID && !!interaction.member?.roles?.includes(env.MOD_ROLE_ID);
}

async function handleCommand(env: Env, interaction: DiscordInteraction): Promise<Response> {
  const name = interaction.data?.name;
  const options = interaction.data?.options ?? [];
  const getOption = (key: string): string | undefined => {
    const v = options.find((o) => o.name === key)?.value;
    return typeof v === "string" ? v : undefined;
  };
  const getIntOption = (key: string): number | undefined => {
    const v = options.find((o) => o.name === key)?.value;
    return typeof v === "number" ? v : undefined;
  };

  switch (name) {
    case "setnickname": {
      if (!isOwner(env, interaction)) return ephemeralReply("Only the bot owner can use this command.");
      const guildId = interaction.guild_id;
      const nickname = getOption("nickname");
      if (!guildId) return ephemeralReply("This command only works inside a server.");
      if (!nickname) return ephemeralReply("Give me a nickname to set.");
      return handleSetNickname(env, guildId, nickname);
    }
    case "setname": {
      if (!isOwner(env, interaction)) return ephemeralReply("Only the bot owner can use this command.");
      const username = getOption("username");
      if (!username) return ephemeralReply("Give me a username to set.");
      return handleSetName(env, username);
    }
    case "setavatar": {
      if (!isOwner(env, interaction)) return ephemeralReply("Only the bot owner can use this command.");
      const url = getOption("url");
      if (!url) return ephemeralReply("Give me an image URL to use.");
      return handleSetAvatar(env, url);
    }
    case "setdescription": {
      if (!isOwner(env, interaction)) return ephemeralReply("Only the bot owner can use this command.");
      const description = getOption("text");
      if (!description) return ephemeralReply("Give me the new description text.");
      return handleSetDescription(env, description);
    }
    case "rules": {
      if (!isOwner(env, interaction)) return ephemeralReply("Only the bot owner can use this command.");
      return handleRulesCommand(env);
    }
    case "clear": {
      if (!isMod(env, interaction)) return ephemeralReply("Only mods can use this command.");
      const channelId = interaction.channel_id;
      if (!channelId) return ephemeralReply("Couldn't tell which channel to clear.");
      const amount = getIntOption("amount") ?? 100;
      return handleClear(env, channelId, amount);
    }
    case "nuke": {
      if (!isOwner(env, interaction)) return ephemeralReply("Only the bot owner can use this command.");
      const channelId = interaction.channel_id;
      if (!channelId) return ephemeralReply("Couldn't tell which channel to nuke.");
      return buildNukeConfirmation(env, channelId);
    }
    case "mine":
    case "sell":
    case "profile":
    case "prestige":
    case "leaderboard":
    case "coinflip":
    case "slots":
    case "daily":
    case "weekly":
    case "monthly":
    case "upgrade":
    case "pethunt":
    case "petlist":
    case "petupgrade":
    case "admin": {
      // All idle-miner game commands share one dispatcher, which reads
      // interaction.data.options itself (flat, same shape as every other
      // command here) rather than going through getOption() above.
      const result = await handleGameCommand(interaction, env);
      return jsonResponse(result);
    }
    case "corp": {
      // /corp keeps its own subcommand-based handler (create/join/leave/
      // info/deposit/withdraw/kick/leaderboard), separate from the flat
      // /mine-family dispatcher above.
      const result = await handleCorpCommand(interaction, env);
      return jsonResponse(result);
    }
    case "crate": {
      const result = await handleCrateCommand(interaction, env);
      return jsonResponse(result);
    }
    case "booster": {
      const result = await handleBoosterCommand(interaction, env);
      return jsonResponse(result);
    }
    default:
      return ephemeralReply("Unknown command.");
  }
}

/* ---------- public info endpoint, for the website's project page ---------- */
/* No secrets are exposed here — just what's already publicly visible on
   the bot's own Discord profile, fetched server-side using the bot
   token so the browser never needs it. */

async function handleInfoRequest(env: Env): Promise<Response> {
  const corsHeaders = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  };

  try {
    const [userRes, commandsRes] = await Promise.all([
      discordApi(env, "/users/@me", { method: "GET" }),
      discordApi(env, `/applications/${env.DISCORD_APPLICATION_ID}/commands`, { method: "GET" }),
    ]);

    if (!userRes.ok) {
      throw new Error(`users/@me failed: ${userRes.status}`);
    }

    const user = (await userRes.json()) as { username: string; id: string; avatar: string | null };
    const commands = commandsRes.ok ? ((await commandsRes.json()) as unknown[]) : [];

    const avatarUrl = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/0.png`;

    return new Response(
      JSON.stringify({
        username: user.username,
        avatarUrl,
        commandCount: commands.length,
        status: "operational",
      }),
      { headers: corsHeaders }
    );
  } catch {
    return new Response(JSON.stringify({ status: "unavailable" }), {
      status: 200,
      headers: corsHeaders,
    });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/info") {
      return handleInfoRequest(env);
    }

    if (request.method !== "POST") {
      return new Response(
        "Dead Pixel's Discord bot is running. Set this Worker's URL as the Interactions Endpoint in the Discord Developer Portal.",
        { status: 200 }
      );
    }

    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");
    const rawBody = await request.clone().arrayBuffer();

    const isValid =
      signature && timestamp && (await verifyKey(rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY));

    if (!isValid) {
      return new Response("Bad request signature.", { status: 401 });
    }

    const interaction = (await request.json()) as DiscordInteraction;

    if (interaction.type === InteractionType.PING) {
      return jsonResponse({ type: InteractionResponseType.PONG });
    }

    if (isDisallowedGuild(env, interaction.guild_id)) {
      ctx.waitUntil(leaveGuild(env, interaction.guild_id));
      return ephemeralReply("This bot isn't available in this server.");
    }

    // Server list feature owns /addserver, /serverlist, their autocomplete,
    // modal submission, and their buttons. It returns null for anything
    // that isn't one of those, so the existing commands below are untouched.
    const serverListResult = await handleServerListInteraction(interaction, env, ctx);
    if (serverListResult) {
      return jsonResponse(serverListResult);
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      return handleCommand(env, interaction);
    }

    if (interaction.type === InteractionType.MESSAGE_COMPONENT && interaction.data?.custom_id?.startsWith("nuke_")) {
      return handleNukeButton(env, ctx, interaction);
    }

    if (interaction.type === InteractionType.MESSAGE_COMPONENT && interaction.data?.custom_id?.startsWith("mine_")) {
      const result = await handleMineButtonClick(interaction, env);
      return jsonResponse(result);
    }

    if (interaction.type === InteractionType.MESSAGE_COMPONENT && interaction.data?.custom_id?.startsWith("upg_pick_")) {
      // Opens the buy-quantity modal — no DB access needed yet.
      const result = await handleUpgradeButtonClick(interaction);
      return jsonResponse(result);
    }

    if (interaction.type === InteractionType.MODAL_SUBMIT && interaction.data?.custom_id?.startsWith("upg_modal_")) {
      const result = await handleUpgradeModalSubmit(interaction, env);
      return jsonResponse(result);
    }

    if (interaction.type === InteractionType.MESSAGE_COMPONENT && interaction.data?.custom_id?.startsWith("crate_open_")) {
      const result = await handleCrateButtonClick(interaction, env);
      return jsonResponse(result);
    }

    if (interaction.type === InteractionType.MESSAGE_COMPONENT && interaction.data?.custom_id?.startsWith("boost_use_")) {
      const result = await handleBoosterButtonClick(interaction, env);
      return jsonResponse(result);
    }

    return jsonResponse({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: "Unsupported interaction type." },
    });
  },
};
