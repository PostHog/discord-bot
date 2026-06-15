# Discord ↔ PostHog Code bridge — wire contract

The single source of truth for how this Discord bot and PostHog talk to each
other. The bot is implemented against this; the PostHog side must match it.

The bot is **gateway-connected**: it holds the Discord token, opens an outbound
websocket, ACKs interactions itself, and relays. PostHog never talks to Discord
directly — it goes through the bot's actions API. Nothing here uses Discord's
HTTP Interactions endpoint, so no Ed25519 / `DISCORD_PUBLIC_KEY` is involved.

Two directions, both authenticated with the **same static bearer** over TLS:
- **Discord → PostHog** — the bot POSTs interactions/events to PostHog's ingest.
- **PostHog → Discord** — PostHog POSTs ops to the bot's actions API.

Bot source of truth: `src/bridge/forward.ts` (outbound), `src/bridge/actionsServer.ts`
(inbound), `src/interactions/router.ts` (what's forwarded vs handled locally).

---

## 1. Auth

`Authorization: Bearer <secret>` on every request in both directions. On the bot
this is `POSTHOG_DISCORD_SHARED_SECRET`; on PostHog it's `DISCORD_BRIDGE_SHARED_SECRET`
— **they must be equal**. Compared constant-time. Integrity/confidentiality rely
on TLS. Reject missing/mismatched with 401.

## 2. Config

**Bot** (`.env`):
| var | meaning |
|---|---|
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `DISCORD_APPLICATION_ID` | Discord application (client) id |
| `POSTHOG_DISCORD_SHARED_SECRET` | shared bearer (both directions) |
| `BOT_ACTIONS_BIND` | `host:port` the actions API binds to, e.g. `0.0.0.0:8080` |
| `POSTHOG_BRIDGE_BASE_URL` | dev-only: override the PostHog host the bot forwards to |
| `DATABASE_PATH` | SQLite path |

**PostHog**:
| var | meaning |
|---|---|
| `DISCORD_BOT_ACTIONS_URL` | full URL of the bot's actions API, e.g. `https://bot.example/actions` |
| `DISCORD_BRIDGE_SHARED_SECRET` | shared bearer — equals the bot's `POSTHOG_DISCORD_SHARED_SECRET` |
| `DISCORD_APP_CLIENT_ID` / `DISCORD_APP_CLIENT_SECRET` | Discord OAuth app for account-link (`identify`) |

**Region routing.** The bot derives the PostHog **app host** it forwards to from
the guild's analytics region (`us` → `https://us.posthog.com`, `eu` →
`https://eu.posthog.com`), defaulting to US. `POSTHOG_BRIDGE_BASE_URL` overrides
this entirely for local dev. PostHog initiates the reverse direction, so it just
uses `DISCORD_BOT_ACTIONS_URL`.

---

## 3. Discord → PostHog (endpoints PostHog must serve)

### `POST /api/discord/interactions/ingest`  (bearer)

The bot ACKs the Discord interaction within 3 s (deferred reply) and forwards it
here. **Only `code`, `connect`, and PostHog-rendered components/modals are
forwarded** — `analytics`, `triggers`, and `forums` are handled locally by the
bot. Forum activity (below) also arrives here.

**Slash commands** (`kind:"command"`):
```json
{
  "kind": "command",
  "guild_id": "string|null",
  "guild_name": "string|null",
  "channel_id": "string|null",
  "user": { "id": "string", "username": "string", "global_name": "string|null" },
  "command": "code | connect",
  "subcommand": null,
  "options": { "prompt": "...", "repo": "owner/repo", "project_id": "..." },
  "interaction_id": "string",
  "interaction_token": "string (valid ~15 min)",
  "application_id": "string",
  "channel_is_thread": false,
  "context": [
    {
      "id": "string",
      "author": { "id": "...", "username": "...", "global_name": "...", "bot": false },
      "content": "...",
      "timestamp": "ISO-8601",
      "reply_to_id": "string|null"
    }
  ]
}
```
- `/ph code` → `command:"code"`, `options:{ prompt, repo? }`
- `/ph connect` → `command:"connect"`, `options:{ project_id? }`
- `channel_is_thread` — true when the command ran in a thread (run the task in
  that thread instead of nesting a new one).
- `context` — **only when `/ph code` runs inside a thread**: up to 50 recent
  thread messages, **oldest-first**, so prompts like "review this" resolve
  against the thread. The bot's own deferred reply is excluded. Omitted outside a
  thread (a busy channel's backlog is noise) or when history can't be paged.

**Components** (buttons / selects PostHog rendered) — `kind:"component"`, adds
`message_id`, `custom_id`, `values:[...]`. **Modals** — `kind:"modal_submit"`,
adds `message_id`, `custom_id`, and `options` as a `{ fieldCustomId: value }` map.

**Response** (reply fast; bot timeout ~10 s), JSON, one of:
- `{ "status": "accepted" }` — you'll drive Discord asynchronously via the actions API.
- `{ "action": "ephemeral", "content": "<text, may contain a URL>" }` — the bot
  shows it as an ephemeral reply (account-link prompt, connect link, "not
  connected", errors). For a public `/ph code` defer the bot clears the public
  "thinking" and answers privately; for `connect` it edits the ephemeral defer.

### `GET /api/discord/repos?guild_id=&user_id=&query=`  (bearer)
Repo autocomplete for `/ph code`'s `repo` option. Budget < 2 s; ≤ 25 results.
Return `{ "choices": [{ "name": "owner/repo", "value": "owner/repo" }] }` or
`{ "repos": ["owner/repo", ...] }` (both accepted).

### Forum activity (also POSTed to the ingest endpoint, **fire-and-forget**)
Enabled per forum by an admin via `/ph forums watch` (bot-local; PostHog doesn't
see that config). These have no interaction to reply to — the bot only checks for
a 2xx and **retries once** on failure. Dedupe by `thread_id` / `message_id`.

New post (`kind:"forum_post"`):
```json
{
  "kind": "forum_post",
  "guild_id": "...",
  "forum_channel_id": "<parent forum id>",
  "thread_id": "<post thread id>",
  "title": "<thread name>",
  "content": "<starter message content>",
  "tags": ["<applied forum tag names>"],
  "author": { "id": "...", "username": "...", "global_name": "...", "bot": false }
}
```

Reply in a watched thread (`kind:"message"`):
```json
{
  "kind": "message",
  "guild_id": "...",
  "forum_channel_id": "<forum id, or null for non-forum watched threads>",
  "thread_id": "...",
  "message_id": "...",
  "content": "...",
  "author": { "id": "...", "username": "...", "global_name": "...", "bot": false },
  "replied_to": {
    "id": "string",
    "author": { "id": "...", "username": "...", "global_name": "...", "bot": false },
    "content": "...",
    "timestamp": "ISO-8601",
    "reply_to_id": "string|null"
  }
}
```
Replies come from threads under a watched forum **or** any thread registered via
`watch_thread` (below). Bot authors (incl. the bot itself) are skipped, so the
agent's own posts don't loop. Map replies to a task by `thread_id`.
- `replied_to` — the single message this one is a Discord reply to, or `null`
  when it isn't a reply (or the referenced message was deleted). No bulk thread
  history is sent here: you already accumulate the thread via `thread_id`, so a
  reply only needs to name the message it answers.

---

## 4. PostHog → Discord (the bot's actions API)

`POST {DISCORD_BOT_ACTIONS_URL}` with the bearer, body `{ "op": "...", ...fields }`.
`GET .../health` → `{ "ok": true }`. Errors: 401 (bad bearer), 400 (bad JSON /
unknown op / missing required field), 500 (Discord call failed, `{error}`).

| op | fields | returns |
|----|--------|---------|
| `create_thread` | `channel_id, name, message_id?` | `{ "thread_id": "..." }` |
| `post_message` | `interaction_token?` **or** `target_id`; `content?, embeds?, components?, ephemeral?` | `{ "message_id": "..." }` |
| `edit_message` | `interaction_token?` (edits `@original`) **or** `target_id`+`message_id`; `content?, embeds?, components?` | `{ "ok": true }` |
| `delete_message` | `target_id, message_id` | `{ "ok": true }` |
| `add_reaction` / `remove_reaction` | `channel_id, message_id, emoji` | `{ "ok": true }` |
| `connect_guild` | `guild_id, region ("us"\|"eu"), project_api_key` | `{ "ok": true }` |
| `watch_thread` / `unwatch_thread` | `guild_id, thread_id` | `{ "ok": true }` |

Notes:
- **Token window.** Use `interaction_token` for the first reply and ephemeral
  follow-ups (valid ~15 min; ephemeral only works via the token). After that, and
  for messages in threads, use channel routes (`target_id` / `channel_id`). Don't
  send the bot token or `application_id` — the bot supplies its own.
- **Emoji** is passed through verbatim (URL-encoded unicode, or `name:id` for a
  custom emoji).
- **`connect_guild`** provisions analytics: the bot stores the project capture
  key + region for the guild. An empty/omitted `project_api_key` disconnects.
- **`watch_thread`** is idempotent; the bot clears a guild's watched threads if
  it's removed from the server.

---

## 5. Flows

### Connect a server (`/ph connect`, Manage Server)
1. Bot forwards `command:"connect"` (+ optional `options.project_id`).
2. PostHog mints a signed URL (`signing.dumps` carrying `guild_id` +
   `discord_user_id`, ~15-min expiry) and returns
   `{ "action": "ephemeral", "content": "Connect this server: <url>" }`.
3. URL → `/login?next=` → confirmation page "Connect this Discord server to
   project X?" (pre-select `project_id` if given, else show current project).
4. On confirm: verify org admin (`_is_org_admin`), then
   `Integration(kind="discord", integration_id=guild_id, team=project, created_by=user)`.
5. PostHog calls `connect_guild { guild_id, region, project_api_key }` so the bot
   provisions analytics. (This replaces the old `/ph analytics setup` — the
   project key is never pasted into Discord.)

### Account-link a user (`identify` OAuth)
When a forwarded interaction's `user.id` isn't linked, return
`{ "action": "ephemeral", "content": "Link your PostHog account: <signed url>" }`.
Host the Discord `identify` OAuth callback (`DISCORD_APP_CLIENT_ID/SECRET`;
register the redirect URI in the Developer Portal), store the
`discord_user_id ↔ PostHog user` mapping. Then the user re-runs the command.

### Run a task (`/ph code`)
1. Bot forwards `command:"code"`.
2. If unlinked/unconnected → ephemeral prompt (above). Else `{ "status": "accepted" }`.
3. Do the work async; drive Discord via the actions API:
   - `create_thread` → get `thread_id`
   - `watch_thread { guild_id, thread_id }` so the user's replies forward back
   - `post_message` / `edit_message` (use `interaction_token` for the first reply
     within 15 min, then channel routes)
4. Inbound `kind:"message"` events with that `thread_id` feed the agent.
5. `unwatch_thread { guild_id, thread_id }` when the task is done.

### Forums
`/ph forums watch <forum>` is local config. The bot then forwards new posts
(`forum_post`) and replies (`message`) from that forum automatically — no
`watch_thread` needed for forum threads.

---

## 6. Verify
- `GET {actions}/health` → 200 `{ok:true}`; `POST {actions}` with no/wrong bearer → 401.
- `POST {actions}` `{op:"post_message", target_id, content}` → a Discord message appears.
- `/ph connect` → ephemeral signed link → confirm → `Integration` created →
  `connect_guild` POSTed → bot stores the key.
- `/ph code` by an unlinked user → ephemeral link; after linking → accepted, then
  a thread + messages appear; replies arrive as `kind:"message"`.
- `/ph forums watch` a forum → a new post arrives as `forum_post`, a reply as `message`.
