import { type Client, Events } from "discord.js";

import { getGuildConfig } from "@/configCache.js";
import { getPostHogClient } from "@/posthogPool.js";

/**
 * On ready, log status and run a `groupIdentify` for every configured guild so
 * PostHog has up-to-date group properties (name, member count) for the
 * `discord_server` group used on all events.
 *
 * Slash commands are not (re)registered here: `guildCreate` registers them on
 * join and Discord persists them server-side across restarts.
 */
export function register(client: Client): void {
  client.once(Events.ClientReady, (ready) => {
    console.log(
      `Logged in as ${ready.user.tag} — serving ${ready.guilds.cache.size} guild(s).`
    );

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
