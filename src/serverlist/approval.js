import { getConfig } from './config.js';
import { sendMessage, editMessage, deleteMessage, memberHasRole } from './discordApi.js';
import { buildApprovalComponents, buildRevokeComponents, buildPublicEmbed } from './embeds.js';

// Handles clicks on Approve, Reject (both on a pending submission), and
// Revoke (shown in place of those two once a submission is approved).
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

  ctx.waitUntil(
    resolveAction(action, serverId, interaction, env).catch((err) => {
      console.error(`${action} action failed for server ${serverId}:`, err.stack || err.message || err);
    })
  );

  return {
    type: 6, // DEFERRED_UPDATE_MESSAGE — acknowledges the click, keeps the message as-is until we edit it below
  };
}

async function resolveAction(action, serverId, interaction, env) {
  if (action === 'revoke') return resolveRevoke(serverId, interaction, env);
  return resolveApproveReject(action, serverId, interaction, env);
}

async function resolveApproveReject(action, serverId, interaction, env) {
  const config = getConfig(env);
  const db = env.DB;

  const server = await db.prepare('SELECT * FROM servers WHERE id = ?').bind(serverId).first();
  if (!server || server.status !== 'pending') return; // already resolved or missing

  const nowSeconds = Math.floor(Date.now() / 1000);
  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  const modId = interaction.member.user.id;

  await db
    .prepare('UPDATE servers SET status = ?, resolved_at = ? WHERE id = ?')
    .bind(newStatus, nowSeconds, serverId)
    .run();

  if (newStatus === 'approved') {
    const embed = buildPublicEmbed(server);
    const publicMessage = await sendMessage(config.discordToken, config.publicChannelId, {
      embeds: [embed],
    });
    await db
      .prepare('UPDATE servers SET public_message_id = ? WHERE id = ?')
      .bind(publicMessage.id, serverId)
      .run();

    // Swap to a live Revoke button instead of just greying out — lets a mod
    // pull the listing later if the server goes offline.
    await editMessage(config.discordToken, config.approvalChannelId, server.approval_message_id, {
      components: buildRevokeComponents(serverId),
      content: `**APPROVED** by <@${modId}>`,
    });
  } else {
    // Rejected submissions are silently dropped for now (no DM). Add one
    // here later if you want submitters notified with a reason.
    await editMessage(config.discordToken, config.approvalChannelId, server.approval_message_id, {
      components: buildApprovalComponents(serverId, true),
      content: `**REJECTED** by <@${modId}>`,
    });
  }
}

async function resolveRevoke(serverId, interaction, env) {
  const config = getConfig(env);
  const db = env.DB;

  const server = await db.prepare('SELECT * FROM servers WHERE id = ?').bind(serverId).first();
  if (!server || server.status !== 'approved') return; // not currently live, nothing to revoke

  const modId = interaction.member.user.id;

  if (server.public_message_id) {
    await deleteMessage(config.discordToken, config.publicChannelId, server.public_message_id);
  }

  await db.prepare('DELETE FROM servers WHERE id = ?').bind(serverId).run();

  await editMessage(config.discordToken, config.approvalChannelId, server.approval_message_id, {
    components: buildRevokeComponents(serverId, true),
    content: `**REVOKED** by <@${modId}> (previously approved — removed from the database)`,
  });
}
