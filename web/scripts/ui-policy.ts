import ts from "typescript";
const forbidden = new Set([
  "button",
  "input",
  "select",
  "option",
  "textarea",
  "dialog",
  "details",
  "summary",
  "progress",
  "meter",
  "datalist",
]);
const specialized = new Set([
  "checkbox",
  "radio",
  "range",
  "date",
  "datetime-local",
  "time",
  "month",
  "week",
  "file",
  "color",
]);
export function uiPolicy(source: string, file = "component.tsx") {
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const problems: string[] = [],
    inputs = new Set(["Input"]);
  function visit(node: ts.Node) {
    if (
      ts.isImportSpecifier(node) &&
      (node.propertyName?.text || node.name.text) === "Input"
    )
      inputs.add(node.name.text);
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast);
      if (forbidden.has(tag))
        problems.push(`Use a shared component instead of <${tag}>.`);
      if (inputs.has(tag) || tag.endsWith(".Input")) {
        for (const attr of node.attributes.properties) {
          if (ts.isJsxAttribute(attr) && attr.name.getText(ast) === "list")
            problems.push(
              "Use a shared suggestion component instead of a native datalist.",
            );
          if (
            ts.isJsxAttribute(attr) &&
            attr.name.getText(ast) === "type" &&
            attr.initializer
          ) {
            const inspect = (part: ts.Node) => {
              if (ts.isStringLiteral(part) && specialized.has(part.text))
                problems.push(`Use a dedicated component for ${part.text}.`);
              ts.forEachChild(part, inspect);
            };
            inspect(attr.initializer);
          }
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const call = node.expression.getText(ast);
      if (/^(?:(?:window|globalThis)\.)?(?:alert|confirm|prompt)$/.test(call))
        problems.push("Use a shared dialog instead of browser prompts.");
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return problems;
}
