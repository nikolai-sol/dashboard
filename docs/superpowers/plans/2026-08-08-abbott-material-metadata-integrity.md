# Abbott Material Metadata Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore reliable Abbott article titles and material metadata, make unmapped coverage visible, and prevent an accepted release from changing or publishing an empty workbook source.

**Architecture:** Keep the dashboard DB-native and canonical-first. Enrich Metrika page facts only from the active release's approved catalog projections, treating invalid raw titles as missing and using catalog titles as a display fallback. Harden the Python release gate and MySQL schema so source receipts, snapshot manifests, and active release pointers remain consistent; expose violations through the existing health payload.

**Tech Stack:** Next.js 16, React, TypeScript, Node test runner, Python 3 unittest, MySQL 8, canonical Abbott runtime.

## Global Constraints

- Work only in branch `codex/abbott-material-metadata-fix` and its isolated worktree.
- Do not modify Zaruku, Gidrofuril, Direct, Bitrix connectors, source OAuth handling, cron collection time, or unrelated dashboards.
- Dashboard reads remain canonical MySQL-only; no source API call is allowed from request/render/filter/export code.
- Raw User ID, raw client ID, visit identifiers, tokens, passwords, and private URLs must never be logged or added to fixtures.
- Active releases remain append-only; repair production data through a reviewed successor release, never by rewriting release 12.
- Every production behavior change follows test-first RED → GREEN and is committed separately.

---

### Task 1: Catalog title fallback and deterministic metadata resolution

**Files:**
- Modify: `src/lib/abbott-private-types.ts`
- Modify: `src/lib/abbott-private-store.ts`
- Modify: `src/lib/abbott-private-store.test.ts`
- Modify: `src/lib/abbott-bi.ts`
- Modify: `src/lib/abbott-bi-loader.test.ts`

**Interfaces:**
- `AbbottContentMetadata` gains `page_title: string | null`.
- Catalog projection SQL selects `catalog.page_title` and `contentMetadata()` preserves it.
- Raw Metrika titles that are `null`, empty, whitespace-only, or case-insensitive literal `"null"` are missing.
- Resolution order is: valid raw title projection first; otherwise normalized path; otherwise slug.
- Display title is the valid raw title, else resolved catalog title, else an empty string.

- [ ] **Step 1: Write failing private-store tests**

Extend the resolved-projection fixture with `page_title: "Shared"` and assert title, slug, and path maps each retain:

```ts
{
  page_title: "Shared",
  direction: "Cardiology",
  material_type: "article",
  access: "Врачи",
  is_active: true,
}
```

Also assert projection SQL selects `catalog.page_title` without adding raw-value predicates.

- [ ] **Step 2: Run the private-store test and verify RED**

Run: `node --import tsx --test src/lib/abbott-private-store.test.ts`

Expected: FAIL because metadata lacks `page_title` and SQL does not select it.

- [ ] **Step 3: Implement catalog title transport**

Add the nullable field to the interface, select it from the approved catalog row, and map it in `contentMetadata()`. Do not query canonical page facts from the private store.

- [ ] **Step 4: Run the private-store test and verify GREEN**

Run: `node --import tsx --test src/lib/abbott-private-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing loader tests**

Add loader tests that prove:

```ts
// invalid Metrika title uses path metadata and catalog title
page_title: " NuLl "  // result page_title === "Catalog title"

// valid Metrika title remains authoritative
page_title: "Raw Metrika title" // result keeps this title

// when raw title is missing, exact path wins over a conflicting slug
```

All tests must verify direction, material type, access, inactive-page behavior, and stable pageview/user totals.

- [ ] **Step 6: Run the loader test and verify RED**

Run: `node --import tsx --test src/lib/abbott-bi-loader.test.ts`

Expected: FAIL because literal `"null"` is displayed and slug currently precedes path.

- [ ] **Step 7: Implement minimal resolver change**

Normalize only the raw display title. Preserve exact valid raw titles. Use a normalized path lookup before slug only when no resolved valid-title projection exists, then set the output title to `rawTitle ?? metadata?.page_title ?? ""`.

- [ ] **Step 8: Run focused and full tests**

Run:

```bash
node --import tsx --test src/lib/abbott-private-store.test.ts src/lib/abbott-bi-loader.test.ts
npm test
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/abbott-private-types.ts src/lib/abbott-private-store.ts src/lib/abbott-private-store.test.ts src/lib/abbott-bi.ts src/lib/abbott-bi-loader.test.ts
git commit -m "fix: restore Abbott catalog page titles"
```

---

### Task 2: Make unmapped Abbott metadata visible and filterable

**Files:**
- Modify: `src/components/abbott-page-stats.ts`
- Modify: `src/components/abbott-page-stats.test.ts`
- Modify: `src/components/AbbottBiDashboard.tsx`
- Modify: `src/components/AbbottBiDashboard.ui.test.ts`

**Interfaces:**
- Export `ABBOTT_UNMAPPED_LABEL = "Не определено"`.
- Export a page-dimension label helper that converts null/blank to that label.
- Page material, direction, and access filters include and match `Не определено`.
- Page charts keep an explicit unmapped group; non-page charts keep their existing behavior.
- Export `summarizeAbbottPageMetadataCoverage(rows)` returning row and pageview totals for mapped material types.

- [ ] **Step 1: Write failing page-stat helper tests**

Add tests for:

```ts
matchesSelectedMaterialType(null, ["Не определено"]) === true
```

and for chart grouping/coverage so null and blank values aggregate under one `Не определено` row instead of disappearing.

- [ ] **Step 2: Run helper tests and verify RED**

Run: `node --import tsx --test src/components/abbott-page-stats.test.ts`

Expected: FAIL because unnamed values are removed or unmatched.

- [ ] **Step 3: Implement pure helpers**

Implement the shared label, filter normalization, page-only grouping, option generation, and coverage summary without changing canonical API null values.

- [ ] **Step 4: Run helper tests and verify GREEN**

Run: `node --import tsx --test src/components/abbott-page-stats.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing UI contract tests**

Assert the page table displays `Не определено` for null direction/material/access, page charts use page-dimension grouping rather than `excludeUnnamedChartGroups`, and the page section renders:

```text
Справочник: тип определён для X из Y страниц; просмотры — A из B.
```

- [ ] **Step 6: Run UI tests and verify RED**

Run: `node --import tsx --test src/components/AbbottBiDashboard.ui.test.ts`

Expected: FAIL because the current table shows an em dash and chart inputs discard unnamed groups.

- [ ] **Step 7: Wire helpers into Abbott page statistics only**

Update options, filters, three metadata charts, table labels, export labels, and the filtered-period coverage note. Leave Bitrix and every non-Abbott dashboard unchanged.

- [ ] **Step 8: Run focused and full verification**

Run:

```bash
node --import tsx --test src/components/abbott-page-stats.test.ts src/components/AbbottBiDashboard.ui.test.ts
npm test
npm run lint
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/abbott-page-stats.ts src/components/abbott-page-stats.test.ts src/components/AbbottBiDashboard.tsx src/components/AbbottBiDashboard.ui.test.ts
git commit -m "fix: expose unmapped Abbott page metadata"
```

---

### Task 3: Release source integrity, health alert, and schedule alignment

**Files:**
- Create: `src/db/migrations/046_abbott_release_source_integrity.sql`
- Create: `src/db/abbott-release-source-integrity-migration.test.ts`
- Modify: `reportingdash-canonical-bootstrap/lib/canonical_release_store.py`
- Modify: `reportingdash-canonical-bootstrap/runtime/canonical_release_store.py`
- Modify: `reportingdash-canonical-bootstrap/runtime/abbott_health_probe.py`
- Create: `reportingdash-canonical-bootstrap/tests/test_canonical_release_store.py`
- Create: `reportingdash-canonical-bootstrap/tests/test_abbott_health_probe.py`
- Modify: `package.json`
- Modify: `reportingdash-canonical-bootstrap/MIGRATION-MANIFEST.md`

**Interfaces:**
- MySQL blocks `source_snapshot_ids` changes once a release leaves `staging`.
- MySQL blocks insert/update/delete of release import receipts unless the parent release is `staging`.
- Workbook JSON validation requires positive integer `direction_count`, `event_catalog_count`, and `general_material_count`, with `imported_row_count` equal to their sum.
- Activation rechecks exact source snapshot IDs against successful import receipts under the activation transaction.
- Health payload adds `release_source_integrity`; a pointer/receipt mismatch is `CRITICAL`.
- Default Moscow expected completion hour changes from `9` to `7`, matching the 04:22 UTC collector.

- [ ] **Step 1: Write failing Python release-gate tests**

Unit-test `_validate_imported_sources()` with a valid workbook manifest and these rejected cases: missing semantic counts, zero count, count sum mismatch, and pointer/receipt ID mismatch. Test the activation helper against exact matching and mismatching source sets.

- [ ] **Step 2: Run Python tests and verify RED**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest reportingdash-canonical-bootstrap/tests/test_canonical_release_store.py`

Expected: FAIL because semantic workbook checks and activation re-attestation do not exist.

- [ ] **Step 3: Implement and synchronize the release gate**

Add pure validation helpers, call them from validation and activation, and keep `lib/canonical_release_store.py` byte-identical to `runtime/canonical_release_store.py`.

- [ ] **Step 4: Write failing health tests**

Test that receipt IDs `[25,26]` versus active IDs `[25,22]` emits exactly one `release_source_integrity` incident and that a run finished at 04:23 UTC is fresh after the 07:00 Moscow completion boundary.

- [ ] **Step 5: Run health tests and verify RED**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest reportingdash-canonical-bootstrap/tests/test_abbott_health_probe.py`

Expected: FAIL because the health probe lacks the source check and still expects 09:00 Moscow.

- [ ] **Step 6: Implement health source attestation and schedule correction**

Add an aggregate-only SQL query for active source IDs and receipt IDs, validate them in the payload adapter, emit a sanitized fixed-identity incident, and set the default expected completion hour to `7`.

- [ ] **Step 7: Write migration contract test and migration**

The test must verify repeat-safe trigger creation and these blocked operations for non-staging releases. The migration must not modify existing release 12 data; it only prevents future drift.

- [ ] **Step 8: Add Python tests to the repository test command and update hashes**

Split the current Node command into `test:node`, add `test:python`, make `test` execute both, and update the bootstrap SHA-256 entries for both synchronized release-store copies and the health probe.

- [ ] **Step 9: Run full verification**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
cmp reportingdash-canonical-bootstrap/lib/canonical_release_store.py reportingdash-canonical-bootstrap/runtime/canonical_release_store.py
```

Expected: all PASS and `cmp` exits 0.

- [ ] **Step 10: Commit**

```bash
git add src/db/migrations/046_abbott_release_source_integrity.sql src/db/abbott-release-source-integrity-migration.test.ts reportingdash-canonical-bootstrap package.json
git commit -m "fix: attest Abbott release source integrity"
```

---

### Task 4: Reviewed successor release and production verification

**Files:**
- No source file changes; use committed operators and server-side protected archives only.

**Interfaces:**
- Build a new staging release from a valid workbook JSON source equivalent to snapshot 14 and the reviewed catalog source.
- Populate all five canonical scopes through the last completed Metrika day.
- Materialize normalized path projections before validation.
- Cut over only after exact coverage, zero bad rows, source integrity, baseline comparison, app smoke tests, July/August controls, and rollback readiness.

- [ ] **Step 1: Merge reviewed code to main and deploy without changing cron or secrets**

Record the reviewed branch SHA, merge it through the repository's normal non-destructive workflow, deploy the application with `npm run deploy`, and install the committed Abbott canonical runtime closure at the same reviewed revision. Verify `git status --short` and the packaged runtime manifest before restarting anything.

- [ ] **Step 2: Apply migration 046 and verify its triggers without mutating release 12**

Run `npm run db:migrate`, query `information_schema.triggers` for the four named Abbott integrity triggers (release update plus receipt insert/update/delete), and perform the migration's read-only contract query. Do not issue a test update against production release rows.

- [ ] **Step 3: Freeze the successor baseline and create staging**

On the VPS, source only the protected operator environment and run:

```bash
cd /root/reportingdash-abbott-canonical
python3 capture_abbott_canonical_baseline.py \
  --date-from 2026-01-01 \
  --date-to 2026-08-07 \
  --private-archive-dir "$ABBOTT_CONTROL_ARCHIVE_DIR" \
  --code-revision "$DEPLOYED_CANONICAL_SHA" \
  --source-file "abbott_workbook_json:$ABBOTT_WORKBOOK_JSON_PARSER:$ABBOTT_WORKBOOK_JSON_PATH" \
  --source-file "abbott_workbook_catalog:$ABBOTT_WORKBOOK_CATALOG_PARSER:$ABBOTT_WORKBOOK_XLSX_PATH"

python3 abbott_release_operator.py create \
  --predecessor-release-id "$ACTIVE_RELEASE_ID" \
  --baseline-snapshot-id "$BASELINE_ID" \
  --code-revision "$DEPLOYED_CANONICAL_SHA"
```

The variables must be populated from protected configuration and sanitized operator output; never echo their secret-bearing source paths.

- [ ] **Step 4: Import exact frozen bytes and materialize paths**

```bash
cd /var/www/dashboard
npx tsx scripts/import-abbott-private-data.ts \
  --canonical-release-id "$CANDIDATE_RELEASE_ID" \
  --workbook-json "$ABBOTT_WORKBOOK_JSON_PATH" \
  --workbook-xlsx "$ABBOTT_WORKBOOK_XLSX_PATH" \
  --parser-version "$ABBOTT_IMPORT_PARSER_VERSION" \
  --code-revision "$DEPLOYED_APP_SHA" \
  --archive-dir "$ABBOTT_PRIVATE_ARCHIVE_DIR"

npx tsx scripts/build-abbott-return-page-direction-projection.ts "$CANDIDATE_RELEASE_ID"
```

Persist only aggregate projection counts in the checkpoint; never persist source rows there.

- [ ] **Step 5: Resume-safe backfill five scopes through 2026-08-07**

```bash
cd /root/reportingdash-abbott-canonical
python3 backfill_abbott_metrika_2026.py \
  --canonical-release-id "$CANDIDATE_RELEASE_ID" \
  --code-revision "$DEPLOYED_CANONICAL_SHA" \
  --parser-version "$ABBOTT_METRIKA_PARSER_VERSION"
```

Require exactly `220` covered dates, `1100` five-scope coverage rows, and zero bad rows before continuing. Resume the same candidate after rate-limit or process interruption; never create parallel workers.

- [ ] **Step 6: Compare, validate, and activate atomically**

```bash
python3 compare_abbott_canonical_release.py \
  --baseline-run-id "$BASELINE_ID" \
  --candidate-release-id "$CANDIDATE_RELEASE_ID"

python3 abbott_release_operator.py validate \
  --release-id "$CANDIDATE_RELEASE_ID" \
  --date-from 2026-01-01 \
  --date-to 2026-08-07 \
  --code-revision "$DEPLOYED_CANONICAL_SHA"

python3 abbott_release_operator.py activate \
  --release-id "$CANDIDATE_RELEASE_ID" \
  --expected-active-release-id "$ACTIVE_RELEASE_ID"
```

- [ ] **Step 7: Run production smoke controls**

Verify authenticated July and 1–7 August page tables, material filters, explicit `Не определено`, article title fallback, API `200`, browser console/network, embed aggregate boundary, manager-only fields, session partition integrity, health JSON, Telegram summary dry-run, and public Abbott private-asset `404` responses.

- [ ] **Step 8: Roll back on any failed smoke**

```bash
python3 abbott_release_operator.py rollback \
  --from-release-id "$CANDIDATE_RELEASE_ID" \
  --to-release-id "$ACTIVE_RELEASE_ID"
```

Rollback the application release through `npm run deploy:rollback` when the failure is application-side. Never restore public private assets.

- [ ] **Step 9: Remove the orphaned supervisor only after PM2 attestation**

Confirm `pm2 jlist` reports `dashboard-next` online, the process cwd is `/var/www/dashboard`, both public health and Abbott authenticated smoke pass, then disable the unused systemd unit and verify it no longer restarts. PM2 remains the single dashboard supervisor.
