import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BridgeClient, type BrowserBridge } from "./bridge-client";
import { createMcpServer } from "./server";

const offlineBridge: BrowserBridge = {
  async status() { throw new Error("Browser offline"); },
  async command() { throw new Error("Browser offline"); },
};

async function connect(t: { after: (fn: () => unknown) => void }, bridge = offlineBridge) {
  const server = createMcpServer({ bridge });
  const client = new Client({ name: "schematic-test", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  return result.structuredContent as Record<string, unknown>;
}

test("MCP discovers tools and edits/undoes a document with no browser", async (t) => {
  const client = await connect(t);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 12);
  for (const tool of tools.tools) {
    assert.ok(!JSON.stringify(tool.inputSchema).includes('"prefixItems"'), "Tool schemas must use homogeneous coordinate arrays for host compatibility.");
  }
  assert.equal(tools.tools.find((tool) => tool.name === "schematic_inspect")?.annotations?.readOnlyHint, true);
  const created = await call(client, "schematic_new", { size: [4, 3, 4], name: "MCP workshop" });
  assert.deepEqual(created.size, [4, 3, 4]);
  const edited = await call(client, "schematic_edit", {
    expectedRevision: created.revision,
    operations: [{ type: "fill", box: { min: [0, 0, 0], max: [3, 0, 3] }, block: "minecraft:stone" }],
  });
  assert.equal(edited.blocks, 16);
  const inspected = await call(client, "schematic_inspect", { limit: 2 });
  assert.equal(inspected.blocks, 16);
  assert.equal((inspected.entries as unknown[]).length, 2);
  assert.equal(inspected.nextOffset, 2);
  const stale = await client.callTool({ name: "schematic_edit", arguments: {
    expectedRevision: created.revision,
    operations: [{ type: "set", blocks: [{ at: [0, 1, 0], block: "minecraft:glass" }] }],
  } });
  assert.equal(stale.isError, true);
  const undone = await call(client, "schematic_history", { direction: "undo" });
  assert.equal(undone.blocks, 0);
  const redone = await call(client, "schematic_history", { direction: "redo" });
  assert.equal(redone.blocks, 16);
  const status = await call(client, "schematic_status");
  assert.equal((status.browser as Record<string, unknown>).available, false);
  assert.equal((status.headless as Record<string, unknown>).blocks, 16);
});

test("relative paint, room material counts and compact replies through MCP", async (t) => {
  const client = await connect(t);
  await call(client, "schematic_new", {size:[12,8,12]});
  const result = await call(client, "schematic_edit", {origin:[6,2,6],operations:[
    {type:"paint",block:"astralsorcery:marble_bricks",at:[[-2,0,-1],[2,0,-1],[2,0,1]]},
    {type:"copy",box:{min:[-2,0,-1],max:[-2,0,-1]},to:[-2,0,1]},
    {type:"set",blocks:[{at:[0,1,0],block:"lantern"}]},
  ]});
  assert.equal(result.changed,5);
  assert.equal(result.materialCount,2);
  assert.equal(result.materials,undefined);
  const counts = await call(client,"schematic_inspect",{mode:"materials",box:{min:[4,2,5],max:[8,2,7]},includeAir:true,limit:1});
  assert.deepEqual(counts.entries,[{state:"minecraft:air",count:11}]);
  assert.equal(counts.nextOffset,1);
  assert.equal(counts.blocksInRegion,15);
  const second = await call(client,"schematic_inspect",{mode:"materials",box:counts.box,includeAir:true,offset:1});
  assert.deepEqual(second.entries,[{state:"astralsorcery:marble_bricks",count:4}]);
  const invalid = await client.callTool({name:"schematic_edit",arguments:{origin:[1,0,1],operations:[
    {type:"paint",block:"gold_block",at:[[0,0,0],[-2,0,0]]}
  ]}});
  assert.equal(invalid.isError,true);
  const full=await call(client,"schematic_status",{detail:"full"});
  assert.equal((full.current as {revision:number}).revision,result.revision);
  assert.equal((full.current as {materials:unknown[]}).materials.length,2);
  assert.equal((await call(client,"schematic_history",{direction:"undo"})).blocks,0);
});

test("MCP saves all writable formats, reopens files and preserves existing output by default", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "schematic-mcp-files-"));
  t.after(() => rm(root, { recursive: true }));
  const client = await connect(t);
  await call(client, "schematic_new", { size: [3, 2, 3], name: "Round trip" });
  await call(client, "schematic_edit", { operations: [{ type: "set", blocks: [{ at: [1, 1, 1], block: "create:andesite_casing" }] }] });
  for (const format of ["litematic", "schem", "nbt"]) {
    const path = join(root, `roundtrip.${format}`);
    const saved = await call(client, "schematic_save", { path });
    assert.ok(Number(saved.bytes) > 0);
    const before = await readFile(path);
    const duplicate = await client.callTool({ name: "schematic_save", arguments: { path } });
    assert.equal(duplicate.isError, true);
    assert.deepEqual(await readFile(path), before);
    await call(client, "schematic_new", { size: [1, 1, 1] });
    const opened = await call(client, "schematic_open", { path });
    assert.equal(opened.blocks, 1);
    assert.deepEqual(opened.size, [3, 2, 3]);
  }
  const relative = await client.callTool({ name: "schematic_save", arguments: { path: "relative.nbt" } });
  assert.equal(relative.isError, true);
});

test("MCP browser target, preview and rendering tools use the selected bridge client", async (t) => {
  const calls: { command: Record<string, unknown>; clientId?: string }[] = [];
  const bridge: BrowserBridge = {
    async status() { return { clients: [{ id: "chrome-1" }] }; },
    async command(command, clientId) {
      calls.push({ command: command as unknown as Record<string, unknown>, clientId });
      return { ok: true, action: command.action };
    },
  };
  const client = await connect(t, bridge);
  await call(client, "schematic_new", { size: [2, 2, 2] });
  await call(client, "schematic_preview", { clientId: "chrome-1" });
  assert.equal(calls[0].command.action, "open");
  assert.equal(calls[0].command.newTab, true);
  assert.equal(calls[0].clientId, "chrome-1");
  assert.equal(typeof calls[0].command.data, "string");
  await call(client, "schematic_edit", { target: "browser", clientId: "chrome-1", operations: [
    { type: "fill", box: { min: [0, 0, 0], max: [1, 0, 1] }, block: "stone" },
  ] });
  assert.equal(calls.at(-1)?.command.action, "edit");
  assert.equal(calls.at(-1)?.clientId, "chrome-1");
  await call(client, "schematic_resources", { operation: "list", clientId: "chrome-1" });
  assert.equal(calls.at(-1)?.command.action, "resources");
  await call(client, "schematic_view", { layer: 1, clientId: "chrome-1" });
  assert.equal(calls.at(-1)?.command.action, "view");
  await call(client, "schematic_documents", { operation: "switch", documentId: "doc-2", clientId: "chrome-1" });
  assert.deepEqual(calls.at(-1)?.command, { action: "documents", operation: "switch", documentId: "doc-2" });
  const status = await call(client, "schematic_status");
  assert.deepEqual((status.browser as Record<string, unknown>).clients, [{ id: "chrome-1" }]);
});

test("capture returns native image content, selects a browser and preserves existing PNG files", async (t) => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/D1cAAAAASUVORK5CYII=";
  const capture = { angles: ["top"], tileSize: 512, center: [1, 2, 3], span: 4 };
  const bridge: BrowserBridge = {
    async status() { return {}; },
    async command(command, id) {
      assert.equal(id, "live");
      assert.deepEqual(command, { action: "view", capture });
      return { mimeType: "image/png", data: png, revision: 7 };
    },
  };
  const client = await connect(t, bridge);
  const folder = await mkdtemp(join(tmpdir(), "mcp-capture-"));
  t.after(() => rm(folder, { recursive: true }));
  const path = join(folder, "view.png");
  const request = { name: "schematic_capture", arguments: { ...capture, clientId: "live", path } };
  const image = await client.callTool(request);
  assert.deepEqual(image.content, [{ type: "image", mimeType: "image/png", data: png }]);
  assert.deepEqual(image.structuredContent, { mimeType: "image/png", revision: 7, path });
  assert.deepEqual(await readFile(path), Buffer.from(png, "base64"));
  assert.equal((await client.callTool(request)).isError, true);
});

test("MCP rejects unknown properties and invalid batch parameters", async (t) => {
  const client = await connect(t);
  const results = await Promise.all([
    client.callTool({ name: "schematic_new", arguments: { size: [2, 2, 2], unexpected: true } }),
    client.callTool({ name: "schematic_inspect", arguments: { limit: 4097 } }),
    client.callTool({ name: "schematic_edit", arguments: { operations: [] } }),
    client.callTool({ name: "schematic_edit", arguments: { operations: [{ type: "set", blocks: [{ at: [-1, 0, 0], block: "stone" }] }] } }),
  ]);
  for (const result of results) assert.equal(result.isError, true);
});

test("BridgeClient authenticates loopback requests and re-reads rotated runtime tokens", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "schematic-mcp-bridge-"));
  t.after(() => rm(root, { recursive: true }));
  const path = join(root, "runtime.json");
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify(String(input).endsWith("/status") ? { clients: [] } : { result: { ok: true } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
  await writeFile(path, JSON.stringify({ url: "http://127.0.0.1:5173", token: "first-token" }));
  const bridge = new BridgeClient(path, fetcher);
  assert.deepEqual(await bridge.status(), { clients: [] });
  assert.equal((requests[0].init?.headers as Record<string, string>).Authorization, "Bearer first-token");
  await writeFile(path, JSON.stringify({ url: "http://127.0.0.1:5173", token: "second-token" }));
  assert.deepEqual(await bridge.command({ action: "status" }, "chrome-1"), { ok: true });
  assert.equal((requests[1].init?.headers as Record<string, string>).Authorization, "Bearer second-token");
  assert.deepEqual(JSON.parse(String(requests[1].init?.body)), { command: { action: "status" }, clientId: "chrome-1" });
  await writeFile(path, JSON.stringify({ url: "https://example.com", token: "bad-target" }));
  await assert.rejects(bridge.status(), /127\.0\.0\.1/);
  assert.equal(requests.length, 2);
});

test("absolute launcher serves real stdio MCP from an unrelated working directory", async (t) => {
  const client = new Client({ name: "schematic-stdio-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("./launch.mjs", import.meta.url))],
    cwd: tmpdir(), stderr: "pipe",
  });
  let errors = "";
  transport.stderr?.on("data", (chunk) => { errors += String(chunk); });
  t.after(() => client.close());
  try { await client.connect(transport); }
  catch (error) { throw new Error(`stdio startup failed: ${errors}`, { cause: error }); }
  assert.equal((await client.listTools()).tools.length, 12);
  const created = await call(client, "schematic_new", { size: [2, 3, 4], name: "stdio" });
  assert.deepEqual(created.size, [2, 3, 4]);
  assert.equal(errors, "");
});
