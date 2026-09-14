import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import ts from "typescript";

const ALLOWED_INTERNAL_INPUTS = new Set([
  "apps/abbott/src/app/api/dashboard/[id]/route.ts",
  "apps/abbott/src/lib/abbott-dashboard-loader.ts",
  "apps/abbott/src/lib/abbott-json-handler.ts",
  "apps/abbott/src/lib/abbott-route-access.ts",
  "packages/runtime-contract/src/index.ts",
  "packages/runtime-contract/src/manifest.mjs",
  "src/lib/abbott-bi.ts",
  "src/lib/abbott-content-lookup.ts",
  "src/lib/abbott-dashboard-loader.ts",
  "src/lib/abbott-data-projection.ts",
  "src/lib/abbott-date-range.ts",
  "src/lib/abbott-page-url.ts",
  "src/lib/abbott-private-store.ts",
  "src/lib/abbott-private-types.ts",
  "src/lib/abbott-return-frequency.ts",
  "src/lib/access-auth.ts",
  "src/lib/dashboard-access-policy.ts",
  "src/lib/dashboard-access.ts",
  "src/lib/dashboard-ai-summary.ts",
  "src/lib/dashboard-date-range.ts",
  "src/lib/dashboard-i18n.ts",
  "src/lib/dashboard-shared-access.ts",
  "src/lib/db.ts",
  "src/lib/schema-parser.ts",
  "src/lib/shared-password-policy.ts",
  "src/lib/source-mapping.ts",
]);

function assertLiteralDynamicImports(inputs: string[]) {
  for (const input of inputs) {
    if (!/\.[cm]?[jt]sx?$/.test(input)) continue;
    const source = ts.createSourceFile(
      input,
      readFileSync(input, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function inspect(node: ts.Node) {
      if (
        ts.isCallExpression(node)
        && (
          node.expression.kind === ts.SyntaxKind.ImportKeyword
          || (ts.isIdentifier(node.expression) && node.expression.text === "require")
        )
      ) {
        const specifier = node.arguments[0];
        assert.ok(
          specifier && ts.isStringLiteral(specifier),
          `dynamic dependency must be statically traceable in ${input}`,
        );
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
}

test("Abbott JSON route includes only recognized Abbott, access and static-config runtime modules", async () => {
  const result = await build({
    entryPoints: ["./apps/abbott/src/app/api/dashboard/[id]/route.ts"],
    bundle: true,
    write: false,
    metafile: true,
    packages: "external",
    platform: "node",
    format: "esm",
    logLevel: "silent",
    tsconfig: "apps/abbott/tsconfig.json",
    alias: {
      "@reportingdash/runtime-contract": path.resolve("packages/runtime-contract/src/index.ts"),
    },
  });
  const inputs = Object.keys(result.metafile!.inputs).sort();
  const trace = inputs.join("\n");
  assert.match(trace, /abbott-route-access\.ts/);
  assert.match(trace, /abbott-dashboard-loader\.ts/);
  assert.match(trace, /abbott-data-projection\.ts/);
  assert.match(trace, /packages\/runtime-contract\/src\/index\.ts/);
  assert.match(trace, /packages\/runtime-contract\/src\/manifest\.mjs/);
  assert.match(trace, /schema-parser\.ts/, "static Abbott schema configuration remains allowed");
  assert.doesNotMatch(trace, /dashboard-data-loader\.ts|zaruku|advertising-binding|google-ads|yandex-direct|metrika-client|bitrix.*client|manual-data-fetcher/);
  assert.doesNotMatch(trace, /^src\/app\/api\/dashboard\/\[id\]\//m);

  const unexpected = inputs.filter((input) => {
    const internal = input.startsWith("apps/") || input.startsWith("packages/") || input.startsWith("src/");
    return internal && !ALLOWED_INTERNAL_INPUTS.has(input);
  });
  assert.deepEqual(unexpected, [], `unrecognized internal imports:\n${unexpected.join("\n")}`);
  assertLiteralDynamicImports(inputs);

  const workspaceExternals = Object.values(result.metafile!.inputs)
    .flatMap((input) => input.imports)
    .filter((entry) => entry.external && (entry.path.startsWith("@reportingdash/") || entry.path.startsWith("@abbott/") || entry.path.startsWith("@runtime-contract")))
    .map((entry) => entry.path);
  assert.deepEqual([...new Set(workspaceExternals)], [], "internal workspace imports must resolve into the graph");
});

test("shared authorization context carries the dashboard type needed for fail-closed identity checks", () => {
  const source = readFileSync("src/lib/dashboard-access.ts", "utf8");
  assert.match(source, /dashboard_type/);
});
