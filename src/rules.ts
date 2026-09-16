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

import type { Env } from "./index";
import { discordApi, ephemeralReply } from "./shared";

function buildRulesEmbed() {
  return {
    title: "📜 Community Rules",
    color: 0x5865f2,
    description:
      "By being in this server, you agree to follow these rules. Breaking them can lead to a warning, mute, kick, or ban at a moderator's discretion.",
    fields: [
      {
        name: "1. Be respectful",
        value:
          "No harassment, hate speech, discrimination, or personal attacks. Disagree without being disrespectful.",
      },
      {
        name: "2. Keep it appropriate",
        value: "No NSFW or gore, and nothing that violates Discord's Terms of Service or Community Guidelines.",
      },
      {
        name: "3. No spam or self-promotion",
        value:
          "No mass-mentions, unsolicited DMs, or advertising other servers/products outside designated channels.",
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
    ],
    footer: { text: "Edit this text in src/rules.ts — this is placeholder wording." },
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
    body: JSON.stringify({ embeds: [buildRulesEmbed()] }),
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
