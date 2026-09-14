# Server list feature — integration guide

This adds `/addserver` and `/serverlist` to your existing Dead Pixel bot
without touching your current nickname/avatar customizer code.

## 1. Copy files in

Copy `src/serverlist/` into your existing repo's `src/` folder, and
`schema.sql` + `scripts/register-commands.js` into the repo root.

## 2. Wire it into your existing interaction handler

In whatever file currently receives Discord interactions (likely your
`index.js` / Worker `fetch` handler), import and call it near the top of
your interaction switch, before your existing command handling:

```js
import { handleServerListInteraction } from './serverlist/index.js';

// inside your fetch handler, after verifying the request signature:
const result = await handleServerListInteraction(interaction, env, ctx);
if (result) {
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
}
// ...fall through to your existing command handling for everything else
```

`ctx` here is the Worker's `ExecutionContext` (the third argument to
`fetch(request, env, ctx)`) — needed so the AI screening and Discord API
calls can run in the background via `ctx.waitUntil()` while Discord gets its
required response within 3 seconds.

## 3. Add bindings and vars to wrangler.toml

```toml
[[d1_databases]]
binding = "DB"
database_name = "your-db-name"
database_id = "your-d1-database-id"

[ai]
binding = "AI"

[vars]
APPROVAL_CHANNEL_ID = "put channel id here"
PUBLIC_CHANNEL_ID = "put channel id here"
MOD_ROLE_ID = "put role id here"
```

`DISCORD_TOKEN` should already exist as a secret from your current bot setup
(`npx wrangler secret put DISCORD_TOKEN` if not).

## 4. Create the D1 database (skip if you already have one for this Worker)

```
npx wrangler d1 create your-db-name
```

Copy the `database_id` it prints into `wrangler.toml` above.

## 5. Apply the schema

```
npx wrangler d1 execute your-db-name --remote --file=./schema.sql
```

## 6. Register the two slash commands

```
export DISCORD_APPLICATION_ID=your-app-id
export DISCORD_TOKEN=your-bot-token
export DISCORD_GUILD_ID=your-server-id   # optional, instant for testing
node scripts/register-commands.js
```

## 7. Deploy

```
npx wrangler deploy
```

## Notes / things you may want to adjust

- Rejected submissions are currently silently dropped — no DM to the
  submitter. Add that in `src/serverlist/approval.js` if you want it.
- The AI screening model used is `@cf/meta/llama-3.1-8b-instruct`. If it's
  ever too slow or too loose/strict, swap the model name in
  `src/serverlist/screening.js`.
- The submit cooldown defaults to 300 seconds (5 min) and lives in the
  `bot_settings` D1 table, so you can change it without redeploying:
  ```
  npx wrangler d1 execute your-db-name --remote --command \
    "UPDATE bot_settings SET value = '600' WHERE key = 'submit_cooldown_seconds'"
  ```
- `PAGE_SIZE` (servers per index page) is in `src/serverlist/config.js`.
