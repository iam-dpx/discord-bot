/*
  shared.ts
  Small helpers used by both index.ts and rules.ts. Pulled out into their
  own file so rules.ts doesn't need to import a function from index.ts
  (which itself imports from rules.ts) — that's a real circular runtime
  import, not just a type one, and easy to get subtly wrong with bundlers.
*/

import type { Env } from "./index";

const DISCORD_API = "https://discord.com/api/v10";
export const EPHEMERAL = 64; // Discord message flag: only the command's caller sees the reply

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function ephemeralReply(content: string): Response {
  return jsonResponse({
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: { content, flags: EPHEMERAL },
  });
}

export async function discordApi(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bot ${env.DISCORD_TOKEN}`,
      "content-type": "application/json",
    },
  });
}
