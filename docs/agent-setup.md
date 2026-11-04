# Agent deployment guide

English | [简体中文](agent-setup.zh-CN.md)

Use this when the user asks you to install or configure this project. Complete the supported setup steps autonomously within the user's request. Use the host's actual installation and browser capabilities.

## Locate the checkout and dependencies

1. Reuse an existing checkout, or clone `https://github.com/iceriny/MinecraftSchematicEditor.git` into a suitable user workspace.
2. Check Node and npm. Supported Node versions are 20.19+ or 22.12+. If missing, use the environment's supported installation flow.
3. Run `npm ci` in the checkout, then `npm run check:setup`. This starts a temporary read-only MCP client and verifies the tool schemas. Browser availability may be false at this stage.

## Connect MCP and the skill

Configure a stdio server named `minecraft-schematic-editor` with the actual Node executable and the absolute path to `mcp/launch.mjs`. The launcher finds its checkout automatically.

For Codex, inspect the existing entry first

```sh
codex mcp get minecraft-schematic-editor --json
```

Register a missing connection or update this same entry to the desired checkout

```sh
codex mcp add minecraft-schematic-editor -- node /absolute/path/to/MinecraftSchematicEditor/mcp/launch.mjs
```

Use native path quoting for the current shell. Preserve tool permission settings on an existing entry. Keep one stable server name so tool permission tables refer to an actual server.

If the host installs the repository as a plugin, it can discover root `plugin.json`, `mcp.json`, and `skills/`. Otherwise, copy the entire `skills/minecraft-schematic-editor` directory into the host's supported skill location. For Codex, use `$CODEX_HOME/skills` or `~/.codex/skills` when CODEX_HOME is unset. Preserve an existing customized skill and report any material conflict.

Load [the skill](../skills/minecraft-schematic-editor/SKILL.md). Reconnect through the host's supported mechanism if necessary. Confirm this chat exposes `schematic_capture.box`, `schematic_edit.origin`, and `schematic_inspect.mode`. A new SDK client passing self-check does not prove the chat's old tool list has refreshed.

## Start the webpage

On Windows, use the repository launcher

```powershell
./local-server.ps1 -Action Start
```

It opens the default browser. To reuse a particular browser through the host's browser tools, pass `-NoBrowser` and open <http://127.0.0.1:5173> there. On other platforms, keep `npm run dev` running in a separate terminal and open that address using the supported browser capability.

Call `schematic_status({"target":"browser"})` in this chat. If clients are empty, help the user open the editor page. Multiple pages require choosing the intended `clientId`. Run `npm run check:setup -- --require-browser` to check the service-side connection as well.

Minecraft assets are optional. Use `schematic_resources` to discover actual versions and instances. For nonstandard installations, configure the user's supplied directories using the [Windows settings](windows.md) or environment variables described in the [editor guide](editor-guide.md). Load resources matching the intended game version.

## Verify the workflow and hand off

For a harmless preview check, open `public/samples/cottage.litematic` in a new browser document and call `schematic_capture`. Preserve existing user documents. Close only the sample document you opened, returning to the user's prior tab.

When the user wants the tower example, open `examples/chenheng-tower.litematic`. Its marble textures need the matching Astral Sorcery JAR.

After setup, send the user

- The clickable local webpage address, and whether it has connected to MCP.
- How to restart the editor and continue with a saved schematic.
- How to ask for an output directory and file format, with previews if wanted.
- The example building prompt from [the skill's handoff reference](../skills/minecraft-schematic-editor/references/first-build.md), in the user's language.

If host-side reconnection still needs user action, explain that specific remaining step. Report only the part actually verified. Then resume the user's building request when the connection is available.
