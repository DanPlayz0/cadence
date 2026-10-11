// @vitest-environment jsdom
import { expect, it } from "vitest";
import { copyPlayerStyles } from "./playerStyles";
it("copies loaded theme rules into a popup document", () => {
  const target = document.implementation.createHTMLDocument();
  const style = document.createElement("style");
  style.textContent = ".ui-slider-thumb { width: 16px; height: 16px; }";
  // JSDOM only creates stylesheets on the active document.
  document.head.appendChild(style);
  copyPlayerStyles(document, target);
  expect(target.head.textContent).toContain(".ui-slider-thumb");
  style.remove();
});
