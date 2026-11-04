import { readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { publishFile } from "./publish-file";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { executeCommand, MemoryEditor } from "../src/automation/engine";
import type { EditorCommand, EditorHost, Vec3 } from "../src/automation/protocol";
import { captureAngles } from "../src/automation/protocol";
import { BridgeClient, type BrowserBridge } from "./bridge-client";

const coord = z.number().int().min(0).max(24_000_000);
// Homogeneous arrays also work in MCP hosts that do not support JSON Schema tuples.
const vec = z.array(coord).length(3) as unknown as z.ZodType<Vec3>;
const box = z.strictObject({ min: vec, max: vec });
const block = z.string().trim().min(1).max(1024);
const targetFields = {
  target: z.enum(["headless", "browser"]).default("headless")
    .describe("headless edits this MCP process's document; browser edits the selected open editor tab."),
  clientId: z.string().min(1).max(128).optional().describe("Browser client ID from schematic_status; required when several tabs are connected."),
};
const format = z.enum(["litematic", "schem", "nbt"]);
const documentFields = {
  ...targetFields,
  detail: z.enum(["compact", "full"]).default("compact").describe("Use full only for the complete document palette and tab list."),
};
const editPoint = z.array(z.number().int().min(-24_000_000).max(24_000_000)).length(3) as unknown as z.ZodType<Vec3>;
const editBox = z.strictObject({ min: editPoint, max: editPoint });
const operation = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("fill"), box: editBox, block, shape: z.enum(["solid", "hollow", "walls", "outline", "air"]).optional() }),
  z.strictObject({ type: z.literal("set"), blocks: z.array(z.strictObject({ at: editPoint, block })).min(1).max(100_000) }),
  z.strictObject({ type: z.literal("paint"), block, at: z.array(editPoint).min(1).max(100_000) }),
  z.strictObject({ type: z.literal("replace"), from: block, to: block, box: editBox.optional() }),
  z.strictObject({ type: z.literal("copy"), box: editBox, to: editPoint, rotate: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(), mirror: z.enum(["x", "z"]).optional(), includeAir: z.boolean().optional() }),
  z.strictObject({ type: z.literal("move"), box: editBox, to: editPoint }),
]);

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : { result: value ?? null };
}

function toolResult(value: unknown): CallToolResult {
  const result = asObject(value);
  return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
}

function documentResult(value: unknown, detail?: "compact" | "full") {
  if (!detail || detail === "full" || !value) return value;
  const { materials, documents, ...rest } = asObject(value);
  return {
    ...rest,
    ...(Array.isArray(materials) ? { materialCount: materials.length } : {}),
    ...(Array.isArray(documents) ? { documentCount: documents.length } : {}),
  };
}

function absolutePath(path: string): string {
  if (!isAbsolute(path)) throw new Error("请提供文件的绝对路径。");
  return resolve(path);
}

export interface ServerOptions { editor?: EditorHost; bridge?: BrowserBridge }

export function createMcpServer(options: ServerOptions = {}): McpServer {
  const editor = options.editor ?? new MemoryEditor();
  const bridge = options.bridge ?? new BridgeClient();
  const server = new McpServer({ name: "minecraft-schematic-editor", version: "0.1.0" }, {
    instructions: "Use target=browser for live edits or headless (default) for a private document. Coordinates are [x,y,z]; box corners are inclusive. Batch a feature into one schematic_edit and undo step. Use fill for volumes and paint for scattered positions of one material. Inspect with mode=materials for counts, capture with box for a cutaway. Reuse the returned revision and activeDoc for guarded edits and saves. Save explicitly.",
  });
  let queue: Promise<unknown> = Promise.resolve();

  function add<S extends z.ZodRawShape>(
    name: string, description: string, shape: S, readOnly: boolean,
    handler: (args: z.output<z.ZodObject<S>>) => Promise<unknown>,
    encode: (value: unknown) => CallToolResult = toolResult,
  ) {
    const schema = z.strictObject(shape);
    server.registerTool<z.ZodRawShape, typeof schema>(name, {
      description, inputSchema: schema,
      annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: false },
    }, async (raw) => {
      const work = queue.then(async (): Promise<CallToolResult> => {
        try { return encode(await handler(schema.parse(raw))); }
        catch (error) {
          return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
        }
      });
      queue = work.catch(() => undefined);
      return work;
    });
  }

  async function run(command: EditorCommand, args: { target: "headless" | "browser"; clientId?: string; detail?: "compact" | "full" }): Promise<unknown> {
    const result = args.target === "browser" ? await bridge.command(command, args.clientId) : await executeCommand(command, editor);
    return documentResult(result, args.detail);
  }

  add("schematic_status", "Inspect the current document and connected browser clients. Use detail=full for the complete palette.", documentFields, true, async (args) => {
    const headless = await executeCommand({ action: "status" }, editor);
    let browser: Record<string, unknown>;
    try { browser = { ...await bridge.status(), available: true }; }
    catch (error) { browser = { available: false, error: error instanceof Error ? error.message : String(error), clients: [] }; }
    const current = args.target === "browser"
      ? browser.available ? await bridge.command({ action: "status" }, args.clientId) : null
      : headless;
    return { target: args.target, current: documentResult(current, args.detail),
      headless: args.detail === "full" ? headless : { open: headless.open, revision: headless.revision, blocks: headless.blocks }, browser };
  });

  add("schematic_new", "Create an empty schematic. Browser target defaults to opening a new document tab, preserving existing tabs.", {
    ...documentFields, size: z.array(coord.positive()).length(3) as unknown as z.ZodType<Vec3>,
    name: z.string().min(1).max(256).optional(), newTab: z.boolean().default(true),
  }, false, async (args) => run({ action: "new", size: args.size, name: args.name, newTab: args.newTab }, args));

  add("schematic_open", "Read a local .litematic, .schem, .schematic or .nbt file into the selected editor. Entity data unsupported by the editor is rejected.", {
    ...documentFields, path: z.string().min(1).max(32_768), newTab: z.boolean().default(true),
  }, false, async (args) => {
    const path = absolutePath(args.path);
    if (![".litematic", ".schem", ".schematic", ".nbt"].includes(extname(path).toLowerCase())) {
      throw new Error("支持的输入格式为 .litematic、.schem、.schematic、.nbt。");
    }
    const info = await stat(path);
    if (!info.isFile()) throw new Error("输入路径必须是普通文件。");
    if (info.size > 64 * 1024 * 1024) throw new Error("输入文件超过 64 MiB 限制。");
    const data = (await readFile(path)).toString("base64");
    const result = await run({ action: "open", name: basename(path), data, newTab: args.newTab }, args);
    return { ...asObject(result), path };
  });

  add("schematic_save", "Save a snapshot to an absolute path. For live edits, pass clientId, expectedDocumentId (activeDoc) and expectedRevision from the edit result. Returns the serialized revision, document ID and file SHA-256. Overwrite is opt-in.", {
    ...targetFields, path: z.string().min(1).max(32_768), format: format.optional(), overwrite: z.boolean().default(false),
    expectedRevision: z.number().int().nonnegative().optional(),
    expectedDocumentId: z.string().min(1).max(256).optional(),
  }, false, async (args) => {
    const path = absolutePath(args.path);
    const inferred = extname(path).slice(1).toLowerCase();
    const chosen = args.format ?? format.parse(inferred);
    if (extname(path).toLowerCase() !== `.${chosen}`) throw new Error("输出文件扩展名必须与导出格式一致。");
    if (args.expectedDocumentId !== undefined && args.target !== "browser") throw new Error("expectedDocumentId 只用于网页文档。");
    const exported = asObject(await run({
      action: "export", format: chosen, expectedRevision: args.expectedRevision, expectedDocumentId: args.expectedDocumentId,
    }, args));
    const revision = exported.revision;
    const documentId = args.target === "browser" ? exported.documentId : null;
    if (!Number.isSafeInteger(revision) || (args.target === "browser" && typeof documentId !== "string")) {
      throw new Error("编辑器未返回导出快照的身份或版本，请刷新编辑器并重新检查当前文档。");
    }
    if (args.expectedRevision !== undefined && args.expectedRevision !== revision ||
        args.expectedDocumentId !== undefined && args.expectedDocumentId !== documentId) {
      throw new Error("导出快照与预期文档或版本不符，文件未写入。");
    }
    if (typeof exported.data !== "string" || exported.format !== chosen) throw new Error("编辑器没有返回有效的导出数据。");
    const bytes = Buffer.from(exported.data, "base64");
    if (bytes.length === 0 || bytes.length !== exported.bytes) throw new Error("导出数据长度不符，文件未写入。");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    try { await publishFile(path, bytes, args.overwrite); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("输出文件已存在。请选择新路径，或明确设置 overwrite=true。");
      throw error;
    }
    return { path, format: chosen, bytes: bytes.length, revision, documentId, sha256 };
  });

  add("schematic_inspect", "Read dimensions, materials and a paginated list of block coordinates and states. Box coordinates are inclusive.", {
    ...documentFields, mode: z.enum(["blocks","materials"]).default("blocks").describe("materials counts the block states in this box, most common first."),
    box: box.optional(), limit: z.number().int().min(1).max(4096).default(32),
    offset: z.number().int().nonnegative().default(0), includeAir: z.boolean().default(false),
  }, true, async (args) => run({ action: "inspect", mode: args.mode, box: args.box, limit: args.limit, offset: args.offset, includeAir: args.includeAir }, args));

  add("schematic_edit", "Apply an atomic batch as one undo step: fill a region, set blocks, replace material, copy with rotation/mirroring, or move a region. Block states use namespace:block[property=value].", {
    ...documentFields, operations: z.array(operation).min(1).max(128).describe("Use paint for one material at many positions; use fill for rectangles."),
    origin: vec.optional().describe("Block to use as local [0,0,0] for all positions in this batch. Relative offsets may be negative."),
    expectedDocumentId: z.string().min(1).max(256).optional(),
    label: z.string().min(1).max(256).optional(), expectedRevision: z.number().int().nonnegative().optional(),
  }, false, async (args) => run({ action: "edit", operations: args.operations, origin: args.origin, label: args.label, expectedRevision: args.expectedRevision, expectedDocumentId: args.expectedDocumentId }, args));

  add("schematic_history", "Undo or redo complete edit batches in the selected document.", {
    ...documentFields, direction: z.enum(["undo", "redo"]), steps: z.number().int().min(1).max(50).default(1),
  }, false, async (args) => run({ action: "history", direction: args.direction, steps: args.steps }, args));

  add("schematic_preview", "Open the headless document in a NEW tab in the connected browser editor. Other document tabs are preserved. Later headless changes require another preview; target=browser edits the live preview directly.", {
    clientId: targetFields.clientId,
  }, false, async (args) => {
    const exported = asObject(await executeCommand({ action: "export", format: "litematic" }, editor));
    if (typeof exported.data !== "string") throw new Error("没有可预览的建筑。");
    return bridge.command({ action: "open", name: String(exported.name ?? "MCP preview.litematic"), data: exported.data, newTab: true }, args.clientId);
  });

  add("schematic_resources", "Show the active texture pack, loaded mods and available instances. To find a mod JAR, list with instance and an optional case-insensitive filename filter. Set detail=full to return complete inventories.", {
    clientId: targetFields.clientId, operation: z.enum(["list", "load_version", "add_mod"]),
    version: z.string().min(1).max(256).optional(), instance: z.string().min(1).max(256).optional(), file: z.string().min(1).max(1024).optional(),
    detail: z.enum(["summary", "full"]).default("summary"),
    filter: z.string().trim().min(1).max(256).optional(),
    limit: z.number().int().min(1).max(200).optional().describe("Maximum matching JARs from one instance; defaults to 25."),
  }, false, async (args) => {
    if (args.operation === "load_version" && !args.version) throw new Error("load_version 需要 version。");
    if (args.operation === "add_mod" && (!args.instance || !args.file)) throw new Error("add_mod 需要 instance 和 file。");
    const listInstance = args.operation === "list" ? args.instance : undefined;
    if ((args.filter !== undefined || args.limit !== undefined) && !listInstance) {
      throw new Error("查询 JAR 时请使用 operation=list 并指定 instance。");
    }
    if (args.detail === "full" && listInstance) throw new Error("查询指定实例时请使用 detail=summary。");
    const inventory = asObject(await bridge.command({ action: "resources", operation: args.operation, version: args.version, instance: args.instance, file: args.file }, args.clientId));
    if (args.detail === "full") return inventory;
    const instances: import("../src/assets/pack").InstalledInstance[] = Array.isArray(inventory.instances) ? inventory.instances : [];
    const versions: import("../src/assets/pack").InstalledVersion[] = Array.isArray(inventory.versions) ? inventory.versions : [];
    const summary = {
      pack: inventory.pack, packStatus: inventory.packStatus, mods: inventory.mods,
      versions: versions.map(version => version.id),
      instances: instances.map(instance => ({ id: instance.id, name: instance.name, modCount: instance.mods.length })),
    };
    if (!listInstance) return summary;
    const instance = instances.find(entry => entry.id === listInstance);
    if (!instance) throw new Error("未找到该实例，请从 schematic_resources 的 instances 中选择 id。");
    const needle = args.filter?.toLowerCase() ?? "";
    const matches = instance.mods.filter(mod => mod.file.toLowerCase().includes(needle));
    return { ...summary, instance: instance.id, matchCount: matches.length, files: matches.slice(0, args.limit ?? 25) };
  });

  add("schematic_view", "Frame the active browser build or set its visible upper Y layer. No blocks are changed.", {
    clientId: targetFields.clientId, frame: z.boolean().default(true), layer: z.number().int().nonnegative().optional(),
  }, false, async (args) => bridge.command({ action: "view", frame: args.frame, layer: args.layer }, args.clientId));

  add("schematic_documents", "List, switch or close document tabs in the selected browser editor. Use document IDs returned by list; this is separate from browser client IDs.", {
    clientId: targetFields.clientId, operation: z.enum(["list", "switch", "close"]),
    documentId: z.string().min(1).max(256).optional(),
  }, false, async (args) => {
    if (args.operation !== "list" && !args.documentId) throw new Error("switch 和 close 需要 documentId。");
    return bridge.command({ action: "documents", operation: args.operation, documentId: args.documentId }, args.clientId);
  });

  add("schematic_capture", "Render PNG views of the live, textured browser document. Returns an MCP image contact sheet. South is +Z. The editor camera and visible layers are preserved.", {
    clientId: targetFields.clientId,
    box: box.optional().describe("Cutaway with inclusive min/max corners in original schematic coordinates. Renders only this box, including its cut faces, regardless of the layer slider. Omit to render the current layers."),
    angles: z.array(z.enum(captureAngles)).min(1).max(4).optional().describe("Defaults to one southeast view for a cutaway, four views for a whole build."),
    tileSize: z.number().int().min(256).max(1024).default(640),
    center: vec.optional().describe("Optional focus [x,y,z] in schematic coordinates."),
    span: z.number().min(1).max(100000).optional().describe("Width and height of each view in blocks. Omit for automatic framing."),
    path: z.string().min(1).max(32768).optional().describe("Optional absolute .png path for saving the contact sheet."),
    overwrite: z.boolean().default(false),
  }, false, async ({ clientId, box, angles, tileSize, center, span, path, overwrite }) => {
    const output = path ? absolutePath(path) : undefined;
    if (output && extname(output).toLowerCase() !== ".png") throw new Error("预览图输出路径应以 .png 结尾。");
    const views = angles ?? (box ? ["southeast"] as const : ["southeast", "southwest", "northwest", "top"] as const);
    const captured = asObject(await bridge.command({ action: "view", capture: { angles: [...views], tileSize, center, span, ...(box ? { box } : {}) } }, clientId));
    if (captured.mimeType !== "image/png" || typeof captured.data !== "string") throw new Error("The viewer did not return a PNG. Reload its automation module and retry.");
    const png = Buffer.from(captured.data, "base64");
    if (!png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) throw new Error("Invalid PNG capture.");
    if (output) await writeFile(output, png, { flag: overwrite ? "w" : "wx" });
    const { data, ...metadata } = captured;
    return { data, metadata: { ...metadata, ...(output ? { path: output } : {}) } };
  }, (value) => {
    const { data, metadata } = value as { data: string; metadata: Record<string, unknown> };
    return { content: [{ type: "image", mimeType: "image/png", data }], structuredContent: metadata };
  });

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await createMcpServer().connect(new StdioServerTransport());
}
