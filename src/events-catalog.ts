/**
 * Canonical list of every event type the bot can send to PostHog. This is the
 * single source of truth used by:
 *   - the `/analytics events` select menu (what an admin can toggle)
 *   - validation when persisting a guild's enabled-event set
 *   - the capture gate (an event is only sent if its key is enabled)
 *
 * `requiresIntent` documents which privileged Gateway intent a richer version of
 * the event depends on. The event still fires without it (we degrade
 * gracefully), but some properties may be missing — see README.
 */
export type EventCategory =
  | "messages"
  | "members"
  | "reactions"
  | "voice"
  | "threads";

export interface CatalogEntry {
  key: string;
  label: string;
  description: string;
  category: EventCategory;
  requiresIntent?: "GuildMembers" | "MessageContent";
}

export const EVENT_CATALOG: readonly CatalogEntry[] = [
  // Messages
  {
    key: "message_sent",
    label: "Message sent",
    description: "A message was posted (metadata only, never the text)",
    category: "messages",
  },
  {
    key: "message_edited",
    label: "Message edited",
    description: "A message was edited",
    category: "messages",
  },
  {
    key: "message_deleted",
    label: "Message deleted",
    description: "A message was deleted",
    category: "messages",
  },
  // Members
  {
    key: "member_joined",
    label: "Member joined",
    description: "A user joined the server",
    category: "members",
    requiresIntent: "GuildMembers",
  },
  {
    key: "member_left",
    label: "Member left",
    description: "A user left or was kicked",
    category: "members",
    requiresIntent: "GuildMembers",
  },
  {
    key: "member_banned",
    label: "Member banned",
    description: "A user was banned",
    category: "members",
  },
  // Reactions
  {
    key: "reaction_added",
    label: "Reaction added",
    description: "A reaction was added to a message",
    category: "reactions",
  },
  {
    key: "reaction_removed",
    label: "Reaction removed",
    description: "A reaction was removed from a message",
    category: "reactions",
  },
  // Voice
  {
    key: "voice_channel_joined",
    label: "Voice channel joined",
    description: "A user joined a voice channel",
    category: "voice",
  },
  {
    key: "voice_channel_left",
    label: "Voice channel left",
    description: "A user left a voice channel",
    category: "voice",
  },
  {
    key: "voice_channel_moved",
    label: "Voice channel moved",
    description: "A user moved between voice channels",
    category: "voice",
  },
  // Threads
  {
    key: "thread_created",
    label: "Thread created",
    description: "A thread was created",
    category: "threads",
  },
] as const;

export const EVENT_KEYS: readonly string[] = EVENT_CATALOG.map((e) => e.key);

const KEY_SET = new Set(EVENT_KEYS);

export function isValidEventKey(key: string): boolean {
  return KEY_SET.has(key);
}

/** Filter an arbitrary list down to known event keys (drops anything unknown). */
export function sanitizeEventKeys(keys: string[]): string[] {
  return keys.filter((k) => KEY_SET.has(k));
}

export function getCatalogEntry(key: string): CatalogEntry | undefined {
  return EVENT_CATALOG.find((e) => e.key === key);
}
