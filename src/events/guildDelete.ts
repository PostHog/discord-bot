import { type Client, Events } from "discord.js";

import { purgeGuild } from "@/db.js";

/**
 * When the bot is removed from a server, purge that guild's stored config and
 * triggers so we don't retain its PostHog key or settings. Discord deletes the
 * bot's guild-scoped slash commands automatically on removal, so there's
 * nothing to unregister here.
 *
 * `GuildDelete` also fires during Discord outages, when a guild goes temporarily
 * unavailable rather than being left. We skip those (`available === false`) so a
 * blip doesn't wipe real data.
 */
export function register(client: Client): void {
  client.on(Events.GuildDelete, (guild) => {
    if (guild.available === false) return; // transient outage, not a removal

    console.log(`Removed from guild ${guild.name ?? guild.id} (${guild.id}); purging stored data.`);
    try {
      purgeGuild(guild.id);
    } catch (err) {
      console.error(`[guildDelete] failed to purge ${guild.id}:`, err);
    }
  });
}
