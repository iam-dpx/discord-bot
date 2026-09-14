import { openAddServerModal, handleAddServerSubmit } from './addserver.js';
import { handleApprovalButton } from './approval.js';
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
    if (name === 'addserver') return openAddServerModal();
    if (name === 'serverlist') return handleServerlistCommand(interaction, env);
  }

  // Autocomplete while typing the game_name option
  if (type === 4 && name === 'serverlist') {
    return handleServerlistAutocomplete(interaction, env);
  }

  // Modal submission from /addserver
  if (type === 5 && customId === 'addserver_modal') {
    return handleAddServerSubmit(interaction, env, ctx);
  }

  // Buttons
  if (type === 3 && customId) {
    if (customId.startsWith('approve_') || customId.startsWith('reject_')) {
      return handleApprovalButton(interaction, env, ctx);
    }
    if (customId.startsWith('serverlist_page_')) {
      return handleServerlistPagination(interaction, env);
    }
  }

  return null; // not ours — let the existing router handle it
}
