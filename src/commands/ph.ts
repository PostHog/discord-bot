import { SlashCommandBuilder } from "discord.js";

/**
 * The single top-level `/ph` command. It bundles every capability under one
 * command because Discord caps a command at one freeform-option OR subcommands
 * (never both) and forbids nesting subcommand groups:
 *
 *   /ph code <prompt> [repo]                 → PostHog Code (forwarded, public)
 *   /ph analytics setup|events|…|disable     → analytics config (local, Manage Server)
 *   /ph triggers  add|list|remove|toggle     → custom triggers (local, Manage Server)
 *   /ph project   show|set|workspace         → default project (forwarded)
 *   /ph rules     list|add|remove            → repo routing rules (forwarded)
 *
 * Permission gating is enforced per-subcommand in `interactions/router.ts`, so
 * no `setDefaultMemberPermissions` is set here (it can only gate the whole
 * command, and `code` must stay open to everyone).
 */
export const phCommand = new SlashCommandBuilder()
  .setName("ph")
  .setDescription("PostHog Code, analytics, and project tools")
  .setDMPermission(false)
  // --- code -------------------------------------------------------------
  .addSubcommand((sub) =>
    sub
      .setName("code")
      .setDescription("Ask PostHog Code to work on a task")
      .addStringOption((o) =>
        o
          .setName("prompt")
          .setDescription("What should PostHog Code do?")
          .setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName("repo")
          .setDescription("Repository (owner/repo)")
          .setAutocomplete(true)
      )
  )
  // --- connect ----------------------------------------------------------
  .addSubcommand((sub) =>
    sub
      .setName("connect")
      .setDescription("Connect this server to a PostHog project (admins)")
      .addStringOption((o) =>
        o
          .setName("project_id")
          .setDescription("PostHog project id to pre-select (optional)")
      )
  )
  // --- analytics --------------------------------------------------------
  .addSubcommandGroup((group) =>
    group
      .setName("analytics")
      .setDescription("Configure PostHog analytics for this server")
      .addSubcommand((sub) =>
        sub
          .setName("setup")
          .setDescription("Connect this server to a PostHog project (key + region)")
          .addStringOption((o) =>
            o
              .setName("region")
              .setDescription("PostHog Cloud region (default: us)")
              .addChoices({ name: "us", value: "us" }, { name: "eu", value: "eu" })
          )
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
        sub.setName("status").setDescription("Show the current analytics configuration")
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
  )
  // --- triggers ---------------------------------------------------------
  .addSubcommandGroup((group) =>
    group
      .setName("triggers")
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
            o.setName("channel").setDescription("Only fire in this channel (optional)")
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
            o.setName("emoji").setDescription("Emoji to match (reaction)").setMaxLength(100)
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
              .setDescription("Trigger id (see /ph triggers list)")
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
              .setDescription("Trigger id (see /ph triggers list)")
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
  // --- project ----------------------------------------------------------
  .addSubcommandGroup((group) =>
    group
      .setName("project")
      .setDescription("Manage default PostHog project")
      .addSubcommand((sub) =>
        sub.setName("show").setDescription("Show current default")
      )
      .addSubcommand((sub) =>
        sub
          .setName("set")
          .setDescription("Set your default project")
          .addStringOption((o) =>
            o
              .setName("project_id")
              .setDescription("PostHog project id")
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("workspace")
          .setDescription("Set workspace-wide default (admins)")
          .addStringOption((o) =>
            o
              .setName("project_id")
              .setDescription("PostHog project id")
              .setRequired(true)
          )
      )
  )
  // --- rules ------------------------------------------------------------
  .addSubcommandGroup((group) =>
    group
      .setName("rules")
      .setDescription("Manage repo routing rules")
      .addSubcommand((sub) => sub.setName("list").setDescription("List rules"))
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Add a rule")
          .addStringOption((o) =>
            o
              .setName("text")
              .setDescription("When to apply this rule")
              .setRequired(true)
          )
          .addStringOption((o) =>
            o
              .setName("repo")
              .setDescription("owner/repo")
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Remove rules")
          .addStringOption((o) =>
            o
              .setName("ids")
              .setDescription("Comma-separated rule numbers")
              .setRequired(true)
          )
      )
  )
  .toJSON();
