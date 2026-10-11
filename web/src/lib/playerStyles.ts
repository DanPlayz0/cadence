// SPDX-License-Identifier: GPL-2.0-or-later
// Copy loaded rules synchronously so a blank popup has the theme on first render.
// Recreate cross-origin links when browsers prohibit reading their CSSOM.
export function copyPlayerStyles(source: Document, target: Document) {
  for (const sheet of Array.from(source.styleSheets)) {
    if (sheet.disabled) continue;
    try {
      const style = target.createElement("style");
      style.textContent = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
      style.media = sheet.media?.mediaText || "";
      target.head.appendChild(style);
    } catch {
      if (!sheet.href) continue;
      const link = target.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      link.media = sheet.media?.mediaText || "";
      target.head.appendChild(link);
    }
  }
}
