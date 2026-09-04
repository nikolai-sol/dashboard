import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

for (const route of ["route.ts", "pdf/route.ts", "excel/route.ts"]) {
  test(`isolated ${route} dependency graph excludes combined, private, advertising, and source API modules`, async () => {
    const entry = `apps/zaruku/src/app/api/dashboard/zaruku/${route}`;
    const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, packages: "external", platform: "node", format: "esm", logLevel: "silent" });
    const trace = Object.keys(result.metafile!.inputs).sort().join("\n");
    assert.match(trace, /apps\/zaruku\/src\/lib\/zaruku-route-access\.ts/);
    if (route !== "pdf/route.ts") assert.match(trace, /apps\/zaruku\/src\/lib\/zaruku-dashboard-loader\.ts/);
    assert.doesNotMatch(trace, /abbott-(?:bi|private)|advertising-binding|canonical-adapter|gsheet-fetcher|leads-fetcher|manual-data-fetcher|schema-parser|dashboard-data-loader\.ts|compat\/api/);
    assert.doesNotMatch(trace, /src\/app\/api\/dashboard\/\[id\]/);
  });
}
