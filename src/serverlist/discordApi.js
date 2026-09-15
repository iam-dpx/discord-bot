const API = 'https://discord.com/api/v10';

function authHeaders(botToken) {
  return {
    Authorization: `Bot ${botToken}`,
    'Content-Type': 'application/json',
  };
}

export async function sendMessage(botToken, channelId, payload) {
  const res = await fetch(`${API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: authHeaders(botToken),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`sendMessage failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function editMessage(botToken, channelId, messageId, payload) {
  const res = await fetch(`${API}/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    headers: authHeaders(botToken),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`editMessage failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function deleteMessage(botToken, channelId, messageId) {
  const res = await fetch(`${API}/channels/${channelId}/messages/${messageId}`, {
    method: 'DELETE',
    headers: authHeaders(botToken),
  });
  // 404 means it's already gone (manually deleted, etc.) — treat as success
  // rather than failing the whole revoke.
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteMessage failed: ${res.status} ${await res.text()}`);
  }
}

// Resolves a Discord invite code (e.g. "abc123" from discord.gg/abc123) so we
// can confirm it actually points at a real, joinable server before approval.
// Authenticated with the bot token deliberately: Cloudflare Workers share
// outbound IPs across many customers, so the unauthenticated version of this
// endpoint can get rate-limited by traffic that has nothing to do with this
// bot. Using the bot token gives it its own per-application rate limit.
export async function resolveInvite(inviteCode, botToken) {
  const res = await fetch(`${API}/invites/${inviteCode}?with_counts=true`, {
    headers: {
      Authorization: `Bot ${botToken}`,
      'User-Agent': 'DiscordBot (dead-pixel-discord-bot, 1.0)',
    },
  });
  if (!res.ok) {
    console.error(`resolveInvite failed for code "${inviteCode}": ${res.status} ${await res.text()}`);
    return null;
  }
  return res.json();
}

export function extractInviteCode(inviteLink) {
  // handles discord.gg/xxx and discord.com/invite/xxx, with or without https://
  const match = inviteLink.match(/discord(?:\.gg|(?:app)?\.com\/invite)\/([a-zA-Z0-9-]+)/);
  return match ? match[1] : null;
}

// Checks whether the member who clicked a button has the mod role.
export function memberHasRole(interactionMember, roleId) {
  return !!interactionMember?.roles?.includes(roleId);
}
