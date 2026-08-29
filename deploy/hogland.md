# Deploying the bot

Runs as a systemd service under a dedicated `discordbot` user, from
`/opt/discord-bot`, on any Linux host (these notes assume a [hogland](https://github.com/PostHog/hogland) microVM, but nothing here is hogland-specific).

## Create the Discord application

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. **New Application**, then open the **Bot** tab → **Reset Token** and copy it.
   This is `DISCORD_BOT_TOKEN`.
2. **General Information** → copy the **Application ID**. This is
   `DISCORD_APPLICATION_ID`.
3. Still on the **Bot** tab, enable both **privileged intents**:
   - **Server Members Intent**
   - **Message Content Intent**

   The bot requests both (`src/index.ts`), and without them it fails to log in.

Keep the token and application ID handy for step 4.

## Provision the host

### Create the service account the bot runs as:

```bash
sudo apt update && sudo apt install -y nano wget build-essential ca-certificates curl
sudo useradd --system --shell /usr/sbin/nologin --no-create-home discordbot
```

### Install Docker

```bash
# Add Docker's official GPG key:
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to apt sources:
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update

# Install and verify:
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### Install Flox

```bash
# Intel/AMD
wget https://downloads.flox.dev/by-env/stable/deb/flox-1.12.2.x86_64-linux.deb

# or ARM
wget https://downloads.flox.dev/by-env/stable/deb/flox-1.12.2.aarch64-linux.deb

sudo apt install ./flox-1.12.2.x86_64-linux.deb
```

### Install the 1Password CLI

```bash
curl -sS https://downloads.1password.com/linux/keys/1password.asc | \
  sudo gpg --dearmor --output /usr/share/keyrings/1password-archive-keyring.gpg && \
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/$(dpkg --print-architecture) stable main" | \
  sudo tee /etc/apt/sources.list.d/1password.list && \
  sudo mkdir -p /etc/debsig/policies/AC2D62742012EA22/ && \
  curl -sS https://downloads.1password.com/linux/debian/debsig/1password.pol | \
  sudo tee /etc/debsig/policies/AC2D62742012EA22/1password.pol && \
  sudo mkdir -p /usr/share/debsig/keyrings/AC2D62742012EA22 && \
  curl -sS https://downloads.1password.com/linux/keys/1password.asc | \
  sudo gpg --dearmor --output /usr/share/debsig/keyrings/AC2D62742012EA22/debsig.gpg && \
  sudo apt update && sudo apt install 1password-cli
```

## Get the code onto the box and build

Pick **one** of these to land a built copy in `/opt/discord-bot`.

**Option A: clone on the box** (simplest when the box has git + GitHub access):

```bash
git clone git@github.com:PostHog/discord-bot.git ~/discord-bot
cd ~/discord-bot && npm install && npm run build
sudo rsync -a --delete --exclude data --exclude .env ~/discord-bot/ /opt/discord-bot/
```

**Option B: sync from your laptop** (e.g. a hogland box reached over the
tailnet). `--filter=':- .gitignore'` skips ignored files; note this means your
local `.env` is *not* copied that's intentional, you fill it in on the box in
step 4.

```bash
# hogland: resolve the box's ssh host + port
eval "$(hogland box get <box-id> | jq -r '"PORT=\(.guest_ssh_port) IP=\(.public_ip)"')"

rsync -avz --filter=':- .gitignore' --exclude='.git' \
  -e "ssh -p $PORT" ~/workspace/discord-bot "hog@$IP:~/"

# then on the box
cd ~/discord-bot && npm install && npm run build
sudo rsync -a --delete --exclude data --exclude .env ~/discord-bot/ /opt/discord-bot/
```

`--exclude data` preserves the SQLite database across redeploys, and
`--exclude .env` preserves the secrets file — without it `--delete` removes
`/opt/discord-bot/.env` (the source tree has no `.env`, by design) and the
service crash-loops on `Missing required environment variable`.

## 4. Configure the environment

The bot reads `/opt/discord-bot/.env` (via `dotenv`, relative to
`WorkingDirectory`). Create it with the real values from step 1 an empty file
makes the bot crash-loop with `Missing required environment variable`.

```bash
sudo mkdir -p /opt/discord-bot/data
sudo tee /opt/discord-bot/.env > /dev/null <<'EOF'
DISCORD_APPLICATION_ID=
DISCORD_CLIENT_SECRET=
DISCORD_PUBLIC_KEY=
DISCORD_BOT_TOKEN=

POSTHOG_DISCORD_SHARED_SECRET=
BOT_ACTIONS_BIND=127.0.0.1:8129
POSTHOG_BRIDGE_BASE_URL=http://127.0.0.1:8000
EOF
sudo chmod 600 /opt/discord-bot/.env
sudo chown -R discordbot:discordbot /opt/discord-bot/
```

`DATABASE_PATH` is set by the systemd unit below, so it doesn't need to be in
`.env`. See `.env.example` for the full list of variables.

The bot exposes an **actions API** on `BOT_ACTIONS_BIND` that PostHog Code calls
back to drive Discord. PostHog must be able to reach it, so open that port to
PostHog (e.g. a security-group/firewall rule) and front it with TLS the bridge
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

You should see `Logged in as <bot> serving N guild(s).` in the logs.

## 6. Invite the bot to a server

Build an OAuth2 invite URL (Developer Portal → **OAuth2 → URL Generator**, or by
hand). Both scopes are required `applications.commands` is what makes the
slash commands show up:

```
https://discord.com/oauth2/authorize?client_id=<APP_ID>&scope=bot+applications.commands&permissions=326417599552
```

`permissions=326417599552` covers what the bridge actions API needs to act in a
channel: **View Channels**, **Read Message History**, **Send Messages**, **Send
Messages in Threads**, **Create Public Threads**, **Add Reactions**, and **Embed
Links**. (Add **Manage Messages** only if PostHog will delete *other* users'
messages; the bot needs nothing extra to delete its own. Add **Attach Files** to
upload files.) Easiest is to tick these boxes in the URL Generator and let it
compute the integer.

Analytics needs far less: member joins/leaves/bans and voice states arrive
guild-wide over the gateway intents, no channel permission involved. Message,
reaction, and thread events are different — the gateway only delivers those for
channels the bot can **View Channel** on, so a private channel the bot isn't in
is simply absent from your analytics rather than partially captured.

Forum forwarding (`/ph forums watch`) relies on **View Channel** + **Send
Messages in Threads** on the watched forum both are in the set above, but make
sure a per-channel override on that forum doesn't remove them.

The **account-link** flow is a separate OAuth authorization PostHog initiates per
user (`DISCORD_APP_CLIENT_ID`/`SECRET`), using only the `identify` scope it is
not part of this invite URL.

On join, the bot registers `/ph` for that guild automatically (instant). When
it's removed from a server, it deletes its stored config for that guild and
Discord drops the commands no manual cleanup. Then configure it in-server with
`/ph connect` (see the top-level [README](../README.md#per-server-usage)).

> A server that was added *before* auto-registration shipped won't have the
> commands. Kick and re-add the bot once to trigger registration.

---

## Redeploying a new version

Rebuild and sync, keeping the database, then restart:

```bash
cd ~/discord-bot && git pull && npm install && npm run build
sudo rsync -a --delete --exclude data --exclude .env ~/discord-bot/ /opt/discord-bot/
sudo chown -R discordbot:discordbot /opt/discord-bot
sudo systemctl restart discord-bot
sudo journalctl -u discord-bot -f
```

Registered slash commands persist across restarts, so a redeploy needs no
Discord-side action.
