import {
  ChannelType,
  type Client,
  Events,
  type Message,
  type ThreadChannel,
} from "discord.js";

import { resolveRepliedTo } from "@/bridge/context.js";
import { forwardForumPost, forwardMessage } from "@/bridge/forward.js";
import { isWatchedForum, isWatchedThread } from "@/db.js";

const STARTER_RETRY_MS = 1000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The starter message can lag behind the ThreadCreate event, so try once more
 * after a short delay before giving up.
 */
async function fetchStarter(thread: ThreadChannel): Promise<Message | null> {
  const once = async (): Promise<Message | null> =>
    thread.fetchStarterMessage().catch(() => null);
  const first = await once();
  if (first) return first;
  await sleep(STARTER_RETRY_MS);
  return once();
}

/**
 * Forward forum activity in watched forum channels to PostHog Code:
 *   - ThreadCreate → the new post (thread + starter message) as `forum_post`
 *   - MessageCreate → subsequent replies in that thread as `message`, so the
 *     original poster's follow-ups reach the agent.
 *
 * A forum "post" is a thread whose parent is a `GuildForum`. Bots (including this
 * one — which prevents feedback loops on the agent's own replies) and archived
 * threads are skipped. PostHog dedupes by `thread_id` / `message_id`, so the
 * forwarder's retry is safe.
 */
export function register(client: Client): void {
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guildId) return;

    const channel = message.channel;
    if (!channel.isThread()) return;

    // Forward replies in a watched forum's threads OR in an individually watched
    // thread (e.g. one PostHog Code created off a /ph code invocation).
    const forum = channel.parent;
    const forumId = forum?.type === ChannelType.GuildForum ? forum.id : null;
    const watched =
      (forumId !== null && isWatchedForum(message.guildId, forumId)) ||
      isWatchedThread(message.guildId, channel.id);
    if (!watched) return;

    // The starter message shares the thread's id and is already sent as the
    // forum_post; only forward genuine replies.
    if (message.id === channel.id) return;

    // PostHog already accumulates the running thread (every message is forwarded
    // as it arrives, keyed by thread_id), so a reply only needs to point at the
    // message it answers. Best-effort: null when it isn't a reply or the
    // referenced message is gone.
    const repliedTo = await resolveRepliedTo(message);

    await forwardMessage({
      kind: "message",
      guild_id: message.guildId,
      forum_channel_id: forumId,
      thread_id: channel.id,
      message_id: message.id,
      content: message.content,
      author: {
        id: message.author.id,
        username: message.author.username,
        global_name: message.author.globalName ?? null,
        bot: message.author.bot,
      },
      replied_to: repliedTo,
    });
  });

  client.on(Events.ThreadCreate, async (thread, newlyCreated) => {
    // `newlyCreated` is false when the bot merely gains access to an existing
    // thread (e.g. on startup) — only forward genuinely new posts.
    if (!newlyCreated) return;

    const forum = thread.parent;
    if (forum?.type !== ChannelType.GuildForum) return;
    if (!thread.parentId || !isWatchedForum(thread.guildId, thread.parentId)) return;
    if (thread.archived) return;

    const starter = await fetchStarter(thread);
    if (!starter) {
      console.error(`[forums] no starter message for thread ${thread.id}; skipping.`);
      return;
    }
    if (starter.author.bot) return; // skip bots, including ourselves

    // Applied tags are ids; resolve them to names via the parent forum.
    const tags = thread.appliedTags
      .map((id) => forum.availableTags.find((t) => t.id === id)?.name)
      .filter((name): name is string => Boolean(name));

    await forwardForumPost({
      kind: "forum_post",
      guild_id: thread.guildId,
      forum_channel_id: thread.parentId,
      thread_id: thread.id,
      title: thread.name,
      content: starter.content,
      tags,
      author: {
        id: starter.author.id,
        username: starter.author.username,
        global_name: starter.author.globalName ?? null,
        bot: starter.author.bot,
      },
    });
  });
}
