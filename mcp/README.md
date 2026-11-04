# Schematic Editor MCP

English | [简体中文](README.zh-CN.md)

Create, inspect, edit, undo, preview, and save Minecraft schematics through an agent. For agent instructions, use the bundled [skill](../skills/minecraft-schematic-editor/SKILL.md). For installation through handoff, follow [agent setup](../docs/agent-setup.md).

## Connect

Install dependencies in the checkout with `npm ci`. Configure your host to run a stdio MCP server named `minecraft-schematic-editor` with `node` and the absolute path to `mcp/launch.mjs`. The launcher locates the checkout automatically.

```json
{
  "mcpServers": {
    "minecraft-schematic-editor": {
      "command": "node",
      "args": ["/absolute/path/to/MinecraftSchematicEditor/mcp/launch.mjs"]
    }
  }
}
```

Hosts supporting plugin manifests can use root `mcp.json` and `skills/`. Other hosts can install the skill folder separately.

For Codex, from the checkout in PowerShell

```powershell
codex mcp add minecraft-schematic-editor -- node (Resolve-Path 'mcp/launch.mjs').Path
```

Reconnect in the host and verify its actual tools expose the expected parameters. Configuration details are in the [official MCP documentation](https://learn.chatgpt.com/docs/extend/mcp).

Headless editing works in the MCP process. For live editing and screenshots, run `npm run dev` and open <http://127.0.0.1:5173>. The authenticated loopback bridge stores its runtime information in `run.local/mcp-bridge.json`. Windows background launchers are described in [Windows setup](../docs/windows.md).

## Tools

| Tool | Purpose |
| --- | --- |
| `schematic_status` | Current document, revisions, and connected browser clients |
| `schematic_new` | Create a build with dimensions `[width,height,length]` |
| `schematic_open` | Load an absolute local file path |
| `schematic_inspect` | Paginated block coordinates or material counts in a region |
| `schematic_edit` | Atomic fill, paint, set, replace, copy, and move batches |
| `schematic_history` | Undo or redo |
| `schematic_save` | Export a local file with snapshot identity and SHA-256 |
| `schematic_preview` | Open the headless build in a new browser document |
| `schematic_resources` | Discover and load local Minecraft and mod resources |
| `schematic_view` | Frame a build or set the visible upper layer |
| `schematic_capture` | Return and optionally save PNG exterior or cutaway views |
| `schematic_documents` | List, switch, and close browser documents |

Editing tools default to `target:"headless"`. For the live page, pass `target:"browser"`; select `clientId` when multiple pages are connected. Browser-only tools use that page directly. A preview is a snapshot; subsequent live edits use the browser target.

## Efficient editing

Coordinates are zero-based `[x,y,z]` and boxes include both endpoints. South is +Z. A batch's optional `origin` translates its coordinates, allowing negative relative offsets within the build.

Use `fill` for volumes, `paint` for scattered positions sharing one state, and `set` for mixed states. Copy can rotate clockwise around Y in quarter turns, mirror X or Z, and include air. A `replace` without a box searches the entire build.

```json
{"target":"browser","origin":[16,0,16],"operations":[{"type":"paint","block":"minecraft:stone_bricks","at":[[-6,1,-6],[6,1,-6],[-6,1,6],[6,1,6]]}]}
```

Each batch is one undo step, with up to 128 operations and one million changed cells. Set/paint accept up to 100,000 positions per operation. Undo retains 50 edits.

Replies default to compact summaries. Request `detail:"full"` for the document palette. Inspection defaults to 32 entries; use a box and `mode:"materials"` for a room's material counts. Resources default to instance summaries; provide `instance` and `filter` to find JARs.

## Preview and save

Capture a room by passing `box` in original schematic coordinates. All six planes are cut, independently of the user's visible layer. The active document and camera are preserved.

```json
{"box":{"min":[5,12,5],"max":[25,24,25]},"tileSize":768,"path":"/absolute/output/room.png"}
```

Cutaways default to one southeast view. Without a box, capture uses current visible layers and four views. You can select 1–4 `angles`, a `center`, and framing `span`. Captures return a native MCP image and metadata.

Save to an absolute path with a matching `.litematic`, `.schem`, or `.nbt` extension. Existing output requires explicit `overwrite:true`. For live edits and saves, reuse the latest `activeDoc` and `revision` as `expectedDocumentId` and `expectedRevision`. Saving reports the serialized snapshot's identity and SHA-256. Replacement writes stage a complete file in the destination directory before replacing the target.

## Files and sessions

Inputs include legacy `.schematic`; outputs use modern formats. The block model handles states and basic metadata. Entity, block-entity, and checked scheduled-tick payloads are rejected to avoid dropping them. It does not retain chest inventories, sign text, or machine internals.

Headless state ends with its MCP process. Browser autosave keeps the active document. Save needed documents before a session ends or a development reload occurs. Browser live tools require Vite; the static `dist` site has no local bridge.

## Verify

```sh
npm run check:setup
npm run check:setup -- --require-browser
npm run test:mcp
npm run typecheck
npm run build
```

On the 54,308-block tower example, a compact one-block edit reply measured 163 UTF-8 JSON bytes versus 10,429 in full mode. A 64-position single-material request measured 592 bytes with paint versus 4,633 with set.
