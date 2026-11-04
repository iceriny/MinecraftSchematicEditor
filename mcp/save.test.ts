import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { executeCommand, MemoryEditor } from "../src/automation/engine";
import { createMcpServer } from "./server";
import { publishFile } from "./publish-file";

class DocumentEditor extends MemoryEditor {
  documentId = "doc-A";
  getDocumentId() { return this.documentId; }
}

test("export reports the document and revision serialized before compression yielded", async () => {
  const host = new DocumentEditor();
  await executeCommand({ action: "new", name: "first", size: [2, 2, 2] }, host);
  await executeCommand({ action: "edit", operations: [{ type: "set", blocks: [{ at: [0, 0, 0], block: "gold_block" }] }] }, host);
  const firstRevision = host.getRevision();
  const exporting = executeCommand({ action: "export", format: "litematic", expectedRevision: firstRevision, expectedDocumentId: "doc-A" }, host);
  host.documentId = "doc-B";
  await executeCommand({ action: "new", name: "second", size: [1, 1, 1] }, host);
  const exported = await exporting;
  assert.equal(exported.documentId, "doc-A");
  assert.equal(exported.revision, firstRevision);
  assert.notEqual(exported.revision, host.getRevision());
  const restored = await executeCommand({ action: "open", name: exported.name, data: exported.data }, new MemoryEditor());
  assert.equal(restored.name, "first");
  assert.equal(restored.blocks, 1);
  assert.deepEqual(restored.size, [2, 2, 2]);
});

test("MCP guarded save refuses stale data before replacing the target, and reports a verifiable hash", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "schematic-save-"));
  t.after(() => rm(dir, { recursive: true }));
  const path = join(dir, "tower.litematic");
  await writeFile(path, "existing file");
  const host = new DocumentEditor();
  await executeCommand({ action: "new", size: [2, 1, 2] }, host);
  const server = createMcpServer({ bridge: {
    status: async () => ({}), command: command => executeCommand(command, host),
  } });
  const [input, output] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "save-test", version: "1" });
  await server.connect(input);
  await client.connect(output);
  t.after(async () => { await client.close(); await server.close(); });
  const save = (expectedDocumentId: string, expectedRevision: number) => client.callTool({
    name: "schematic_save", arguments: { path, target: "browser", expectedDocumentId, expectedRevision, overwrite: true },
  });
  const revision = host.getRevision();
  for (const result of [await save("doc-B", revision), await save("doc-A", revision + 1)]) {
    assert.equal(result.isError, true);
    assert.equal(await readFile(path, "utf8"), "existing file");
  }
  const success = await save("doc-A", revision);
  assert.notEqual(success.isError, true);
  const bytes = await readFile(path);
  assert.deepEqual(success.structuredContent, {
    path, format: "litematic", bytes: bytes.length, revision, documentId: "doc-A",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  assert.deepEqual(await readdir(dir), ["tower.litematic"]);
});

test("concurrent no-overwrite publishers produce one complete winner and failed replacements clean staging", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "schematic-publish-"));
  t.after(() => rm(dir, { recursive: true }));
  const path = join(dir, "projection.nbt");
  const candidates = [Buffer.alloc(80000, 1), Buffer.alloc(120000, 2)];
  const results = await Promise.allSettled(candidates.map(bytes => publishFile(path, bytes)));
  const winner = results.findIndex(result => result.status === "fulfilled");
  assert.notEqual(winner, -1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  assert.deepEqual(await readFile(path), candidates[winner]);

  const occupied = join(dir, "occupied");
  await mkdir(occupied);
  await writeFile(join(occupied, "existing"), "original");
  await assert.rejects(publishFile(occupied, Buffer.from("replacement"), true));
  assert.equal(await readFile(join(occupied, "existing"), "utf8"), "original");
  assert.deepEqual((await readdir(dir)).sort(), ["occupied", "projection.nbt"]);
});
