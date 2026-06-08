import { REST, Routes } from "discord.js";

import { analyticsCommand } from "@/commands/analytics.js";
import { config } from "@/config.js";

/**
 * Slash-command registration. The bot registers commands per-guild: the
 * `guildCreate` handler does it the moment the bot is added to a server (so
 * `/analytics` appears instantly), and the `ready` handler backfills guilds the
 * bot is already in on startup (`guildCreate` only fires for *new* joins).
 *
 * There is deliberately no global registration — per-guild is instant and
 * self-healing, and mixing the two namespaces would show duplicate commands.
 */
export const commandPayload = [analyticsCommand];

export async function registerGuildCommands(guildId: string): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, guildId),
    { body: commandPayload }
  );
}
