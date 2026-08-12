import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { minecraftAssets } from "./scripts/minecraft-assets-plugin";

export default defineConfig({
  plugins: [react(), minecraftAssets()],
  server: { port: 5173 },
  build: { target: "es2022" },
});
