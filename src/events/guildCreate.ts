import { type Client, Events, PermissionFlagsBits } from "discord.js";

import { registerGuildCommands } from "@/commandRegistry.js";

/**
 * When the bot is added to a new server, register its slash commands for that
 * guild (instant, so `/analytics` works right away) and post a one-time hint in
 * the system channel (if we can) telling an admin how to get started. Purely
 * onboarding — no analytics are sent until an admin runs `/analytics setup`.
 */
export function register(client: Client): void {
  client.on(Events.GuildCreate, async (guild) => {
    console.log(`Joined guild ${guild.name} (${guild.id}).`);

    try {
      await registerGuildCommands(guild.id);
      console.log(`Registered slash commands for guild ${guild.id}.`);
    } catch (err) {
      console.error(
        `[guildCreate] failed to register commands for ${guild.id}:`,
        err
      );
    }

    const channel = guild.systemChannel;
    if (!channel) return;

    const me = guild.members.me;
    if (
      me &&
      !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)
    ) {
      return;
    }

    try {
      await channel.send(
        "👋 Thanks for adding **PostHog Analytics**!\n\n" +
          "An admin can connect this server to PostHog with `/analytics setup`, " +
          "then choose what to track with `/analytics events`. " +
          "No data is sent until you do. Use `/analytics status` any time to review."
      );
    } catch {
      // Missing permissions or similar — ignore, onboarding is best-effort.
    }
  });
}
