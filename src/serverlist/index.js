import { openAddServerModal, handleAddServerSubmit, handleAddServerAutocomplete } from './addserver.js';
import { handleApprovalButton, handleRejectModalSubmit } from './approval.js';
import {
  handleServerlistCommand,
  handleServerlistAutocomplete,
  handleServerlistPagination,
} from './browse.js';

// Call this from your existing interaction switch, e.g.:
//
//   import { handleServerListInteraction } from './serverlist/index.js';
//   ...
//   const result = await handleServerListInteraction(interaction, env, ctx);
//   if (result) return jsonResponse(result);
//   // ...fall through to your existing command handling
//
// Returns null if the interaction isn't one this feature owns, so your
// existing router can keep handling everything else unchanged.
export async function handleServerListInteraction(interaction, env, ctx) {
  const type = interaction.type;
  const name = interaction.data?.name;
  const customId = interaction.data?.custom_id;

  // Slash commands
  if (type === 2) {
    if (name === 'addserver') {
      const gameOption = interaction.data.options?.find((o) => o.name === 'game_name');
      return openAddServerModal(gameOption?.value || 'Unknown game');
    }
    if (name === 'serverlist') return handleServerlistCommand(interaction, env);
  }

  // Autocomplete while typing the game_name option
  if (type === 4 && name === 'addserver') {
    return handleAddServerAutocomplete(interaction, env);
  }
  if (type === 4 && name === 'serverlist') {
    return handleServerlistAutocomplete(interaction, env);
  }

  // Modal submission from /addserver — custom_id is "addserver_modal|<gameName>"
  if (type === 5 && customId?.startsWith('addserver_modal')) {
    return handleAddServerSubmit(interaction, env, ctx);
  }

  // Modal submission from clicking Reject — custom_id is "reject_modal_<id>"
  if (type === 5 && customId?.startsWith('reject_modal_')) {
    return handleRejectModalSubmit(interaction, env, ctx);
  }

  // Buttons
  if (type === 3 && customId) {
    if (customId.startsWith('approve_') || customId.startsWith('reject_') || customId.startsWith('revoke_')) {
      return handleApprovalButton(interaction, env, ctx);
    }
    if (customId.startsWith('serverlist_page_')) {
      return handleServerlistPagination(interaction, env);
    }
  }

  return null; // not ours — let the existing router handle it
}
