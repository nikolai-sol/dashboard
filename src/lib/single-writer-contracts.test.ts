import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = new URL("../..", import.meta.url).pathname;

test("deprecated Webmaster weekly contracts have no executable writer", () => {
  const runtimeFiles = [
    "scripts/collect-yandex-webmaster.js",
    "scripts/deploy.sh",
  ];
  const deprecatedContracts = [
    "seo_webmaster_queries_weekly",
    "seo_webmaster_pages_weekly",
  ];
  const offenders: string[] = [];

  for (const relativePath of runtimeFiles) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    for (const contract of deprecatedContracts) {
      if (source.includes(contract)) offenders.push(`${relativePath}: ${contract}`);
    }
  }

  assert.deepEqual(offenders, []);
});

test("supported Webmaster command routes only to the canonical collector", () => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

  assert.equal(
    packageJson.scripts["collect:yandex-webmaster"],
    "bash scripts/collect-yandex-webmaster-canonical.sh --run-type cron",
  );
});

test("deploy inventory packages only the active canonical GSC writer", () => {
  const deploy = readFileSync(join(repoRoot, "scripts/deploy.sh"), "utf8");

  assert.match(deploy, /copy_canonical_file fetch_gsc_canonical\.py/);
  assert.doesNotMatch(deploy, /copy_canonical_file fetch_google_search_console_canonical\.py/);
});
