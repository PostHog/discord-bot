# Rate (burst) triggers

**Goal:** fire a custom event once when N matching messages happen within T
minutes, e.g. "≥15 messages containing a link, server-wide, within 5 minutes,
from members who joined < 24h ago" → `community_spam_raid`. This feeds the
community pager (PostHog destination → incident.io alert source).

## Shape: a condition on `message` / `file`, not a new source

The existing per-message conditions (`channel`, `contains`/`keywords`/`starts_with`,
`file_ext`) still decide *which* messages count. "Rate" only changes *when* the
trigger fires: after the Nth match instead of every match. A new `burst` source
would need to repeat every message condition. So rate is two new optional fields
on `TriggerConditions`:

```ts
newMemberHours?: number;   // only count authors who joined < X hours ago
rate?: { count: number; windowMinutes: number; cooldownMinutes: number };
```

`newMemberHours` is a normal per-message filter, so it also works on non-rate
triggers ("a new member posted a link").

## Slash command

New options on `/ph triggers add` (only valid for `message` / `file`):

| option | range | notes |
|---|---|---|
| `rate_count` | 2–500 | requires `rate_window_minutes` |
| `rate_window_minutes` | 1–60 | requires `rate_count` |
| `cooldown_minutes` | 1–1440 | only with rate; default 30 |
| `new_member_hours` | 1–720 | works with or without rate |

## Member data

`message.member.joinedTimestamp`. Discord's MESSAGE_CREATE payload includes the
author's partial member object with `joined_at`, so this needs no API call or
cache. If it is missing (webhooks, an uncached edge case), the message **does
not count**. That is the conservative choice for a pager.

## Sliding window (`src/rateWindow.ts`)

- In memory: `Map<"guildId:triggerId", { hits, cooldownUntil }>`. A hit is
  `{ ts, authorId, channelId, messageId }`.
- On each matching message: if the trigger is in cooldown, ignore the message.
  Otherwise drop hits older than `now - window`, push the new hit, and keep at
  most `count` hits (memory is bounded). When `hits.length >= count`, **fire**:
  return a burst summary, clear the hits, set `cooldownUntil = now + cooldown`.
- Messages from bots (including webhooks) are never counted, so a bot message
  can't tip the window and then be dropped by the `ignore_bots` capture gate.
- Removing or toggling a trigger clears only **that** trigger's window and
  cooldown, so editing other triggers mid-raid doesn't re-arm a cooldown and
  page twice. Adding a trigger clears nothing. Leaving a guild clears all of it.
- **Restart resets all windows and cooldowns.** That's acceptable: a raid that
  spans a restart either re-fires (cooldown lost) or needs N fresh messages.

## Event properties

Base props (guild, channel, and `message_id`/`message_url` of the last message) + `trigger_*`, plus:
`rate_count` (messages in the burst), `rate_threshold`, `rate_window_minutes`,
`cooldown_minutes`, `burst_duration_seconds`, `unique_author_count`,
`sample_author_ids` (≤10), `channel_ids` (unique), `first_message_id`,
`last_message_id`, `first_message_url`, `last_message_url`, `first_message_at`, `new_member_hours` (if set). The PostHog
`distinct_id` is the author of the message that tipped the threshold (same as
other message triggers).

## Not doing (yet)

Persisting windows to SQLite, per-channel or per-author windows, and a
built-in "has link" condition (`keywords: http://,https://,discord.gg/` covers it).
