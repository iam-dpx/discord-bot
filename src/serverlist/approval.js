import { getConfig } from './config.js';
import { sendMessage, sendDM, editMessage, deleteMessage, memberHasRole } from './discordApi.js';
import { buildRevokeComponents, buildPublicEmbed } from './embeds.js';

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

  // Reject needs to collect a reason first, so it shows a modal directly —
  // modals can only be returned as the immediate response to an
  // interaction, never after a defer. Approve/Revoke have nothing to ask,
  // so they defer and do the real work in the background as before.
  if (action === 'reject') {
    return openRejectReasonModal(serverId);
  }

  ctx.waitUntil(
    resolveAction(action, serverId, interaction, env).catch((err) => {
      console.error(`${action} action failed for server ${serverId}:`, err.stack || err.message || err);
    })
  );

  return {
    type: 6, // DEFERRED_UPDATE_MESSAGE — acknowledges the click, keeps the message as-is until we edit it below
  };
}

function openRejectReasonModal(serverId) {
  return {
    type: 9, // MODAL
    data: {
      custom_id: `reject_modal_${serverId}`,
      title: 'Reject submission',
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: 'reason',
              label: 'Reason (optional — sent to the submitter)',
              style: 2, // paragraph
              max_length: 300,
              required: false,
            },
          ],
        },
      ],
    },
  };
}

function getModalValue(interaction, customId) {
  for (const row of interaction.data.components) {
    for (const comp of row.components) {
      if (comp.custom_id === customId) return comp.value.trim();
    }
  }
  return '';
}

// Called when the reject-reason modal is submitted.
export function handleRejectModalSubmit(interaction, env, ctx) {
  const config = getConfig(env);
  if (!memberHasRole(interaction.member, config.modRoleId)) {
    return { type: 4, data: { content: "You don't have permission to review submissions.", flags: 64 } };
  }

  const serverId = parseInt(interaction.data.custom_id.split('_')[2], 10);
  const reason = getModalValue(interaction, 'reason');

  ctx.waitUntil(
    resolveReject(serverId, interaction, env, reason).catch((err) => {
      console.error(`reject action failed for server ${serverId}:`, err.stack || err.message || err);
    })
  );

  return {
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE (ephemeral) — modal submissions can't defer-update a different message
    data: { content: 'Rejected.', flags: 64 },
  };
}

async function resolveAction(action, serverId, interaction, env) {
  if (action === 'revoke') return resolveRevoke(serverId, interaction, env);
  return resolveApprove(serverId, interaction, env);
}

async function resolveApprove(serverId, interaction, env) {
  const config = getConfig(env);
  const db = env.DB;

  const server = await db.prepare('SELECT * FROM servers WHERE id = ?').bind(serverId).first();
  if (!server || server.status !== 'pending') return; // already resolved or missing

  const nowSeconds = Math.floor(Date.now() / 1000);
  const modId = interaction.member.user.id;

  await db
    .prepare('UPDATE servers SET status = ?, resolved_at = ? WHERE id = ?')
    .bind('approved', nowSeconds, serverId)
    .run();

  const embed = buildPublicEmbed(server);
  const publicMessage = await sendMessage(config.discordToken, config.publicChannelId, {
    embeds: [embed],
  });
  await db
    .prepare('UPDATE servers SET public_message_id = ? WHERE id = ?')
    .bind(publicMessage.id, serverId)
    .run();

  // Swap to a live Revoke button instead of just greying out — lets a mod
  // pull the listing later if the server goes offline. Kept (not deleted)
  // since it's still a live control, unlike reject/revoke which are final.
  await editMessage(config.discordToken, config.approvalChannelId, server.approval_message_id, {
    components: buildRevokeComponents(serverId),
    content: `**APPROVED** by <@${modId}>`,
  });
}

async function resolveReject(serverId, interaction, env, reason) {
  const config = getConfig(env);
  const db = env.DB;

  const server = await db.prepare('SELECT * FROM servers WHERE id = ?').bind(serverId).first();
  if (!server || server.status !== 'pending') return; // already resolved or missing

  const nowSeconds = Math.floor(Date.now() / 1000);

  await db
    .prepare('UPDATE servers SET status = ?, resolved_at = ? WHERE id = ?')
    .bind('rejected', nowSeconds, serverId)
    .run();

  if (server.approval_message_id) {
    await deleteMessage(config.discordToken, config.approvalChannelId, server.approval_message_id);
  }

  try {
    await sendDM(config.discordToken, server.submitted_by_id, {
      content:
        `Your server submission **${server.server_name}** (${server.game_name}) was rejected.` +
        (reason ? `\nReason: ${reason}` : ''),
    });
  } catch (err) {
    // DMs fail often and for reasons outside our control (closed DMs, bot
    // blocked, no mutual server) — never let that break the rejection itself.
    console.error(`Couldn't DM rejection to ${server.submitted_by_id}:`, err.stack || err.message || err);
  }
}

async function resolveRevoke(serverId, interaction, env) {
  const config = getConfig(env);
  const db = env.DB;

  const server = await db.prepare('SELECT * FROM servers WHERE id = ?').bind(serverId).first();
  if (!server || server.status !== 'approved') return; // not currently live, nothing to revoke

  if (server.public_message_id) {
    await deleteMessage(config.discordToken, config.publicChannelId, server.public_message_id);
  }

  await db.prepare('DELETE FROM servers WHERE id = ?').bind(serverId).run();

  if (server.approval_message_id) {
    await deleteMessage(config.discordToken, config.approvalChannelId, server.approval_message_id);
  }
}
