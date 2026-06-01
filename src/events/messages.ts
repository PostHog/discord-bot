import { type Client, Events, type Message, MessageType } from "discord.js";

import { captureForGuild, toPersonLike } from "../capture.js";
import { channelProps, guildProps } from "../props.js";

/**
 * Message events. We send metadata only — never the message text. Note that
 * `message_length` / `attachment_count` / `mention_count` are derived from
 * content the bot can only see when the privileged **Message Content** intent is
 * granted; without it they read as 0 but `message_sent` still fires (so message
 * counts per channel/user remain accurate). See README.
 */
export function register(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    if (!message.inGuild()) return;

    captureForGuild({
      guildId: message.guildId,
      event: "message_sent",
      distinctId: message.author.id,
      actor: toPersonLike(message.author),
      properties: {
        ...guildProps(message.guild),
        ...channelProps(message.channel),
        message_length: message.content.length,
        attachment_count: message.attachments.size,
        mention_count:
          message.mentions.users.size + message.mentions.roles.size,
        is_reply: message.type === MessageType.Reply,
        has_embed: message.embeds.length > 0,
      },
    });
  });

  client.on(Events.MessageUpdate, (_oldMessage, newMessage) => {
    if (!newMessage.inGuild()) return;
    // Updates also fire for embed unfurling etc.; only count genuine user edits.
    if (!newMessage.editedTimestamp) return;
    const author = newMessage.author;
    if (!author) return;

    captureForGuild({
      guildId: newMessage.guildId,
      event: "message_edited",
      distinctId: author.id,
      actor: toPersonLike(author),
      properties: {
        ...guildProps(newMessage.guild),
        ...channelProps(newMessage.channel),
      },
    });
  });

  client.on(Events.MessageDelete, (message) => {
    if (!message.inGuild()) return;
    // For uncached messages the author is unknown — skip rather than mis-attribute.
    const author = message.author;
    if (!author) return;

    captureForGuild({
      guildId: message.guildId,
      event: "message_deleted",
      distinctId: author.id,
      actor: toPersonLike(author),
      properties: {
        ...guildProps(message.guild),
        ...channelProps(message.channel),
      },
    });
  });
}

// Re-export the Message type so editors resolve overloads cleanly.
export type { Message };
