# Schematic Editor MCP

[English](README.md) | 简体中文

由 AI 直接编辑 Minecraft 建筑数据，支持新建、读取、检查、批量修改、撤销与导出；可将结果交给本地网页显示，也能直接修改网页当前建筑。

面向 Agent 的使用流程、能力边界与网页联动见仓库内 [minecraft-schematic-editor Skill](../skills/minecraft-schematic-editor/SKILL.md)。支持根目录插件清单的宿主可发现随插件提供的 `skills/`。手动安装时，将 `skills/minecraft-schematic-editor` 整个目录复制到宿主的技能目录，另按下节配置 MCP 连接。

## 运行与接入

在项目根目录安装依赖并启动服务：

```powershell
npm ci
node mcp/launch.mjs
```

这是标准 stdio MCP 服务，客户端用 Node 启动仓库里的 `mcp/launch.mjs`。入口会自动定位项目根目录，无需客户端设置工作目录。

服务器名为 `minecraft-schematic-editor`。支持插件清单的客户端可使用根目录的 `mcp.json`，其他客户端可将下例中的入口路径换成本地绝对路径：

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

在项目根目录用 PowerShell 注册到 Codex：

```powershell
codex mcp add minecraft-schematic-editor -- node (Resolve-Path 'mcp/launch.mjs').Path
```

客户端需重新加载服务器配置以发现全部工具。配置方式参见 [OpenAI 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp)。

`headless` 模式完全在本地进程中执行。需要网页预览或实时编辑时，在另一个终端运行 `npm run dev` 并打开 <http://127.0.0.1:5173>。编辑桥只连接本机，认证信息由本地服务生成在 `run.local/mcp-bridge.json`。构建后的 `dist` 静态站点使用文件方式编辑。

## 工具

Windows 后台运行方式见 [本地启停说明](../docs/windows.zh-CN.md)。

| 工具 | 用途 |
| --- | --- |
| `schematic_status` | 查看进程内建筑状态和浏览器连接 ID |
| `schematic_new` | 新建指定尺寸的建筑 |
| `schematic_open` | 读取绝对路径下的建筑文件 |
| `schematic_inspect` | 查看尺寸、材料和分页方块清单 |
| `schematic_edit` | 一批填充、放置、替换、复制、旋转／镜像复制、移动 |
| `schematic_history` | 撤销或重做 |
| `schematic_save` | 导出到绝对路径，默认保留已存在的文件 |
| `schematic_preview` | 将进程内建筑打开为网页中的新文档标签 |
| `schematic_resources` | 列出／加载本地材质和模组资源 |
| `schematic_view` | 对准网页建筑或调整显示层高 |
| `schematic_capture` | 从 1～4 个方向渲染当前网页建筑，返回可直接查看的 PNG 拼图 |
| `schematic_documents` | 列出、切换或关闭网页内的文档标签 |

编辑类工具的 `target` 默认为 `headless`，即本 MCP 进程内的建筑。`target: "browser"` 表示直接编辑网页当前文档；多网页连接时用 `schematic_status` 返回的 `clientId` 指定目标。

`schematic_preview` 创建独立的预览文档。之后若继续在 `headless` 中修改，需再次预览；若希望网页立即显示每次修改，则后续操作使用 `target: "browser"`。

## 编辑规则

查看室内时，直接传 `schematic_capture({"box":{"min":[25,12,26],"max":[47,27,44]}})` 即可得到辰衡星塔藏书厅的一张剖面。六个边界均取建筑原坐标，会显露被切开的墙面。剖面独立于网页的可见层，不用创建副本或切换标签。省略 `box` 时按当前可见层生成整塔四视图。两种模式都能指定 1～4 个 `angles`，以及像素边长 `tileSize`、焦点 `center` 和取景宽度 `span`。传绝对 `.png` 路径可保存图片。

状态和编辑回执默认给出尺寸、非空气方块数、版本及材料种数；需要整塔材料明细和标签清单时传 `detail:"full"`。检查房间用 `schematic_inspect` 加 `box`。默认每页列出 32 个方块，`mode:"materials"` 改为按数量列出该区域的材料，`limit` 控制条目数。模组资源默认按实例汇总，例：`schematic_resources({"operation":"list","instance":"星轨与齿轮","filter":"create"})`。

坐标为从零开始的 `[x, y, z]`。区域 `min` 和 `max` 都包含在操作范围内。方块可写 `minecraft:stone`，也可带朝向等属性，例如 `minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]`；模组方块保留原命名空间。

连续体积用 `fill`，同种材料的分散位置用 `paint`。例如以塔轴和本层地面为原点摆四根柱脚，只写一次材料名：

```json
{"target":"browser","origin":[39,12,39],"operations":[{"type":"paint","block":"astralsorcery:marble_chiseled","at":[[-6,1,-6],[6,1,-6],[-6,1,6],[6,1,6]]}]}
```

`origin` 对本批次的方块坐标、区域和复制／移动目的地统一生效，偏移可为负。未指定范围的 `replace` 仍搜索整座建筑。一个批次失败时，错误会标出操作的序号。

每个 `schematic_edit` 批次作为一次修改提交与撤销。先检查当前建筑，再将返回的 `revision` 传为 `expectedRevision`，可以避免基于过期状态修改。一个批次最多 128 项操作、最多改变 100 万个方块；填充、复制和移动的单个区域最多 100 万格。撤销记录保留 50 步。

例如新建后铺一层地板：

```json
{"size":[16,12,16],"name":"工坊"}
```

```json
{"operations":[{"type":"fill","box":{"min":[0,0,0],"max":[15,0,15]},"block":"minecraft:stone_bricks"}],"label":"铺设工坊地板"}
```

`fill.shape` 可用 `solid`、`hollow`、`walls`、`outline`、`air`。`copy.rotate` 为绕 Y 轴顺时针旋转的次数（0～3），`mirror` 为 `x` 或 `z`。复制默认跳过空气，设置 `includeAir: true` 可一并写入空气。

## 文件与会话

输入支持 `.litematic`、`.schem`、`.schematic`、`.nbt`；输出支持 `.litematic`、`.schem`、`.nbt`。路径必须为绝对路径，输出扩展名必须与格式一致。覆盖现有输出文件需明确传入 `overwrite: true`。

服务复用编辑器现有格式实现，编辑对象是方块及其 blockstate。文件若包含该模型无法保留的实体或方块实体数据，会拒绝载入；箱子物品、告示牌文本及机器内部数据等应由支持完整 NBT 的流程处理。

进程内建筑随 MCP 进程关闭而结束，完成工作后使用 `schematic_save` 保存文件。网页文档沿用编辑器自己的自动暂存与保存机制。

在网页上编辑和保存时，可将上一条回执的 `activeDoc`、`revision` 分别作为 `expectedDocumentId`、`expectedRevision` 传回。目标发生变化时调用会失败。保存回执中的 `documentId`、`revision` 和 `sha256` 对应实际写出的文件。覆盖保存先在同目录写完临时文件，再替换目标。

## 验证

```powershell
npm run test:mcp
npm run typecheck
npm run build
```

辰衡星塔实测：54,308 个方块、153 种方块状态。修改一个方块的结构化回执为 163 字节，完整模式为 10,429 字节；64 个同材质坐标的操作从 `set` 的 4,633 字节降至 `paint` 的 592 字节。以上按 UTF-8 JSON 字节计。区域截图验证了活动文档、版本、层高及标签列表均保持原值。
