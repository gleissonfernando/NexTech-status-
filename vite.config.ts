import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_PLATFORM_PANEL_URL": JSON.stringify(
        env.VITE_PLATFORM_PANEL_URL ?? env.PLATFORM_PANEL_URL ?? "https://nextech.discloud.app"
      )
    },
    server: {
      port: 5173,
      proxy: {
        "/api": "http://localhost:8080",
        "/health": "http://localhost:8080"
      }
    },
    build: {
      outDir: "dist/client",
      emptyOutDir: true
    }
  };
});
