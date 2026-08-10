# Abbott Returning Layer and Content Registry Batch Implementation Plan

> **For Codex:** execute this plan in the isolated `codex/abbott-returning-registry-batch` branches in the root and `dashboard-next` repositories. Keep Abbott facts append-only, do not call Metrika, and stop the approval workflow after producing the review batch.

**Goal:** restore page-direction enrichment in Abbott returning views, reconcile the supplied Registry 1 workbook against canonical MySQL without silent classification changes, and publish a review batch containing only unresolved pages.

**Architecture:** keep Metrika visit and returning facts unchanged. Build a reviewed successor Abbott release whose content lookup projection adds normalized `path` keys, filter non-web URLs in the manager returning read-model, and resolve displayed return-page directions from the active release's canonical catalog. Deploy the already tested content-registry schema and use its immutable reconciliation/approval workflow; the supplied workbook is captured as Registry 1 evidence and conflicts are routed to review under the anti-flip rule.

**Tech stack:** Next.js/TypeScript, Node test runner, Python 3.11, MySQL 8, Google Sheets approval projection, `@oai/artifact-tool` for workbook inspection.

---

## Task 1: Freeze production controls

**Files:**
- Create: protected production checkpoint under `/root/reportingdash-private/abbott/checkpoints/`
- Modify: none

1. Record active release, attached snapshots, release status, scope/date coverage, catalog/projection counts, and July/August aggregate controls.
2. Record counts for `file://` visit rows and returning URLs without exposing visitor identifiers.
3. Record catalog direction/material-type coverage and a SHA-256 fingerprint over ordered non-PII catalog/projection fields.
4. Confirm no staging/validated release would be overwritten.

## Task 2: TDD the returning read-model repair

**Files:**
- Modify: `dashboard-next/src/lib/abbott-page-url.ts`
- Modify: `dashboard-next/src/lib/abbott-page-url.test.ts`
- Modify: `dashboard-next/src/lib/abbott-return-frequency.ts`
- Modify: `dashboard-next/src/lib/abbott-return-frequency.test.ts`
- Modify: `dashboard-next/src/lib/abbott-bi.ts`
- Modify: `dashboard-next/src/lib/abbott-bi-loader.test.ts`

1. Add failing tests that non-HTTP(S) URLs are excluded from return-frequency page rows without affecting valid visits or visitor-frequency groups.
2. Add failing tests that HTTP(S) variants normalize to one stable path and map to one accepted path projection.
3. Add failing tests that visible return-page rows collapse at the displayed grain and preserve valid visitor/repeat-visit totals.
4. Implement the minimal read-model changes. Do not change canonical fact writers or request any source data.
5. Run focused tests, then the full Abbott TypeScript test suite.

## Task 3: Verify the supplied Registry 1 workbook

**Files:**
- Source: user-supplied `Реестр_материалов_AbbottPRO_...xlsx`
- Create: protected immutable copy and digest in the production content input directory
- Create: local audit JSON/CSV only in the task output/checkpoint directory

1. Inspect all eight sheets with `@oai/artifact-tool`, preserve the source, and capture sheet/row counts.
2. Run the pipeline parser in dry-run mode and reconcile workbook identities against active canonical catalog rows.
3. Classify results into exact match, missing canonical metadata, conflict, unresolved identity, duplicate occurrence, and rejected source row.
4. Verify every workbook row is accounted for; never automatically overwrite a nonempty active direction.

## Task 4: Deploy canonical approval workflow schema and runtime

**Files:**
- Apply: `dashboard-next/src/db/migrations/047_abbott_content_registry_workflow.sql`
- Apply: `dashboard-next/src/db/migrations/048_abbott_content_candidate_provenance.sql`
- Apply: `dashboard-next/src/db/migrations/049_abbott_content_reconciliation_staging.sql`
- Deploy: reviewed `agents/abbott_page_classifier/` runtime and least-privilege grants

1. Run all migration/schema and workflow tests before production writes.
2. Back up relevant schema definitions and record pre-migration table absence/presence.
3. Apply additive migrations in order and verify constraints/grants without printing credentials.
4. Deploy the exact committed Python 3.11 workflow runtime and verify its manifest.

## Task 5: Capture and reconcile Registry 1

**Files:**
- Use: protected Registry 1 workbook
- Use: reviewed Registry 2 accepted capture or an explicitly empty, hashed capture only if no accepted capture exists

1. Execute `reconcile` with immutable input hashes and current active predecessor.
2. Verify source accounting, duplicate collapse, rejected rows, and identity provenance.
3. Accept only same-value/no-conflict fills for previously empty canonical fields; keep anti-flip and other disagreements in the conflict queue.
4. Persist append-only classification events and audit actor/reason/timestamp where acceptance is authorized by the supplied workbook.

## Task 6: Build and validate the successor returning projection

**Files:**
- Use: `dashboard-next/scripts/build-abbott-return-page-direction-projection.ts`
- Use: content candidate materializer/release operator

1. Materialize a staging successor from active release 14 without calling Metrika and without changing fact values.
2. Build normalized path projection rows from the candidate catalog and existing canonical page facts.
3. Validate snapshot/source receipts, exact fact/coverage equality with release 14, zero anti-flip violations, and nonzero matched path coverage.
4. Activate only after comparison and dashboard smoke pass; retain release 14 as rollback pointer.

## Task 7: Generate the unresolved-page approval batch

**Files:**
- Create: Google Sheet approval projection and exported XLSX review artifact

1. Classify only unresolved/new eligible identities; do not re-propose locked matching classifications.
2. Publish the exact eight-tab approval projection and stop before ingestion/materialization.
3. Verify counts and hashes, render all output sheets, scan formulas/errors, and export the batch to the task output directory.
4. Provide the review link and concise counts for ready/conflict/unresolved/rejected rows.

## Task 8: Deploy and verify Abbott only

**Files:**
- Deploy: `dashboard-next` from the isolated Abbott branch after all tests pass
- Modify: current operational memory/runbook with final runtime truth

1. Build and deploy the app; verify PM2, local/public health, loopback listener isolation, manager auth, and public asset 404.
2. Visually smoke-test July and completed August periods: returning URLs, direction filters, page stats, and zero client errors.
3. Reconcile July/August control totals with the frozen baseline; expected differences are only the explicit exclusion of non-web return-page rows and metadata enrichment.
4. Commit/push both repositories. Merge to `main` only after production verification and preserve Zaruku/Gidrofuril diffs exactly.
