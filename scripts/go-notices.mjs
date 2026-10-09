// SPDX-License-Identifier: GPL-2.0-or-later
// Run with Go and Node installed: node scripts/go-notices.mjs > GO_DEPENDENCY_NOTICES.txt
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const modules = execFileSync(
  "go",
  ["list", "-m", "-f", "{{.Path}}|{{.Version}}|{{.Dir}}", "all"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n");
for (const line of modules) {
  const [name, version, dir] = line.trim().split("|");
  if (!version || !dir) continue;
  const licenses = fs
    .readdirSync(dir)
    .filter((n) => /^(licen[sc]e|copying|notice)(\.|$)/i.test(n));
  process.stdout.write(
    `${name}@${version}\n${licenses.map((n) => fs.readFileSync(path.join(dir, n), "utf8")).join("\n")}\n---\n`,
  );
}
