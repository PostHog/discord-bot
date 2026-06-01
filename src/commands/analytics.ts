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
  .toJSON();
