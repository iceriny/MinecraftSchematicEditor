# Schematic Editor reference

English | [简体中文使用指南](editor-guide.zh-CN.md) | [Product home](../README.md)

A browser tool for Minecraft builds: open a Litematica or WorldEdit schematic —
or start from an empty box — move around it in 3D to see how big it really is,
swap any material for another, add or delete blocks, and clone a piece you
built once into every place it belongs.

Everything runs locally. Files are parsed in the browser and never uploaded.
The build you have open is snapshotted to the browser's own storage as you
work, so closing the tab by accident doesn't cost the session.

**[Try it →](https://faraway24.github.io/MinecraftSchematicEditor/)** Nothing to
install. The hosted copy can't reach your Minecraft folder the way the dev
server can, so it starts in colour-accurate blocks; drop a client `.jar` or a
resource-pack `.zip` on **Add textures** in the top bar for the real thing, and
it's remembered from then on.

## Run it

Node 20.19+ or 22.12+, and a browser with WebGL2. A Minecraft install is *not*
required — without one the viewport draws blocks in colour-accurate averages
and everything else works the same. See **Textures** for what an install adds.

```bash
npm install
npm run dev        # http://localhost:5173
npm run sample     # regenerate the bundled sample builds
npm run build      # production bundle in dist/
npm run typecheck
```

On Windows, the [background start/stop launchers](windows.md) also work
from any checkout location and support per-machine Minecraft paths.

For programmatic editing, the [local MCP server](../mcp/README.md) can read and
write schematics over stdio, edit the active browser document, and render
multi-angle or cutaway previews.

Agents can use the bundled [minecraft-schematic-editor skill](../skills/minecraft-schematic-editor/SKILL.md)
for mode selection, tool workflows, browser setup and format limitations.

## Formats

| Extension     | Written by                     | Read | Write |
| ------------- | ------------------------------ | :--: | :---: |
| `.litematic`  | Litematica                     |  ✓   |   ✓   |
| `.schem`      | WorldEdit (Sponge v1/v2/v3)    |  ✓   |   ✓   |
| `.schematic`  | Schematica / MCEdit (pre-1.13) |  ✓   |   —   |
| `.nbt`        | Vanilla structure block        |  ✓   |   ✓   |

Legacy `.schematic` files use numeric block ids, which are mapped to modern
blockstates through the 1.12 table in `src/formats/legacyIds.ts`. They are read
only — saving always produces a modern format.

Multi-region litematics are merged into one bounding box on load, and saving
writes a single region.

Any of these can be opened as the build, or imported into the build you already
have — see **Bring another design in** below.

## Using it

**Textures** On the dev server your build renders with the real vanilla blocks
straight away, read from your own Minecraft install. See below.

**Move** Drag to orbit, right-drag to pan, scroll to zoom. Press `G` to walk
through the build instead: `WASD` to move, `Space`/`Shift` for up and down, `R`
to sprint, `Esc` to go back to orbiting. With an edit tool selected, left-drag
belongs to the tool, so orbit moves to the right button.

**Read the size** The dimension frame hangs off the corner nearest the camera
and follows you around the build — red for X, green for Y, blue for Z. The same
colours carry through to the coordinate readout in the status bar.

**Peel it back** The layer slider on the right hides everything above a chosen
Y level, so you can read a build one course at a time. It changes the view
only; nothing is deleted.

**The panel** Below the material list sits every tool's settings, one named
section each — **Paint**, **Brush**, **Mirror**, **Selection**, **Clipboard**,
**Ruler & centre**, **Canvas**. Sections come and go with the tool in hand,
which the bar at the top of the panel names, and each one folds away with a
click on its heading; folded, it still shows the figure that matters, so the
whole panel reads as an index of where your build stands. The `?` on a heading
says what the section is for and which tools it governs. **Fold all** clears the
lot, and what you fold is remembered between sessions.

**Change materials** Click a material in the right-hand panel to highlight
every copy of it in the build, then **Replace all** to swap it or **Remove
all** to delete it. The block picker also takes a typed blockstate such as
`oak_stairs[facing=east,half=top]`.

**Every block, not a shortlist** The picker's groups start from a builder's
shelf — stone, wood, wool, glass — and then list every other block the loaded
pack knows about, grouped as walls, stairs, gates, trapdoors, buttons, redstone
and the rest. The pack carries one blockstate file per block, so the list is
exactly the block list of the version you loaded, granite wall included, without
anything having to be written out by hand. With no pack loaded you get the
curated shelf, and typing an id still reaches anything at all.

**Keep materials to hand** The strip along the bottom is a nine-slot hotbar on
the number keys, seeded from the build's own most-used materials when you open
it. `1`–`9` take a slot in hand and load its material. A build with nothing in
it yet starts with a generic set — stone, planks, dirt, glass — so an empty
canvas is ready to draw on.

One slot is *in hand*, raised and ringed, and it holds whatever you are
building with: choose a block in the picker, take one off the build with the
eyedropper, turn a stair round with `R`, and the slot in hand follows. So the
number keys always get you back to a material you actually used, rather than to
whatever the build happened to contain when it opened. Right-click a slot to
choose a block for it directly, or `Shift`-click one to park the current
material there without changing hands.

**Take a block off the build** `Alt`+click anything, with any tool in hand, and
it becomes the paint material — landing in the slot you are holding — without
putting the tool down. Pointing at a material already standing in front of you
beats finding it in a list. `I` is the same thing as a tool, for when both hands
are on the mouse; picking with it hands back the block tool you came from, so
the block you just lifted goes straight down again.

**Remove blocks** Press `E` for the erase tool and click or drag across the
blocks you want gone. A whole drag undoes in one step. For bigger cuts, press
`M`, click one corner of a box, shift-click the opposite corner, then use
**Erase** or `Delete`.

**Add blocks** Press `P` for the place tool. It writes whatever the **Paint**
section is set to into the empty cell against the face you click, and a drag stays on
the face it started from, so a row comes out straight instead of climbing over
itself.

**Turn the block** Stairs, logs, walls, doors, pistons and the rest keep their
orientation in the blockstate, and the panel turns them for you: the compass pad
in **Paint** aims the block, with the half and the other properties that
family actually has beside it. Properties the game works out for itself — a
fence's connections, a stair's corner — aren't offered, since the next edit would
only overwrite them. `R` turns whatever
is loaded a quarter clockwise — the next axis, for a log — and `Shift`+`R` turns
it over. **Plain** drops every turn back off. The state being written is spelled
out above the buttons, since two turns of one stair are otherwise the same name
in the list.

With **Turn it to the face I click** ticked, a placed block also takes the face
into account the way the game does: a log lies along the face it was laid on, a
stair or slab clicked from underneath hangs from the ceiling, and anything with
a front turns it to the camera. Untick it to write the material exactly as it is
set, whatever you click.

**Fences, panes and stairs join up** Fences, glass panes, iron bars, walls and
stairs keep their connections in the blockstate, and the game never asks for
them — it works them out from the neighbours. So does this: every edit rewrites
the joins of the blocks it wrote *and* of the blocks they now touch, in the same
undo step. Lay a row of fence and it comes out as fence rather than a line of
posts; knock a block out of the middle and the two either side let go of it. A
wall loses its post where it runs straight through and grows to full height under
a block, and a gate drops to meet a wall beside it. Nether brick fence keeps to
its own kind, and fences stay clear of walls, exactly as in the game.

Stairs work the same way, on `shape`: turn a flight or a walkway and the block at
the bend is cut to an inner or outer corner, following the game's own rule —
including the part where a stair that already has an identical one across the
turn belongs to a straight line and stays straight.

**Cover ground faster** Place, erase and paint all take a brush width, on `−`
and `=` or the slider in the panel, square or rounded. Widths are odd only —
an even one has no middle cell to sit on and would draw the same footprint as
the odd size below it. The place brush stays flat on the face it is drawn
against rather than balling up into the wall behind it, so a 7-wide brush
patches a wall in one click.

**Lay a floor** Press `H`, press where the floor starts and drag out its far
corner. The rectangle previews as you drag, with its footprint written on it,
and the whole sheet goes down as one undo step when you let go. The height is
settled by the press and never moves again: press on a block's top face and the
floor sits on that course, press on open ground and it lands at `Y 0`. Only the
empty cells are written, so a floor drawn over something already standing goes
around it rather than through it, and says how many cells it stepped over.

Tick **Build on the layer plane** (or press `L`) to put the floor on the layer
slider's height instead, wherever you point — `[` and `]` move the plane while
you work. The place tool honours the same lock, for a flat course laid block by
block.

**Bring another design in** **Import** loads a second schematic onto the
clipboard instead of replacing what you have open, so a design from somewhere
else can be dropped into this build and reworked. Dragging a file in still
opens it; hold `Shift` while you drop to import it instead.

The imported piece arrives as a parked ghost in the middle of the build, which
means the clone tool's whole kit applies to it: arrows slide it, `Page Up`/
`Page Down` lift it, `R` turns it, **Mirror X**/**Mirror Z** flip it, `Enter`
stamps. It stays on the clipboard after stamping, so the same piece can be
placed as many times as you like, and each stamp is one undo step.

By default the piece's empty space leaves what's already there alone, so a
building drops onto terrain without punching a hole around itself — **Stamp the
empty space too** clears it instead. Anything hanging over the edge of the box
is dropped when you stamp; if the piece is bigger than the build, the import
says so and **Canvas** will grow the box first.

Every readable format can be imported: `.litematic`, `.schem`, `.schematic` and
`.nbt`.

**Build symmetrically** The **Mirror** section turns on symmetry for the place,
erase and paint brushes: draw one half and the rest follows. Switch on `X`, `Z`
or both — two axes give four-way symmetry, all three give eight — and every
stroke lands on each side at once, in a single undo step.

Blockstates are reflected, not copied: a stair placed facing east comes out
facing west on the far side, and doors, signs and fences turn with it. The
planes are drawn in the viewport and the cursor shows an outline at every cell
the click will reach, so there is no guessing.

Each plane starts on the middle of the build and the steppers slide it half a
block at a time — either through the middle of a column (`block`) or along the
seam between two (`seam`), which is the difference between an odd and an even
build being symmetrical. **Recentre** puts them all back.

Symmetry follows the brushes only. Fill, stamp and the stairs tool are
unaffected, so a mirrored half of a build stays under your control.

**Run a staircase** Press `S`, click the block the flight starts on, then the
block it lands on. The direction, the grade and every step's `facing` come out
of those two points, so getting from floor 1 to floor 2 is two clicks. A ghost
shows the flight before it is laid down, and it re-draws as you change the
settings:

- **Grade** — *Fit* works the slope out from the two points you clicked; `1:1`,
  `1:2` and `1:3` force it, one rise per one, two or three blocks along. A
  gentle grade puts a full-block landing between the steps.
- **Under it** — *None* leaves the flight floating, *One course* puts a single
  block beneath every tread, *Solid* fills all the way down to the bottom step.
- **Width** widens the flight square to the climb, centred on the line you
  clicked.
- **Shape** — *Stairs* places cut stair blocks turned to face the climb;
  *Blocks* places full blocks for a stepped ramp. Any block that isn't a
  `*_stairs` id is placed exactly as chosen.

Clicking the top step first is fine — the flight always climbs. `Enter` builds
the previewed flight, `Esc` starts over, and the whole thing is one undo step.

**Measure something** Press `K` and click two blocks. The viewport draws the
straight line between them plus the three axis legs that get you there, and the
panel reads out the span on each axis, the straight-line distance and the
distance walked. **Marks to selection** turns the two marks into a selection
box; **Measure selection** does the reverse.

**Find the middle** The **Centre of** section reads out the centre of the build
— or of the current selection — on all three axes, without counting anything.
A box of even width has no middle block, so both the centre line and the two
blocks straddling it are named: `12 · between 11 and 12`. **Show centre lines**
draws them in the viewport, **Centre block** selects the middle block itself,
and **Centre column** selects that block's full-height column so you can build
straight off it.

The **Selection** section carries the same readout for the box you have
selected, so the middle of a selection is one click away without going near the
ruler: the centre coordinates, which block or pair of blocks sits on the middle
of each axis, and the same three buttons pointed at the selection.

**Clone a piece** Select a box with `M`, then `Ctrl+C` (or **Copy**) to put it
on the clipboard and switch to the clone tool. A green outline follows the
pointer showing where the stamp lands — it hangs off whichever face you point
at — and a click writes it. `R` turns the copy a quarter turn, **Mirror X** and
**Mirror Z** flip it; stairs, fences, walls, rails, signs and anything else with
a facing turn with it. By default the copy's empty space leaves what's already
there alone, so a window drops into a wall without punching a hole around it;
**Stamp the empty space too** clears it instead. `Ctrl+X` cuts. The clipboard
survives opening another file, so a piece can move between builds.

The pointer can only anchor a stamp against a surface it can hit, which puts
mid-air out of reach: a second storey, a floating roof, a copy that should sit
three blocks clear of the one below it. `Page Up`/`Page Down` — or `Shift` with
the up and down arrows, for a keyboard with no page keys — float the outline
that many blocks above the face while the pointer keeps aiming it, so height
comes from the keys and placement stays on the mouse. The read-out says how far
it is floating, `Esc` sets it back down, and the panel has the same control as a
stepper. This is the difference from parking the ghost below: parking takes the
pointer out of the job entirely, floating only lifts it.

A stamp is clipped to the build's box: anything hanging over the edge is
dropped and the outline turns red to say so. Grow the box first if you need
the room — see **Change the box** below.

**Select what you can't click** A box select can only take corners off blocks
you can see, which leaves the inside of anything solid — a tree, a roof, a
filled tower — impossible to reach by pointing at it. Press `X` and drag a
rectangle over the build instead: every block inside that rectangle is caught,
however deep it sits or whatever stands in front of it, and the selection
becomes the box around them. The read-out says how many were found. `Shift`
while you drag widens the selection you already have rather than replacing it.

Blocks above the layer limit are left out, so the slider doubles as a depth
filter — peel the build back to the course you care about and the rectangle
stops at it.

**Push blocks about** Press `U` for a brush that carries what it covers. A ball
— or a box, from the panel — follows the pointer, and dragging shoves every
block inside it along, picking up whatever it reaches on the way like a plough
rather than teleporting its load. It is how a branch gets bent, a canopy swung
round, or a roofline pulled out a few blocks without rebuilding it. `−` and `=`
resize the brush; hold `Shift` to keep the shove on one axis.

The brush follows the screen, not the grid: drag left and things go left from
where you are standing, whichever way the build is turned. Blocks are moved,
not copied — they leave holes behind, write over whatever they land on, and
stop at the edge of the box rather than falling off it. The whole drag is one
undo step.

**Shape a selection** The **Shape** dropdown decides which cells of the box
**Fill** and **Erase** actually touch: the whole thing, its six faces, the four
upright walls with no floor or ceiling, the twelve edges, or only the cells
that are empty right now. A room is walls, a frame is edges, and filling in
around what you already built is *Into gaps*.

**Move a selection where it stands** Arrow keys slide the selection box across
the screen and `Page Up`/`Page Down` lift it; hold `Shift` and the blocks
inside come along. **Rotate**, **Mirror X** and **Mirror Z** turn the contents
in place, re-centred on the box, in one undo step — the same blockstate turns
the clipboard gets, so stairs and fences come round with it.

**Change the box** The **Canvas** section grows or shrinks each of the six
sides. Growing adds empty space; shrinking cuts away whatever was there.
**Crop to blocks** pulls the box tight to what's actually in it, which is how
you strip the empty margin a schematic was exported with. Re-cutting the grid
invalidates the block history — it is indexed by position — so it clears the
undo stack and leaves one step of structural undo to put the box back.

**Work on two builds at once** A schematic that arrives the wrong height or
width has to be cut down before it can go anywhere, and doing that inside the
build you are working on means resizing the wrong box. **Open in a tab** — in
the tab strip under the top bar, or `Alt`-dropping a file onto the window —
opens it beside the current build instead of over it. Resize it, crop it,
rotate it, strip what you don't want; then **Copy build** (or `Ctrl+A`,
`Ctrl+C`), click back to the other tab, and stamp it in with the clone tool.

The clipboard is shared between tabs — that is what makes this worth having.
Each tab keeps its own selection, layer limit, materials and undo history, and
picks them back up when you return to it. **+ Empty tab** starts a blank canvas
in one. Only the tab you are working in is autosaved for the next session.

**Start from nothing** **New** opens an empty box at whatever size you pick.
It behaves like any other build from there: save it out to `.litematic`,
`.schem` or `.nbt` when you're done.

### Keys

| Key             | Action                        |
| --------------- | ----------------------------- |
| `V`             | Move                          |
| `P`             | Place                         |
| `E`             | Erase                         |
| `B`             | Paint                         |
| `I`             | Pick material from a block, then back to the block tool you came from |
| `Alt`+click     | Pick material from a block without leaving the current tool |
| `H`             | Floor (drag out a flat course) |
| `U`             | Push (shove blocks with the brush) |
| `S`             | Stairs (on the ground; in walk mode `S` still moves) |
| `K`             | Ruler                         |
| `M`             | Box select                    |
| `X`             | Select through (drag a rectangle, hidden blocks included) |
| `C`             | Clone (stamp the clipboard)   |
| `Enter`         | Build the previewed flight    |
| `L`             | Lock placement to the layer plane |
| `R`             | Turn the clipboard a quarter turn — the paint material, with a block tool in hand |
| `Shift`+`R`     | Turn the paint material over (top slab, upside-down stair) |
| `O` / `G`       | Orbit / walk                  |
| `F`             | Fit the build to the view     |
| `[` / `]`       | Lower / raise the layer limit |
| `1`–`9`         | Take that hotbar slot in hand |
| `Shift`+`1`–`9` | Park the paint material in that slot, hands unchanged |
| `−` / `=`       | Narrower / wider brush (the push brush, with `U` active) |
| Arrows, `PgUp`/`PgDn` | Slide the selection box, or the parked stamp |
| `PgUp`/`PgDn`, `Shift`+`↑`/`↓` | Float the clone stamp above the face the pointer found |
| `Shift`+arrows  | Move the selection's blocks with it |
| `Delete`        | Erase the selection           |
| `Ctrl+A`        | Select the whole build        |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / stamp the selection |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo         |
| `Esc`           | Set a floating stamp back down, start the flight over, clear the selection, stop walking |

## Textures

No game assets ship with this app — Mojang's are not ours to redistribute. It
uses the copy you already have instead.

**On the dev server this is automatic.** `npm run dev` scans your Minecraft
folder, picks the newest installed version, and renders with it. Nothing is
copied into the project; the jar is read where the launcher put it and served
over localhost to the page. The result is cached in the browser, so later
loads don't touch the disk at all.

| Source | Where it looks |
| ------ | -------------- |
| Windows | `%APPDATA%\.minecraft\versions\<version>\<version>.jar` |
| macOS | `~/Library/Application Support/minecraft/versions/…` |
| Linux | `~/.minecraft/versions/…` |
| CurseForge | `~/curseforge/minecraft/Install/versions/…` |
| Anywhere else | set `MINECRAFT_DIR` |

The chip in the top bar shows what's loaded. Click it to toggle textures off
without unloading, `▾` to switch versions or pick a file by hand, `×` to unload
and stop looking. A resource pack `.zip` works anywhere a client `.jar` does —
same internal layout — and only the block assets are unpacked, so the other
~90% of a 30 MB jar is skipped.

A built copy has no dev server, so it falls back to the cache or the picker.

With a pack loaded, blocks are drawn through vanilla's own model pipeline:

```
blockstate JSON  ->  variant, or every matching multipart case
                 ->  model + x/y rotation + uvlock
                 ->  flatten the parent chain, merge texture maps
                 ->  resolve #name texture variables
                 ->  elements: boxes with per-face uv, rotation, cullface, tint
```

So stairs, fences, walls, panes, rails, torches, doors and trapdoors have their
real geometry, not an approximation, and face culling uses the models' own
`cullface` declarations. Textures go into a `DataArrayTexture` — one layer per
texture, so mipmaps need no gutter padding and nothing bleeds between
neighbours.

Without a pack, blocks fall back to hand-picked averages of the vanilla
colours on an approximate box shape. Both paths produce the same kind of quad,
so the mesher only has one code path, and the toggle on the pack chip switches
between them.

Shading is Minecraft's in either case: a fixed per-orientation tint plus corner
ambient occlusion, baked into vertex colours, so the viewport needs no lights
and looks the same from every angle.

## Modded blocks

A mod jar has the same asset layout as a client jar, under its own namespace, so
the same loader reads it and the same pipeline draws it. Mod jars stack over the
base pack: vanilla underneath — a mod's models parent off `minecraft:block/stairs`
and friends — with each mod's blocks added on top.

The **mods chip** sits beside the pack chip once there is something to add.
`▾` lists the modded instances the dev server found and the jars inside each, so
a jar can be taken straight out of the instance you play; **Add a mod jar…**
takes files by hand, which is also the path a built copy uses. Dropping a mod jar
on the window works too — a jar with no `minecraft` namespace is stacked as a mod
rather than adopted as the base pack. Loaded jars are cached like the base pack
and come back on reload. Clicking the chip hides modded blocks without unloading
them; `×` on a row drops one for good.

| Where instances are looked for | |
| ------ | -------------- |
| CurseForge | `~/curseforge/minecraft/Instances/<name>/mods` |
| Prism / MultiMC | `…/PrismLauncher/instances/<name>/.minecraft/mods` |
| Modrinth | `…/ModrinthApp/profiles/<name>/mods` |
| Anywhere else | set `MINECRAFT_INSTANCES` |

Modded blocks are grouped in the picker under their own mod's heading, sorted
into the same categories as vanilla — `Oh The Biomes Weve Gone · Stairs & slabs`.
Ids keep their namespace the whole way through, so `biomeswevegone:aspen_stairs`
is what lands in the palette and what gets written to the exported schematic;
that file loads in-game as long as the mod is installed there too.

Every key in a loaded pack carries its namespace, which is what makes stacking
safe: across the 60 jars of one modpack, 392 asset paths collide once the
namespace is stripped — two mods both shipping a `block/willow_stairs.json`.

One vanilla convention does not carry over: biome tint. Vanilla leaves are
greyscale textures coloured per biome, while mods almost always ship theirs
already coloured and register a fixed colour instead — Oh The Biomes We've Gone
has blue spruce, purple jacaranda and brown oak. So modded blocks keep their
texture's own colour, and only `minecraft:` ids get the plains tint.

Even in vanilla the tint is named block by block rather than matched on
`_leaves`, because the greyscale arrangement is now the exception: cherry, pale
oak and both azaleas ship coloured textures the game leaves alone, and only oak,
jungle, acacia, dark oak and mangrove go through the foliage colormap. Birch and
spruce take fixed colours; fallen leaf litter takes the dry foliage one.

### What isn't covered

- **Block entities** — chests, beds, banners, shulker boxes, signs, bells and
  conduits are drawn by the game in Java code, not by the model JSON, so they
  fall back to coloured boxes.
- **Animation** — animated textures (water, lava, fire, sea lanterns) use their
  first frame.
- **Biome tint** — schematics carry no biome, so grass, leaves, vines and water
  are pinned to plains colours.

## Layout

```
src/
  nbt/         NBT reader/writer and gzip helpers, no dependencies
  formats/     one module per file format, plus the legacy id table
  core/        the Build model, the clipboard and its turns, brush and region
               footprints, the push brush's sweep, stair fitting, symmetry
               planes, distances and centres, the session snapshot, fallback
               colours
  assets/      pack loading and caching, model resolution, texture array
  render/      quad baking, the mesher, and the three.js viewer
  ui/          React components
  store.ts     application state, edits and undo history
scripts/
  minecraft-assets-plugin.ts   dev-only local install discovery
  make-sample.mjs              bundled sample builds
  make-orientation-test.mjs    UV regression fixture
```

`public/samples/orientation.litematic` is a row of blocks whose textures make
their orientation unmistakable — grass, logs on each axis, a furnace facing two
ways, TNT, a carved pumpkin. Open it after touching anything in `bake.ts`: the
TNT lettering has to read upright and left to right, the furnace mouth sits at
the bottom of the face it faces, and grass keeps its green fringe on top.

Blocks are held as palette indices in a `Uint16Array` in YZX order — the order
every schematic format uses on disk, so loading and saving are straight copies.
Geometry is built in 32³ chunks; an edit only re-meshes the chunks it touched.

An edit records the cells it changed, their old values and their new ones. A
drag collects into a mutable buffer and becomes a single history entry when the
pointer comes up, rather than being folded into the undo stack block by block —
that copied the whole stroke on every block, which is quadratic and showed as
lag part-way through a long one. Cells crossed twice in the same drag keep the
value they held before the stroke started, so undo rewinds the whole thing
rather than to a half-drawn state.

Symmetry in `core/mirror.ts` reflects by subtraction — `x' = pivot - x` — with
the pivot held as an integer rather than storing the plane's position directly.
That is what keeps cells landing on cells: the plane itself falls at
`(pivot + 1) / 2`, on a seam for an odd pivot and through a column for an even
one, and both are wanted. The store expands a stroke's writes with their images
before committing, so symmetry costs one undo entry rather than one per side,
and each tool keeps its own rule about what it may write over.

The push brush in `core/push.ts` moves one cell at a time rather than applying
the whole delta at once. A pointer that jumped four blocks between frames would
otherwise teleport its load four blocks, sweeping straight past everything in
between and picking none of it up; stepping makes it a plough, re-reading what
the brush covers on each step so blocks already moved stay under it and fresh
ones join as it reaches them. The steps are capped per pointer move — a flick
across a large build spans more cells than anyone could aim at.

The floor and push tools both take hit-testing off the geometry for the length
of a drag and put it on a plane instead (`Viewer.beginDragPick`): a level plane
for the floor, so it keeps the course it started on, and a camera-facing one
for the push, so the brush follows the mouse rather than whatever happens to be
under it. Blocks moving beneath the pointer must not steer it.

Through-selection ignores the geometry entirely and walks the grid, projecting
each block itself against the view-projection matrix. Occlusion is the whole
problem it exists to solve — the inside of a tree cannot be clicked, because its
own leaves are in the way.

Stair fitting lives in `core/stairs.ts` and is pure: two points and a settings
object in, a list of cells and their blockstates out. Minecraft stairs put their
tall half on the side named by `facing`, so `facing` is simply the direction the
flight climbs in — the fiddly part is the gentle grades, where a tread is one
cut step followed by `run - 1` full blocks at the same height, and the top tread
stops at the click rather than running a landing past it.

The session snapshot in `core/session.ts` stores the block array raw rather
than as a schematic file: writing one means compacting the palette and gzipping
a few megabytes, far too much to repeat every few seconds. It lives in its own
IndexedDB database so it never has to agree on a schema version with the
resource-pack cache, and restoring is offered rather than done automatically.

## License

MIT — see [LICENSE](../LICENSE). Use it, fork it, ship it; keep the copyright
notice with it. Contributions are taken under the same licence.

The dependencies keep their own licences (React, three.js, zustand and fflate
are all MIT too). No Minecraft assets are in this repository — see **Textures**
above — and this project is not affiliated with or endorsed by Mojang.
