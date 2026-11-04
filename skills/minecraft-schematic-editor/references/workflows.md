# Workflow examples

English | [简体中文](workflows.zh-CN.md)

Use actual client/document IDs and current revisions. Replace output paths with the user's absolute paths. The host may prefix tool names with its server namespace.

## Create and preview

Call `schematic_new` with `{"size":[32,48,32],"name":"Observatory"}`, then `schematic_edit`

```json
{"origin":[16,0,16],"operations":[{"type":"fill","box":{"min":[-8,0,-8],"max":[8,0,8]},"block":"minecraft:stone_bricks"},{"type":"paint","block":"minecraft:quartz_pillar[axis=y]","at":[[-6,1,-6],[6,1,-6],[-6,1,6],[6,1,6]]}]}
```

Save with `schematic_save({"path":"/absolute/output/observatory.litematic"})`. After discovering a browser client through status, call `schematic_preview({"clientId":"actual-client"})`. Subsequent live edits use the browser target.

## Inspect and edit a room

Call `schematic_status({"target":"browser"})` and select the intended document using `schematic_documents`.

`schematic_inspect`

```json
{"target":"browser","clientId":"actual-client","box":{"min":[6,12,6],"max":[24,20,24]},"mode":"materials","limit":5}
```

If the latest reply identifies doc-2 at revision 7, call `schematic_edit`

```json
{"target":"browser","clientId":"actual-client","expectedDocumentId":"doc-2","expectedRevision":7,"origin":[16,12,16],"operations":[{"type":"fill","box":{"min":[-3,1,-6],"max":[3,1,-6]},"block":"minecraft:bookshelf"},{"type":"paint","block":"minecraft:dark_oak_slab[type=top,waterlogged=false]","at":[[-2,1,6],[-1,1,6],[0,1,6],[1,1,6],[2,1,6]]}],"label":"Bookshelves and reading desk"}
```

Undo with `schematic_history({"target":"browser","clientId":"actual-client","direction":"undo"})`. Use the new revision for subsequent edits or saving.

## Capture

Call `schematic_capture` for a room cutaway in original coordinates

```json
{"clientId":"actual-client","box":{"min":[5,12,5],"max":[25,24,25]},"tileSize":768,"path":"/absolute/output/room.png"}
```

Capture a whole 32×48×32 build using its full bounds

```json
{"clientId":"actual-client","box":{"min":[0,0,0],"max":[31,47,31]},"angles":["south","southwest","northeast","top"],"tileSize":768,"path":"/absolute/output/exterior.png"}
```

Bounds include both corners; max must not exceed size-1. Without a box, capture uses visible layers. Center uses original coordinates, and span sets each view's width and height. Capture separate floors, then arrange the real PNGs into a labeled sheet when requested.

## Resources and saving

Query `schematic_resources({"operation":"list"})`, then search an actual instance

```json
{"operation":"list","instance":"actual-instance","filter":"create","limit":10}
```

Load a returned file with `operation:"add_mod"`, `instance`, `file` and `clientId`. Base textures use `operation:"load_version"` and a discovered `version`.

Save the latest browser snapshot

```json
{"target":"browser","clientId":"actual-client","expectedDocumentId":"doc-2","expectedRevision":8,"path":"/absolute/output/observatory.litematic","overwrite":true}
```

Use overwrite when the user requests replacing that file. If the snapshot guard fails, inspect before saving again. The returned SHA-256 identifies the written bytes.
