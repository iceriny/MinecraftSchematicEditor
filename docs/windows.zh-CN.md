# Windows 本地启停

[English](windows.md) | 简体中文

安装 Node.js 20.19+ 或 22.12+，在仓库目录执行一次 `npm ci`。双击入口优先使用 PATH 中的 PowerShell 7，否则使用 Windows PowerShell 5.1。

- 在仓库根目录双击 `start-editor.cmd`，后台启动服务并打开 <http://127.0.0.1:5173>。
- 双击 `stop-editor.cmd` 结束本仓库的后台服务。
- 关闭网页后服务继续运行，重启电脑后需再次启动。

命令行也可以使用

```powershell
./local-server.ps1 -Action Start -NoBrowser
./local-server.ps1 -Action Status
./local-server.ps1 -Action Stop
```

脚本从自身位置定位仓库。重复启动会复用已有服务，端口 5173 被其他程序占用时会报错。日志保存在 `run.local/server.log` 与 `run.local/server-error.log`。

## Minecraft 路径

默认由编辑器查找标准启动器目录。自定义安装目录可通过环境变量 `MINECRAFT_DIR` 和 `MINECRAFT_INSTANCES` 指定，或在仓库根目录创建 `local-server.local.json`。

```json
{
  "minecraftDir": "D:/Minecraft/.minecraft",
  "minecraftInstances": "D:/Minecraft/.minecraft/versions"
}
```

`minecraftDir` 下应包含 `versions/<版本>/<版本>.jar`。`minecraftInstances` 下应是各实例目录，每个实例下有 `mods`、`.minecraft/mods` 或 `minecraft/mods`。两项可独立设置。

也可在启动时传 `-MinecraftDir` 和 `-MinecraftInstances`。优先级依次为命令行参数、环境变量、本机 JSON 设置、编辑器默认查找。更换路径后重新启动后台服务即可生效。

## 文件与缓存

`local-server.local.json`、`run.local/`、依赖目录、构建产物和日志由 Git 忽略。浏览器中的材质缓存和自动暂存保存在浏览器数据中。

工具操作与文件格式见 [README](../README.zh-CN.md)。AI 编辑及预览接入见 [MCP 使用说明](../mcp/README.zh-CN.md)。
