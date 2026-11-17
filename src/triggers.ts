import type {
  GuildMember,
  Message,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  User,
  VoiceBasedChannel,
} from "discord.js";

import { captureCustomEvent, toPersonLike } from "@/capture.js";
import type { Trigger, TriggerConditions } from "@/db.js";
import { channelProps, guildProps, messageProps } from "@/props.js";
import { recordRateHit } from "@/rateWindow.js";
import { nowMs } from "@/time.js";
import { getGuildTriggers } from "@/triggersCache.js";

/** A trigger that matched, plus the auto-context describing *what* matched. */
interface TriggerMatch {
  trigger: Trigger;
  matchProps: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Pure matchers
// ---------------------------------------------------------------------------

/** Channel filter passes if no channels are configured, or the id is in the set. */
export function matchChannel(
  conditions: TriggerConditions,
  channelId: string | null | undefined
): boolean {
  const ids = conditions.channelIds;
  if (!ids || ids.length === 0) return true;
  return channelId != null && ids.includes(channelId);
}

/** Case-insensitive content match. Returns the term that matched, if any. */
export function matchContent(
  content: string,
  cond: NonNullable<TriggerConditions["content"]>
): { ok: boolean; term?: string } {
  const hay = content.toLowerCase();
  for (const raw of cond.terms) {
    const needle = raw.toLowerCase();
    if (!needle) continue;
    const hit =
      cond.mode === "starts_with"
        ? hay.startsWith(needle)
        : hay.includes(needle);
    if (hit) return { ok: true, term: raw };
  }
  return { ok: false };
}

/** Lowercased file extension without the dot, or "" if none. */
export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * New-member filter passes if not configured, or the author joined less than
 * `hours` ago. An unknown join time fails: for a pager, missing a borderline
 * message is better than counting established members.
 */
export function matchNewMember(
  hours: number | undefined,
  joinedTimestamp: number | null | undefined,
  now: number
): boolean {
  if (hours == null) return true;
  if (joinedTimestamp == null) return false;
  return now - joinedTimestamp < hours * HOUR_MS;
}

/** Does the emoji condition match the reacted emoji? */
export function matchEmoji(
  cond: NonNullable<TriggerConditions["emoji"]>,
  emoji: { name: string | null; id: string | null }
): boolean {
  if (cond.kind === "custom") return emoji.id === cond.id;
  return emoji.name === cond.value;
}

// ---------------------------------------------------------------------------
// Per-source evaluators
// ---------------------------------------------------------------------------

function enabledTriggers(guildId: string): Trigger[] {
  return getGuildTriggers(guildId).filter((t) => t.enabled);
}

/** Evaluate message + file triggers against a guild message. */
export function evaluateMessage(message: Message<true>): TriggerMatch[] {
  const out: TriggerMatch[] = [];
  const now = nowMs();
  for (const trigger of enabledTriggers(message.guildId)) {
    if (trigger.source !== "message" && trigger.source !== "file") continue;
    const c = trigger.conditions;
    if (!matchChannel(c, message.channelId)) continue;

    const matchProps: Record<string, unknown> = {};

    if (trigger.source === "file") {
      if (message.attachments.size === 0) continue;
      const wanted = c.fileExtensions;
      const attachment = [...message.attachments.values()].find((a) => {
        if (!wanted || wanted.length === 0) return true;
        return wanted.includes(fileExtension(a.name ?? ""));
      });
      if (!attachment) continue;
      matchProps.file_name = attachment.name;
      matchProps.file_extension = fileExtension(attachment.name ?? "");
    }

    if (c.content) {
      const res = matchContent(message.content, c.content);
      if (!res.ok) continue;
      matchProps.matched_term = res.term;
    }

    if (c.newMemberHours != null) {
      const joined = message.member?.joinedTimestamp;
      if (!matchNewMember(c.newMemberHours, joined, now)) continue;
      matchProps.new_member_hours = c.newMemberHours;
      matchProps.member_joined_hours_ago =
        Math.round(((now - joined!) / HOUR_MS) * 10) / 10;
    }

    // Rate gate: count this match, fire only when the window hits the threshold.
    // Bots/webhooks never count (they'd be dropped by the ignore_bots gate after
    // already consuming the burst).
    if (c.rate) {
      if (message.author.bot) continue;
      const burst = recordRateHit(message.guildId, trigger.id, c.rate, {
        ts: now,
        authorId: message.author.id,
        channelId: message.channelId,
        messageId: message.id,
      });
      if (!burst) continue;
      // Per-message details describe only the last message; drop them so the
      // event describes the burst.
      delete matchProps.member_joined_hours_ago;
      delete matchProps.file_name;
      delete matchProps.file_extension;
      Object.assign(matchProps, burst);
    }

    out.push({ trigger, matchProps });
  }
  return out;
}

/** Evaluate reaction triggers. */
export function evaluateReaction(
  reaction: MessageReaction | PartialMessageReaction
): TriggerMatch[] {
  const guildId = reaction.message.guildId;
  if (!guildId) return [];
  const out: TriggerMatch[] = [];
  for (const trigger of enabledTriggers(guildId)) {
    if (trigger.source !== "reaction") continue;
    const c = trigger.conditions;
    if (!matchChannel(c, reaction.message.channelId)) continue;
    if (c.emoji && !matchEmoji(c.emoji, reaction.emoji)) continue;
    out.push({
      trigger,
      matchProps: {
        matched_emoji: reaction.emoji.name,
        matched_emoji_id: reaction.emoji.id,
      },
    });
  }
  return out;
}

/** Evaluate member-join triggers (no further conditions). */
export function evaluateMemberJoin(member: GuildMember): TriggerMatch[] {
  return enabledTriggers(member.guild.id)
    .filter((t) => t.source === "member_join")
    .map((trigger) => ({ trigger, matchProps: {} }));
}

/** Evaluate voice-join triggers against the joined channel. */
export function evaluateVoiceJoin(
  member: GuildMember,
  channel: VoiceBasedChannel
): TriggerMatch[] {
  const out: TriggerMatch[] = [];
  for (const trigger of enabledTriggers(member.guild.id)) {
    if (trigger.source !== "voice_join") continue;
    if (!matchChannel(trigger.conditions, channel.id)) continue;
    out.push({ trigger, matchProps: {} });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runners — evaluate, then emit a custom PostHog event per match
// ---------------------------------------------------------------------------

function emit(
  guildId: string,
  match: TriggerMatch,
  distinctId: string,
  actor: Parameters<typeof captureCustomEvent>[0]["actor"],
  baseProps: Record<string, unknown>
): void {
  captureCustomEvent({
    guildId,
    event: match.trigger.eventName,
    distinctId,
    actor,
    properties: {
      ...baseProps,
      ...match.matchProps,
      trigger_id: match.trigger.id,
      trigger_name: match.trigger.name,
      trigger_source: match.trigger.source,
    },
  });
}

export function runMessageTriggers(message: Message<true>): void {
  const matches = evaluateMessage(message);
  if (matches.length === 0) return;
  const baseProps = {
    ...guildProps(message.guild),
    ...channelProps(message.channel),
    // For rate triggers this is the message that tipped the threshold.
    ...messageProps(message),
  };
  for (const m of matches) {
    emit(message.guildId, m, message.author.id, toPersonLike(message.author), baseProps);
  }
}

export function runReactionTriggers(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
): void {
  const guildId = reaction.message.guildId;
  if (!guildId) return;
  const matches = evaluateReaction(reaction);
  if (matches.length === 0) return;
  // message_* describes the message that was reacted to.
  const baseProps = {
    ...channelProps(reaction.message.channel),
    ...messageProps(reaction.message),
  };
  const actor = user.partial ? undefined : toPersonLike(user);
  for (const m of matches) {
    emit(guildId, m, user.id, actor, baseProps);
  }
}

export function runMemberJoinTriggers(member: GuildMember): void {
  const matches = evaluateMemberJoin(member);
  if (matches.length === 0) return;
  const baseProps = { ...guildProps(member.guild) };
  for (const m of matches) {
    emit(member.guild.id, m, member.id, toPersonLike(member.user), baseProps);
  }
}

export function runVoiceJoinTriggers(
  member: GuildMember,
  channel: VoiceBasedChannel
): void {
  const matches = evaluateVoiceJoin(member, channel);
  if (matches.length === 0) return;
  const baseProps = {
    ...guildProps(member.guild),
    channel_id: channel.id,
    channel_name: channel.name,
  };
  for (const m of matches) {
    emit(member.guild.id, m, member.id, toPersonLike(member.user), baseProps);
  }
}
