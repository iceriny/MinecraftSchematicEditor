---
name: minecraft-schematic-editor
description: Create, inspect and edit Minecraft schematics through MinecraftSchematicEditor MCP, connect the local webpage, and generate exterior or room cutaway previews. Use for building design, material changes, schematic conversion and existing-build adjustments.
---

# Minecraft Schematic Editor

English | [简体中文](references/guide.zh-CN.md)

Edit building data through MCP and show results in the editor webpage. Use the host's actual tool names, typically `mcp__minecraft_schematic_editor__schematic_*`. The server name is `minecraft-schematic-editor`.

After deployment, follow [the handoff reference](references/first-build.md): send the user the page URL, startup and saving instructions, and the building prompt in their language.

## Choose a mode

- For live adjustments, call `schematic_status({"target":"browser"})`, select the intended client and document, and pass `target:"browser"` on edits, inspection and saving.
- For file generation or batch work, use default `headless`. One build lives in the MCP process; save it explicitly.
- `schematic_preview` opens a headless snapshot in a new browser document. Further headless edits need another preview. Switch to the browser target to edit the live page.
- `clientId` identifies a browser connection; `activeDoc` identifies a document tab. Use `schematic_documents` to list or switch tabs. Query IDs again after a page refresh.

## Capability map

| Task | Tool |
| --- | --- |
| Create/load | `schematic_new` takes `size:[width,height,length]`; `schematic_open` reads an absolute file path |
| Inspect | `schematic_inspect` accepts a box, paginated block entries or `mode:"materials"` counts |
| Build | `schematic_edit` batches fill, paint, set, replace, copy and move |
| Undo | `schematic_history` undoes/redoes whole edit batches |
| Review | `schematic_capture` returns a real PNG view or room cutaway and optionally saves it |
| Adjust view | `schematic_view` frames the build or sets the visible upper layer |
| Textures/mods | `schematic_resources` discovers and loads installed versions and JARs |
| Save | `schematic_save` exports a file and reports its document, revision and SHA-256 |

## Build and deliver

Inspect existing dimensions, materials, document identity and the affected region. Carry forward the user's materials, design and destination.

Coordinates are zero-based `[x,y,z]`, with Y up and south +Z. Box corners are inclusive. An optional batch `origin` translates coordinates, allowing negative relative offsets inside the build.

Batch one complete feature into an edit. Use fill for volumes, paint for scattered positions of one material, set for mixed states and copy for repeated components with orientation transforms. Ordinary edits use MCP directly. Large procedural designs can calculate positions in a local script and submit them through MCP.

For an existing browser document, pass the previous reply's `activeDoc` and `revision` as `expectedDocumentId` and `expectedRevision` on edits and saves. Reinspect after conflicts.

Capture the changed area and assess proportions, gaps, furniture scale and materials. A capture box makes all six cut planes directly, preserving the user's tab, camera and layer selection. Save the requested file and check the returned path, identity and revision. Use `overwrite:true` when the user requests replacing an existing file.

Keep default compact replies. Request `detail:"full"` for the complete palette only when needed. Inspection defaults to 32 entries. View native MCP image content instead of printing base64.

One batch allows 128 operations and one million changed cells; set/paint accept 100,000 positions each. A failed batch changes nothing and names the failing operation.

Read [workflow examples](references/workflows.md) for parameters relevant to the task.

## Review the build by intended use

For a whole-build review, begin at the reported coordinates. Read the exact states and neighbouring cells, view the joint from a revealing angle, and identify the assembly and the job it is meant to do. Then examine the other districts, façades, interiors, furnishings, landscape and machinery within scope. Follow each cause into other uses, generators and rotated or mirrored copies. Also look for failure modes the initial example would never expose.

- Establish the design intent from the surroundings and build source. For example, an open trapdoor used as cladding must put its thin face against the intended wall. The same part used as a hatch needs a usable opening. Preserve purposeful gaps, overhangs and unconventional decorative uses.
- Write placement intent explicitly and check the occupied space inside each cell. For a slab shelf, compare its actual top surface with the bottom of the object displayed on it. Inspect the seam in section. Assess visual contact, collision, and any game-specific attachment or survival condition separately. Use the installed version's state definitions, models and game logic as appropriate.
- Check the finished assembly, including its neighbours across edit boundaries. Preserve all partner cells and shared states when copying, rotating or mirroring. Recalculate neighbour-derived shapes while retaining intentional placement properties. For a door, also walk the approach, check headroom, and verify that the player can reach the intended room after opening it.
- Follow the use through to its result. For a functional installation trace access, loading, output, control and servicing. For transmission, match both ports and axes at every joint and leave operating clearance. Where the result depends on the environment, check the required substrate, fluid, light, gravity, redstone signals and subsequent updates. Distinguish saved state from block-entity data, entities and scheduled ticks, and identify any startup actions.
- Use whole-build scans to locate candidates, then inspect context before changing a pattern. If the stored state is correct but the preview is missing or distorted, trace the state's model, geometry loader, material references and any runtime-rendered parts in the installed assets. Compare an isolated cell with the installed assembly to separate rendering faults from placement errors.
- Fix the shared construction cause and any individual conflicts. In live mode compare against a snapshot and apply only the confirmed changes with a revision guard. Re-read the exported states, recheck routes or interfaces affected, and inspect representative close-ups. Report what was checked statically and which behaviours were observed in game.

## Help open the webpage

The local page is <http://127.0.0.1:5173>, served by this checkout's Vite process on the user's machine.

- Install dependencies with `npm ci`. On Windows, `./local-server.ps1 -Action Start` starts the background service and opens the default browser. `-NoBrowser` only starts it. `start-editor.cmd` is the double-click entry.
- To reuse a requested browser, start with `-NoBrowser` and use the host's supported browser tools to find or open this URL. Follow the host's browser-control rules.
- On other platforms, keep `npm run dev` running in a separate terminal and provide the clickable URL. MCP itself has no browser-tab-opening tool.
- Call status after startup. Empty clients mean the page is not connected. Check the owner of an occupied port before changing anything.
- Use `schematic_open(target:"browser")` to send a local schematic to the page, including when its file picker is unavailable.

Discover actual Minecraft versions and mod JARs with resources before loading them. Custom paths use `MINECRAFT_DIR` and `MINECRAFT_INSTANCES`; Windows also supports ignored `local-server.local.json`.

Offer discovered instance names/versions for selection. If the intended instance is missing, ask for the launcher and instance name or folder path, suggesting its “Open instance folder” action. Reuse known paths. Inspect the supplied directory to derive the Minecraft root containing `versions` and the parent containing modded instances, then verify discovery. Explain which folder is needed instead of asking the user to guess variable names.

## Boundaries

- Read `.litematic`, `.schem`, legacy `.schematic`, and structure `.nbt`. Write `.litematic`, `.schem`, and `.nbt`.
- The model retains block IDs, states and basic metadata. Files with nonempty entity, block-entity or checked scheduled-tick data are rejected. Chest inventories, sign text and machine internals need a tool that preserves that NBT.
- Resources come from the user's JARs/packs. Missing resources use approximate colors; block entities may render as boxes, animated textures use their first frame, and biome tint is fixed.
- Unknown block IDs can be accepted. MCP does not consult a game registry to validate IDs, state properties or placement support. Check the actual resource definitions.
- Maximum volume is 24 million cells; input files are limited to 64 MiB. Multi-region litematics merge into a bounding box and export as one region.
- Undo retains 50 edits. New/open creates fresh document history. Headless state ends with its process. Browser autosave keeps only the active document.
- Live editing/capture needs Vite and a connected page. Static `dist` has no MCP bridge. Capture uses that page's textures; explicit cutaway boxes ignore the layer slider.

## Connection handling

The stdio command is `node <absolute-repository-path>/mcp/launch.mjs`. Root `mcp.json` provides plugin configuration.

For missing tools or unrecognized new parameters, inspect this chat's tool definitions. Reconnect the same server using the host's supported mechanism, then make a read-only call with the new parameter. A successful independent SDK check verifies a new connection only.

Keep the server name stable. Tool permission tables belong under the actual configured server. Before a development reload, save all documents the user needs. Preserve runtime directories, caches and local settings.

After a timeout/disconnection, inspect actual state before retrying a modification.
