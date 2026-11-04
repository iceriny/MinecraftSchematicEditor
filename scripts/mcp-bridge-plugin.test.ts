import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ViteDevServer, WebSocketClient } from "vite";
import { mcpBridge } from "./mcp-bridge-plugin";

test("bridge authenticates, isolates tabs and matches replies to the requesting socket", async () => {
  const root = await mkdtemp(join(tmpdir(), "schematic-bridge-"));
  const events = new EventEmitter();
  let middleware: (req: any, res: any) => void = (_req, res) => res.end();
  const http = createServer((req, res) => {
    req.url = req.url?.replace(/^\/__mcp/, "");
    middleware(req, res);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const server = {
    config: { root, server: { port: address.port } },
    ws: events,
    httpServer: http,
    middlewares: { use: (_path: string, handler: typeof middleware) => { middleware = handler; } },
  } as unknown as ViteDevServer;
  const hook = mcpBridge().configureServer!;
  await (hook as (server: ViteDevServer) => void | Promise<void>)(server);
  const runtime = JSON.parse(await readFile(join(root, "run.local/mcp-bridge.json"), "utf8"));
  const auth = { Authorization: `Bearer ${runtime.token}` };
  const request = (body: object, headers = auth) => fetch(`${url}/__mcp/command`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const client = (send: (event: string, data: any) => void) => ({ socket: new EventEmitter(), send }) as unknown as WebSocketClient;
  const first = client((event, data) => {
    if (event !== "mcp:command") return;
    // Another socket cannot forge the result for this request.
    events.emit("mcp:result", { id: data.id, result: "forged" }, second);
    events.emit("mcp:result", { id: data.id, result: { blocks: 42 } }, first);
  });
  const second = client(() => {});
  try {
    assert.equal((await fetch(`${url}/__mcp/status`)).status, 401);
    assert.equal((await fetch(`${url}/__mcp/status`, { headers: { ...auth, Origin: "https://other.example" } })).status, 403);
    assert.equal((await request({ command: { action: "status" } })).status, 503);
    events.emit("mcp:hello", { id: "first", name: "Original" }, first);
    const status = await (await fetch(`${url}/__mcp/status`, { headers: auth })).json();
    assert.equal(status.clients[0].name, "Original");
    assert.deepEqual(await (await request({ command: { action: "status" } })).json(), { result: { blocks: 42 } });
    events.emit("mcp:hello", { id: "second" }, second);
    assert.equal((await request({ command: { action: "status" } })).status, 409);
    assert.deepEqual(await (await request({ clientId: "first", command: { action: "status" } })).json(), { result: { blocks: 42 } });
    assert.equal((await request({ clientId: "missing", command: { action: "status" } })).status, 503);
    assert.equal((await request({ command: { action: "eval" } })).status, 400);
    events.emit("mcp:bye", { id: "second" }, second);
    const again = await (await fetch(`${url}/__mcp/status`, { headers: auth })).json();
    assert.equal(again.clients.length, 1);
  } finally {
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
