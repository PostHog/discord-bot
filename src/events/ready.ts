import { type Client, Events } from "discord.js";

import { registerGuildCommands } from "@/commandRegistry.js";
import { getGuildConfig } from "@/configCache.js";
import { getPostHogClient } from "@/posthogPool.js";

/**
 * On ready, log status and run a `groupIdentify` for every configured guild so
 * PostHog has up-to-date group properties (name, member count) for the
 * `discord_server` group used on all events.
 *
 * Also re-registers slash commands for every guild. `guildCreate` only fires on
 * new joins, so without this a deploy that changes `/ph` options (e.g. the rate
 * trigger options) would never reach servers the bot is already in. The PUT is
 * idempotent, so re-registering unchanged commands is harmless.
 */
export function register(client: Client): void {
  client.once(Events.ClientReady, (ready) => {
    console.log(
      `Logged in as ${ready.user.tag} — serving ${ready.guilds.cache.size} guild(s).`
    );

    void (async () => {
      // Sequential, to stay well inside Discord's rate limits.
      for (const guildId of ready.guilds.cache.keys()) {
        try {
          await registerGuildCommands(guildId);
        } catch (err) {
          console.error(`[ready] command registration failed for ${guildId}:`, err);
        }
      }
    })();

    for (const guild of ready.guilds.cache.values()) {
      const cfg = getGuildConfig(guild.id);
      if (!cfg?.posthogApiKey) continue;
      try {
        const client = getPostHogClient(cfg.posthogHost, cfg.posthogApiKey);
        client.groupIdentify({
          groupType: "discord_server",
          groupKey: guild.id,
          properties: {
            name: guild.name,
            member_count: guild.memberCount,
          },
        });
      } catch (err) {
        console.error(`[ready] groupIdentify failed for ${guild.id}:`, err);
      }
    }
  });
}
