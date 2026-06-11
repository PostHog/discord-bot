import { Routes } from "discord.js";

import { rest } from "@/bridge/discordRest.js";
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
export const commandPayload = [phCommand];

export async function registerGuildCommands(guildId: string): Promise<void> {
  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, guildId),
    { body: commandPayload }
  );
}

/** Remove all of this app's commands from a guild. Used by the dev script. */
export async function clearGuildCommands(guildId: string): Promise<void> {
  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, guildId),
    { body: [] }
  );
}
