import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createBuild, MAX_VOLUME, stateKey } from "../core/model";
import { nbt, TAG, writeNbt, type Tagged } from "../nbt/nbt";
import { executeCommand, MemoryEditor } from "./engine";
import type { EditOperation } from "./protocol";

const box = (min: [number, number, number], max: [number, number, number]) => ({ min, max });
const base64 = (data: Uint8Array) => Buffer.from(data).toString("base64");
const edit = (host: MemoryEditor, operations: EditOperation[]) => executeCommand({ action: "edit", operations }, host);
const stateAt = (host: MemoryEditor, x: number, y = 0, z = 0) => {
  const build = host.getBuild()!;
  return stateKey(build.palette[build.at(x, y, z)]);
};

async function editor(size: [number, number, number] = [8, 4, 8]) {
  const host = new MemoryEditor();
  await executeCommand({ action: "new", size, name: "test-build" }, host);
  return host;
}

test("batch is atomic, has one undo step and preserves counts", async () => {
  const host = await editor();
  const result = await edit(host, [
    { type: "fill", box: box([0, 0, 0], [3, 0, 3]), block: "stone" },
    { type: "set", blocks: [{ at: [1, 1, 1], block: "create:andesite_casing" }] },
  ]);
  assert.equal(result.changed, 17);
  assert.equal(result.blocks, 17);
  assert.deepEqual(host.getHistory(), { undo: 1, redo: 0 });
  await executeCommand({ action: "history", direction: "undo" }, host);
  assert.equal(host.getBuild()!.totalBlocks(), 0);
  await executeCommand({ action: "history", direction: "redo" }, host);
  assert.equal(host.getBuild()!.totalBlocks(), 17);
  assert.equal(stateAt(host, 1, 1, 1), "create:andesite_casing");
});

test("failed batch does not change blocks, palette, history or revision", async () => {
  const host = await editor();
  const before = host.getBuild()!.clone(), revision = host.getRevision();
  await assert.rejects(edit(host, [
    { type: "set", blocks: [{ at: [1, 0, 0], block: "gold_block" }] },
    { type: "fill", box: box([-1, 0, 0], [2, 1, 2]), block: "stone" },
  ]), /inside|integer/);
  assert.deepEqual(host.getBuild()!.palette.map(stateKey), before.palette.map(stateKey));
  assert.deepEqual(host.getBuild()!.data, before.data);
  assert.equal(host.getRevision(), revision);
  assert.equal(host.getHistory().undo, 0);
});

test("replace uses complete blockstate and inspection pagination is stable", async () => {
  const host = await editor();
  await edit(host, [{ type: "set", blocks: [
    { at: [0, 0, 0], block: "oak_log[axis=x]" },
    { at: [1, 0, 0], block: "oak_log[axis=y]" },
    { at: [2, 0, 0], block: "oak_log[axis=x]" },
  ] }]);
  await edit(host, [{ type: "replace", from: "oak_log[axis=x]", to: "birch_log[axis=z]" }]);
  assert.equal(stateAt(host, 0), "minecraft:birch_log[axis=z]");
  assert.equal(stateAt(host, 1), "minecraft:oak_log[axis=y]");
  const result = await executeCommand({ action: "inspect", limit: 2, offset: 1 }, host);
  assert.equal(result.blocksInRegion, 3);
  assert.deepEqual(result.entries.map((entry: { at: number[] }) => entry.at), [[1, 0, 0], [2, 0, 0]]);
  assert.equal(result.nextOffset, null);
});

test("overlapping copy snapshots the source; move carries air and undoes", async () => {
  const host = await editor([6, 1, 1]);
  await edit(host, [{ type: "set", blocks: [
    { at: [0, 0, 0], block: "stone" }, { at: [1, 0, 0], block: "dirt" },
  ] }]);
  await edit(host, [{ type: "copy", box: box([0, 0, 0], [1, 0, 0]), to: [1, 0, 0] }]);
  assert.deepEqual([0, 1, 2].map((x) => stateAt(host, x)), ["minecraft:stone", "minecraft:stone", "minecraft:dirt"]);
  await edit(host, [{ type: "move", box: box([0, 0, 0], [2, 0, 0]), to: [1, 0, 0] }]);
  assert.deepEqual([0, 1, 2, 3].map((x) => stateAt(host, x)), ["minecraft:air", "minecraft:stone", "minecraft:stone", "minecraft:dirt"]);
  await executeCommand({ action: "history", direction: "undo" }, host);
  assert.equal(stateAt(host, 0), "minecraft:stone");
  assert.equal(stateAt(host, 3), "minecraft:air");
});

test("copy rotation and mirror transform both geometry and orientation", async () => {
  const host = await editor();
  await edit(host, [{ type: "set", blocks: [
    { at: [0, 0, 0], block: "oak_stairs[facing=north,half=bottom,shape=straight]" },
    { at: [1, 0, 0], block: "oak_log[axis=x]" },
  ] }]);
  await edit(host, [{ type: "copy", box: box([0, 0, 0], [1, 0, 0]), to: [3, 0, 0], rotate: 1, mirror: "x" }]);
  assert.match(stateAt(host, 3, 0, 0), /facing=west/);
  assert.equal(stateAt(host, 3, 0, 1), "minecraft:oak_log[axis=z]");
});

test("connection repair and undo affect neighboring blocks together", async () => {
  const host = await editor();
  await edit(host, [{ type: "set", blocks: [{ at: [0, 0, 0], block: "oak_fence" }] }]);
  const before = stateAt(host, 0);
  await edit(host, [{ type: "set", blocks: [{ at: [1, 0, 0], block: "oak_fence" }] }]);
  assert.match(stateAt(host, 0), /east=true/);
  assert.match(stateAt(host, 1), /west=true/);
  await executeCommand({ action: "history", direction: "undo" }, host);
  assert.equal(stateAt(host, 0), before);
  assert.equal(stateAt(host, 1), "minecraft:air");
});

test("bounds, malformed states, stale revisions and invalid sizes fail", async () => {
  const host = await editor();
  await assert.rejects(executeCommand({ action: "new", size: [MAX_VOLUME + 1, 1, 1] }, host), /exceeds/);
  await assert.rejects(executeCommand({ action: "new", size: [1.5, 1, 1] }, host), /integer/);
  await assert.rejects(edit(host, [{ type: "set", blocks: [{ at: [8, 0, 0], block: "stone" }] }]), /outside/);
  await assert.rejects(edit(host, [{ type: "set", blocks: [{ at: [0, 0, 0], block: "stone[axis=x,axis=y]" }] }]), /unique/);
  await assert.rejects(edit(host, [{ type: "set", blocks: [{ at: [0, 0, 0], block: "oak_log[axis=x" }] }]), /Invalid/);
  await assert.rejects(executeCommand({ action: "edit", operations: [{ type: "set", blocks: [] }], expectedRevision: 0 }, host), /Revision conflict/);
  await assert.rejects(edit(host, [{ type: "copy", box: box([0, 0, 0], [3, 0, 3]), to: [7, 0, 7] }]), /fit entirely/);
  await assert.rejects(executeCommand({ action: "history", direction: "undo" }, host), /Only 0/);
});

for (const format of ["litematic", "schem", "nbt"] as const) {
  test(`${format} export and load roundtrip dimensions, states, counts and dataVersion`, async () => {
    const source = await editor([5, 3, 4]);
    await edit(source, [{ type: "set", blocks: [
      { at: [0, 0, 0], block: "stone" },
      { at: [4, 2, 3], block: "create:shaft[axis=z]" },
      { at: [1, 1, 2], block: "oak_log[axis=x]" },
    ] }]);
    const exported = await executeCommand({ action: "export", format }, source);
    assert.ok(exported.bytes > 0);
    const target = new MemoryEditor();
    const result = await executeCommand({ action: "open", name: exported.name, data: exported.data }, target);
    assert.deepEqual(result.size, [5, 3, 4]);
    assert.equal(result.blocks, 3);
    assert.equal(result.dataVersion, 3953);
    assert.equal(stateAt(target, 4, 2, 3), "create:shaft[axis=z]");
    assert.equal(stateAt(target, 1, 1, 2), "minecraft:oak_log[axis=x]");
  });
}

test("existing bundled legacy and modern files are readable", async () => {
  for (const name of ["cottage.litematic", "cottage.schem", "cottage.schematic"]) {
    const data = new Uint8Array(await readFile(new URL(`../../public/samples/${name}`, import.meta.url)));
    const result = await executeCommand({ action: "open", name, data: base64(data) }, new MemoryEditor());
    assert.ok(result.blocks > 0);
  }
});

test("entity and block-entity payloads are rejected without replacing the open document", async () => {
  const host = await editor();
  const before = host.getBuild();
  const extras: Record<string, Tagged>[] = [
    { entities: nbt.list(TAG.Compound, [nbt.compound({ id: nbt.string("minecraft:pig") })]) },
    { blocks: nbt.list(TAG.Compound, [nbt.compound({ pos: nbt.list(TAG.Int, [nbt.int(0), nbt.int(0), nbt.int(0)]), state: nbt.int(0), nbt: nbt.compound({ id: nbt.string("minecraft:chest") }) })]) },
  ];
  for (const extra of extras) {
    const raw = writeNbt(nbt.compound({
      size: nbt.list(TAG.Int, [nbt.int(1), nbt.int(1), nbt.int(1)]),
      palette: nbt.list(TAG.Compound, [nbt.compound({ Name: nbt.string("minecraft:stone") })]),
      blocks: nbt.list(TAG.Compound, []), ...extra,
    }));
    await assert.rejects(executeCommand({ action: "open", name: "entities.nbt", data: base64(raw) }, host), /refusing to discard/);
    assert.equal(host.getBuild(), before);
  }
});

test("oversized input is rejected before a dense block array is allocated", async () => {
  const raw = writeNbt(nbt.compound({
    size: nbt.list(TAG.Int, [nbt.int(MAX_VOLUME + 1), nbt.int(1), nbt.int(1)]),
    palette: nbt.list(TAG.Compound, []), blocks: nbt.list(TAG.Compound, []),
  }));
  await assert.rejects(executeCommand({ action: "open", name: "large.nbt", data: base64(raw) }, new MemoryEditor()), /exceeds/);
});

test("palette overflow is rejected before typed arrays truncate indices", async () => {
  const host = new MemoryEditor();
  const build = createBuild(1, 1, 1);
  build.palette = Array.from({ length: 65536 }, (_, i) => ({ name: i ? `test:block_${i}` : "minecraft:air" }));
  host.adoptBuild(build, null, false);
  await assert.rejects(edit(host, [{ type: "set", blocks: [{ at: [0, 0, 0], block: "test:new_block" }] }]), /palette exceeds/);
  assert.equal(host.getBuild()!.palette.length, 65536);
  assert.equal(host.getBuild()!.totalBlocks(), 0);
});

test("history retains 50 actual edits and drops redo after another edit", async () => {
  const host = await editor([1, 1, 1]);
  for (let i = 0; i < 55; i++) await edit(host, [{ type: "set", blocks: [{ at: [0, 0, 0], block: i % 2 ? "stone" : "dirt" }] }]);
  assert.equal(host.getHistory().undo, 50);
  await executeCommand({ action: "history", direction: "undo", steps: 2 }, host);
  assert.equal(host.getHistory().redo, 2);
  await edit(host, [{ type: "set", blocks: [{ at: [0, 0, 0], block: "gold_block" }] }]);
  assert.equal(host.getHistory().redo, 0);
});
