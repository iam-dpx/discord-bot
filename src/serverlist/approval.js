import { getConfig } from './config.js';
import { sendMessage, editMessage, memberHasRole } from './discordApi.js';
import { buildApprovalComponents, buildPublicEmbed } from './embeds.js';

export function handleApprovalButton(interaction, env, ctx) {
  const config = getConfig(env);

  if (!memberHasRole(interaction.member, config.modRoleId)) {
    return {
      type: 4,
      data: { content: "You don't have permission to review submissions.", flags: 64 },
    };
  }

  const [action, serverIdStr] = interaction.data.custom_id.split('_');
  const serverId = parseInt(serverIdStr, 10);

  ctx.waitUntil(resolveSubmission(action, serverId, interaction, env));

  return {
    type: 6, // DEFERRED_UPDATE_MESSAGE — acknowledges the click, keeps the message as-is until we edit it below
  };
}

async function resolveSubmission(action, serverId, interaction, env) {
  const config = getConfig(env);
  const db = env.DB;

  const server = await db.prepare('SELECT * FROM servers WHERE id = ?').bind(serverId).first();
  if (!server || server.status !== 'pending') return; // already resolved or missing

  const nowSeconds = Math.floor(Date.now() / 1000);
  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  await db
    .prepare('UPDATE servers SET status = ?, resolved_at = ? WHERE id = ?')
    .bind(newStatus, nowSeconds, serverId)
    .run();

  // Grey out the buttons on the approval message and note the outcome.
  await editMessage(config.discordToken, config.approvalChannelId, server.approval_message_id, {
    components: buildApprovalComponents(serverId, true),
    content: `**${newStatus.toUpperCase()}** by <@${interaction.member.user.id}>`,
  });

  if (newStatus === 'approved') {
    const embed = buildPublicEmbed(server);
    const publicMessage = await sendMessage(config.discordToken, config.publicChannelId, {
      embeds: [embed],
    });
    await db
      .prepare('UPDATE servers SET public_message_id = ? WHERE id = ?')
      .bind(publicMessage.id, serverId)
      .run();
  }

  // Rejected submissions are silently dropped for now (no DM). Add one here
  // later if you want submitters notified with a reason.
}
