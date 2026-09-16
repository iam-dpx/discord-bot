/*
  rules.ts
  Owner-only /rules command. Posts a rules embed to RULES_CHANNEL_ID, and
  deletes the previous rules message first if one exists — so re-running it
  after an edit leaves exactly one rules message in the channel, not a
  growing pile of old versions.

  The message id is remembered in D1's `bot_settings` table (the same
  key/value table the server-list feature already uses), keyed as
  "rules_message_id" — no schema change needed.

  IMPORTANT: the rules text below is a generic placeholder. Edit
  buildRulesEmbed() to match your server's actual rules before relying on
  this.
*/

/*
  rules.ts
  Owner-only /rules command. Posts two embeds to RULES_CHANNEL_ID — Discord's
  own platform-wide rules, and this server's community rules — and deletes
  the previous rules message first if one exists, so re-running it after an
  edit leaves exactly one rules message in the channel, not a growing pile
  of old versions.

  The message id is remembered in D1's `bot_settings` table (the same
  key/value table the server-list feature already uses), keyed as
  "rules_message_id" — no schema change needed.

  IMPORTANT:
  - The "Discord's Official Rules" embed is a paraphrased summary of
    Discord's Community Guidelines (discord.com/guidelines), not the
    verbatim text — Discord's own wording is their copyrighted document,
    and it can also change on their end, so the embed links to the
    official page for the full, current, authoritative text rather than
    trying to keep a copy in sync here.
  - The "Community Rules" embed is a generic baseline built from what most
    Discord servers commonly include (respect, no spam, use the right
    channels, etc.) — genuinely common conventions, not any one server's
    specific rules. Edit buildCommunityRulesEmbed() to match anything
    specific to your server (voice chat conduct, NSFW channel policy if
    you have one, your own enforcement ladder, etc.) before relying on it.
*/

import type { Env } from "./index";
import { discordApi, ephemeralReply } from "./shared";

function buildDiscordRulesEmbed() {
  return {
    title: "📘 Discord's Official Rules",
    color: 0x5865f2, // Discord blurple
    description:
      "These come from Discord itself and apply on every server, not just this one — they're part of Discord's Terms of Service. Full text: https://discord.com/guidelines",
    fields: [
      {
        name: "Respect people",
        value:
          "No hate speech, harassment, threats, or discriminatory conduct based on someone's protected characteristics.",
      },
      {
        name: "Keep people safe",
        value:
          "No doxxing or sharing someone's private info without consent, and no organizing, promoting, or glorifying violence or extremism.",
      },
      {
        name: "Be honest",
        value: "No impersonation, fake profiles, or spreading harmful misinformation.",
      },
      {
        name: "Keep content appropriate",
        value: "No illegal content, and no NSFW/graphic content outside properly age-gated, marked channels.",
      },
      {
        name: "Respect ownership",
        value: "No sharing pirated content, game cheats/hacks, or otherwise violating someone else's IP rights.",
      },
      {
        name: "No spam, scams, or malware",
        value: "No malicious links, phishing, or deceptive/scam content.",
      },
    ],
    footer: { text: "Paraphrased summary — see discord.com/guidelines for the full, authoritative text." },
  };
}

function buildCommunityRulesEmbed() {
  return {
    title: "📜 This Server's Community Rules",
    color: 0x57f287, // green
    description:
      "On top of Discord's own rules above, this server follows these. Breaking them can lead to a warning, mute, kick, or ban at a moderator's discretion.",
    fields: [
      {
        name: "1. Be respectful",
        value: "Disagreement is fine. Personal attacks, insults, and targeted harassment aren't.",
      },
      {
        name: "2. No spam or self-promotion",
        value: "No mass-mentions, unsolicited DMs, or advertising other servers/products outside designated channels.",
      },
      {
        name: "3. Use the right channel",
        value: "Keep topics in the channel they belong in — check channel descriptions if unsure.",
      },
      {
        name: "4. Server list submissions",
        value:
          "Only submit servers via `/addserver` that you actually own or moderate. Scam, spam, or malicious invite links will be rejected and can result in a ban.",
      },
      {
        name: "5. Follow staff instructions",
        value: "Moderator decisions are final. If you disagree, DM a mod instead of arguing in public channels.",
      },
      {
        name: "6. No ban evasion",
        value: "Using an alt account to get around a mute or ban is treated as a separate, bannable offense.",
      },
    ],
    footer: { text: "Placeholder baseline — edit buildCommunityRulesEmbed() in src/rules.ts for your server." },
    timestamp: new Date().toISOString(),
  };
}

export async function handleRulesCommand(env: Env): Promise<Response> {
  const db = env.DB;

  const existing = (await db
    .prepare("SELECT value FROM bot_settings WHERE key = 'rules_message_id'")
    .first()) as { value: string } | null;

  if (existing?.value) {
    // 404 (already deleted manually) is fine — treat as already-clean.
    const delRes = await discordApi(env, `/channels/${env.RULES_CHANNEL_ID}/messages/${existing.value}`, {
      method: "DELETE",
    });
    if (!delRes.ok && delRes.status !== 404) {
      console.error(`Failed to delete old rules message: ${delRes.status} ${await delRes.text()}`);
    }
  }

  const postRes = await discordApi(env, `/channels/${env.RULES_CHANNEL_ID}/messages`, {
    method: "POST",
    body: JSON.stringify({ embeds: [buildDiscordRulesEmbed(), buildCommunityRulesEmbed()] }),
  });

  if (!postRes.ok) {
    return ephemeralReply(`Couldn't post the rules (Discord said: ${postRes.status}).`);
  }

  const message = (await postRes.json()) as { id: string };

  await db
    .prepare(
      `INSERT INTO bot_settings (key, value) VALUES ('rules_message_id', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .bind(message.id)
    .run();

  return ephemeralReply(`Rules posted in <#${env.RULES_CHANNEL_ID}>.`);
}
