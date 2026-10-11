import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { uiPolicy } from "./scripts/ui-policy";
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : [join(dir, entry.name)],
  );
}
it("all feature UI uses shared controls", () => {
  const violations = files("src")
    .filter(
      (file) =>
        file.endsWith(".tsx") &&
        !file.replaceAll("\\", "/").includes("/ui/") &&
        !file.endsWith(".test.tsx"),
    )
    .flatMap((file) =>
      uiPolicy(readFileSync(file, "utf8"), file).map(
        (problem) => `${file}: ${problem}`,
      ),
    );
  expect(violations).toEqual([]);
});
it("rejects native controls, browser prompts, and specialized aliased Inputs", () => {
  expect(
    uiPolicy(
      'import { Input as Field } from "./input"; const view = <><button/><Field type="date"/><Input type={flag ? "radio" : "text"}/></>; window.confirm("delete");',
    ),
  ).toHaveLength(4);
  expect(
    uiPolicy(
      'const view = <><Button/><Input type="password"/><Slider/><Select/></>;',
    ),
  ).toEqual([]);
  expect(
    uiPolicy(
      'const view = <><UI.Input type="range"/><Input list="folders"/></>;',
    ),
  ).toHaveLength(2);
});
