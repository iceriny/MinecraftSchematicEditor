# Agent 部署指南

[English](agent-setup.md) | 简体中文

用户要求安装或配置本项目时，按本指南完成环境支持的部署步骤。使用当前宿主实际支持的安装、MCP 和浏览器操作方式。

## 定位仓库与安装依赖

1. 复用已有工程，或将 `https://github.com/iceriny/MinecraftSchematicEditor.git` 克隆到合适的用户工作目录。
2. 检查 Node 与 npm。支持 Node.js 20.19+ 或 22.12+。缺少运行时时，使用当前环境支持的安装方式。
3. 在仓库中执行 `npm ci` 和 `npm run check:setup`。自检建立一条临时只读 MCP 连接并核对工具参数，网页此时可以尚未连接。

## 配置 MCP 与 Skill

用实际 Node 可执行文件和 `mcp/launch.mjs` 的绝对路径配置 stdio MCP，服务器名为 `minecraft-schematic-editor`。入口自动定位仓库。

Codex 中先检查已有配置

```sh
codex mcp get minecraft-schematic-editor --json
```

缺少连接时新增，或将同名条目更新到目标仓库

```sh
codex mcp add minecraft-schematic-editor -- node /absolute/path/to/MinecraftSchematicEditor/mcp/launch.mjs
```

按当前 Shell 的规则引用路径。保留已有工具权限，使用同一服务器名，使工具权限子表对应实际服务器。

宿主支持将本仓库作为插件安装时，可发现根目录 `plugin.json`、`mcp.json` 和 `skills/`。其他情况将整个 `skills/minecraft-schematic-editor` 目录复制到宿主支持的技能位置。Codex 使用 `$CODEX_HOME/skills`，未设置 CODEX_HOME 时使用 `~/.codex/skills`。遇到已有自定义 Skill 时先保留，并说明实质冲突。

读取 [Skill](../skills/minecraft-schematic-editor/SKILL.md)。通过宿主支持的方式重连，确认当前聊天实际提供 `schematic_capture.box`、`schematic_edit.origin` 和 `schematic_inspect.mode`。独立 SDK 自检通过只说明新连接可用。

## 启动网页

Windows 使用仓库入口

```powershell
./local-server.ps1 -Action Start
```

该命令打开默认浏览器。若要使用宿主浏览器工具复用指定浏览器，传 `-NoBrowser`，再在其中打开 <http://127.0.0.1:5173>。其他平台在独立终端保持 `npm run dev` 运行，再用受支持的方式打开网页。

在当前聊天调用 `schematic_status({"target":"browser"})`。clients 为空时，帮助用户打开编辑器页面。连接多个页面时选定目标 `clientId`。再运行 `npm run check:setup -- --require-browser` 核对服务侧状态。

Minecraft 材质是可选项。用 `schematic_resources` 查实际版本与实例。非标准目录使用用户给定的路径，配置方式见 [Windows 说明](windows.zh-CN.md) 和 [编辑器指南](editor-guide.zh-CN.md)。加载与目标游戏版本对应的材质。

查到多个实例时，把名称和版本列成简短选项，请用户选择本次使用的实例。找不到目标实例时，询问“你使用哪个启动器？这次使用的实例叫什么，或实例文件夹在哪里？”。用户已给出路径或选择时直接使用。

说明路径可以从启动器的“打开游戏文件夹／实例文件夹”取得。原版材质需要包含 `versions` 的 Minecraft 根目录，模组扫描需要包含各实例子目录的父目录，每个实例内有 `mods`。用户提供单个实例路径时，检查它的 `mods` 和上级目录，推导配置后用资源列表核对。只有目录布局仍不清楚时再追问，避免让用户猜环境变量应填哪一级。

## 预览验证与交付

可以将 `public/samples/cottage.litematic` 打开为新文档，调用 `schematic_capture` 检查预览。保留原文档，只关闭此次打开的示例，再切回用户原标签。

用户希望看辰衡星塔时，打开 `examples/chenheng-tower.litematic`。大理石材质需要对应的星辉魔法 JAR。

部署完成后向用户发送

- 可点击的本地网页地址，以及网页是否已连接 MCP。
- 重启编辑器、打开已有投影的方式。
- 指定保存目录、文件格式及预览图的方式。
- [Skill 交付参考](../skills/minecraft-schematic-editor/references/first-build.md) 中的样例提示词，使用用户的语言。

宿主重连仍需要用户操作时，说明具体待完成的一步，并准确区分已验证的部分。连接可用后继续用户的建筑请求。
