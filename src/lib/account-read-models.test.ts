import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import {
  loadAccountFacts,
  loadSeoIntelligence,
  loadSeoProcess,
} from "@/lib/account-read-models";

const repoRoot = new URL("../..", import.meta.url).pathname;
const runtimeRoots = ["src/lib", "src/components", "src/app"].map((path) => join(repoRoot, path));
const allowedKillListReferences = new Set([
  "src/lib/account-read-models.test.ts",
]);

function collectRuntimeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) return collectRuntimeFiles(path);
    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) return [];
    return [path];
  });
}

test("account read model exports use neutral names without client names", () => {
  assert.equal(typeof loadAccountFacts, "function");
  assert.equal(typeof loadSeoProcess, "function");
  assert.equal(typeof loadSeoIntelligence, "function");

  for (const exportedName of ["loadAccountFacts", "loadSeoProcess", "loadSeoIntelligence"]) {
    assert.doesNotMatch(exportedName, /zaruku/i);
  }
});

test("account read model functions require an accountId argument", () => {
  assert.equal(loadAccountFacts.length, 2);
  assert.equal(loadSeoProcess.length, 1);
  assert.equal(loadSeoIntelligence.length, 1);
});

test("account read model implementation does not depend on client-named loader imports", () => {
  const source = readFileSync(join(repoRoot, "src/lib/account-read-models.ts"), "utf8");

  assert.doesNotMatch(source, /loadZaruku/);
});

test("runtime read layer does not reference dead weekly AI or deprecated Webmaster contracts", () => {
  const killList = [
    "zaruku-ai-visibility",
    "seo_ai_visibility_weekly",
    "seo_webmaster_queries_weekly",
  ];
  const offenders: string[] = [];

  for (const file of runtimeRoots.flatMap(collectRuntimeFiles)) {
    const relativePath = relative(repoRoot, file);
    if (allowedKillListReferences.has(relativePath)) continue;
    const text = readFileSync(file, "utf8");
    for (const deadName of killList) {
      if (text.includes(deadName)) offenders.push(`${relativePath}: ${deadName}`);
    }
  }

  assert.deepEqual(offenders, []);
});
