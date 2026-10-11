// SPDX-License-Identifier: GPL-2.0-or-later
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
export function pwa() {
  return {
    name: "cadence-pwa",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = [
        "/offline.html",
        "/manifest.webmanifest",
        "/icons/icon-192.png",
        "/icons/icon-512.png",
        "/icons/apple-touch-icon.png",
      ];
      const hash = createHash("sha256");
      for (const [name, entry] of Object.entries(bundle).sort()) {
        if (
          name.startsWith("assets/") &&
          !name.startsWith("assets/playlist-icon-")
        )
          files.push(`/${name}`);
        hash
          .update(name)
          .update(entry.type === "chunk" ? entry.code : entry.source);
      }
      for (const file of files.filter((file) => !file.startsWith("/assets/")))
        hash.update(readFileSync(new URL(`./public${file}`, import.meta.url)));
      const template = readFileSync(
        new URL("./service-worker.js", import.meta.url),
        "utf8",
      );
      hash.update(template);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: template
          .replace(
            "__CACHE_NAME__",
            JSON.stringify(`cadence-static-${hash.digest("hex").slice(0, 16)}`),
          )
          .replace("__PRECACHE__", JSON.stringify(files)),
      });
    },
  };
}
