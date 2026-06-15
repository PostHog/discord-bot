import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  MessageFlags,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from "discord.js";

import { fetchChannelContext } from "@/bridge/context.js";
import { markSeen } from "@/bridge/dedupe.js";
import {
  buildCommandPayload,
  buildComponentPayload,
  buildModalPayload,
  fetchRepos,
  forwardInteraction,
  type ForwardResponse,
} from "@/bridge/forward.js";

/**
 * Handlers for the forwarded `/ph` surface (code/connect + any
 * PostHog-rendered components/modals + repo autocomplete). Each ACKs Discord
 * within the 3 s window, then forwards to PostHog, which drives any resulting UI
 * back through the actions API. Forwards are deduped on interaction id because
 * Discord may redeliver.
 */

/**
 * Apply PostHog's synchronous forward reply. On `accepted`, PostHog drives the
 * deferred reply via the actions API, so we leave it. On an `ephemeral` action
 * (e.g. an account-link prompt) we answer privately — deleting a *public* defer
 * first so it doesn't hang on "thinking…". On failure we surface a brief error.
 */
async function applyForwardResult(
  interaction: ChatInputCommandInteraction,
  res: ForwardResponse | null,
  wasPublic: boolean
): Promise<void> {
  if (res === null) {
    await interaction
      .editReply({ content: "⚠️ Couldn't reach PostHog. Please try again." })
      .catch(() => {});
    return;
  }
  if (res.action === "ephemeral" && res.content) {
    if (wasPublic) {
      await interaction.deleteReply().catch(() => {});
      await interaction.followUp({ content: res.content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.editReply({ content: res.content });
    }
  }
  // Otherwise: accepted — PostHog will edit the deferred reply via the actions API.
}

/** `/ph code` → public deferred reply, forward, then account-link follow-up if asked. */
export async function handleCodeCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!markSeen(interaction.id)) return;
  await interaction.deferReply();
  // Gather the surrounding conversation so the prompt's references resolve.
  // Done after the defer (which posts our own "thinking" reply — excluded by
  // interaction id) to stay within Discord's 3 s ack window.
  const payload = buildCommandPayload(interaction);
  payload.context = await fetchChannelContext(interaction.channel, {
    excludeInteractionId: interaction.id,
  });
  const res = await forwardInteraction(payload);
  await applyForwardResult(interaction, res, true);
}

/** `/ph connect` → ephemeral deferred reply, then forward. */
export async function handleForwardedCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!markSeen(interaction.id)) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const res = await forwardInteraction(buildCommandPayload(interaction));
  await applyForwardResult(interaction, res, false);
}

/** A button / select menu rendered by PostHog → deferred update, then forward. */
export async function handleComponentForward(
  interaction: MessageComponentInteraction
): Promise<void> {
  if (!markSeen(interaction.id)) return;
  await interaction.deferUpdate();
  await forwardInteraction(buildComponentPayload(interaction));
}

/** A modal rendered by PostHog → deferred update, then forward. */
export async function handleModalForward(
  interaction: ModalSubmitInteraction
): Promise<void> {
  if (!markSeen(interaction.id)) return;
  await interaction.deferUpdate();
  await forwardInteraction(buildModalPayload(interaction));
}

/** Repo autocomplete → ask PostHog for choices (best-effort, empty on failure). */
export async function handleRepoAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const choices =
    focused.name === "repo"
      ? await fetchRepos(interaction.guildId, interaction.user.id, focused.value)
      : [];
  try {
    await interaction.respond(choices);
  } catch {
    // Past the 3 s window or already answered — nothing to do.
  }
}
