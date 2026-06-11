import {
  ChannelType,
  type Client,
  Events,
  type Message,
  type ThreadChannel,
} from "discord.js";

import { forwardForumPost } from "@/bridge/forward.js";
import { isWatchedForum } from "@/db.js";

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
 * Forward new posts in watched forum channels to PostHog Code. A forum "post" is
 * a thread whose parent is a `GuildForum`; its starter message is the body. Bots
 * (including this one) and archived threads are skipped. PostHog dedupes by
 * `thread_id`, so the forwarder's retry is safe.
 */
export function register(client: Client): void {
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
