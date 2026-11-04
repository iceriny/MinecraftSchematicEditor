# Minecraft Schematic Editor

[English](../SKILL.md) | 简体中文

用 MCP 操作建筑数据，用编辑器网页给用户看结果。工具名称以实际工具目录为准，通常为 `mcp__minecraft_schematic_editor__schematic_*`。服务器名为 `minecraft-schematic-editor`。

首次部署配置完成后，按 [部署交付](first-build.md) 给用户网页地址、启动和保存方式，并发送对应语言的样例提示词。

## 先选工作模式

- 用户正在看网页，或要求实时调整时，调用 `schematic_status({"target":"browser"})`，选定 `clientId` 和活动文档。后续编辑、检查、保存都传 `target:"browser"`。
- 生成文件或批处理时用默认的 `headless`。同一 MCP 进程内保留一份建筑，完成后显式保存。
- `schematic_preview` 把 headless 建筑打开为网页中的新文档。随后继续改 headless，需再次预览。要让后续修改实时可见，转为编辑网页中的该文档。
- `clientId` 标识浏览器连接，`activeDoc` 标识网页内的文档。多网页连接时明确选连接，多文档时用 `schematic_documents` 列出和切换。刷新后重新查询 ID。

## 能做什么

| 工作 | 工具与做法 |
| --- | --- |
| 读取／创建建筑 | `schematic_open` 读绝对路径，`schematic_new` 指定 `size:[宽,高,长]`。网页默认新开文档 |
| 看局部和材料 | `schematic_inspect` 加 `box`，`mode:"materials"` 按数量汇总。需要逐格数据时用默认模式和分页 |
| 批量搭建 | `schematic_edit` 的 `fill` 铺体积，`paint` 放同材质散点，`set` 写异材质散点 |
| 改造已有建筑 | 同一批次内 `replace`、`copy` 或 `move`。复制支持旋转、镜像和是否写入空气 |
| 撤销 | `schematic_history` 的 `undo`／`redo`，每个编辑批次为一步 |
| 看效果 | `schematic_capture` 返回 MCP 图片，可指定多个方向或房间剖面，并保存 PNG |
| 调整用户视图 | `schematic_view` 对准建筑或设置可见层 |
| 加载材质／模组 | `schematic_resources` 查询已安装版本、实例及 JAR，按需加载 |
| 交付文件 | `schematic_save` 导出到绝对路径，返回实际文档、版本及 SHA-256 |

## 编辑与交付

1. 从状态或局部检查了解尺寸、目标文档及区域现状。沿用用户指定的材料、建筑和保存位置。
2. 坐标从零开始，为 `[x,y,z]`，Y 向上，南向为 +Z。区域两端均包含。批次设置 `origin` 后，坐标相对此原点，可用负偏移，最终位置须在建筑内。
3. 将一处完整特征合成一个编辑批次。矩形区域用 `fill`，同材质散点用 `paint`，重复构件用带朝向转换的 `copy`。普通修改直接使用 MCP。
4. 对已有网页建筑，将上一条回执的 `activeDoc`、`revision` 作为 `expectedDocumentId`、`expectedRevision` 传给编辑和保存。发生冲突后重新检查目标。
5. 用 `schematic_capture` 查看刚修改的范围，检查轮廓、尺度、空隙和材质。室内传 `box` 直接剖切，保留当前文档和用户镜头。
6. 保存后核对回执中的路径、文档和版本。覆盖用户指定的现有文件时传 `overwrite:true`。按任务需要重新读取核对或输出预览图。

常规状态和回执使用默认的 compact 结果。只有需要整塔材料表时传 `detail:"full"`。局部检查默认每页 32 项。使用 MCP 图片返回值查看截图，避免把 base64 文本输出到对话。

大规模程序化造型可用本地脚本计算坐标，再通过 MCP 批量提交。每批最多 128 项操作、改变 100 万格，单个 `set`／`paint` 最多 10 万坐标。批次失败会指出操作序号，整个批次不提交。

最小调用示例见 [workflows.zh-CN.md](workflows.zh-CN.md)，按当前任务读取对应小节。

## 帮用户打开网页

网页地址为 <http://127.0.0.1:5173>，需要在用户的机器上运行本仓库的 Vite 服务。

- 在仓库目录安装依赖 `npm ci`。Windows 用 `./local-server.ps1 -Action Start` 启动后台服务并打开默认浏览器，`-NoBrowser` 只启动服务。双击 `start-editor.cmd` 也可以。
- 要复用指定浏览器的现有会话时，用 `-NoBrowser` 启动，再用宿主可用的浏览器工具查找或打开上述 URL。按宿主的浏览器控制规范操作。
- 其他平台在独立终端运行 `npm run dev`，向用户提供可点击的地址。MCP 本身没有打开浏览器标签页的工具。
- 服务就绪后调用 `schematic_status` 看连接。clients 为空表示尚未连接编辑器页面。端口被占用时先检查归属。
- 通过 `schematic_open(target:"browser")` 将本地文件直接交给网页。文件选择器不可用时仍可走这条路径。

Minecraft 标准目录由服务发现。自定义路径使用 `MINECRAFT_DIR`、`MINECRAFT_INSTANCES`，Windows 入口也支持被 Git 忽略的 `local-server.local.json`。先用 resources 查实际版本和模组 ID，按需加载对应资源。

## 能力边界

- 输入支持 `.litematic`、`.schem`、旧式 `.schematic`、结构 `.nbt`，输出支持前三者中的 `.litematic`、`.schem` 及 `.nbt`。旧式 `.schematic` 只读。
- 编辑模型保存方块 ID、blockstate 与基础元数据。输入含非空实体、方块实体或受检查的定时 tick 数据会拒绝载入。箱子物品、告示牌文本、机器内部 NBT 需要另用能完整处理这些数据的工具。
- 模组材质来自用户安装的 JAR／资源包。缺少资源时显示近似色块。方块实体通常用方盒显示，动画只用首帧，生物群系色调固定。
- MCP 写入方块状态字符串，未知 ID 也可能被接受。不会根据游戏注册表自动判定一个方块是否存在、朝向属性是否合法，或附着面与邻接交互是否满足。先核对实际资源中的定义。
- 最大建筑体积为 2,400 万格，输入文件最大 64 MiB。多区域 litematic 载入后合成一个包围盒，导出为单区域。
- 撤销保留最近 50 次编辑。新建／打开文档会建立新的编辑历史。headless 状态随 MCP 进程结束而消失，网页自动暂存只包含当前活动文档。
- 网页实时编辑和截图依赖运行中的 Vite 服务及已连接页面。`dist` 静态页面没有本地 MCP 桥。截图取自该页面的材质渲染，`box` 不受层滑块限制。

## 连接与故障处理

服务端启动命令为 `node <仓库绝对路径>/mcp/launch.mjs`。宿主需连接该 stdio 服务器。仓库根目录的 `mcp.json` 提供插件配置。

工具缺失或新参数报 unrecognized key 时，先检查当前聊天实际暴露的工具定义。让宿主重连同名 MCP，随后用新参数做一次只读调用验证。独立 SDK 测试成功只能确认新连接，不能据此宣称当前聊天的旧连接已刷新。

保持服务器名 `minecraft-schematic-editor` 一致。宿主配置中的工具权限子表应挂在有启动命令的实际服务器下。根据宿主支持的配置方式更新连接。

网页刷新或源码热更新可能重载页面。进行会触发重载的开发工作前，先将所有需要保留的打开文档保存为文件。保留用户正在使用的运行目录、缓存与本机配置。

命令超时或断线后先检查实际文档状态，再决定是否重试修改，避免重复提交。
