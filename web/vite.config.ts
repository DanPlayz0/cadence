import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import packageInfo from "./package.json" with { type: "json" };
// @ts-expect-error Local build plugin is implemented in JavaScript.
import { pwa } from "./pwa.mjs";
export default defineConfig({
  define: { __CLIENT_VERSION__: JSON.stringify(packageInfo.version) },
  plugins: [react(), pwa()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:6450",
      "/healthz": "http://127.0.0.1:6450",
    },
  },
});
