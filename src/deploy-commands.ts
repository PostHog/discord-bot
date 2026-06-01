import { REST, Routes } from "discord.js";

import { analyticsCommand } from "./commands/analytics.js";
import { config } from "./config.js";

/**
 * One-off script to register slash commands with Discord.
 *
 *   npm run deploy-commands                  # register globally (up to ~1h to propagate)
 *   npm run deploy-commands -- --guild <id>  # register to one guild (instant, for dev)
 *   npm run deploy-commands -- --guild       # uses DEV_GUILD_ID from .env
 */
async function main(): Promise<void> {
  const commands = [analyticsCommand];
  const rest = new REST({ version: "10" }).setToken(config.discordToken);

  const guildFlagIndex = process.argv.indexOf("--guild");
  const guildId =
    guildFlagIndex !== -1
      ? process.argv[guildFlagIndex + 1] || config.devGuildId
      : undefined;

  if (guildFlagIndex !== -1) {
    if (!guildId) {
      throw new Error(
        "--guild requires a guild id (pass one, or set DEV_GUILD_ID in .env)"
      );
    }
    await rest.put(
      Routes.applicationGuildCommands(config.discordClientId, guildId),
      { body: commands }
    );
    console.log(`Registered ${commands.length} command(s) to guild ${guildId}.`);
  } else {
    await rest.put(Routes.applicationCommands(config.discordClientId), {
      body: commands,
    });
    console.log(
      `Registered ${commands.length} command(s) globally. ` +
        "Global commands can take up to an hour to appear."
    );
  }
}

main().catch((err) => {
  console.error("Failed to deploy commands:", err);
  process.exit(1);
});
