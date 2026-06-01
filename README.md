# Discord → PostHog analytics bot

A public, multi-tenant Discord bot that streams server-event analytics to
**PostHog**. Anyone can add it to their server and configure it entirely
in-Discord with slash commands — **each server routes to its own PostHog
project**. The bot sends **metadata only** and never stores message text.

## How it works

```
Discord event → handler → captureForGuild() → that guild's PostHog project
                                  │
                  gate: configured? event enabled? bot filter? sampling?
```

- **distinct_id** = the Discord user id, so every Discord user becomes a PostHog
  person (with `discord_username` / `discord_global_name` person properties).
- **Group analytics**: every event is attached to a `discord_server` group keyed
  on the guild id, so you can break analytics down per server.
- **Nothing is sent until an admin runs `/analytics setup`** and enables event
  types — a freshly-added server is silent by default.
- Per-guild config (PostHog key, host, enabled events, options) is stored in
  **SQLite**. A client pool keeps one `posthog-node` client per destination.

## Supported events

`message_sent`, `message_edited`, `message_deleted`, `member_joined`,
`member_left`, `member_banned`, `reaction_added`, `reaction_removed`,
`voice_channel_joined`, `voice_channel_left`, `voice_channel_moved`,
`thread_created`. Each carries `guild_*` / `channel_*` metadata — see
`src/events-catalog.ts` and the handlers in `src/events/`.

## Slash commands (require the **Manage Server** permission)

| Command | What it does |
|---|---|
| `/analytics setup` | Connect this server to a PostHog project (key + host, via a modal) |
| `/analytics events` | Choose which events are sent (multi-select) |
| `/analytics options` | Toggle bot filtering and message sampling |
| `/analytics status` | Show the current config (the key is masked) |
| `/analytics test` | Send a test event to verify the connection |
| `/analytics disable` | Stop sending and clear this server's config |

The PostHog **project** API key (`phc_…`) is a publishable, capture-only key —
it cannot read data — so storing it per guild is low-risk.

## Setup (self-hosting)

1. **Create the Discord app** at <https://discord.com/developers/applications>:
   - **Bot → Token** → `DISCORD_TOKEN`
   - **General Information → Application ID** → `DISCORD_CLIENT_ID`
   - **Bot → Privileged Gateway Intents**: enable **Server Members Intent**
     (required for join/leave). Enable **Message Content Intent** too if you want
     `message_length` / mention / attachment counts (see note below).
2. **Invite the bot** with the OAuth2 URL generator — scopes `bot` +
   `applications.commands`, with read permissions (View Channels, Read Message
   History) plus Send Messages (for the onboarding hint). Example:
   ```
   https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&scope=bot+applications.commands&permissions=68608
   ```
3. **Install & configure:**
   ```bash
   npm install
   cp .env.example .env   # fill in DISCORD_TOKEN, DISCORD_CLIENT_ID
   ```
4. **Register the slash commands:**
   ```bash
   # Instant, for one test server:
   npm run deploy-commands -- --guild <your_test_guild_id>
   # Or globally (can take up to ~1h to appear):
   npm run deploy-commands
   ```
5. **Run it:**
   ```bash
   npm run dev      # watch mode
   # or
   npm run build && npm start
   ```

## Per-server usage

In any server the bot has joined, an admin runs:

1. `/analytics setup` → paste the PostHog **project** API key and host
   (defaults to `https://us.i.posthog.com`; use `https://eu.i.posthog.com` for
   EU or your self-hosted URL).
2. `/analytics test` → confirm the event lands in PostHog's Activity feed.
3. `/analytics events` → tick the events to track.

## Privileged intents (important for a public bot)

Both `GuildMembers` and `MessageContent` are **privileged**. Once the bot is in
**100+ servers**, Discord requires the app to be **verified** and these intents
approved.

- **`GuildMembers`** is required for `member_joined` / `member_left`.
- **`MessageContent`** is used *only* to derive metadata (length, mention and
  attachment counts) — never to read or store text. The bot **degrades
  gracefully** without it: `message_sent` still fires (so per-channel/per-user
  message counts stay accurate); only the content-derived numbers read as `0`.
  If you'd rather not request it, leave it disabled.

## Privacy

- Raw message text is **never** sent to PostHog — only metadata.
- Configuration (including the PostHog key) is only ever shown to admins via
  **ephemeral** replies, and the key is masked in `/analytics status`.

## Deployment

A `Dockerfile` is included. Mount a volume at `/data` so the SQLite config
survives restarts:

```bash
docker build -t discord-posthog-bot .
docker run -d --env-file .env -v $(pwd)/data:/data discord-posthog-bot
```

## Project layout

```
src/
  config.ts          bot-level env (token, client id, db path)
  db.ts              SQLite schema + per-guild config repo
  configCache.ts     in-memory config cache (hot path)
  events-catalog.ts  canonical list of supported events
  posthogPool.ts     pooled posthog-node clients per destination
  capture.ts         the capture gate (configured? enabled? filtered?)
  props.ts           shared guild/channel property builders
  index.ts           client setup, handler wiring, graceful shutdown
  deploy-commands.ts slash-command registration script
  commands/          slash-command definitions
  interactions/      command / modal / select-menu handlers
  events/            Discord gateway event handlers
```
