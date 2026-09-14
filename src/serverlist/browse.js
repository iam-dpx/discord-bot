import { PAGE_SIZE } from './config.js';
import { buildIndexEmbed } from './embeds.js';

function getOption(interaction, name) {
  const opt = interaction.data.options?.find((o) => o.name === name);
  return opt ? opt.value : null;
}

// Discord calls this as the user types in the game_name option.
export async function handleServerlistAutocomplete(interaction, env) {
  const focused = interaction.data.options?.find((o) => o.focused);
  const typed = (focused?.value || '').trim();

  const rows = await env.DB
    .prepare(
      `SELECT DISTINCT game_name FROM servers WHERE status = 'approved' AND game_name LIKE ? ORDER BY game_name LIMIT 25`
    )
    .bind(`%${typed}%`)
    .all();

  return {
    type: 8, // APPLICATION_COMMAND_AUTOCOMPLETE_RESULT
    data: {
      choices: rows.results.map((r) => ({ name: r.game_name, value: r.game_name })),
    },
  };
}

export async function handleServerlistCommand(interaction, env) {
  const gameFilter = getOption(interaction, 'game_name');
  const embed = await buildIndexPage(env.DB, 1, gameFilter);

  return {
    type: 4,
    data: {
      embeds: [embed.embed],
      components: buildPaginationComponents(1, embed.totalPages, gameFilter),
    },
  };
}

// Previous/Next button clicks on the index message.
export async function handleServerlistPagination(interaction, env) {
  // custom_id shape: serverlist_page_<pageNumber>_<gameFilterOrDash>
  const parts = interaction.data.custom_id.split('_');
  const page = parseInt(parts[2], 10);
  const gameFilter = parts[3] === '-' ? null : decodeURIComponent(parts[3]);

  const embed = await buildIndexPage(env.DB, page, gameFilter);

  return {
    type: 7, // UPDATE_MESSAGE
    data: {
      embeds: [embed.embed],
      components: buildPaginationComponents(page, embed.totalPages, gameFilter),
    },
  };
}

async function buildIndexPage(db, page, gameFilter) {
  const whereClause = gameFilter ? "WHERE status = 'approved' AND game_name = ?" : "WHERE status = 'approved'";
  const countRow = gameFilter
    ? await db.prepare(`SELECT COUNT(*) as n FROM servers ${whereClause}`).bind(gameFilter).first()
    : await db.prepare(`SELECT COUNT(*) as n FROM servers ${whereClause}`).first();

  const totalPages = Math.max(1, Math.ceil(countRow.n / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * PAGE_SIZE;

  const query = `SELECT * FROM servers ${whereClause} ORDER BY server_name LIMIT ? OFFSET ?`;
  const rows = gameFilter
    ? await db.prepare(query).bind(gameFilter, PAGE_SIZE, offset).all()
    : await db.prepare(query).bind(PAGE_SIZE, offset).all();

  return {
    embed: buildIndexEmbed(rows.results, safePage, totalPages, gameFilter, PAGE_SIZE),
    totalPages,
  };
}

function buildPaginationComponents(page, totalPages, gameFilter) {
  const filterPart = gameFilter ? encodeURIComponent(gameFilter) : '-';
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: 'Previous',
          custom_id: `serverlist_page_${page - 1}_${filterPart}`,
          disabled: page <= 1,
        },
        {
          type: 2,
          style: 2,
          label: 'Next',
          custom_id: `serverlist_page_${page + 1}_${filterPart}`,
          disabled: page >= totalPages,
        },
      ],
    },
  ];
}
