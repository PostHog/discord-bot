import { registerGuildCommands } from "@/commandRegistry.js";

/**
 * Dev-only: register `/ph` for a single guild (instant). Production relies on
 * per-guild auto-registration in the `guildCreate` handler; this is for local
 * iteration on the command tree — re-run it after editing `commands/ph.ts`.
 *
 *   npm run register-commands -- <guild-id>
 */
async function main(): Promise<void> {
  const guildId = process.argv[2];
  if (!guildId) {
    throw new Error("usage: npm run register-commands -- <guild-id>");
  }
  await registerGuildCommands(guildId);
  console.log(`Registered /ph for guild ${guildId}.`);
}

main().catch((err) => {
  console.error("Failed to register commands:", err);
  process.exit(1);
});
