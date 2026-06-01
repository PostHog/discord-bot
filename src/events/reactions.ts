import {
  type Client,
  Events,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from "discord.js";

import { captureForGuild, toPersonLike } from "../capture.js";
import { channelProps } from "../props.js";
import { runReactionTriggers } from "../triggers.js";

function emojiProps(
  reaction: MessageReaction | PartialMessageReaction
): Record<string, unknown> {
  const isCustom = reaction.emoji.id != null;
  return {
    emoji_name: reaction.emoji.name,
    emoji_id: reaction.emoji.id,
    is_custom_emoji: isCustom,
  };
}

function handle(
  event: "reaction_added" | "reaction_removed",
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
): void {
  const guildId = reaction.message.guildId;
  if (!guildId) return; // DM reaction — ignore.

  captureForGuild({
    guildId,
    event,
    distinctId: user.id,
    // Only attach person props (and apply the bot filter) when the user is fully
    // resolved; a partial user may lack username/bot.
    actor: user.partial ? undefined : toPersonLike(user),
    properties: {
      ...channelProps(reaction.message.channel),
      ...emojiProps(reaction),
    },
  });
}

/** Reaction add/remove events. */
export function register(client: Client): void {
  client.on(Events.MessageReactionAdd, (reaction, user) => {
    handle("reaction_added", reaction, user);
    // User-defined reaction triggers fire on add only.
    runReactionTriggers(reaction, user);
  });
  client.on(Events.MessageReactionRemove, (reaction, user) =>
    handle("reaction_removed", reaction, user)
  );
}
