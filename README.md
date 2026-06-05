# Discord Analytics Bot

A public, multi-tenant Discord bot that streams server-event analytics to **PostHog**. Anyone can add it to their server and configure it entirely in-Discord with slash commands.

> [!NOTE]
> Each server routes to its own PostHog project, and the bot never sends or stores message text, only metadata.

## How it works

```
Discord event → handler → captureForGuild() → configured? → event enabled? → bot filter? → sampling? → PostHog project
```

Every event is attached to a `discord_server` group keyed on the guild id, so you can break analytics down per server. Nothing is sent until an admin runs `/analytics setup` and enables event types. Per-guild config (API key, host, enabled events, options) is stored in SQLite, where a client pool keeps one `posthog-node` client per destination.

## Supported events

`message_sent`, `message_edited`, `message_deleted`, `member_joined`, `member_left`, `member_banned`, `reaction_added`, `reaction_removed`, `voice_channel_joined`, `voice_channel_left`, `voice_channel_moved`, `thread_created`, `server_snapshot`. Each carries `guild_*` / `channel_*` metadata, see `src/events-catalog.ts` and the handlers in `src/events/`.

### `server_snapshot`

Discord's _Server Insights_ dashboard isn't exposed to bots, but the flow events above let PostHog reproduce (and exceed) its growth, churn, retention, and activity charts. The one thing gateway events don't give you is *totals at a moment in time*, so `server_snapshot` fills that gap. When enabled, the bot periodically emits one event per server with:

`member_count`, `online_count` (approximate), `channel_count`, `role_count`, `boost_count`, `premium_tier`, `emoji_count`, `sticker_count`.

Graph these in PostHog for "members / online / boosts over time". It's opt-in via `/analytics events` like any other event, fires once on startup for an immediate data point, and only does the per-guild API call when a server has it enabled.

## Slash commands (require the **Manage Server** permission)

| Command | What it does |
|---|---|
| `/analytics setup` | Connect this server to a PostHog project (region + project key, via a modal) |
| `/analytics events` | Choose which events are sent (multi-select) |
| `/analytics options` | Toggle bot filtering and message sampling |
| `/analytics status` | Show the current config (the key is masked) |
| `/analytics test` | Send a test event to verify the connection |
| `/analytics disable` | Stop sending and clear this server's config |
| `/analytics trigger add` | Create a custom-event trigger (see below) |
| `/analytics trigger list` | List this server's triggers (with ids) |
| `/analytics trigger remove <id>` | Delete a trigger |
| `/analytics trigger toggle <id> <enabled>` | Enable/disable a trigger |

The PostHog project API key (`phc_…`) is a publishable, capture-only key (it cannot read data ), so storing it per guild is low-risk.

## Custom event triggers

Beyond the built-in catalog, server admins can define **triggers** When Discord activity matches a rule, the bot emits a **custom-named** PostHog event. Triggers fire independently of whichever built-in events are enabled (they only need the server to be connected via `/analytics setup`).

A trigger has a **source** and optional **conditions** (all conditions must match):

| Source | Fires when… | Conditions |
|---|---|---|
| `message` | a message is posted | `channel`, and one of `contains` / `keywords` / `starts_with` |
| `file` | a message with an attachment is posted | `channel`, `file_ext` (e.g. `pdf,png`) |
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

Matching is simple and case-insensitive (`contains` / `keywords` / `starts_with`). Each server can have **up to 50 triggers**.

## Per-server usage

In any server the bot has joined, an admin runs:

1. `/analytics setup` → choose the `region` (`us` or `eu`) and paste the PostHog **project** API key. The destination is fixed to that PostHog Cloud region. There is no custom/self-hosted host option, so the bot can only ever send to `us.i.posthog.com` or `eu.i.posthog.com`.
2. `/analytics test` → confirm the event lands in PostHog's Activity feed.
3. `/analytics events` → tick the events to track.

## Privacy

- Raw message text is **never** sent to PostHog (only metadata).
- Configuration (including the API key) is only ever shown to admins via **ephemeral** replies, and the key is masked in `/analytics status`.

## Deployment

A `Dockerfile` is included. Mount a volume at `/data` so the SQLite config survives restarts:

```bash
docker build -t discord-posthog-bot .
docker run -d --env-file .env -v $(pwd)/data:/data discord-posthog-bot
```

## Tests

[Vitest](https://vitest.dev) covers the bot end to end at the unit level: trigger matching/evaluation, the capture gates, the SQLite repo, the events catalog, props, the PostHog client pool, the periodic `server_snapshot`, and every Discord event handler (`messages`/`members`/`reactions`/`voice`/`threads`/`ready`). It also covers the interaction layer: the command router's permission gate and dispatch, `setup` region/key validation, `status` key masking, and `trigger add` validation. DB tests run against an in-memory SQLite where Discord and PostHog are mocked, so no network or credentials are needed.

```bash
npm test
npm run test:watch
```

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
