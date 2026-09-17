import { Routes } from "discord.js";

import { rest } from "@/bridge/discordRest.js";
import { ideaMessageCommand } from "@/commands/idea.js";
import { phCommand } from "@/commands/ph.js";
import { config } from "@/config.js";

/**
 * Slash-command registration. The bot registers commands per-guild: the
 * `guildCreate` handler does it the moment the bot is added to a server (so
 * `/ph` appears instantly), and the `ready` handler backfills guilds the bot is
 * already in on startup (`guildCreate` only fires for *new* joins).
 *
 * There is deliberately no global registration — per-guild is instant and
 * self-healing, and mixing the two namespaces would show duplicate commands.
 */
/**
 * Commands for one guild. `/ph` goes everywhere; the roadmap-idea message
 * action is added only where the feature is configured, so members of other
 * servers never see an entry that would refuse them.
 */
export function commandsForGuild(guildId: string): unknown[] {
  const idea = config.roadmapIdea;
  const ideaEnabled =
    idea !== undefined && (idea.guildIds.length === 0 || idea.guildIds.includes(guildId));
  return ideaEnabled ? [phCommand, ideaMessageCommand] : [phCommand];
}

export async function registerGuildCommands(guildId: string): Promise<void> {
  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, guildId),
    { body: commandsForGuild(guildId) }
  );
}

/** Remove all of this app's commands from a guild. Used by the dev script. */
export async function clearGuildCommands(guildId: string): Promise<void> {
  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, guildId),
    { body: [] }
  );
}
