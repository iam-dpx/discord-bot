// Fill these in (or set as Worker secrets/vars in wrangler.toml — recommended
// for the channel/role IDs since they're not sensitive but do vary by server).
//
// wrangler.toml example:
//   [vars]
//   APPROVAL_CHANNEL_ID = "123..."
//   PUBLIC_CHANNEL_ID   = "456..."
//   MOD_ROLE_ID         = "789..."

export function getConfig(env) {
  return {
    approvalChannelId: env.APPROVAL_CHANNEL_ID,
    publicChannelId: env.PUBLIC_CHANNEL_ID,
    modRoleId: env.MOD_ROLE_ID,
    discordToken: env.DISCORD_TOKEN, // bot token, used for REST calls (not the public key)
  };
}

export const DEFAULT_COOLDOWN_SECONDS = 300; // 5 minutes, overridden by bot_settings table

export const PAGE_SIZE = 5; // servers per page in the compact index
