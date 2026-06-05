# Discord → PostHog analytics bot

A public, multi-tenant Discord bot that streams server-event analytics to **PostHog**. Anyone can add it to their server and configure it entirely in-Discord with slash commands — **each server routes to its own PostHog project**. The bot sends **metadata only** and never stores message text.

## How it works

```
Discord event → handler → captureForGuild() → that guild's PostHog project
                                  │
                  gate: configured? event enabled? bot filter? sampling?
```

- **distinct_id** = the Discord user id, so every Discord user becomes a PostHog person (with `discord_username` / `discord_global_name` person properties).
- **Group analytics**: every event is attached to a `discord_server` group keyed on the guild id, so you can break analytics down per server.
- **Nothing is sent until an admin runs `/analytics setup`** and enables event types — a freshly-added server is silent by default.
- Per-guild config (PostHog key, host, enabled events, options) is stored in **SQLite**. A client pool keeps one `posthog-node` client per destination.

## Supported events

`message_sent`, `message_edited`, `message_deleted`, `member_joined`, `member_left`, `member_banned`, `reaction_added`, `reaction_removed`, `voice_channel_joined`, `voice_channel_left`, `voice_channel_moved`, `thread_created`, `server_snapshot`. Each carries `guild_*` / `channel_*` metadata — see `src/events-catalog.ts` and the handlers in `src/events/`.

### `server_snapshot` — point-in-time server totals

Discord's **Server Insights** dashboard isn't exposed to bots, but you don't need it: the flow events above let PostHog reproduce (and exceed) its growth, churn, retention, and activity charts. The one thing gateway events don't give you is *totals at a moment in time*, so `server_snapshot` fills that gap. When enabled, the bot periodically (default **every 24 h**, set `SNAPSHOT_INTERVAL_HOURS`) emits one event per server with:

`member_count`, `online_count` (Discord's approximate counts — no Presence intent needed), `channel_count`, `role_count`, `boost_count`, `premium_tier`, `emoji_count`, `sticker_count`.

Graph these in PostHog for "members / online / boosts over time" — the Insights overview tiles, but trendable. It's opt-in via `/analytics events` like any other event, fires once on startup for an immediate data point, and only does the per-guild API call when a server has it enabled.

## Slash commands (require the **Manage Server** permission)

| Command | What it does |
|---|---|
| `/analytics setup` | Connect this server to a PostHog project (key + host, via a modal) |
| `/analytics events` | Choose which events are sent (multi-select) |
| `/analytics options` | Toggle bot filtering and message sampling |
| `/analytics status` | Show the current config (the key is masked) |
| `/analytics test` | Send a test event to verify the connection |
| `/analytics disable` | Stop sending and clear this server's config |
| `/analytics trigger add` | Create a custom-event trigger (see below) |
| `/analytics trigger list` | List this server's triggers (with ids) |
| `/analytics trigger remove <id>` | Delete a trigger |
| `/analytics trigger toggle <id> <enabled>` | Enable/disable a trigger |

The PostHog **project** API key (`phc_…`) is a publishable, capture-only key — it cannot read data — so storing it per guild is low-risk.

## Custom event triggers

Beyond the built-in catalog, server admins can define **triggers**: when Discord activity matches a rule, the bot emits a **custom-named** PostHog event. Triggers fire independently of which built-in events are enabled (they only need the server to be connected via `/analytics setup`).

A trigger has a **source** and optional **conditions** (all conditions must match):

| Source | Fires when… | Conditions |
|---|---|---|
| `message` | a message is posted | `channel`, and one of `contains` / `keywords` / `starts_with` |
| `file` | a message with an attachment is posted | `channel`, `file_ext` (e.g. `pdf,png`), optional content match |
| `reaction` | a reaction is added | `channel`, `emoji` |
| `member_join` | a user joins | — |
| `voice_join` | a user joins a voice channel | `channel` (the voice channel) |

Examples:

```
# "refund" mentioned in #support → refund_request
/analytics trigger add name:Refunds event_name:refund_request source:message \
    channel:#support contains:refund

# a PDF uploaded to #contracts → contract_uploaded
/analytics trigger add name:Contracts event_name:contract_uploaded source:file \
    channel:#contracts file_ext:pdf

# 🎫 reaction anywhere → ticket_opened
/analytics trigger add name:Tickets event_name:ticket_opened source:reaction emoji:🎫
```

Each fired event carries auto-context: channel info, what matched (`matched_term` / `matched_emoji` / `file_name`), `trigger_name` / `trigger_id` / `trigger_source`, and the acting Discord user as the PostHog person.

**Matching is simple and case-insensitive** (`contains` / `keywords` / `starts_with`) — no regex. **Content, keyword, and file matching require the Message Content intent** (the `trigger add` reply reminds you); channel-only, reaction, member-join, and voice-join triggers work without it. Each server can have up to 50 triggers.

## Setup (self-hosting)

1. **Create the Discord app** at <https://discord.com/developers/applications>:
   - **Bot → Token** → `DISCORD_BOT_TOKEN`
   - **General Information → Application ID** → `DISCORD_APPLICATION_ID`
   - **Bot → Privileged Gateway Intents**: enable **Server Members Intent** (required for join/leave). Enable **Message Content Intent** too if you want `message_length` / mention / attachment counts (see note below).
2. **Invite the bot** with the OAuth2 URL generator — scopes `bot` + `applications.commands`, with read permissions (View Channels, Read Message History) plus Send Messages (for the onboarding hint). Example:
   ```
   https://discord.com/oauth2/authorize?client_id=<DISCORD_APPLICATION_ID>&scope=bot+applications.commands&permissions=68608
   ```
3. **Install & configure:**
   ```bash
   npm install
   cp .env.example .env   # fill in DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID
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

1. `/analytics setup` → paste the PostHog **project** API key and host. Pass the optional `region` choice (`us` / `eu` / `custom`) to pre-fill the host field — `us` (`us.i.posthog.com`) is the default, `eu` is `eu.i.posthog.com`, or leave `custom` to type a self-hosted URL. The key and host must be from the same region (an EU key only works against the EU host).
2. `/analytics test` → confirm the event lands in PostHog's Activity feed.
3. `/analytics events` → tick the events to track.

## Privileged intents (important for a public bot)

Both `GuildMembers` and `MessageContent` are **privileged**. Once the bot is in **100+ servers**, Discord requires the app to be **verified** and these intents approved.

- **`GuildMembers`** is required for `member_joined` / `member_left`.
- **`MessageContent`** is used *only* to derive metadata (length, mention and attachment counts) — never to read or store text. The bot **degrades gracefully** without it: `message_sent` still fires (so per-channel/per-user message counts stay accurate); only the content-derived numbers read as `0`. If you'd rather not request it, leave it disabled.

## Privacy

- Raw message text is **never** sent to PostHog — only metadata.
- Configuration (including the PostHog key) is only ever shown to admins via **ephemeral** replies, and the key is masked in `/analytics status`.

## Deployment

A `Dockerfile` is included. Mount a volume at `/data` so the SQLite config survives restarts:

```bash
docker build -t discord-posthog-bot .
docker run -d --env-file .env -v $(pwd)/data:/data discord-posthog-bot
```

## Tests

[Vitest](https://vitest.dev) covers the bot end to end at the unit level: trigger matching/evaluation, the capture gates, the SQLite repo, the events catalog, props, the PostHog client pool, the periodic `server_snapshot`, every Discord event handler (`messages`/`members`/`reactions`/`voice`/`threads`/`ready`), and the interaction layer — the command router's permission gate and dispatch, `setup` host normalization + key validation, `status` key masking, and `trigger add` validation. DB tests run against an in-memory SQLite; Discord and PostHog are mocked, so no network or credentials are needed.

```bash
npm test          # run once
npm run test:watch
```

Tests live under `tests/`, mirroring the `src/` layout (`tests/events/`, `tests/interactions/`). They're type-checked by `npm run typecheck` but excluded from the build (`tsconfig.build.json`).

## Project layout

```
src/
  config.ts          bot-level env (token, client id, db path)
  db.ts              SQLite schema + per-guild config & triggers repos
  configCache.ts     in-memory config cache (hot path)
  triggersCache.ts   in-memory per-guild triggers cache (hot path)
  events-catalog.ts  canonical list of built-in events
  posthogPool.ts     pooled posthog-node clients per destination
  capture.ts         capture gates (built-in + captureCustomEvent for triggers)
  triggers.ts        trigger matching engine + runners
  snapshots.ts       periodic server_snapshot scheduler
  props.ts           shared guild/channel property builders
  index.ts           client setup, handler wiring, graceful shutdown
  deploy-commands.ts slash-command registration script
  commands/          slash-command definitions
  interactions/      command / modal / select-menu handlers
  events/            Discord gateway event handlers
```
