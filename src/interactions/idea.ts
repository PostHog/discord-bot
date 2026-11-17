import {
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type Interaction,
  MessageFlags,
  type MessageContextMenuCommandInteraction,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import { config } from "@/config.js";
import { getPostHogClient } from "@/posthogPool.js";
import { channelProps, guildProps } from "@/props.js";
import { nowMs } from "@/time.js";

/**
 * Roadmap-idea submission: `/ph idea` for a fresh pitch, or the "Submit as
 * roadmap idea" message action to lift an existing message.
 *
 * Both open the same modal and land on the same PostHog survey the form at
 * posthog.com/roadmap writes to, as a `survey sent` event. Two things differ
 * from every other capture in this bot, and both are deliberate:
 *
 * - It reports to one fixed project (`config.roadmapIdea`), not the guild's own.
 * - The survey has no server-side validation of any kind, so the per-user
 *   cooldown below is the only thing standing between a bored member and the
 *   results page.
 *
 * Only the message *link* is sent, never the surrounding conversation: whoever
 * reads the results clicks through to Discord for context. Copying other
 * people's messages into a survey response would sidestep the opt-in that
 * gates message content everywhere else in the bot.
 */

export const IDEA_MODAL_PREFIX = "roadmap_idea";

const IDEA_INPUT_ID = "idea";
const EMAIL_INPUT_ID = "email";

/** Discord's hard cap on a modal text input. */
const MAX_IDEA_LENGTH = 4000;
const MAX_EMAIL_LENGTH = 200;

/** Minimum gap between one member's submissions. */
export const COOLDOWN_MS = 60_000;

/** Last submission time per Discord user id. */
const lastSubmission = new Map<string, number>();

/** The message an idea was lifted from. All fields absent for `/ph idea`. */
interface IdeaSource {
  channelId?: string;
  messageId?: string;
  authorId?: string;
}

/**
 * Pack the source into the modal's `custom_id` — the only state Discord carries
 * from opening a modal to its submission. Three snowflakes plus the prefix sit
 * well inside the 100-character limit. The guild id is left out because the
 * submit interaction supplies it.
 */
function encodeSource(source: IdeaSource): string {
  return [
    IDEA_MODAL_PREFIX,
    source.channelId ?? "",
    source.messageId ?? "",
    source.authorId ?? "",
  ].join(":");
}

export function decodeSource(customId: string): IdeaSource {
  const [, channelId, messageId, authorId] = customId.split(":");
  return {
    channelId: channelId || undefined,
    messageId: messageId || undefined,
    authorId: authorId || undefined,
  };
}

export function buildIdeaModal(source: IdeaSource, prefill: string): ModalBuilder {
  const idea = new TextInputBuilder()
    .setCustomId(IDEA_INPUT_ID)
    .setLabel("Your idea")
    .setPlaceholder("What should PostHog build?")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(MAX_IDEA_LENGTH)
    .setRequired(true);

  // Prefilled from the message, but still editable — a chat message is rarely a
  // well-formed idea on its own, and the submitter is the one who can fix that.
  if (prefill) idea.setValue(prefill.slice(0, MAX_IDEA_LENGTH));

  const email = new TextInputBuilder()
    .setCustomId(EMAIL_INPUT_ID)
    .setLabel("Email (optional)")
    .setPlaceholder("you@company.com")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(MAX_EMAIL_LENGTH)
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId(encodeSource(source))
    .setTitle("Pitch a roadmap idea")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(idea),
      new ActionRowBuilder<TextInputBuilder>().addComponents(email)
    );
}

/**
 * Gate on the feature being configured and the guild being allowed. Replies on
 * refusal, so callers only need the boolean.
 */
async function ensureEnabled(
  interaction: ChatInputCommandInteraction | MessageContextMenuCommandInteraction
): Promise<boolean> {
  const cfg = config.roadmapIdea;
  const guildId = interaction.guildId;
  const allowed =
    cfg !== undefined &&
    guildId !== null &&
    (cfg.guildIds.length === 0 || cfg.guildIds.includes(guildId));

  if (!allowed) {
    await interaction.reply({
      content: "Roadmap ideas aren't enabled in this server.",
      flags: MessageFlags.Ephemeral,
    });
  }
  return allowed;
}

/** `/ph idea` → empty modal. */
export async function handleIdeaCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!(await ensureEnabled(interaction))) return;
  await interaction.showModal(buildIdeaModal({}, ""));
}

/** Message action → the same modal, prefilled with the message. */
export async function handleIdeaMessageAction(
  interaction: MessageContextMenuCommandInteraction
): Promise<void> {
  if (!(await ensureEnabled(interaction))) return;

  const message = interaction.targetMessage;
  const content = message.content.trim();
  if (!content) {
    await interaction.reply({
      content:
        "That message has no text to submit — attachments and embeds can't be " +
        "turned into an idea. Use `/ph idea` to write one instead.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(
    buildIdeaModal(
      {
        channelId: message.channelId,
        messageId: message.id,
        authorId: message.author.id,
      },
      content
    )
  );
}

/** Modal submit → capture the survey response and confirm. */
export async function handleIdeaModalSubmit(
  interaction: ModalSubmitInteraction
): Promise<void> {
  const cfg = config.roadmapIdea;
  const guildId = interaction.guildId;
  if (!cfg || !guildId) return;

  const submitterId = interaction.user.id;
  const since = nowMs() - (lastSubmission.get(submitterId) ?? 0);
  if (since < COOLDOWN_MS) {
    await interaction.reply({
      content: `Hold on a moment before submitting another idea (${Math.ceil(
        (COOLDOWN_MS - since) / 1000
      )}s).`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const idea = interaction.fields.getTextInputValue(IDEA_INPUT_ID).trim();
  if (!idea) {
    await interaction.reply({
      content: "An idea needs some text.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const email = interaction.fields.getTextInputValue(EMAIL_INPUT_ID).trim();

  const source = decodeSource(interaction.customId);
  const messageUrl =
    source.channelId && source.messageId
      ? `https://discord.com/channels/${guildId}/${source.channelId}/${source.messageId}`
      : null;

  // The idea belongs to whoever wrote it, so the person is the message author
  // when there is one. `discord_submitted_by` keeps the actual clicker visible,
  // which is the only way to tell curation apart from authorship in the results.
  const authorId = source.authorId ?? submitterId;

  const client = getPostHogClient(cfg.host, cfg.projectApiKey);
  client.capture({
    distinctId: authorId,
    event: "survey sent",
    properties: {
      $survey_id: cfg.surveyId,
      $survey_response: idea,
      [`$survey_response_${cfg.ideaQuestionId}`]: idea,
      ...(email ? { [`$survey_response_${cfg.emailQuestionId}`]: email } : {}),
      // Absent on website submissions, so the two are still distinguishable
      // without changing anything on posthog.com.
      submission_source: "discord",
      discord_author_id: authorId,
      discord_submitted_by: submitterId,
      discord_submitted_by_username: interaction.user.username,
      discord_message_url: messageUrl,
      ...(interaction.guild ? guildProps(interaction.guild) : {}),
      ...channelProps(interaction.channel),
    },
  });

  // posthog-node batches on a 10s timer. For a one-off interactive action we
  // want to know it landed before telling anyone it did.
  try {
    await client.flush();
  } catch (err) {
    console.error("[idea] flush failed:", err);
    await interaction.reply({
      content: "⚠️ Couldn't reach PostHog — your idea wasn't submitted. Please try again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  lastSubmission.set(submitterId, nowMs());

  // A message lifted from someone else is announced in the channel: the author
  // never agreed to it, so at minimum they should see that it happened.
  if (messageUrl && source.authorId && source.authorId !== submitterId) {
    await interaction.reply({
      content: `💡 Submitted <@${source.authorId}>'s [idea](${messageUrl}) to the PostHog roadmap.`,
      allowedMentions: { users: [source.authorId] },
    });
    return;
  }

  await interaction.reply({
    content: "💡 Thanks — your idea is on its way to the PostHog roadmap.",
    flags: MessageFlags.Ephemeral,
  });
}

/** True for modals this module owns. */
export function isIdeaModal(interaction: Interaction): boolean {
  return (
    interaction.isModalSubmit() && interaction.customId.startsWith(`${IDEA_MODAL_PREFIX}:`)
  );
}

/** Test seam: drop all cooldown state. */
export function resetIdeaCooldowns(): void {
  lastSubmission.clear();
}
