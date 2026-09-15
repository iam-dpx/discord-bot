import { extractInviteCode, resolveInvite } from './discordApi.js';

// Returns { flag: 'clean' | 'flagged' | 'invalid_invite', reason?: string }
export async function screenSubmission(env, { about, invite_link, game_name, server_name }) {
  const inviteCode = extractInviteCode(invite_link);
  if (!inviteCode) {
    return { flag: 'invalid_invite', reason: 'Link is not a recognizable Discord invite.' };
  }

  const invite = await resolveInvite(inviteCode);
  if (!invite) {
    return { flag: 'invalid_invite', reason: 'Invite is expired, revoked, or invalid.' };
  }

  // Ask a small instruction-following model to flag obvious scam/spam patterns.
  // Keep the prompt narrow and ask for strict JSON so it's easy to parse.
  const prompt = `You are a moderation classifier for a Discord server-listing bot.
Given a submission, decide if it looks like a scam, phishing attempt, or spam
(e.g. fake nitro/gift links, crypto scam wording, impersonation of Discord/Nitro,
unrelated advertising). Legitimate gaming server descriptions are common and fine.

Game: ${game_name}
Server name: ${server_name}
About text: ${about}

Respond with ONLY compact JSON, no other text:
{"scam": true|false, "reason": "short reason, empty string if not a scam"}`;

  let aiResult;
  try {
    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
    });
    const raw = (response.response || '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    aiResult = jsonMatch ? JSON.parse(jsonMatch[0]) : { scam: false, reason: '' };
  } catch (err) {
    // If the AI call fails, fail open but note it — don't block legitimate
    // submissions just because the classifier had a hiccup. Consider logging
    // `err` somewhere (e.g. a Cloudflare Logpush destination) in production.
    aiResult = { scam: false, reason: '' };
  }

  if (aiResult.scam) {
    return { flag: 'flagged', reason: aiResult.reason || 'Flagged by AI screening.' };
  }

  return { flag: 'clean' };
}
