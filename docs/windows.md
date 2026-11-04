# Windows background launchers

English | [简体中文](windows.zh-CN.md)

Install Node.js 20.19+ or 22.12+ and run `npm ci` in the repository. The launchers use PowerShell 7 from PATH when available, otherwise Windows PowerShell 5.1.

- Double-click `start-editor.cmd` in the repository root to start the background service and open <http://127.0.0.1:5173>.
- Double-click `stop-editor.cmd` to stop this checkout's service.
- Closing the webpage leaves the service running. Start it again after restarting your computer.

Command-line usage

```powershell
./local-server.ps1 -Action Start -NoBrowser
./local-server.ps1 -Action Status
./local-server.ps1 -Action Stop
```

The script locates the checkout relative to itself. Repeated starts reuse the running service. Another application occupying port 5173 produces an error. Logs are written to `run.local/server.log` and `run.local/server-error.log`.

## Minecraft paths

Standard launcher directories are discovered automatically. For custom installations, set `MINECRAFT_DIR` and `MINECRAFT_INSTANCES`, or create `local-server.local.json` in the repository root.

```json
{
  "minecraftDir": "D:/Minecraft/.minecraft",
  "minecraftInstances": "D:/Minecraft/.minecraft/versions"
}
```

`minecraftDir` contains `versions/<version>/<version>.jar`. `minecraftInstances` contains instance directories with a `mods`, `.minecraft/mods`, or `minecraft/mods` subdirectory. Set either field independently.

Startup parameters `-MinecraftDir` and `-MinecraftInstances` take precedence over environment variables, then local JSON settings, then default discovery. Restart the service after changing these paths.

## Files and caches

Git ignores `local-server.local.json`, `run.local/`, dependencies, build output, and logs. Browser textures and autosave live in the browser's own storage.

See the [product README](../README.md) for the workflow and the [MCP guide](../mcp/README.md) for agent connections.
