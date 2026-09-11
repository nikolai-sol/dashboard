import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE = path.join(ROOT, "config/sites/medroche.json");
const EXAMPLE = path.join(ROOT, "config/sites/fixtures/example-clinic.json");

test("preview validates MedRoche and reports its configured automated Yandex bindings without writes", async () => {
  const { previewCreate } = await import("./site-seo-create.mjs");
  const result = previewCreate(PROFILE, { registry: [] });
  assert.equal(result.profile.siteId, "site-medroche");
  assert.equal(result.bindings.yandex_metrika.status, "configured");
  assert.equal(result.bindings.yandex_metrika.counterId, "94927113");
  assert.equal(result.bindings.google_search_console.status, "unconfigured");
  assert.equal(result.bindings.google_search_console.domain, "med.roche.ru");
  assert.equal(result.bindings.yandex_webmaster.status, "configured");
  assert.equal(result.bindings.yandex_wordstat.status, "configured");
  assert.equal(result.bindings.yandex_webmaster_alice_manual.status, "missing");
  assert.equal(result.bindings.seo_os.status, "missing_inputs");
  assert.equal(result.registrationStatus, "proposed_local");
  assert.equal(result.proposedClientId, "client-roche");
  assert.equal(result.proposedSiteId, "site-medroche");
  assert.equal(result.proposedDashboardId, 41);
  assert.match(result.previewId, /^site-preview-/);
});

test("apply is idempotent and rejects a stale preview", async () => {
  const { previewCreate, applyCreate } = await import("./site-seo-create.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "site-seo-registry-"));
  try {
    const registry = path.join(directory, "registry.json");
    const preview = previewCreate(PROFILE, { registry: [] });
    const first = applyCreate(PROFILE, { registry, previewId: preview.previewId, preview });
    const second = applyCreate(PROFILE, { registry, previewId: preview.previewId, preview });
    assert.equal(first.releaseManifest.siteId, "site-medroche");
    assert.deepEqual({ ...second, idempotent: false }, first);
    assert.throws(() => applyCreate(EXAMPLE, { registry, previewId: preview.previewId, preview }), /stale|profile|preview/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("preview catches runtime collisions with the existing registry", async () => {
  const { previewCreate } = await import("./site-seo-create.mjs");
  assert.throws(() => previewCreate(PROFILE, {
    registry: [{ profile: { runtime: { port: 3003 } } }],
  }), /collision|port/i);
});
