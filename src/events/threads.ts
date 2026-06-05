import { type Client, Events } from "discord.js";

import { captureForGuild } from "@/capture.js";
import { guildProps } from "@/props.js";

/** Thread creation events. */
export function register(client: Client): void {
  client.on(Events.ThreadCreate, (thread, newlyCreated) => {
    // `newlyCreated` is false when the bot simply gains access to an existing
    // thread (e.g. on startup) — only count genuinely new threads.
    if (!newlyCreated) return;

    const ownerId = thread.ownerId;
    if (!ownerId) return; // Can't attribute without an owner.

    captureForGuild({
      guildId: thread.guild.id,
      event: "thread_created",
      distinctId: ownerId,
      properties: {
        ...guildProps(thread.guild),
        thread_id: thread.id,
        thread_name: thread.name,
        parent_channel_id: thread.parentId,
        parent_channel_name: thread.parent?.name ?? null,
      },
    });
  });
}
