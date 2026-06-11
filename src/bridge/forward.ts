import {
  ApplicationCommandOptionType,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from "discord.js";

import { bearerHeaders } from "@/bridge/auth.js";
import { config } from "@/config.js";
import { getGuildConfig } from "@/configCache.js";

/**
 * Discord → PostHog forwarding. The bot ACKs the interaction itself (defer) and
 * then hands the payload to PostHog Code, which does the real work asynchronously
 * and drives Discord back through the actions API (`actionsServer.ts`).
 */

export interface ForwardPayload {
  kind: "command" | "component" | "modal_submit";
  guild_id: string | null;
  /** Guild name when the interaction's guild is cached, else null (display only). */
  guild_name: string | null;
  channel_id: string | null;
  message_id?: string | null;
  user: { id: string; username: string; global_name: string | null };
  command?: string | null;
  subcommand?: string | null;
  options?: Record<string, unknown>;
  custom_id?: string;
  values?: string[];
  interaction_id: string;
  interaction_token: string;
  application_id: string;
}

/** PostHog's synchronous reply to a forward. */
export interface ForwardResponse {
  status?: string;
  action?: "ephemeral";
  content?: string;
}

const INGEST_TIMEOUT_MS = 10_000;
const REPOS_TIMEOUT_MS = 2_000;

/**
 * Map a guild's analytics region to the PostHog **app** host (where the bridge
 * API lives). The region is set when the guild connects (`/ph connect`), stored
 * as `posthogHost`; unconfigured guilds default to US.
 */
export function appHostForGuild(guildId: string | null): string {
  // Dev override (e.g. a tunneled local PostHog) wins over region derivation.
  if (config.bridgeBaseUrl) return config.bridgeBaseUrl;
  const host = guildId ? getGuildConfig(guildId)?.posthogHost : undefined;
  return host?.includes("eu")
    ? "https://eu.posthog.com"
    : "https://us.posthog.com";
}

/** Drill past subcommand-group / subcommand wrappers to the leaf option list. */
function flattenOptions(
  interaction: ChatInputCommandInteraction
): Record<string, unknown> {
  let opts = interaction.options.data as readonly {
    name: string;
    type: ApplicationCommandOptionType;
    value?: unknown;
    options?: readonly { name: string; value?: unknown }[];
  }[];

  for (let depth = 0; depth < 2 && opts.length === 1; depth++) {
    const first = opts[0];
    if (
      first.type === ApplicationCommandOptionType.Subcommand ||
      first.type === ApplicationCommandOptionType.SubcommandGroup
    ) {
      opts = (first.options ?? []) as typeof opts;
    } else break;
  }

  const out: Record<string, unknown> = {};
  for (const o of opts) out[o.name] = o.value;
  return out;
}

function baseFields(interaction: {
  guildId: string | null;
  guild?: { name: string } | null;
  channelId: string | null;
  user: { id: string; username: string; globalName: string | null };
  id: string;
  token: string;
  applicationId: string;
}) {
  return {
    guild_id: interaction.guildId,
    guild_name: interaction.guild?.name ?? null,
    channel_id: interaction.channelId,
    user: {
      id: interaction.user.id,
      username: interaction.user.username,
      global_name: interaction.user.globalName ?? null,
    },
    interaction_id: interaction.id,
    interaction_token: interaction.token,
    application_id: interaction.applicationId,
  };
}

/** Build the forward payload for a chat-input command (`/ph code|connect`). */
export function buildCommandPayload(
  interaction: ChatInputCommandInteraction
): ForwardPayload {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(false);
  return {
    kind: "command",
    ...baseFields(interaction),
    // `command` is the group name or the bare subcommand ("code"/"connect");
    // `subcommand` is the leaf within a group, else null.
    command: group ?? sub,
    subcommand: group ? sub : null,
    options: flattenOptions(interaction),
  };
}

/** Build the forward payload for a button / select-menu interaction. */
export function buildComponentPayload(
  interaction: MessageComponentInteraction
): ForwardPayload {
  return {
    kind: "component",
    ...baseFields(interaction),
    message_id: interaction.message?.id ?? null,
    custom_id: interaction.customId,
    values: interaction.isAnySelectMenu() ? interaction.values : [],
  };
}

/** Build the forward payload for a modal submit. */
export function buildModalPayload(
  interaction: ModalSubmitInteraction
): ForwardPayload {
  const options: Record<string, unknown> = {};
  for (const [customId, field] of interaction.fields.fields) {
    // Only text inputs carry a `.value`; skip newer component kinds.
    if ("value" in field) options[customId] = field.value;
  }
  return {
    kind: "modal_submit",
    ...baseFields(interaction),
    message_id: interaction.message?.id ?? null,
    custom_id: interaction.customId,
    options,
  };
}

async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearerHeaders() },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Forward an interaction to PostHog. Returns PostHog's parsed reply, or null on
 * any network/timeout/HTTP error (the caller decides how to surface failure).
 */
export async function forwardInteraction(
  payload: ForwardPayload
): Promise<ForwardResponse | null> {
  const url = `${appHostForGuild(payload.guild_id)}/api/discord/interactions/ingest`;
  try {
    const res = await postJson(url, payload, INGEST_TIMEOUT_MS);
    if (!res.ok) {
      console.error(`[bridge] ingest returned ${res.status}`);
      return null;
    }
    return (await res.json()) as ForwardResponse;
  } catch (err) {
    console.error("[bridge] forward failed:", err);
    return null;
  }
}

interface AuthorRef {
  id: string;
  username: string;
  global_name: string | null;
  bot: boolean;
}

export interface ForumPostPayload {
  kind: "forum_post";
  guild_id: string;
  forum_channel_id: string;
  thread_id: string;
  title: string;
  content: string;
  tags: string[];
  author: AuthorRef;
}

export interface MessagePayload {
  kind: "message";
  guild_id: string;
  forum_channel_id: string;
  thread_id: string;
  message_id: string;
  content: string;
  author: AuthorRef;
}

/**
 * Forward a non-interaction event to the ingest endpoint, fire-and-forget.
 * PostHog dedupes by `thread_id` / `message_id`, so a non-2xx is retried once;
 * anything else is logged and dropped (no Discord reply to drive).
 */
async function ingestFireAndForget(
  payload: { guild_id: string; kind: string },
  label: string
): Promise<void> {
  const url = `${appHostForGuild(payload.guild_id)}/api/discord/interactions/ingest`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await postJson(url, payload, INGEST_TIMEOUT_MS);
      if (res.ok) return; // accepted or skipped — done
      console.error(`[bridge] ${label} ingest returned ${res.status} (attempt ${attempt})`);
    } catch (err) {
      console.error(`[bridge] ${label} forward failed (attempt ${attempt}):`, err);
    }
  }
}

/** Forward a new forum post (the thread + its starter message). */
export function forwardForumPost(payload: ForumPostPayload): Promise<void> {
  return ingestFireAndForget(payload, "forum_post");
}

/** Forward a reply message in a watched forum thread, so it reaches the agent. */
export function forwardMessage(payload: MessagePayload): Promise<void> {
  return ingestFireAndForget(payload, "message");
}

/** Autocomplete choice shape Discord expects. */
export interface RepoChoice {
  name: string;
  value: string;
}

/**
 * Fetch repo autocomplete choices from PostHog. Short timeout because Discord
 * autocomplete has a hard 3 s budget and there's no defer for it; returns `[]`
 * on any failure so the dropdown just shows nothing.
 */
export async function fetchRepos(
  guildId: string | null,
  userId: string,
  query: string
): Promise<RepoChoice[]> {
  const url = new URL(`${appHostForGuild(guildId)}/api/discord/repos`);
  if (guildId) url.searchParams.set("guild_id", guildId);
  url.searchParams.set("user_id", userId);
  if (query) url.searchParams.set("query", query);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPOS_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: bearerHeaders(), signal: controller.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      choices?: RepoChoice[];
      repos?: string[];
    };
    const choices =
      data.choices ?? (data.repos ?? []).map((r) => ({ name: r, value: r }));
    return choices.slice(0, 25);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Re-exported for the actions server, which needs the same app id. */
export const applicationId = config.discordClientId;
