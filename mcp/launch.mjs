import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
register();
const { createMcpServer } = await import("./server.ts");
await createMcpServer().connect(new StdioServerTransport());
