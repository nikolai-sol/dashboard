import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("isolated layout and global styles are unchanged from the production baseline", () => {
  for (const file of ["layout.tsx", "globals.css"]) {
    const baseline = execFileSync("git", ["show", `8f389a28df1c4b741ec33b7538f0354b74f5a40e:src/app/${file}`], { encoding: "utf8" });
    assert.equal(readFileSync(new URL(`./${file}`, import.meta.url), "utf8"), baseline);
  }
});

test("dynamic route validates identity before rendering and retains the requested Abbott alias", () => {
  const source = readFileSync(new URL("./dashboard/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(source, /normalizeAbbottIdentifier\(id\)/);
  assert.match(source, /if \(!normalizeAbbottIdentifier\(id\)\) notFound\(\)/);
  assert.match(source, /dashboardId=\{dashboardId\}/);
  assert.doesNotMatch(source, /@\/app\/dashboard/);
});
