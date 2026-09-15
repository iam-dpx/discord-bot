/*
  wipe-servers.mjs
  Clears out all submitted servers and cooldown records — useful after
  testing. Leaves known_games and bot_settings alone since those are
  configuration, not test data.

  Run:
    CF_API_TOKEN=your_token \
    CF_ACCOUNT_ID=your_account_id \
    CF_D1_DATABASE_ID=your_database_id \
    node wipe-servers.mjs
  (or just `node wipe-servers.mjs` if those are already in ~/.bashrc)
*/

const token = process.env.CF_API_TOKEN;
const accountId = process.env.CF_ACCOUNT_ID;
const databaseId = process.env.CF_D1_DATABASE_ID;

if (!token || !accountId || !databaseId) {
  console.error("Set CF_API_TOKEN, CF_ACCOUNT_ID, and CF_D1_DATABASE_ID environment variables first.");
  process.exit(1);
}

const statements = [
  'DELETE FROM servers',
  'DELETE FROM submission_cooldowns',
];

const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

for (const sql of statements) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  });

  const body = await res.json();

  if (!res.ok || body.success === false) {
    console.error(`Failed on: ${sql}\n`, JSON.stringify(body, null, 2));
    process.exit(1);
  }

  console.log(`OK: ${sql}`);
}

console.log('Servers and cooldowns wiped. known_games and bot_settings left untouched.');
