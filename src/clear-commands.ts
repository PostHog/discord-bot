import { clearGuildCommands } from "@/commandRegistry.js";

/**
 * Dev-only: remove all of this app's commands from a single guild (instant).
 * The bot re-registers `/ph` on join and on the next `guildCreate`, so this is
 * for clearing a dev guild while iterating — not a production teardown.
 *
 *   npm run clear-commands -- <guild-id>
 */
async function main(): Promise<void> {
  const guildId = process.argv[2];
  if (!guildId) {
    throw new Error("usage: npm run clear-commands -- <guild-id>");
  }
  await clearGuildCommands(guildId);
  console.log(`Cleared all commands from guild ${guildId}.`);
}

main().catch((err) => {
  console.error("Failed to clear commands:", err);
  process.exit(1);
});
