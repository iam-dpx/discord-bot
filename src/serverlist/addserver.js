import { getConfig } from './config.js';
import { checkCooldown, recordSubmission } from './cooldown.js';
import { screenSubmission } from './screening.js';
import { sendMessage, memberHasRole } from './discordApi.js';
import { buildApprovalEmbed, buildApprovalComponents } from './embeds.js';
import { searchGameNames } from './gameNames.js';

// Discord calls this as the user types in /addserver's game_name option.
export async function handleAddServerAutocomplete(interaction, env) {
  const focused = interaction.data.options?.find((o) => o.focused);
  const typed = (focused?.value || '').trim();
  const names = await searchGameNames(env.DB, typed);

  return {
    type: 8, // APPLICATION_COMMAND_AUTOCOMPLETE_RESULT
    data: { choices: names.map((name) => ({ name, value: name })) },
  };
}

// Called when the user runs /addserver — game_name already came in as a
// command option (with autocomplete), so it's carried through in the
// modal's custom_id rather than asked again as a text field. Modals can't
// hold select menus or hidden fields, so encoding it in custom_id is the
// simplest way to pass it along to the submit handler below.
export function openAddServerModal(gameName) {
  return {
    type: 9, // MODAL
    data: {
      custom_id: `addserver_modal|${encodeURIComponent(gameName)}`,
      title: `Submit a server — ${gameName}`.slice(0, 45), // Discord caps modal titles at 45 chars
      components: [
        textInputRow('server_name', 'Server name', 1, 100),
        textInputRow('region', 'Region (e.g. asia, eu, na)', 1, 50),
        textInputRow('about', 'About the server', 2, 500),
        textInputRow('invite_link', 'Discord invite link', 1, 200),
      ],
    },
  };
}

function getGameNameFromCustomId(customId) {
  const [, encoded] = customId.split('|');
  return decodeURIComponent(encoded || '');
}

function textInputRow(customId, label, style, maxLength) {
  return {
    type: 1,
    components: [
      {
        type: 4,
        custom_id: customId,
        label,
        style, // 1 = short, 2 = paragraph
        max_length: maxLength,
        required: true,
      },
    ],
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

// Called when the modal is submitted. Discord requires a response within 3s,
// so we defer immediately and do the real work (cooldown, AI screening, D1
// insert, posting to the approval channel) inside ctx.waitUntil.
export function handleAddServerSubmit(interaction, env, ctx) {
  ctx.waitUntil(
    processSubmission(interaction, env).catch(async (err) => {
      console.error('addserver submission failed:', err.stack || err.message || err);
      try {
        await followUp(env, interaction, {
          content: 'Something went wrong processing your submission — please try again, or tell a mod if it keeps happening.',
          flags: 64,
        });
      } catch (followUpErr) {
        console.error('addserver followup also failed:', followUpErr.stack || followUpErr.message || followUpErr);
      }
    })
  );
  return {
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE (ephemeral)
    data: {
      content: 'Got it — checking your submission now. You will see it appear once it clears review.',
      flags: 64, // ephemeral
    },
  };
}

async function processSubmission(interaction, env) {
  const config = getConfig(env);
  const db = env.DB;
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const userName = interaction.member?.user?.username || interaction.user?.username;

  const isMod = memberHasRole(interaction.member, config.modRoleId);

  if (!isMod) {
    const { onCooldown, secondsLeft } = await checkCooldown(db, userId);
    if (onCooldown) {
      // Can't edit the original ephemeral reply here without the interaction
      // token dance; simplest is a DM or a followup message. Followup shown:
      await followUp(env, interaction, {
        content: `You're submitting too often — try again in ${secondsLeft}s.`,
        flags: 64,
      });
      return;
    }
  }

  const gameName = getGameNameFromCustomId(interaction.data.custom_id);

  const server = {
    game_name: gameName,
    server_name: getModalValue(interaction, 'server_name'),
    region: getModalValue(interaction, 'region'),
    about: getModalValue(interaction, 'about'),
    invite_link: getModalValue(interaction, 'invite_link'),
    submitted_by_id: userId,
    submitted_by_name: userName,
  };

  const screening = await screenSubmission(env, server);

  if (screening.flag === 'invalid_invite') {
    await followUp(env, interaction, {
      content: `That invite link doesn't look valid: ${screening.reason}`,
      flags: 64,
    });
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const insertResult = await db
    .prepare(
      `INSERT INTO servers (game_name, server_name, region, about, invite_link, status, submitted_by_id, submitted_by_name, screening_flag, screening_reason, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
    )
    .bind(
      server.game_name,
      server.server_name,
      server.region,
      server.about,
      server.invite_link,
      server.submitted_by_id,
      server.submitted_by_name,
      screening.flag,
      screening.reason || null,
      nowSeconds
    )
    .run();

  const serverId = insertResult.meta.last_row_id;
  if (!isMod) {
    await recordSubmission(db, userId);
  }

  const embed = buildApprovalEmbed({ ...server, id: serverId }, screening);
  const components = buildApprovalComponents(serverId);
  const message = await sendMessage(config.discordToken, config.approvalChannelId, {
    embeds: [embed],
    components,
  });

  await db
    .prepare('UPDATE servers SET approval_message_id = ? WHERE id = ?')
    .bind(message.id, serverId)
    .run();
}

async function followUp(env, interaction, payload) {
  // Followup messages use the interaction token, valid for 15 minutes, and
  // don't require the bot token in the URL — but the endpoint still needs
  // the application id.
  const url = `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`followUp failed: ${res.status} ${await res.text()}`);
  }
}
