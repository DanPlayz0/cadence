// SPDX-License-Identifier: GPL-2.0-or-later
// Run after npm ci: node scripts/notices.mjs > web/DEPENDENCY_NOTICES.txt
import fs from "node:fs";
import path from "node:path";
const root = path.resolve("web/node_modules");
const packages = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.name.startsWith("@")) {
      walk(p);
      continue;
    }
    const manifest = path.join(p, "package.json");
    if (!fs.existsSync(manifest)) continue;
    const j = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const licenses = fs
      .readdirSync(p)
      .filter((n) => /^(licen[sc]e|copying|notice)(\.|$)/i.test(n));
    packages.push(
      `${j.name}@${j.version}\nLicense: ${j.license ?? "See upstream"}\n${licenses.map((n) => fs.readFileSync(path.join(p, n), "utf8")).join("\n")}\n`,
    );
    if (fs.existsSync(path.join(p, "node_modules")))
      walk(path.join(p, "node_modules"));
  }
}
walk(root);
process.stdout.write(packages.sort().join("\n---\n"));
