import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./server";

test("resource discovery keeps inventories compact and searches only the selected instance", async t => {
  const inventory = {
    pack: "1.21.1.jar", packStatus: "ready", mods: [{ file: "create.jar", label: "Create" }],
    versions: [{ id: "1.21.1", size: 100, modified: 123 }],
    instances: [
      { id: "first", name: "First pack", mods: ["Create-A.jar", "create-B.jar", "other.jar"].map(file => ({ file, size: 10 })) },
      { id: "second", name: "Second pack", mods: [{ file: "create-third.jar", size: 20 }] },
    ],
  };
  const server = createMcpServer({ bridge: { async status() { return {}; }, async command() { return inventory; } } });
  const client = new Client({ name: "resources-test", version: "1" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const list = (args: Record<string, unknown> = {}) =>
    client.callTool({ name: "schematic_resources", arguments: { operation: "list", ...args } });

  const summary = (await list()).structuredContent;
  assert.deepEqual(summary, {
    pack: inventory.pack, packStatus: inventory.packStatus, mods: inventory.mods, versions: ["1.21.1"],
    instances: [{ id: "first", name: "First pack", modCount: 3 }, { id: "second", name: "Second pack", modCount: 1 }],
  });
  const selected = (await list({ instance: "first", filter: "CREATE", limit: 1 })).structuredContent as Record<string, unknown>;
  assert.equal(selected.matchCount, 2);
  assert.deepEqual(selected.files, [{ file: "Create-A.jar", size: 10 }]);
  const absent = (await list({ instance: "first", filter: "absent" })).structuredContent as Record<string, unknown>;
  assert.deepEqual(absent.files, []);
  assert.deepEqual((await list({ detail: "full" })).structuredContent, inventory);
  assert.equal((await list({ filter: "create" })).isError, true);
  assert.equal((await list({ instance: "missing" })).isError, true);
});
