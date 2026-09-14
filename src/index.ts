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

export interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
}

const DISCORD_API = "https://discord.com/api/v10";
const EPHEMERAL = 64; // Discord message flag: only the command's caller sees the reply

/* ---------- small helpers ---------- */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function ephemeralReply(content: string): Response {
  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: EPHEMERAL },
  });
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

async function discordApi(env: Env, path: string, init: RequestInit): Promise<Response> {
  return fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bot ${env.DISCORD_TOKEN}`,
      "content-type": "application/json",
    },
  });
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

/* ---------- interaction routing ---------- */

interface DiscordOption {
  name: string;
  value?: string;
}

interface DiscordInteraction {
  type: number;
  guild_id?: string;
  data?: {
    name?: string;
    options?: DiscordOption[];
  };
}

async function handleCommand(env: Env, interaction: DiscordInteraction): Promise<Response> {
  const name = interaction.data?.name;
  const options = interaction.data?.options ?? [];
  const getOption = (key: string): string | undefined =>
    options.find((o) => o.name === key)?.value;

  switch (name) {
    case "setnickname": {
      const guildId = interaction.guild_id;
      const nickname = getOption("nickname");
      if (!guildId) return ephemeralReply("This command only works inside a server.");
      if (!nickname) return ephemeralReply("Give me a nickname to set.");
      return handleSetNickname(env, guildId, nickname);
    }
    case "setname": {
      const username = getOption("username");
      if (!username) return ephemeralReply("Give me a username to set.");
      return handleSetName(env, username);
    }
    case "setavatar": {
      const url = getOption("url");
      if (!url) return ephemeralReply("Give me an image URL to use.");
      return handleSetAvatar(env, url);
    }
    case "setdescription": {
      const description = getOption("text");
      if (!description) return ephemeralReply("Give me the new description text.");
      return handleSetDescription(env, description);
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
  async fetch(request: Request, env: Env): Promise<Response> {
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

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      return handleCommand(env, interaction);
    }

    return jsonResponse({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: "Unsupported interaction type." },
    });
  },
};
