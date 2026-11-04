# 调用示例

以下是工具名及参数。宿主可加服务器命名空间前缀。示例中的 clientId、文档 ID 和版本由实际回执获取，路径换成用户要求的绝对路径。

## 创建文件并展示

`schematic_new`

```json
{"size":[32,48,32],"name":"观星书屋"}
```

`schematic_edit`

```json
{"origin":[16,0,16],"operations":[{"type":"fill","box":{"min":[-8,0,-8],"max":[8,0,8]},"block":"minecraft:stone_bricks"},{"type":"paint","block":"minecraft:quartz_pillar[axis=y]","at":[[-6,1,-6],[6,1,-6],[-6,1,6],[6,1,6]]}],"label":"地坪与柱脚"}
```

`schematic_save`

```json
{"path":"/absolute/output/观星书屋.litematic"}
```

用 `schematic_status` 找到浏览器连接，再调用 `schematic_preview({"clientId":"实际连接ID"})`，把 headless 建筑打开为网页中的新文档。下一步实时修改须传 `target:"browser"`。

## 编辑网页内的房间

先调用 `schematic_status({"target":"browser"})`。多文档时通过 `schematic_documents({"operation":"list","clientId":"实际连接ID"})` 选定并切换文档。

`schematic_inspect`

```json
{"target":"browser","clientId":"实际连接ID","box":{"min":[6,12,6],"max":[24,20,24]},"mode":"materials","limit":5}
```

假设最新回执的 activeDoc 为 doc-2、revision 为 7，将它们传给 `schematic_edit`

```json
{"target":"browser","clientId":"实际连接ID","expectedDocumentId":"doc-2","expectedRevision":7,"origin":[16,12,16],"operations":[{"type":"fill","box":{"min":[-3,1,-6],"max":[3,1,-6]},"block":"minecraft:bookshelf"},{"type":"paint","block":"minecraft:dark_oak_slab[type=top,waterlogged=false]","at":[[-2,1,6],[-1,1,6],[0,1,6],[1,1,6],[2,1,6]]}],"label":"书架与阅读桌"}
```

需要改正时对同一目标调用 `schematic_history({"target":"browser","clientId":"实际连接ID","direction":"undo"})`。再次编辑或保存时取最新版本。

## 剖面与外观预览

`schematic_capture` 的 box 直接定义六个切面，示例返回一张东南向房间剖面

```json
{"clientId":"实际连接ID","box":{"min":[5,12,5],"max":[25,24,25]},"tileSize":768,"path":"/absolute/output/书屋剖面.png"}
```

整栋外观多角度可显式传入覆盖完整尺寸的 box，使结果覆盖整栋

```json
{"clientId":"实际连接ID","box":{"min":[0,0,0],"max":[31,47,31]},"angles":["south","southwest","northeast","top"],"tileSize":768,"path":"/absolute/output/书屋外观.png"}
```

box 边界包含在内，max 不得超过 size-1。不传 box 时沿用当前可见层。center 使用建筑原坐标，span 指定每格画面的取景宽度与高度。

同一张拼图最多四个方向。用户需要跨楼层总览时分别截图，再将返回的真实 PNG 编排为带标题的总览图。

## 查找并加载模组资源

先 `schematic_resources({"operation":"list"})` 查看版本及实例，再按实例筛选文件

```json
{"operation":"list","instance":"实际实例ID","filter":"create","limit":10}
```

从返回文件选择实际 JAR

```json
{"operation":"add_mod","instance":"实际实例ID","file":"实际返回的模组文件名.jar","clientId":"实际连接ID"}
```

加载基础材质使用 `operation:"load_version"` 和查询到的 version。资源加载只改变渲染资源。

## 保存已编辑的网页文档

`schematic_save`

```json
{"target":"browser","clientId":"实际连接ID","expectedDocumentId":"最新activeDoc","expectedRevision":8,"path":"/absolute/output/观星书屋.litematic","overwrite":true}
```

只有用户要求覆盖既有文件时设置 overwrite。版本过期时重新检查文档，判断是否继续保存。返回的 SHA-256 对应写出字节。
