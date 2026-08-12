import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { minecraftAssets } from "./scripts/minecraft-assets-plugin";

export default defineConfig({
  plugins: [react(), minecraftAssets()],
  // GitHub Pages serves a project site from /<repo>/, not from the root, so
  // every asset URL needs that prefix baked in. The deploy workflow passes the
  // repository's own name, which keeps working if the repo is ever renamed.
  base: process.env.BASE_PATH ?? "/",
  server: { port: 5173 },
  build: { target: "es2022" },
});
