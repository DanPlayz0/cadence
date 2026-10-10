import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error Local build plugin is implemented in JavaScript.
import { pwa } from "./pwa.mjs";
export default defineConfig({
  plugins: [react(), pwa()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/healthz": "http://127.0.0.1:8080",
    },
  },
});
