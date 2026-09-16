import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { classifyTargetIntentQuery } from "../../apps/site-seo/src/lib/target-intent.ts";
import {
  buildMedRocheTargetIntentPreview,
  parseTargetIntentImportArgs,
  runTargetIntentImportCli,
} from "./import-target-intent.ts";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const seedPath = fixture("medroche-intent-expert-seed.json");
const extensionsPath = fixture("medroche-intent-reviewed-extensions.json");
const corpusPath = fixture("medroche-intent-regression-corpus.json");
const profilePath = fileURLToPath(new URL("../../config/sites/medroche.json", import.meta.url));
const json = (filename: string) => JSON.parse(readFileSync(filename, "utf8"));

test("MedRoche preview preserves 802 expert rows, reviewed extensions and immutable provenance", () => {
  const preview = buildMedRocheTargetIntentPreview({
    profile: json(profilePath),
    seed: json(seedPath),
    extensions: json(extensionsPath),
  });

  assert.equal(preview.previewOnly, true);
  assert.equal(preview.scope.siteId, "site-medroche");
  assert.equal(preview.scope.dashboardId, 41);
  assert.equal(preview.label, "Мед. интент");
  assert.equal(preview.provenance.historicalExpertRowCount, 802);
  assert.equal(preview.provenance.historicalExpertGroupCount, 89);
  assert.equal(preview.provenance.historicalWorkbookSha256, "d117d44f24bcee104341096b5e8363ff1cb0fceee150f0af0061264d5867ce54");
  assert.ok(preview.ruleCount > 802);
  assert.equal(preview.rules.length, preview.ruleCount);
  assert.match(preview.rulesSha256, /^[a-f0-9]{64}$/);
  assert.ok(preview.rules.some((rule) => rule.matchType === "exact"));
  assert.ok(preview.rules.some((rule) => rule.matchType === "phrase"));
  assert.deepEqual(buildMedRocheTargetIntentPreview({ profile: json(profilePath), seed: json(seedPath), extensions: json(extensionsPath) }), preview);
});

test("canonical preview matches the accepted MedRoche classifier corpus before legacy removal", () => {
  const seed = json(seedPath);
  const preview = buildMedRocheTargetIntentPreview({ profile: json(profilePath), seed, extensions: json(extensionsPath) });
  for (const row of seed.queries) {
    assert.equal(classifyTargetIntentQuery(row.query, preview.rules).category, "target", row.query);
    assert.equal(classifyTargetIntentQuery(`что такое ${row.query}`, preview.rules).category, "target", `что такое ${row.query}`);
  }
  for (const entry of json(corpusPath).queries) {
    assert.equal(classifyTargetIntentQuery(entry.query, preview.rules).category, entry.expected, entry.query);
  }
});

test("CLI is preview-only and apply requires a separate explicit intent manifest", async () => {
  const base = ["--profile", profilePath, "--seed", seedPath, "--extensions", extensionsPath];
  assert.throws(() => parseTargetIntentImportArgs([...base, "--apply"]), /intent-manifest/);
  assert.equal(parseTargetIntentImportArgs([...base, "--preview"]).action, "preview");
  assert.equal(parseTargetIntentImportArgs([...base, "--apply", "--intent-manifest", "/tmp/owner-intent.json"]).action, "apply");

  let output = "";
  const result = await runTargetIntentImportCli([...base, "--preview"], {
    readJson: async (filename) => json(filename),
    write: (value) => { output += value; },
  });
  assert.equal(result.status, "preview");
  assert.match(output, /"previewOnly":true/);
  assert.match(output, /"rulesSha256":"[a-f0-9]{64}"/);
  await assert.rejects(runTargetIntentImportCli([...base, "--apply", "--intent-manifest", "/tmp/owner-intent.json"], {
    readJson: async (filename) => filename.endsWith("owner-intent.json") ? { kind: "initial" } : json(filename),
    write: () => undefined,
  }), /outside this preview-only command/);
});
