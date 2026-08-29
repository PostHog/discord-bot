import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from "discord.js";

import { createActionsServer } from "@/bridge/actionsServer.js";
import { config } from "@/config.js";
import { closeDb } from "@/db.js";
import { routeInteraction } from "@/interactions/router.js";
import { shutdownAll } from "@/posthogPool.js";
import * as snapshots from "@/snapshots.js";

import * as forumPosts from "@/events/forumPosts.js";
import * as guildCreate from "@/events/guildCreate.js";
import * as guildDelete from "@/events/guildDelete.js";
import * as members from "@/events/members.js";
import * as messages from "@/events/messages.js";
import * as reactions from "@/events/reactions.js";
import * as ready from "@/events/ready.js";
import * as threads from "@/events/threads.js";
import * as voice from "@/events/voice.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    // Privileged — needed for member_joined / member_left. Enable in the
    // Developer Portal. Required for the bot's core member analytics.
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    // Privileged — derives message metadata (length, mentions), and carries the
    // text itself for guilds that opted in via `/ph analytics options`.
    // Optional: without it message_sent still fires.
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
  ],
  // Needed to receive events for objects that aren't in the cache (e.g. reactions
  // on old messages, members/messages the bot hasn't seen this session).
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.GuildMember,
    Partials.User,
  ],
});

// Register all event handlers.
ready.register(client);
guildCreate.register(client);
guildDelete.register(client);
messages.register(client);
members.register(client);
reactions.register(client);
voice.register(client);
threads.register(client);
forumPosts.register(client);
snapshots.register(client);

// Slash-command / modal / select-menu interactions.
client.on(Events.InteractionCreate, (interaction) => {
  void routeInteraction(interaction);
});

client.on(Events.Error, (err) => {
  console.error("[client] error:", err);
});

// Inbound actions API for the PostHog Code bridge (PostHog → bot).
const actionsServer = createActionsServer();
actionsServer.listen(config.actionsBind.port, config.actionsBind.host, () => {
  console.log(
    `Actions API listening on ${config.actionsBind.host}:${config.actionsBind.port}.`
  );
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nReceived ${signal}, shutting down…`);
  try {
    snapshots.stopSnapshots();
    actionsServer.close();
    client.removeAllListeners();
    await client.destroy();
    // Flush all pending analytics before exiting.
    await shutdownAll();
    closeDb();
  } catch (err) {
    console.error("[shutdown] error:", err);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

client.login(config.discordToken).catch((err) => {
  console.error("Failed to log in:", err);
  process.exit(1);
});
