const COLOR_CLEAN = 0x57f287; // green
const COLOR_FLAGGED = 0xed4245; // red
const COLOR_APPROVED = 0x5865f2; // blurple

export function buildApprovalEmbed(server, screening) {
  const color = screening.flag === 'clean' ? COLOR_CLEAN : COLOR_FLAGGED;
  const embed = {
    title: `${server.game_name} — ${server.server_name}`,
    description: server.about.slice(0, 1000),
    color,
    fields: [
      { name: 'Region', value: server.region, inline: true },
      { name: 'Submitted by', value: `<@${server.submitted_by_id}>`, inline: true },
      { name: 'Invite', value: server.invite_link, inline: false },
    ],
    footer: { text: `Screening: ${screening.flag}${screening.reason ? ' — ' + screening.reason : ''}` },
  };
  return embed;
}

export function buildApprovalComponents(serverId, disabled = false) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Approve', custom_id: `approve_${serverId}`, disabled },
        { type: 2, style: 4, label: 'Reject', custom_id: `reject_${serverId}`, disabled },
      ],
    },
  ];
}

export function buildPublicEmbed(server) {
  return {
    title: `${server.game_name} — ${server.server_name}`,
    description: server.about.slice(0, 1000),
    color: COLOR_APPROVED,
    fields: [
      { name: 'Region', value: server.region, inline: true },
      { name: 'Invite', value: server.invite_link, inline: false },
    ],
    footer: { text: `Submitted by ${server.submitted_by_name}` },
  };
}

export function buildIndexEmbed(servers, page, totalPages, gameFilter, pageSize) {
  const title = gameFilter ? `Server list — ${gameFilter} (page ${page} of ${totalPages})` : `Server list — page ${page} of ${totalPages}`;
  const lines = servers.map(
    (s, i) => `${(page - 1) * pageSize + i + 1}. ${s.server_name} — ${s.game_name}, ${s.region}`
  );
  return {
    title,
    description: lines.join('\n') || 'No approved servers yet.',
    color: COLOR_APPROVED,
  };
}
