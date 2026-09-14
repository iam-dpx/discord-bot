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

// Resolves a Discord invite code (e.g. "abc123" from discord.gg/abc123) so we
// can confirm it actually points at a real, joinable server before approval.
export async function resolveInvite(inviteCode) {
  const res = await fetch(`${API}/invites/${inviteCode}?with_counts=true`);
  if (!res.ok) return null; // invalid, expired, or revoked invite
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
