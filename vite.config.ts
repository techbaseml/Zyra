import { defineConfig } from "vite";
import { existsSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { sites } from "./scripts/vite/sites-vite-plugin";
import { configureToolEnvironment } from "./scripts/tool-environment.mjs";
export default defineConfig(async () => {
  configureToolEnvironment(process.cwd());
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    plugins: [
      react(),
      ...(existsSync(".openai/hosting.json") ? [sites({ mockAuth: false })] : []),
      cloudflare({ viteEnvironment: { name: "server" }, inspectorPort: false }),
    ],
    server: { host: "0.0.0.0", allowedHosts: ["terminal.local"] },
    build: { chunkSizeWarningLimit: 700 },
  };
});
