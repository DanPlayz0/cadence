// SPDX-License-Identifier: GPL-2.0-or-later
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../web/package.json", import.meta.url));
const { parse } = require("yaml");
const spec = parse(fs.readFileSync("docs/openapi.yaml", "utf8"));
if (spec.openapi !== "3.0.3" || !spec.paths || !spec.components)
  throw new Error("Invalid OpenAPI document");
const routeSource = fs.readdirSync("internal/httpapi").filter(name => name.endsWith(".go") && !name.endsWith("_test.go")).map(name => fs.readFileSync(`internal/httpapi/${name}`, "utf8")).join("\n");
for (const match of routeSource.matchAll(
  /HandleFunc\("(GET|POST|PUT|PATCH|DELETE|HEAD) \/api\/v1([^" ]+)"/g,
)) {
  const [, method, path] = match;
  if (!spec.paths[path]?.[method.toLowerCase()])
    throw new Error(`Undocumented route: ${method} ${path}`);
}
for (const [path, methods] of Object.entries(spec.paths))
  for (const [method, operation] of Object.entries(methods)) {
    if (!operation.responses)
      throw new Error(`Missing responses: ${method} ${path}`);
    for (const [, name] of path.matchAll(/\{([^}]+)\}/g))
      if (
        !operation.parameters?.some(
          (p) => p.in === "path" && p.name === name && p.required,
        )
      )
        throw new Error(`Missing path parameter ${name}`);
  }
console.log(
  `OpenAPI valid: ${Object.keys(spec.paths).length} documented paths`,
);
