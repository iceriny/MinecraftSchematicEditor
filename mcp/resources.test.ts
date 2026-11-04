import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import { isCreateCtBindingClass, readCreateCtBindings } from "../src/assets/createCtBindings";
import { CREATE_SHIFT_CLASS, readCreateCtSprites } from "../src/assets/createCtSprites";
import { loadPackBytes } from "../src/assets/pack";
import { bakePalette } from "../src/render/bake";
import { meshRegion } from "../src/render/mesher";
import { WINDOW_FACTORY, WINDOW_SHIFTS } from "../src/assets/connectedWindows";
import { createBuild, parseStateKey } from "../src/core/model";
import { resolveState, resolveTexture } from "../src/assets/modelResolver";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./server";

// Supply a local Create 6.0.10 client jar to exercise its actual registration
// bootstrap and factories without redistributing Minecraft or mod binaries.
test("Create registrations follow the supplied block ID and select distinct side and end shifts", {
  skip: !process.env.CREATE_CT_JAR,
}, async () => {
  const files = unzipSync(await readFile(process.env.CREATE_CT_JAR!), {
    filter: ({name}) => name === CREATE_SHIFT_CLASS || isCreateCtBindingClass(name),
  });
  const registry = files["com/simibubi/create/content/decoration/palettes/AllPaletteBlocks.class"];
  const oldName = "industrial_iron_window", newName = "example_custom_gallery";
  const i = Buffer.from(registry).indexOf(oldName);
  assert.ok(i >= 0);
  assert.equal(newName.length, oldName.length);
  registry.set(strToU8(newName), i);
  const sprites = readCreateCtSprites(files), blocks = readCreateCtBindings(files);
  const iron = blocks.get("create:" + newName)!;
  assert.equal(blocks.has("create:" + oldName), false);
  assert.equal(sprites.get(iron.side)?.type, "RECTANGLE");
  assert.equal(iron.cap, undefined);
  const framed = blocks.get("create:framed_glass")!, horizontal = blocks.get("create:horizontal_framed_glass")!;
  assert.equal(sprites.get(framed.side)?.original, sprites.get(horizontal.side)?.original);
  assert.equal(sprites.get(horizontal.side)?.type, "HORIZONTAL_KRYPPERS");
  assert.equal(sprites.get(horizontal.cap!)?.type, "OMNIDIRECTIONAL");
});

test("window factory side tiles use coplanar matches above and below, keeping the end sprite", async () => {
  const json = (value: unknown) => strToU8(JSON.stringify(value));
  const pngHeader = (size: number) => Uint8Array.of(137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,size,0,0,0,size);
  const pack = await loadPackBytes("create.jar", zipSync({
    [WINDOW_FACTORY]: strToU8("woodenWindowBlock getWoodenWindow"),
    [WINDOW_SHIFTS]: strToU8("getWoodenWindow WOODEN_WINDOWS palettes/\x01_window vertical"),
    "assets/create/blockstates/oak_window.json": json({variants: {"": {model: "create:block/oak_window"}}}),
    "assets/create/models/block/oak_window.json": json({parent: "minecraft:block/cube_column",
      textures: {end: "minecraft:block/oak_planks", side: "create:block/palettes/oak_window"}}),
    "assets/minecraft/models/block/cube_column.json": json({elements: [{from: [0,0,0], to: [16,16,16],
      faces: {north: {texture: "#side"}, up: {texture: "#end"}}}]}),
    "assets/create/textures/block/palettes/oak_window.png": pngHeader(16),
    "assets/create/textures/block/palettes/oak_window_connected.png": pngHeader(32),
    "assets/minecraft/textures/block/oak_planks.png": pngHeader(16),
  }), "mod");
  const build = createBuild(1,3,2);
  const id = build.paletteIndexFor(parseStateKey("create:oak_window"));
  build.data[build.index(0,1,1)] = id;
  const baked = await bakePalette(build, pack);
  const end = baked.texturePaths.indexOf("minecraft:block/oak_planks");
  const tiles = baked.blocks[id].connected!.side!.tiles;
  const layers = () => meshRegion(build, baked, 0,1,1, 1,1,1,2).layers.flatMap(mesh =>
    mesh ? [...mesh.layers].filter((_, index) => index % 4 === 0) : []);
  for (let mask = 0; mask < 4; mask++) {
    build.data[build.index(0,2,1)] = mask & 1 ? id : 0;
    build.data[build.index(0,0,1)] = mask & 2 ? id : 0;
    assert.deepEqual(layers(), [tiles[mask], end]);
  }
  build.data[build.index(0,2,0)] = id; // step projecting in front of the upper window's north face
  assert.deepEqual(layers(), [tiles[2], end]);
});

test("sparse multipart states keep unconditional parts and choose one branch per flag", async () => {
  const part = {model: "fixture:block/part"};
  const pack = await loadPackBytes("fixture.jar", zipSync({
    "assets/fixture/blockstates/panel.json": strToU8(JSON.stringify({multipart: [
      {apply: part}, {when: {slot: "false"}, apply: part},
      {when: {AND: [{slot: "true"}, {east: "true"}]}, apply: part},
      {when: {slot: "true"}, apply: part},
    ]})),
    "assets/fixture/models/block/part.json": strToU8('{"elements":[{"from":[0,0,0],"to":[16,16,16],"faces":{}}]}'),
  }), "mod");
  const parts = (key: string) => resolveState(pack, parseStateKey(key), new Map())!.length;
  assert.equal(parts("fixture:panel"), 2);
  assert.equal(parts("fixture:panel[east=true]"), 2);
  assert.equal(parts("fixture:panel[east=true,slot=true]"), 3);
});

test("a renderer's static item pose contributes only original-scale, compatible extra pieces", async () => {
  const body = { from: [2,0,2], to: [14,4,14], faces: { up: { texture: "#base" } } };
  const head = { from: [5,4,5], to: [11,14,11], faces: { up: { texture: "#top" } } };
  const state = parseStateKey("fixture:gauge[facing=east]");
  const entry = (value: unknown) => strToU8(JSON.stringify(value));
  const pack = await loadPackBytes("fixture.jar", zipSync({
    "assets/fixture/blockstates/gauge.json": entry({variants: {"facing=east": {model: "fixture:block/gauge", y: 90}}}),
    "assets/fixture/models/block/gauge.json": entry({textures: {base: "fixture:block/panel"}, elements: [body]}),
    "assets/fixture/models/item/gauge.json": entry({textures: {base: "fixture:block/panel", top: "fixture:block/panel"}, elements: [head, body]}),
    "assets/fixture/textures/block/panel.png": new Uint8Array(1),
  }), "mod");
  const parts = () => resolveState(pack, state, new Map())!;
  assert.equal(parts().length, 1); // An item model alone provides no evidence of a world renderer.
  pack.rendererFamilies.add("fixture:gauge");
  assert.deepEqual(parts().map(([p]) => [p.y, p.model.elements]), [[90,[body]], [90,[head]]]);
  pack.models.get("fixture:item/gauge")!.textures!.base = "fixture:block/another_material";
  assert.equal(parts().length, 1);
  pack.models.get("fixture:item/gauge")!.textures!.base = "fixture:block/panel";
  pack.blockstates.get("fixture:gauge")!.variants!["open=true"] = {model: "fixture:block/gauge"};
  assert.equal(parts().length, 1);
});

test("a wheel retains its textured OBJ face outside the hub when turned onto the X axis", async () => {
  const model = "create:block/large_water_wheel/block";
  const dir = "assets/create/models/block/large_water_wheel/";
  const bytes = zipSync({
    "assets/create/blockstates/large_water_wheel.json": strToU8(JSON.stringify({
      variants: {"axis=x": {model, x: 90, y: 90}},
    })),
    [dir+"block.json"]: strToU8(JSON.stringify({
      parent: "create:block/large_water_wheel/textures", loader: "neoforge:obj",
      model: "create:models/block/large_water_wheel/wheel.obj", flip_v: true,
    })),
    [dir+"textures.json"]: strToU8('{"textures":{"planks":"block/oak_planks"}}'),
    [dir+"wheel.mtl"]: strToU8("newmtl vane\nmap_Kd #planks"),
    [dir+"wheel.obj"]: strToU8("mtllib wheel.mtl\nv 0 0.5 0\nv 2.5 0.5 0\nv 0 0.5 1\n"+
      "vt 0 0.25\nvt 1 0.25\nvt 0 1\nusemtl vane\nf 1/1 2/2 3/3"),
  });
  const pack = await loadPackBytes("wheel.jar", bytes, "mod");
  const state = parseStateKey("create:large_water_wheel[axis=x]");
  const placement = resolveState(pack, state, new Map())![0][0];
  const face = placement.model.mesh![0];
  assert.equal(resolveTexture(placement.model.textures, face.texture), "minecraft:block/oak_planks");
  const build = createBuild(1,1,1);
  const id = build.paletteIndexFor(state);
  const baked = await bakePalette(build, pack);
  const quads = baked.blocks[id].single!;
  assert.equal(quads.length, 1);
  assert.equal(quads[0].uv[1], .75);
  assert.equal(quads[0].pos[5], 2.5);
  assert.equal(quads[0].pos[3], .5);
  assert.equal(quads[0].cull, -1);
  assert.equal(baked.blocks[id].occludes.some(Boolean), false);
});

test("mod resource loading includes declared JarJar assets and preserves outer overrides", async () => {
  const path = "META-INF/jarjar/physics.jar";
  const definition = "assets/physics/blockstates/rotor.json";
  const child = zipSync({
    [definition]: strToU8('{"variants":{"":{"model":"physics:block/old"}}}'),
    "assets/physics/models/block/rotor.json": strToU8('{"parent":"block/cube_all"}'),
  });
  const ignored = zipSync({ "assets/unused/blockstates/ghost.json": strToU8("{}") });
  const bytes = zipSync({
    "META-INF/jarjar/metadata.json": strToU8(JSON.stringify({ jars: [{ path }] })),
    [path]: child,
    "META-INF/jarjar/unused.jar": ignored,
    [definition]: strToU8('{"variants":{"":{"model":"physics:block/rotor"}}}'),
  });
  const pack = await loadPackBytes("bundle.jar", bytes, "mod");
  assert.deepEqual(pack.namespaces, ["physics"]);
  assert.deepEqual(pack.blockstates.get("physics:rotor")?.variants?.[""], { model: "physics:block/rotor" });
  assert.deepEqual(pack.models.get("physics:block/rotor"), { parent: "block/cube_all" });
});

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
