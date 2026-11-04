import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { minecraftAssets } from "./scripts/minecraft-assets-plugin";
import { mcpBridge } from "./scripts/mcp-bridge-plugin";

export default defineConfig({
  plugins: [react(), minecraftAssets(), mcpBridge()],
  // GitHub Pages serves a project site from /<repo>/, not from the root, so
  // every asset URL needs that prefix baked in. The deploy workflow passes the
  // repository's own name, which keeps working if the repo is ever renamed.
  base: process.env.BASE_PATH ?? "/",
  server: {
    host: "127.0.0.1", port: 5173, strictPort: true,
    fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/run.local/**"] },
  },
  build: { target: "es2022" },
});
