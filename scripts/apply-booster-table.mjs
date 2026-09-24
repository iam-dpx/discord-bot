/*
  scripts/apply-booster-table.mjs
  One-off: creates the player_booster_items table added for the crate/booster
  reward system. Deliberately NOT part of a re-run of schema.sql — schema.sql
  already ran its ALTER TABLE lines against this database, and D1/SQLite
  errors on re-adding a column that already exists, which would abort
  apply-schema.mjs before it ever reached this new table. Same D1 HTTP API
  approach as apply-schema.mjs, so no wrangler is needed.

  This DROPS and recreates the table if it already exists in the OLD
  (booster_tier-based) shape — safe as long as /crate and /booster haven't
  been live yet, since there's nothing real to lose.

  Run:
    CF_API_TOKEN=your_token \
    CF_ACCOUNT_ID=your_account_id \
    CF_D1_DATABASE_ID=your_d1_database_id \
    node scripts/apply-booster-table.mjs
*/

const token = process.env.CF_API_TOKEN;
const accountId = process.env.CF_ACCOUNT_ID;
const databaseId = process.env.CF_D1_DATABASE_ID;

if (!token || !accountId || !databaseId) {
  console.error("Set CF_API_TOKEN, CF_ACCOUNT_ID, and CF_D1_DATABASE_ID environment variables first.");
  process.exit(1);
}

const statements = [
  "DROP TABLE IF EXISTS player_booster_items",
  `CREATE TABLE player_booster_items (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    multiplier REAL NOT NULL,
    duration_minutes INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, multiplier, duration_minutes)
  )`,
];

const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

for (const sql of statements) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ sql }),
  });

  const body = await res.json();

  if (!res.ok || body.success === false) {
    console.error(`Failed running: ${sql}\n`, JSON.stringify(body, null, 2));
    process.exit(1);
  }
}

console.log("player_booster_items table created.");
