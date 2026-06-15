/**
 * Conversation-context collection for forwards to PostHog Code.
 *
 * A `/ph code` invocation or a reply in a watched thread often refers to the
 * surrounding discussion ("review this", "can you fix it?"). On its own the
 * forwarded prompt has no referent, so the agent has to ask what "this" is.
 * Here we gather the recent channel/thread history (and, for a reply, the
 * message being replied to) so PostHog Code receives the same context a human
 * reader would have.
 */

/** Max messages of channel/thread history forwarded as conversation context. */
export const CONTEXT_LIMIT = 50;

export interface ContextAuthor {
  id: string;
  username: string;
  global_name: string | null;
  bot: boolean;
}

export interface ContextMessage {
  id: string;
  author: ContextAuthor;
  content: string;
  /** ISO-8601 creation time, so the agent can order the conversation. */
  timestamp: string;
  /** The referenced message id when this message is a Discord reply, else null. */
  reply_to_id: string | null;
}

/** Minimal shape we read off a discord.js Message (kept structural for tests). */
interface RawMessage {
  id: string;
  content: string;
  createdTimestamp: number;
  author: { id: string; username: string; globalName: string | null; bot: boolean };
  reference?: { messageId?: string | null } | null;
  interactionMetadata?: { id: string } | null;
}

/** A channel that can page its message history (text channels and threads). */
interface ContextChannel {
  messages: {
    fetch(options: { limit: number }): Promise<Map<string, RawMessage>>;
  };
}

function isContextChannel(channel: unknown): channel is ContextChannel {
  if (typeof channel !== "object" || channel === null) return false;
  const messages = (channel as { messages?: unknown }).messages;
  return (
    typeof messages === "object" &&
    messages !== null &&
    typeof (messages as { fetch?: unknown }).fetch === "function"
  );
}

function toContextMessage(m: RawMessage): ContextMessage {
  return {
    id: m.id,
    author: {
      id: m.author.id,
      username: m.author.username,
      global_name: m.author.globalName ?? null,
      bot: m.author.bot,
    },
    content: m.content,
    timestamp: new Date(m.createdTimestamp).toISOString(),
    reply_to_id: m.reference?.messageId ?? null,
  };
}

export interface ContextOptions {
  limit?: number;
  /** Drop our own deferred reply for this interaction (matched on metadata). */
  excludeInteractionId?: string;
  /** Drop a specific message (e.g. the reply we're already forwarding). */
  excludeMessageId?: string;
}

/**
 * Fetch up to `limit` recent messages from a channel/thread, oldest-first.
 * Best-effort: returns `[]` if the channel can't page history or the fetch
 * fails (so a context failure never blocks the forward).
 */
export async function fetchChannelContext(
  channel: unknown,
  options: ContextOptions = {}
): Promise<ContextMessage[]> {
  if (!isContextChannel(channel)) return [];
  const limit = options.limit ?? CONTEXT_LIMIT;
  let collection: Map<string, RawMessage>;
  try {
    collection = await channel.messages.fetch({ limit });
  } catch (err) {
    console.error("[context] failed to fetch channel history:", err);
    return [];
  }
  return [...collection.values()]
    .filter(
      (m) =>
        m.id !== options.excludeMessageId &&
        (options.excludeInteractionId === undefined ||
          m.interactionMetadata?.id !== options.excludeInteractionId)
    )
    // Discord returns newest-first; present the conversation chronologically.
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(toContextMessage);
}

/** A message that may be a reply and can fetch its referenced message. */
interface ReplyableMessage extends RawMessage {
  reference?: { messageId?: string | null } | null;
  fetchReference(): Promise<RawMessage>;
}

/**
 * Resolve the message a reply points at, or null if this isn't a reply (or the
 * referenced message was deleted / can't be fetched).
 */
export async function resolveRepliedTo(
  message: ReplyableMessage
): Promise<ContextMessage | null> {
  if (!message.reference?.messageId) return null;
  try {
    return toContextMessage(await message.fetchReference());
  } catch {
    return null;
  }
}
