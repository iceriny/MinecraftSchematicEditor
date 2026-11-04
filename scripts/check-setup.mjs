import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const [major, minor] = process.versions.node.split(".").map(Number);
if (!(major === 20 && minor >= 19 || major === 22 && minor >= 12 || major > 22)) {
  console.error("Use Node.js 20.19+ or 22.12+.");
  process.exit(1);
}
try {
  require.resolve("@modelcontextprotocol/sdk/client/index.js");
  require.resolve("tsx/esm/api");
} catch {
  console.error("Dependencies are missing. Run npm ci from the repository root.");
  process.exit(1);
}

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
const client = new Client({ name: "schematic-setup-check", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../mcp/launch.mjs", import.meta.url))],
  stderr: "inherit",
});
const timeout = setTimeout(() => {
  console.error("MCP startup check timed out.");
  void client.close().finally(() => process.exit(1));
}, 15000);
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const capture = tools.find(tool => tool.name === "schematic_capture");
  const edit = tools.find(tool => tool.name === "schematic_edit");
  if (!capture?.inputSchema.properties?.box || !edit?.inputSchema.properties?.origin) {
    throw new Error("Expected cutaway and local-origin tool schemas are missing.");
  }
  const result = await client.callTool({ name: "schematic_status", arguments: {} });
  if (result.isError) throw new Error(result.content.find(item => item.type === "text")?.text ?? "Status failed.");
  const status = result.structuredContent;
  const browser = status?.browser ?? {};
  const connectedPages = Array.isArray(browser.clients) ? browser.clients.length : 0;
  console.log(JSON.stringify({
    node: process.versions.node,
    server: "minecraft-schematic-editor",
    tools: tools.length,
    cutaway: true,
    localOrigin: true,
    browserAvailable: browser.available === true,
    connectedPages,
    ...(browser.error ? { browserError: browser.error } : {}),
  }, null, 2));
  if (process.argv.includes("--require-browser") && (!browser.available || !connectedPages)) {
    throw new Error("Start npm run dev and open http://127.0.0.1:5173, then repeat the browser check.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  await client.close();
}
