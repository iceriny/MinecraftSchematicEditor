import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, WebSocketClient } from "vite";
import type { BridgeReply, EditorCommand } from "../src/automation/protocol";

interface Session {
  client: WebSocketClient;
  summary: Record<string, unknown>;
  lastSeen: number;
}
interface Pending {
  client: WebSocketClient;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 96 * 1024 * 1024) throw new Error("Request exceeds the 96 MiB limit.");
    chunks.push(bytes);
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected a JSON object.");
  return body as Record<string, unknown>;
}

/** Authenticated local command relay; all editing runs through typed engine commands. */
export function mcpBridge(): Plugin {
  return {
    name: "schematic-mcp-bridge",
    apply: "serve",
    async configureServer(server) {
      const token = randomBytes(32).toString("hex");
      const tokenBytes = Buffer.from(token);
      const sessions = new Map<string, Session>();
      const pending = new Map<string, Pending>();
      const runtimeFile = join(server.config.root, "run.local", "mcp-bridge.json");
      const port = server.config.server.port ?? 5173;
      const url = `http://127.0.0.1:${port}`;
      await mkdir(join(server.config.root, "run.local"), { recursive: true });
      await writeFile(runtimeFile, JSON.stringify({ token, url, pid: process.pid }), { mode: 0o600 });

      const forget = (client: WebSocketClient) => {
        for (const [id, session] of sessions) if (session.client === client) sessions.delete(id);
        for (const [id, request] of pending) {
          if (request.client !== client) continue;
          clearTimeout(request.timer);
          request.reject(new Error("Editor disconnected. Inspect its state before retrying a modification."));
          pending.delete(id);
        }
      };
      const tracked = new WeakSet<WebSocketClient>();
      server.ws.on("mcp:hello", (data: Record<string, unknown>, client) => {
        if (typeof data?.id !== "string" || data.id.length > 100) return;
        if (!tracked.has(client)) {
          tracked.add(client);
          client.socket.once("close", () => forget(client));
        }
        sessions.set(data.id, { client, summary: data, lastSeen: Date.now() });
      });
      server.ws.on("mcp:bye", (_data, client) => forget(client));
      server.ws.on("mcp:result", (reply: BridgeReply, client) => {
        const request = pending.get(reply?.id);
        if (!request || request.client !== client) return;
        clearTimeout(request.timer);
        pending.delete(reply.id);
        if (reply.error) request.reject(new Error(reply.error));
        else request.resolve(reply.result);
      });

      server.middlewares.use("/__mcp", async (req, res) => {
        const address = req.socket.remoteAddress;
        if (!address || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) {
          return json(res, 403, { error: "Loopback connections only." });
        }
        const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
        if (!req.headers.host || !allowedHosts.includes(req.headers.host) ||
            (req.headers.origin && !allowedHosts.some((host) => req.headers.origin === `http://${host}`))) {
          return json(res, 403, { error: "Unexpected Host or Origin." });
        }
        const received = Buffer.from(req.headers.authorization?.replace(/^Bearer /, "") ?? "");
        if (received.length !== tokenBytes.length || !timingSafeEqual(received, tokenBytes)) {
          return json(res, 401, { error: "Valid local bridge token required." });
        }
        const path = new URL(req.url ?? "", url).pathname;
        if (req.method === "GET" && path === "/status") {
          return json(res, 200, {
            url, clients: [...sessions].map(([id, session]) => ({ ...session.summary, id, lastSeen: session.lastSeen })),
          });
        }
        if (req.method !== "POST" || path !== "/command") return json(res, 404, { error: "Unknown bridge endpoint." });
        try {
          const body = await readBody(req);
          const command = body.command as EditorCommand | undefined;
          if (!command || !["status", "new", "open", "export", "inspect", "edit", "history", "resources", "view", "documents"].includes(command.action)) {
            return json(res, 400, { error: "Unknown editor command." });
          }
          const id = typeof body.clientId === "string" ? body.clientId : undefined;
          if (!id && sessions.size > 1) return json(res, 409, { error: "Multiple editor tabs are connected. Choose clientId from schematic_status." });
          const session = id ? sessions.get(id) : sessions.values().next().value;
          if (!session) return json(res, 503, { error: "Open the Schematic Editor browser tab first." });
          const requestId = randomUUID();
          const result = await new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
              pending.delete(requestId);
              session.client.send("mcp:cancel", { id: requestId });
              reject(new Error("Editor command timed out. Inspect state before retrying a modification."));
            }, 30_000);
            pending.set(requestId, { client: session.client, resolve, reject, timer });
            session.client.send("mcp:command", { id: requestId, command });
          });
          json(res, 200, { result });
        } catch (cause) {
          json(res, 400, { error: cause instanceof Error ? cause.message : String(cause) });
        }
      });
      server.httpServer?.once("close", () => {
        for (const session of sessions.values()) forget(session.client);
      });
    },
  };
}
