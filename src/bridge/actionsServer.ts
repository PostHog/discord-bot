import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { Routes } from "discord.js";

import { verifyBearer } from "@/bridge/auth.js";
import { rest } from "@/bridge/discordRest.js";
import { applicationId } from "@/bridge/forward.js";
import {
  addWatchedThread,
  clearConfig,
  removeWatchedThread,
  upsertPosthog,
} from "@/db.js";
import { hostForRegion } from "@/regions.js";
import { nowMs } from "@/time.js";

/**
 * The actions API (PostHog → bot). PostHog Code does its work asynchronously and
 * calls back here to drive Discord: create threads, post/edit/delete messages,
 * add/remove reactions. Each op maps to a Discord REST call via the shared
 * `rest` client. When an `interaction_token` is supplied the bot uses the
 * interaction webhook routes (valid ~15 min, can post ephemeral); otherwise it
 * uses bot-token channel routes.
 */

const MAX_BODY_BYTES = 1024 * 1024;
const EPHEMERAL_FLAG = 64;

export interface ActionResult {
  status: number;
  body: unknown;
}

type Fields = Record<string, unknown>;

const str = (v: unknown): string => String(v ?? "");

/**
 * Dispatch one action op to Discord. Pure of HTTP concerns so it can be unit
 * tested by calling it directly with a mocked `rest`.
 */
export async function handleAction(op: string, fields: Fields): Promise<ActionResult> {
  switch (op) {
    case "create_thread": {
      const channelId = str(fields.channel_id);
      const messageId = fields.message_id ? str(fields.message_id) : undefined;
      const route = messageId
        ? Routes.threads(channelId, messageId)
        : Routes.threads(channelId);
      // A thread anchored to a message takes just a name; a standalone thread
      // also needs a type (11 = public thread).
      const body = messageId
        ? { name: fields.name }
        : { name: fields.name, type: 11 };
      const thread = (await rest.post(route, { body })) as { id: string };
      return { status: 200, body: { thread_id: thread.id } };
    }

    case "post_message": {
      const token = fields.interaction_token ? str(fields.interaction_token) : undefined;
      const common = {
        content: fields.content,
        embeds: fields.embeds,
        components: fields.components,
      };
      let route: `/${string}`;
      let body: Record<string, unknown>;
      let auth: boolean;
      if (token) {
        route = Routes.webhook(applicationId, token);
        body = { ...common, ...(fields.ephemeral ? { flags: EPHEMERAL_FLAG } : {}) };
        auth = false; // interaction webhooks authenticate via the token in the URL
      } else {
        route = Routes.channelMessages(str(fields.target_id));
        body = common;
        auth = true;
      }
      const msg = (await rest.post(route, { body, auth })) as { id: string };
      return { status: 200, body: { message_id: msg.id } };
    }

    case "edit_message": {
      const token = fields.interaction_token ? str(fields.interaction_token) : undefined;
      const route = token
        ? Routes.webhookMessage(applicationId, token, "@original")
        : Routes.channelMessage(str(fields.target_id), str(fields.message_id));
      await rest.patch(route, {
        body: {
          content: fields.content,
          embeds: fields.embeds,
          components: fields.components,
        },
        auth: !token,
      });
      return { status: 200, body: { ok: true } };
    }

    case "delete_message": {
      await rest.delete(
        Routes.channelMessage(str(fields.target_id), str(fields.message_id))
      );
      return { status: 200, body: { ok: true } };
    }

    case "add_reaction": {
      // emoji is passed through verbatim (already URL-encoded unicode or name:id).
      await rest.put(
        Routes.channelMessageOwnReaction(
          str(fields.channel_id),
          str(fields.message_id),
          str(fields.emoji)
        )
      );
      return { status: 200, body: { ok: true } };
    }

    case "remove_reaction": {
      await rest.delete(
        Routes.channelMessageOwnReaction(
          str(fields.channel_id),
          str(fields.message_id),
          str(fields.emoji)
        )
      );
      return { status: 200, body: { ok: true } };
    }

    case "connect_guild": {
      // Push from PostHog after an admin confirms `/ph connect`: bind this
      // guild's analytics capture to the chosen project. Replaces the old
      // `/ph analytics setup` modal — the project key now comes from PostHog,
      // never pasted into Discord. An empty key disconnects.
      const guildId = str(fields.guild_id);
      if (!guildId) return { status: 400, body: { error: "missing guild_id" } };
      const apiKey = fields.project_api_key ? str(fields.project_api_key) : "";
      if (apiKey) {
        // Host is derived from the region, never taken as free text.
        upsertPosthog(guildId, apiKey, hostForRegion(str(fields.region)), nowMs());
      } else {
        clearConfig(guildId);
      }
      return { status: 200, body: { ok: true } };
    }

    case "watch_thread":
    case "unwatch_thread": {
      // Register/unregister a thread so its replies are forwarded as kind:"message"
      // (e.g. a thread PostHog Code created off a /ph code invocation).
      const guildId = str(fields.guild_id);
      const threadId = str(fields.thread_id);
      if (!guildId || !threadId) {
        return { status: 400, body: { error: "missing guild_id or thread_id" } };
      }
      if (op === "watch_thread") addWatchedThread(guildId, threadId);
      else removeWatchedThread(guildId, threadId);
      return { status: 200, body: { ok: true } };
    }

    default:
      return { status: 400, body: { error: `unknown op: ${op}` } };
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? "").split("?")[0];

  if (req.method === "GET" && path === "/health") {
    return sendJson(res, 200, { ok: true });
  }
  if (req.method !== "POST" || path !== "/actions") {
    return sendJson(res, 404, { error: "not found" });
  }
  if (!verifyBearer(req.headers.authorization)) {
    return sendJson(res, 401, { error: "unauthorized" });
  }

  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    return sendJson(res, 413, { error: "body too large" });
  }

  let parsed: { op?: unknown } & Fields;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return sendJson(res, 400, { error: "invalid json" });
  }

  const { op, ...fields } = parsed;
  if (typeof op !== "string") {
    return sendJson(res, 400, { error: "missing op" });
  }

  try {
    const result = await handleAction(op, fields);
    return sendJson(res, result.status, result.body);
  } catch (err) {
    console.error("[bridge] action failed:", err);
    return sendJson(res, 500, { error: "action failed" });
  }
}

/** Create the actions HTTP server (call `.listen(port, host)` to start it). */
export function createActionsServer(): Server {
  return createServer((req, res) => {
    void handleRequest(req, res);
  });
}
