import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { loadAbbottDashboardData } from "./abbott-dashboard-loader";
import { loadAbbottDashboardData as focusedLoader } from "../../../../src/lib/abbott-dashboard-loader";

test("Abbott app re-exports the focused entry", () => {
  assert.strictEqual(loadAbbottDashboardData, focusedLoader);
});

test("Abbott runtime import graph excludes generic loaders, source clients and manual fact readers", () => {
  const root = process.cwd();
  const visited = new Set<string>();
  function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    assert.doesNotMatch(file, /(?:dashboard-data-loader|zaruku-seo|canonical-adapter|advertising-binding-read-model|gsheet-fetcher|manual-data-fetcher|leads-fetcher|media-plan-store|abbott-workbook-catalog)\.[cm]?tsx?$/);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function follow(specifier: string) {
      let target: string;
      if (specifier.startsWith("@/")) target = path.join(root, "src", specifier.slice(2));
      else if (specifier.startsWith(".")) target = path.resolve(path.dirname(file), specifier);
      else if (specifier === "@reportingdash/runtime-contract") target = path.join(root, "packages/runtime-contract/src/index.ts");
      else return;
      visit(path.extname(target) ? target : `${target}.ts`);
    }
    function inspect(node: ts.Node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return;
        if (ts.isExportDeclaration(node) && node.isTypeOnly) return;
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) follow(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        const specifier = node.arguments[0];
        assert.ok(specifier && ts.isStringLiteral(specifier), `dependency must be statically traceable in ${file}`);
        follow(specifier.text);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
  visit(path.join(root, "apps/abbott/src/lib/abbott-dashboard-loader.ts"));
  assert.ok(visited.has(path.join(root, "src/lib/abbott-bi.ts")));
  assert.ok(visited.has(path.join(root, "src/lib/schema-parser.ts")), "static source configuration remains in the graph for schema override parity");
});
