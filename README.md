<!--
  README.md
  Dead Pixel — Discord customizer bot
  Written by Dead Pixel (iamreal.dpx@gmail.com)
-->
# Dead Pixel — Discord Customizer Bot

Slash commands that let a server customize the bot:

- `/setnickname <name>` — changes the bot's nickname **in that server only**.
  Anyone with "Manage Nicknames" can run it.
- `/setname <name>` — changes the bot's **username everywhere** it's added
  (admin-only by default). Discord limits this to ~2 changes per hour.
- `/setavatar <url>` — changes the bot's **avatar everywhere** it's added
  (admin-only by default). Discord limits this to roughly once per 10
  minutes.
- `/setdescription <text>` — changes the bot's "About Me" text (shown on
  its Discord profile), **everywhere** it's added (admin-only by
  default). No gateway connection needed for this one.

Runs on Cloudflare Workers using Discord's HTTP Interactions model — no
always-on server, no gateway connection. Discord POSTs each slash command
straight to this Worker's URL.

## One-time setup

**Important: this can't be deployed with `wrangler` from Termux.** Wrangler
depends on `workerd` (Cloudflare's actual runtime), which ships native
binaries for Linux/macOS/Windows only — not Android. `npm install` will
fail with `Unsupported platform: android arm64` no matter what. Use
Cloudflare's Git-based deploy instead — it builds and deploys on
Cloudflare's own servers, so your phone never needs to run `workerd` at
all. This is the same approach already used for the Pages site, just for
Workers instead.

### 1. Create the Discord application

1. Go to `https://discord.com/developers/applications` → **New Application**
2. Under **Bot**, click **Reset Token** and save the token somewhere safe
   (you can't view it again later)
3. From **General Information**, copy the **Application ID** and
   **Public Key**

### 2. Push this project to its own new GitHub repo

This needs a repo separate from `website` — Workers and Pages are
different Cloudflare products, each connected to its own repo.
```
cd ~/discord-bot
git init
git remote add origin https://github.com/YOUR_USERNAME/discord-bot.git
git add .
git commit -m "Initial Discord bot"
git branch -M main
git push -u origin main
```

### 3. Connect the repo in the Cloudflare dashboard

1. In the Cloudflare dashboard: **Workers & Pages** → **Create** →
   **Workers** → **Connect GitHub** (authorize it the first time)
2. Select the `discord-bot` repo → **Deploy**
3. Cloudflare runs `npm install` and deploys automatically — no local
   build needed

### 4. Set the secrets (via the dashboard, not the CLI)

In the deployed Worker's page: **Settings** → **Variables and Secrets**
→ add each of these as an **encrypted** variable:
- `DISCORD_TOKEN`
- `DISCORD_PUBLIC_KEY`
- `DISCORD_APPLICATION_ID`

Save — Cloudflare redeploys automatically after secrets change.

### 5. Set the Interactions Endpoint URL

Your Worker's URL is shown at the top of its dashboard page (something
like `https://dead-pixel-discord-bot.<your-subdomain>.workers.dev`).
Back in the Discord Developer Portal → your app → **General Information**
→ **Interactions Endpoint URL** → paste it → **Save Changes**. Discord
immediately sends a test ping — if the Worker is deployed and the
secrets are set correctly, this succeeds automatically.

### 6. Register the slash commands

This one small script still needs to run somewhere with plain Node (not
Wrangler) — Termux's regular `node` works fine for this, since it's
just a `fetch` call, no `workerd` involved:
```
cd ~/discord-bot
DISCORD_TOKEN=your_token DISCORD_APPLICATION_ID=your_app_id node register.mjs
```

### 7. Invite the bot to a server

Build an invite link (replace `YOUR_APP_ID`) — the `permissions` value
below (`67108864`) is Discord's **Change Nickname** permission, which the
bot needs to change its own nickname per server. Without it, `/setnickname`
returns a 403 even with a valid token:
```
https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot%20applications.commands&permissions=67108864
```
Open it, pick a server, authorize. The slash commands should now show up.

## Updating the bot later

```
cd ~/discord-bot
git add .
git commit -m "update"
git push
```
Cloudflare redeploys automatically on push — same flow as the website.
If you change the commands themselves (names, options), also re-run the
register script from step 6.

## Live status on the website

The `/info` endpoint on this Worker (e.g.
`https://dead-pixel-discord-bot.<your-subdomain>.workers.dev/info`)
returns the bot's public username, avatar, and command count as JSON —
this is what powers the "Live status" panel on the site's
`discord-bot.html` page. Once deployed, send that URL over so it can be
wired into the site (currently a placeholder in
`src/discord-bot-status.ts`).

## Known limitations (Discord's rules, not this code's)

- `/setname` and `/setavatar` affect the bot **globally** — every server
  it's in sees the change, not just the one where the command ran.
- No live custom status (e.g. "Playing Minecraft"), no green "online" dot,
  and no rich presence — all three require a persistent gateway
  connection, which Cloudflare Workers doesn't support. Deliberately
  staying Workers-only (free, no server to maintain) rather than adding
  an always-on host for these.
