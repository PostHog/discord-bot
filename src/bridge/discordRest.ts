import { REST } from "discord.js";

import { config } from "@/config.js";

/**
 * One shared discord.js REST client, reused for slash-command registration
 * (`commandRegistry`) and for the actions API's raw Discord calls
 * (`actionsServer`). Using a singleton keeps a single rate-limit bucket.
 */
export const rest = new REST({ version: "10" }).setToken(config.discordToken);
