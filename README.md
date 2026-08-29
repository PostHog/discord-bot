# Discord Analytics Bot

A public, multi-tenant Discord bot that streams server-event analytics to **PostHog** and bridges Discord to **PostHog Code** via the `/ph` command. Anyone can add it to their server and configure it entirely in-Discord with slash commands.

> [!NOTE]
> Each server routes to its own PostHog project. Analytics sends only metadata by default; message text is sent only if an admin explicitly opts in via `/ph analytics options`. The other place content leaves Discord is forum channels an admin opts into via `/ph forums watch` (for the PostHog Code bridge).

## How it works

```
Discord event → handler → captureForGuild() → configured? → event enabled? → bot filter? → sampling? → PostHog project
```

Every event is attached to a `discord_server` group keyed on the guild id, so you can break analytics down per server. Channel-scoped events also carry `root_channel_id` / `root_channel_name` — the parent channel for messages in threads, the channel itself otherwise — so a per-channel breakdown folds thread activity into the channel it happened in instead of splitting each thread out. Nothing is sent until an admin connects the server with `/ph connect` and enables event types. Per-guild config (API key, host, enabled events, options) is stored in SQLite, where a client pool keeps one `posthog-node` client per destination.

## Supported events

`message_sent`, `message_edited`, `message_deleted`, `member_joined`, `member_left`, `member_banned`, `member_roster`, `reaction_added`, `reaction_removed`, `voice_channel_joined`, `voice_channel_left`, `voice_channel_moved`, `thread_created`, `server_snapshot`. Each carries `guild_*` / `channel_*` metadata, see `src/events-catalog.ts` and the handlers in `src/events/`.

### `member_roster`

Gateway events only ever tell you about members who *do* something, so PostHog never
learns the silent majority exists — which makes "how many members have never posted?"
unanswerable, because the denominator is missing. `member_roster` fills that in: when
enabled it periodically emits one event per member carrying `joined_at`, `roles`,
`role_count`, `is_bot`, and `nickname`, and mirrors `discord_joined_at` /
`discord_roles` / `discord_role_count` onto the PostHog person.

That unlocks never-posted / posted-once / posted-2+ breakdowns, and tenure
("joined 30+ days ago") for members who were already in the server before the bot
arrived — `member_joined` can only see joins from installation onwards.

Roles are re-set on every run, so a member who picks up a role later is reflected
within one interval (`ROSTER_INTERVAL_HOURS`, default 24). Note PostHog freezes person
properties onto events at ingestion time, so older events won't retroactively gain a
newly-added role — filter with a cohort when you need current role state.

**It costs one event per member per run**: a 1,000-member server emits 1,000 events a
day at the default interval. Raise `ROSTER_INTERVAL_HOURS` to trade freshness for
volume.

### Message content

By default message events carry metadata only (`message_length`, `attachment_count`, `mention_count`, …) — the text never leaves Discord. An admin can opt the whole server in:

```
/ph analytics options capture_message_content:true
```

`message_sent` and `message_edited` then also carry `message_content` (the text; for edits, the post-edit version) and `message_content_truncated`. Text is capped at 2000 characters — Discord's own non-Nitro limit — so only long Nitro messages are cut.

Worth thinking about before you turn it on:

- **Members are not notified.** Only server admins see the setting. Tell your community, and check this is compatible with whatever you've told them about data handling.
- **Text becomes an event property in PostHog**, subject to that project's retention and visible to anyone who can query the project.
- It requires the privileged **Message Content** intent (the bot already requests it).
- It's off by default and stays off when an existing deployment upgrades — the column is added defaulting to off.
- Turn it back off with `capture_message_content:false`; `/ph analytics status` always shows the current state.

The gate lives at the capture choke point in `src/capture.ts`, not in the event handlers, so "metadata only" is enforced in exactly one place.

### `server_snapshot`

Discord's _Server Insights_ dashboard isn't exposed to bots, but the flow events above let PostHog reproduce (and exceed) its growth, churn, retention, and activity charts. The one thing gateway events don't give you is *totals at a moment in time*, so `server_snapshot` fills that gap. When enabled, the bot periodically emits one event per server with:

`member_count`, `online_count` (approximate), `channel_count`, `role_count`, `boost_count`, `premium_tier`, `emoji_count`, `sticker_count`.

Graph these in PostHog for "members / online / boosts over time". It's opt-in via `/ph analytics events` like any other event, fires once on startup for an immediate data point, and only does the per-guild API call when a server has it enabled.

## Slash commands

Everything lives under one top-level **`/ph`** command (Discord caps a command at
one freeform option *or* subcommands, and forbids nested groups — hence `triggers`
is a sibling group rather than under `analytics`). The `analytics`, `triggers`,
and `forums` groups plus `connect` require **Manage Server**; `code` is open to
any member (PostHog authorizes sensitive actions).

| Command | What it does | Gating |
|---|---|---|
| `/ph code <prompt> [repo]` | Ask PostHog Code to work on a task | anyone |
| `/ph connect` | Connect this server to a PostHog project (returns a signed confirmation link; also provisions the analytics project) | Manage Server |
| `/ph analytics events` | Choose which events are sent (multi-select) | Manage Server |
| `/ph analytics options` | Toggle bot filtering, message sampling, and message-content capture | Manage Server |
| `/ph analytics status` | Show the current config (the key is masked) | Manage Server |
| `/ph analytics test` | Send a test event to verify the connection | Manage Server |
| `/ph analytics disable` | Stop sending and clear this server's config | Manage Server |
| `/ph triggers add` | Create a custom-event trigger (see below) | Manage Server |
| `/ph triggers list` | List this server's triggers (with ids) | Manage Server |
| `/ph triggers remove <id>` | Delete a trigger | Manage Server |
| `/ph triggers toggle <id> <enabled>` | Enable/disable a trigger | Manage Server |
| `/ph forums watch` / `unwatch <channel>` | Watch/stop watching a forum channel (new posts forwarded to PostHog Code) | Manage Server |
| `/ph forums list` | List watched forum channels | Manage Server |

`code` and `connect` are **forwarded** to PostHog Code over an
authenticated HTTP bridge; PostHog does the work asynchronously and drives the
Discord reply (threads, messages, reactions) back through the bot's actions API.
`analytics` and `triggers` are handled locally and write to SQLite. See
[the bridge](#posthog-code-bridge).

The PostHog project API key (`phc_…`) is a publishable, capture-only key (it cannot read data ), so storing it per guild is low-risk.

## Custom event triggers

Beyond the built-in catalog, server admins can define **triggers** When Discord activity matches a rule, the bot emits a **custom-named** PostHog event. Triggers fire independently of whichever built-in events are enabled (they only need the server to be connected via `/ph connect`).

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
/ph triggers add name:Refunds event_name:refund_request source:message \
    channel:#support contains:refund

# a PDF uploaded to #contracts → contract_uploaded
/ph triggers add name:Contracts event_name:contract_uploaded source:file \
    channel:#contracts file_ext:pdf

# 🎫 reaction anywhere → ticket_opened
/ph triggers add name:Tickets event_name:ticket_opened source:reaction emoji:🎫
```

Each fired event carries auto-context: channel info, what matched (`matched_term` / `matched_emoji` / `file_name`), `trigger_name` / `trigger_id` / `trigger_source`, and the acting Discord user as the PostHog person.

Matching is simple and case-insensitive (`contains` / `keywords` / `starts_with`). Each server can have **up to 50 triggers**.

## Per-server usage

In any server the bot has joined, an admin runs:

1. `/ph connect` → open the signed link, confirm the PostHog project, and PostHog provisions the server (binding it to the project and sending the bot its capture key + region — `us.i.posthog.com` or `eu.i.posthog.com`, never an arbitrary host).
2. `/ph analytics test` → confirm the event lands in PostHog's Activity feed.
3. `/ph analytics events` → tick the events to track.

## PostHog Code bridge

`/ph code` and `/ph connect` turn the bot into a two-way bridge to
**PostHog Code**:

- **Discord → PostHog:** the bot ACKs the interaction within Discord's 3 s window
  (a deferred reply) and forwards it to `{app_host}/api/discord/interactions/ingest`.
  The app host is derived from the guild's analytics region (`us`/`eu`),
  defaulting to US. Repo autocomplete is served from `…/api/discord/repos`.
- **PostHog → Discord:** the bot exposes an **actions API** (`BOT_ACTIONS_BIND`,
  `POST /actions`) that PostHog calls to create threads and post/edit/delete
  messages and reactions, using the interaction's webhook token while it's valid
  (~15 min) and the bot token afterwards.

**Forum posts.** `/ph forums watch <forum>` (Manage Server, stored locally per
guild) makes the bot forward forum activity in that channel to the same ingest
endpoint:
- each **new post** as `kind: "forum_post"` (title, starter-message content,
  applied tag names, author), and
- each **reply** in those threads as `kind: "message"` (content, author, the
  thread/forum ids) — that's how the original poster's follow-ups reach the agent.

Bots (including this one, so the agent's own replies don't loop) and archived
threads are skipped. PostHog dedupes by `thread_id` / `message_id`, so a failed
POST is retried once. Both are fire-and-forget — there's no interaction to reply to.

PostHog can also forward replies from **any** thread (e.g. one it created off a
`/ph code` task, not just forum posts) by registering it through the actions API
(`op: "watch_thread"` / `"unwatch_thread"` with `guild_id` + `thread_id`). Those
threads are tracked locally and cleared on guild removal.

**Connecting a server.** `/ph connect` (Manage Server) forwards like any other
command; PostHog replies with a short-lived signed URL. The admin opens it, logs
into PostHog, and confirms binding the server to a project — PostHog verifies
they're an org admin, stores the link, and pushes the project's capture key back
to the bot via the actions API (`op: "connect_guild"` with `guild_id`, `region`,
`project_api_key`; an empty key disconnects). That's how analytics gets
provisioned — there's no separate setup step. Individual users separately
account-link via the `identify` OAuth flow. Until then, forwarded commands get an
ephemeral "link your account / connect this server" prompt.

The full wire contract (every endpoint, op, payload, and flow) is in
[`docs/discord-bridge-contract.md`](docs/discord-bridge-contract.md) — the
authoritative spec for the PostHog side.

Both directions authenticate with a single shared bearer secret
(`POSTHOG_DISCORD_SHARED_SECRET`) and rely on TLS for transport security.
Forwarded interactions are deduped on interaction id. The bot stores no state for
these features — repo routing, project bindings, and account links all live in
PostHog. Config is in `.env` (see `.env.example`); the actions port must be
reachable by PostHog.

## Privacy

- **Analytics** sends metadata only unless an admin opts the server in with `/ph analytics options capture_message_content:true` (off by default, including across upgrades). See [Message content](#message-content).
- Content also leaves Discord via the **PostHog Code bridge**: in a forum an admin explicitly opts in with `/ph forums watch`, post and reply **content** is forwarded (that's the point — the agent needs it). Nothing is forwarded from unwatched channels.
- Configuration (including the API key) is only ever shown to admins via **ephemeral** replies, and the key is masked in `/ph analytics status`.

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
  config.ts          bot-level env (token, client id, db path, bridge secret/bind)
  bridge/            PostHog Code bridge: forward (out), actionsServer (in), auth, dedupe
  commands/ph.ts     the single /ph slash command definition
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
  commandRegistry.ts per-guild slash-command registration
  commands/          slash-command definitions
  interactions/      command / modal / select-menu handlers
  events/            Discord gateway event handlers
```

## License

[MIT](LICENSE) © PostHog, Inc.
