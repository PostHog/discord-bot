import {
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

/**
 * The single `/analytics` command with subcommands. Gated to members with
 * "Manage Server" via `setDefaultMemberPermissions`; handlers re-check this so
 * the gate can't be bypassed by an admin lowering Discord's command permissions.
 */
export const analyticsCommand = new SlashCommandBuilder()
  .setName("analytics")
  .setDescription("Configure PostHog analytics for this server")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  // Server-only — there is no per-DM configuration.
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName("setup")
      .setDescription("Connect this server to a PostHog project (key + host)")
  )
  .addSubcommand((sub) =>
    sub
      .setName("events")
      .setDescription("Choose which Discord events are sent to PostHog")
  )
  .addSubcommand((sub) =>
    sub
      .setName("options")
      .setDescription("Toggle bot filtering and message sampling")
      .addBooleanOption((opt) =>
        opt
          .setName("ignore_bots")
          .setDescription("Skip events triggered by bots (default: true)")
      )
      .addNumberOption((opt) =>
        opt
          .setName("message_sample_rate")
          .setDescription("Fraction of messages to send, 0.0–1.0 (default: 1.0)")
          .setMinValue(0)
          .setMaxValue(1)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("Show the current analytics configuration")
  )
  .addSubcommand((sub) =>
    sub
      .setName("test")
      .setDescription("Send a test event to verify the PostHog connection")
  )
  .addSubcommand((sub) =>
    sub
      .setName("disable")
      .setDescription("Stop sending analytics and clear this server's config")
  )
  .addSubcommandGroup((group) =>
    group
      .setName("trigger")
      .setDescription("Custom events fired when Discord activity matches a rule")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Create a custom-event trigger")
          .addStringOption((o) =>
            o
              .setName("name")
              .setDescription("A label for this trigger, e.g. 'Support requests'")
              .setRequired(true)
              .setMaxLength(100)
          )
          .addStringOption((o) =>
            o
              .setName("event_name")
              .setDescription("PostHog event to emit, e.g. support_request")
              .setRequired(true)
              .setMaxLength(100)
          )
          .addStringOption((o) =>
            o
              .setName("source")
              .setDescription("Which Discord signal fires this trigger")
              .setRequired(true)
              .addChoices(
                { name: "Message posted", value: "message" },
                { name: "File/attachment uploaded", value: "file" },
                { name: "Emoji reaction added", value: "reaction" },
                { name: "Member joined", value: "member_join" },
                { name: "Voice channel joined", value: "voice_join" }
              )
          )
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("Only fire in this channel (optional)")
          )
          .addStringOption((o) =>
            o
              .setName("contains")
              .setDescription("Message contains this text (message/file)")
              .setMaxLength(200)
          )
          .addStringOption((o) =>
            o
              .setName("keywords")
              .setDescription("Comma-separated; match if any appears (message/file)")
              .setMaxLength(300)
          )
          .addStringOption((o) =>
            o
              .setName("starts_with")
              .setDescription("Message starts with this text (message/file)")
              .setMaxLength(200)
          )
          .addStringOption((o) =>
            o
              .setName("file_ext")
              .setDescription("Comma-separated extensions, e.g. pdf,png (file)")
              .setMaxLength(100)
          )
          .addStringOption((o) =>
            o
              .setName("emoji")
              .setDescription("Emoji to match (reaction)")
              .setMaxLength(100)
          )
      )
      .addSubcommand((sub) =>
        sub.setName("list").setDescription("List this server's triggers")
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Delete a trigger by id")
          .addIntegerOption((o) =>
            o
              .setName("id")
              .setDescription("Trigger id (see /analytics trigger list)")
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("toggle")
          .setDescription("Enable or disable a trigger by id")
          .addIntegerOption((o) =>
            o
              .setName("id")
              .setDescription("Trigger id (see /analytics trigger list)")
              .setRequired(true)
          )
          .addBooleanOption((o) =>
            o
              .setName("enabled")
              .setDescription("true to enable, false to disable")
              .setRequired(true)
          )
      )
  )
  .toJSON();
