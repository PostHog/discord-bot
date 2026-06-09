# Deploying the bot

Runs as a systemd service under a dedicated `discordbot` user, from
`/opt/discord-bot`, on any Linux host (these notes assume a [hogland](https://github.com/PostHog/hogland)
microVM, but nothing here is hogland-specific). Node.js 20+ is required.

The flow is: get a Discord app → put the code on the box → fill in `.env` →
install the service → invite the bot. Slash commands register themselves
per-guild on join, so there is **no** command-deploy step.

---

## 1. Create the Discord application

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. **New Application**, then open the **Bot** tab → **Reset Token** and copy it.
   This is `DISCORD_BOT_TOKEN`.
2. **General Information** → copy the **Application ID**. This is
   `DISCORD_APPLICATION_ID`.
3. Still on the **Bot** tab, enable both **privileged intents**:
   - **Server Members Intent**
   - **Message Content Intent**

   The bot requests both (`src/index.ts`); without them it fails to log in.

Keep the token and application ID handy for step 4.

## 2. Provision the host

Create the service account the bot runs as:

```bash
sudo useradd --system --shell /usr/sbin/nologin --no-create-home discordbot
```

## 3. Get the code onto the box and build

Pick **one** of these to land a built copy in `/opt/discord-bot`.

**Option A — clone on the box** (simplest when the box has git + GitHub access):

```bash
git clone git@github.com:PostHog/discord-bot.git ~/discord-bot
cd ~/discord-bot && npm install && npm run build
sudo rsync -a --delete --exclude data ~/discord-bot/ /opt/discord-bot/
```

**Option B — sync from your laptop** (e.g. a hogland box reached over the
tailnet). `--filter=':- .gitignore'` skips ignored files; note this means your
local `.env` is *not* copied — that's intentional, you fill it in on the box in
step 4.

```bash
# hogland: resolve the box's ssh host + port
eval "$(hogland box get <box-id> | jq -r '"PORT=\(.guest_ssh_port) IP=\(.public_ip)"')"

rsync -avz --filter=':- .gitignore' --exclude='.git' \
  -e "ssh -p $PORT" ~/workspace/discord-bot "hog@$IP:~/discord-bot"
# then on the box:
cd ~/discord-bot && npm install && npm run build
sudo rsync -a --delete --exclude data ~/discord-bot/ /opt/discord-bot/
```

`--exclude data` preserves the SQLite database across redeploys.

## 4. Configure the environment

The bot reads `/opt/discord-bot/.env` (via `dotenv`, relative to
`WorkingDirectory`). Create it with the real values from step 1 — an empty file
makes the bot crash-loop with `Missing required environment variable`.

```bash
sudo mkdir -p /opt/discord-bot/data
sudo tee /opt/discord-bot/.env > /dev/null <<'EOF'
DISCORD_BOT_TOKEN=your-real-bot-token
DISCORD_APPLICATION_ID=your-real-application-id
# PostHog Code bridge — both are required; the secret must match PostHog's.
POSTHOG_DISCORD_SHARED_SECRET=your-shared-secret
BOT_ACTIONS_BIND=0.0.0.0:8080
EOF
sudo chmod 600 /opt/discord-bot/.env
sudo chown -R discordbot:discordbot /opt/discord-bot
```

`DATABASE_PATH` is set by the systemd unit below, so it doesn't need to be in
`.env`. See `.env.example` for the full list of variables.

The bot exposes an **actions API** on `BOT_ACTIONS_BIND` that PostHog Code calls
back to drive Discord. PostHog must be able to reach it, so open that port to
PostHog (e.g. a security-group/firewall rule) and front it with TLS — the bridge
authenticates with a bearer secret and relies on TLS for transport security.

## 5. Install and start the service

```bash
sudo tee /etc/systemd/system/discord-bot.service > /dev/null <<'EOL'
[Unit]
Description=Discord analytics bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=discordbot
Group=discordbot
WorkingDirectory=/opt/discord-bot
Environment=NODE_ENV=production
Environment=DATABASE_PATH=/opt/discord-bot/data/bot.sqlite
ExecStart=node dist/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/discord-bot/data

[Install]
WantedBy=multi-user.target
EOL

sudo systemctl daemon-reload
sudo systemctl enable --now discord-bot.service
sudo journalctl -u discord-bot -f
```

You should see `Logged in as <bot> — serving N guild(s).` in the logs.

## 6. Invite the bot to a server

Build an OAuth2 invite URL (Developer Portal → **OAuth2 → URL Generator**, or by
hand). Both scopes are required — `applications.commands` is what makes the
slash commands show up:

```
https://discord.com/oauth2/authorize?client_id=<APP_ID>&scope=bot+applications.commands&permissions=66560
```

`permissions=66560` = **View Channels** + **Read Message History**. Everything
else the bot needs (members, reactions, voice, bans) arrives via gateway
intents, not channel permissions.

On join, the bot registers `/ph` for that guild automatically (instant). When
it's removed from a server, it deletes its stored config for that guild and
Discord drops the commands — no manual cleanup. Then configure it in-server with
`/ph analytics setup` (see the top-level [README](../README.md#per-server-usage)).

> A server that was added *before* auto-registration shipped won't have the
> commands. Kick and re-add the bot once to trigger registration.

---

## Redeploying a new version

Rebuild and sync, keeping the database, then restart:

```bash
cd ~/discord-bot && git pull && npm install && npm run build
sudo rsync -a --delete --exclude data ~/discord-bot/ /opt/discord-bot/
sudo chown -R discordbot:discordbot /opt/discord-bot
sudo systemctl restart discord-bot
sudo journalctl -u discord-bot -f
```

Registered slash commands persist across restarts, so a redeploy needs no
Discord-side action.
