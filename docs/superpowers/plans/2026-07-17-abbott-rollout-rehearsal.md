# Abbott Rollout Rehearsal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the Abbott canonical/private rollout locally on live MySQL while preserving every workbook row, exposing lookup ambiguity, and stopping safely before owner- or production-only actions.

**Architecture:** Split source-faithful catalog rows from a release-scoped hashed lookup projection. Exercise the application schema, grants, importer, validation, activation and rollback in an ephemeral MySQL 8.4 container using protected local copies of the approved source files. Produce only sanitized evidence; live API/backfill and production mutations remain behind explicit credential and authority gates.

**Tech Stack:** TypeScript/Node 25, Next.js 16, `xlsx`, `mysql2`, Python 3.9+, `unittest`, MySQL 8.4 Docker, POSIX shell.

## Global Constraints

- Work only in `/Users/nafanya/ReportingDash/.worktrees/abbott-canonical-private-foundation` on `codex/abbott-canonical-private-foundation` and its matching nested dashboard/Nest branches.
- Abbott Metrika authority is counter `90602537`; the exact scopes are `other`, `traffic`, `page`, `user_behavior`, and `returning`.
- Never commit or print raw UserID, session IDs, person-name slugs, private URLs, source rows, passwords, OAuth tokens, launch secrets, database hostnames, or private archive paths.
- Private inputs must be outside Git and web roots under a mode-`0700` directory; every input, secret, archive and raw log file must be mode `0600`.
- Never use credentials recovered from Git history. Missing owner-issued or production credentials are a hard blocked gate.
- No production DB/API write, release activation, deployment, cron edit, Telegram send, Hermes schedule, service restart or OAuth revocation is authorized by this plan.
- All behavior changes use TDD: demonstrate RED, implement the minimum GREEN change, run focused tests, self-review, commit, then obtain a task-scoped spec/quality review.
- Do not load the full 8.1 GiB MariaDB dump by default with only 32 GiB free. Run a schema-only compatibility probe; application import requires separately verified completeness-manifested Bitrix sources.
- Execution amendment (2026-07-17): inspection proved the available Bitrix JSON is an older exploratory test format without the required completeness manifests or canonical page/event grains. Treat it only as a rejection fixture. Do not synthesize events or completeness; defer four-source import/lifecycle acceptance until the live Bitrix database connector contract exists.

---

### Task 1: Source-faithful workbook parser and sanitized audit

**Files:**
- Create: `dashboard-next/src/lib/abbott-workbook-catalog.ts`
- Create: `dashboard-next/src/lib/abbott-workbook-catalog.test.ts`
- Create: `dashboard-next/scripts/audit-abbott-workbook.ts`
- Modify: `dashboard-next/scripts/import-abbott-private-data.ts`
- Modify: `dashboard-next/scripts/import-abbott-private-data.test.ts`

**Interfaces:**
- Consumes: an XLSX `Buffer` and the existing twelve-sheet configuration.
- Produces: `parseAbbottWorkbookCatalog(buffer): AbbottWorkbookCatalogParseResult`, where each row contains `sourceSheet`, `sourceRowOrdinal`, normalized metadata and a provenance-bearing `targetKeyFingerprint`.
- Produces: `buildAbbottCatalogAudit(rows): AbbottCatalogAudit`, containing aggregate counts and hashed conflict-set fingerprints only.

- [ ] **Step 1: Write parser RED tests**

Add tests proving that two rows with the same title or slug on different sheets are both returned, that the one-based ordinal is stable, and that the fingerprint changes when sheet or ordinal changes:

```ts
assert.deepEqual(parsed.rows.map(({ sourceSheet, sourceRowOrdinal }) => [sourceSheet, sourceRowOrdinal]), [
  ["pages", 1],
  ["Статьи", 1],
]);
assert.notEqual(parsed.rows[0]?.targetKeyFingerprint, parsed.rows[1]?.targetKeyFingerprint);
```

- [ ] **Step 2: Verify RED**

Run:

```bash
cd dashboard-next
node --import tsx --test src/lib/abbott-workbook-catalog.test.ts
```

Expected: failure because `parseAbbottWorkbookCatalog` does not exist and the current parser rejects duplicate lookup keys.

- [ ] **Step 3: Extract and implement the source-faithful parser**

Move catalog parsing out of the importer without changing the other three source parsers. Remove global title/slug uniqueness assertions. Keep row-level validation, and derive the fingerprint from this exact ordered value list:

```ts
[
  sourceSheet,
  sourceRowOrdinal,
  pageTitle,
  materialType,
  sourceSlug,
  direction,
  access,
  isActive,
]
```

- [ ] **Step 4: Write and verify sanitized audit RED/GREEN tests**

The audit must report `source_row_count`, `rows_with_slug`, `unique_lookup_keys`, `identical_groups`, `ambiguous_groups`, `excess_occurrences`, and sorted SHA-256 conflict-set fingerprints. Assert recursively that forbidden keys such as `title`, `slug`, `url`, `path`, `user_id`, and `session` are absent.

Run:

```bash
cd dashboard-next
node --import tsx --test src/lib/abbott-workbook-catalog.test.ts scripts/import-abbott-private-data.test.ts
```

Expected: all parser/importer tests pass with no row-level values in output.

- [ ] **Step 5: Add a parser-only audit CLI**

`audit-abbott-workbook.ts` must accept exactly `--workbook-xlsx` and `--output`, reject inputs under a web root, never archive or connect to MySQL, write the JSON atomically with mode `0600`, and print only `Abbott workbook audit complete`.

- [ ] **Step 6: Run the audit on a protected copy of the real workbook**

```bash
umask 077
install -d -m 700 /tmp/abbott-rollout-rehearsal/inputs /tmp/abbott-rollout-rehearsal/evidence
install -m 600 '/Users/nafanya/ReportingDash/Abbott names.xlsx' /tmp/abbott-rollout-rehearsal/inputs/Abbott-names.xlsx
cd dashboard-next
node --import tsx scripts/audit-abbott-workbook.ts \
  --workbook-xlsx /tmp/abbott-rollout-rehearsal/inputs/Abbott-names.xlsx \
  --output /tmp/abbott-rollout-rehearsal/evidence/workbook-audit.json
```

Expected sanitized evidence: `source_row_count=1769`; no raw lookup key is present.

- [ ] **Step 7: Verify and commit**

```bash
cd dashboard-next
npm run typecheck
npm run security:public-assets
git diff --check
git add src/lib/abbott-workbook-catalog.ts src/lib/abbott-workbook-catalog.test.ts scripts/audit-abbott-workbook.ts scripts/import-abbott-private-data.ts scripts/import-abbott-private-data.test.ts
git commit -m "fix: preserve Abbott workbook source rows"
```

---

### Task 2: Auditable content lookup projection and incomplete-metadata behavior

**Files:**
- Modify: `dashboard-next/src/db/migrations/033_abbott_canonical_release_control.sql`
- Modify: `dashboard-next/scripts/import-abbott-private-data.ts`
- Modify: `dashboard-next/scripts/import-abbott-private-data.test.ts`
- Modify: `dashboard-next/src/lib/abbott-private-types.ts`
- Modify: `dashboard-next/src/lib/abbott-private-store.ts`
- Modify: `dashboard-next/src/lib/abbott-private-store.test.ts`
- Modify: `dashboard-next/src/lib/abbott-bi.ts`
- Modify: `dashboard-next/src/lib/abbott-bi-loader.test.ts`
- Modify: `ops/sql/abbott_private_schema_and_grants.sql`
- Modify: `tests/test_abbott_schema_contract.py`

**Interfaces:**
- Consumes: Task 1 `AbbottWorkbookCatalogRow[]`.
- Produces: `buildAbbottContentLookupProjection(rows)` with `unique`, `identical_collapsed`, or `ambiguous` resolution rows for `title`, `slug`, and `path` lookup kinds. `title_type` is excluded because no current canonical/Bitrix fact carries both inputs.
- Produces: hashed lookup maps plus `lookupQuality: { ambiguousGroups: number; collapsedGroups: number }`; ambiguous groups have no selected catalog row.

- [ ] **Step 1: Write migration and projection RED tests**

Require `portal_content_catalog.source_sheet`, `source_row_ordinal`, a uniqueness key on release/snapshot/sheet/ordinal, and `portal_content_lookup_projection` with a unique key on release/snapshot/kind/hash. Test these projection cases:

```ts
assert.equal(unique.resolutionStatus, "unique");
assert.equal(identical.resolutionStatus, "identical_collapsed");
assert.equal(identical.candidateCount, 2);
assert.equal(ambiguous.resolutionStatus, "ambiguous");
assert.equal(ambiguous.selectedSourceRowFingerprint, null);
```

- [ ] **Step 2: Verify RED**

```bash
cd dashboard-next
node --import tsx --test scripts/import-abbott-private-data.test.ts src/lib/abbott-private-store.test.ts src/lib/abbott-bi-loader.test.ts
cd ..
python3 -m unittest tests.test_abbott_schema_contract -v
```

Expected: failures because provenance columns and projection table/builder do not exist.

- [ ] **Step 3: Implement repeat-safe schema changes**

Add the new columns/table to the fresh DDL and guard existing-install ALTER/index changes through `INFORMATION_SCHEMA` prepared statements. Store only `lookup_key_hash`, candidate counts, metadata-signature counts, resolution status, selected source fingerprint and a group fingerprint; do not duplicate raw title/slug/path values in the projection.

Grant the importer role `SELECT, INSERT` and the runtime-reader role `SELECT` on `report_bd.portal_content_lookup_projection`. Do not grant the collector or release-operator roles access to the projection.

- [ ] **Step 4: Persist catalog provenance and projection in one importer transaction**

Every catalog batch must include `source_sheet` and `source_row_ordinal`. Projection rows are derived from the freshly parsed batch, inserted with the same release/snapshot, verified by count/fingerprint, and included in per-release import evidence before commit.

- [ ] **Step 5: Make read-model ambiguity non-destructive**

Load only `unique` and `identical_collapsed` projection rows joined to their selected catalog row. Hash page title/slug/path server-side before lookup. For `ambiguous`, return optional metadata as `null`, keep the canonical page metrics, and expose only aggregate ambiguity counts in `data_quality`.

- [ ] **Step 6: Verify focused behavior**

```bash
cd dashboard-next
node --import tsx --test scripts/import-abbott-private-data.test.ts src/lib/abbott-private-store.test.ts src/lib/abbott-bi-loader.test.ts
npm run typecheck
cd ..
python3 -m unittest tests.test_abbott_schema_contract -v
```

Expected: every catalog row persists; identical groups collapse only in lookup; conflicting groups do not suppress page metrics or disclose raw keys.

- [ ] **Step 7: Commit nested and root pointers**

```bash
cd dashboard-next
git add src/db/migrations/033_abbott_canonical_release_control.sql scripts/import-abbott-private-data.ts scripts/import-abbott-private-data.test.ts src/lib/abbott-private-types.ts src/lib/abbott-private-store.ts src/lib/abbott-private-store.test.ts src/lib/abbott-bi.ts src/lib/abbott-bi-loader.test.ts
git commit -m "feat: resolve Abbott content lookups explicitly"
cd ..
git add dashboard-next ops/sql/abbott_private_schema_and_grants.sql tests/test_abbott_schema_contract.py
git commit -m "test: require Abbott lookup provenance"
```

---

### Task 3: Ephemeral MySQL rehearsal harness

**Files:**
- Create: `ops/local/abbott_mysql_rehearsal.sh`
- Create: `ops/local/abbott_dump_schema_filter.py`
- Create: `tests/test_abbott_mysql_rehearsal_contract.py`
- Modify: `docs/ABBOTT-OPERATIONS-RUNBOOK.md`

**Interfaces:**
- Produces: `abbott_mysql_rehearsal.sh schema --dump-sql PATH --evidence DIR`. The schema mode consumes reviewed migrations from a clean tracked `HEAD` plus the explicit dump path; it does not accept or copy application-import inputs. Other modes fail with a sanitized usage error until Task 4 adds their tested orchestration.
- Produces: sanitized `rehearsal-summary.json`, `schema-signature.sha256`, `grant-signature.sha256`, and `dump-schema-probe.txt`.
- Cleans container, volume and private temp credentials by default; `ABBOTT_REHEARSAL_PRESERVE_ON_FAILURE=1` preserves only local private artifacts.

- [ ] **Step 1: Write shell-contract RED tests**

Test that the harness pins `mysql:8.4.10`, records the resolved digest, generates credentials without printing them, uses container-local MySQL clients, rejects source paths under `public`, installs inputs as `0600`, and has a cleanup trap. Test that the dump filter emits DDL but no `INSERT`, `LOCK TABLES`, row data, DEFINER, or source database name.

- [ ] **Step 2: Verify RED**

```bash
python3 -m unittest tests.test_abbott_mysql_rehearsal_contract -v
```

Expected: failure because the rehearsal scripts do not exist.

- [ ] **Step 3: Implement the harness**

Fresh mode must:

1. start an isolated MySQL container and wait using `mysqladmin ping` inside it;
2. create `report_bd`, `report_bd_private`, and `abbott_source_dump_20260529`;
3. apply dashboard migrations in lexical order through `033` exactly once;
4. run `ops/sql/abbott_private_schema_and_grants.sql`;
5. create rehearsal accounts and assign the four roles with default roles;
6. capture sorted schema/index/grant signatures;
7. re-run only migration `033` and the private script, then require identical signatures.

- [ ] **Step 4: Implement schema-only MariaDB dump compatibility**

Stream `/Users/nafanya/ReportingDash/abbott_reader_analytics_abbottpro_db_2026-05-29_11-14-33.sql` through the filter into a private temporary file, load it only into `abbott_source_dump_20260529`, and record table count plus sanitized SQL error class. Never load dump rows by default.

- [ ] **Step 5: Add runbook local-rehearsal checkpoint**

Document the exact command, 32 GiB capacity decision, evidence files and cleanup behavior. Keep production checkpoints unchanged.

- [ ] **Step 6: Verify static contracts and commit**

```bash
python3 -m unittest tests.test_abbott_mysql_rehearsal_contract tests.test_abbott_operations_runbook -v
bash -n ops/local/abbott_mysql_rehearsal.sh
git diff --check
git add ops/local/abbott_mysql_rehearsal.sh ops/local/abbott_dump_schema_filter.py tests/test_abbott_mysql_rehearsal_contract.py docs/ABBOTT-OPERATIONS-RUNBOOK.md
git commit -m "feat: add Abbott MySQL rollout rehearsal"
```

---

### Task 4: Execute live local schema, import, validation and rollback rehearsal

**Files:**
- Modify: `ops/local/abbott_mysql_rehearsal.sh`
- Create: `tests/test_abbott_mysql_candidate_rehearsal.py`
- Create: `docs/abbott-rehearsal/2026-07-17-summary.md`
- Modify only if a live-MySQL defect is reproduced first: the exact source/test files covering that defect.

**Interfaces:**
- Consumes: Tasks 1-3, protected copies of the four approved sources, and the ephemeral MySQL service.
- Produces: independently runnable `import --inputs DIR --evidence DIR` and `lifecycle --inputs DIR --evidence DIR` modes that start from a fresh ephemeral application schema, perform their requested phase, capture sanitized evidence and clean up. Only `schema` consumes the 8.1 GiB dump.
- Produces: a committed sanitized summary and private uncommitted evidence under `/tmp/abbott-rollout-rehearsal/evidence`.

- [ ] **Step 1: Write import/lifecycle orchestration RED tests**

Require `import` to create a predecessor, frozen local baseline, staging candidate and four-source import before verifying counts/provenance. Require `lifecycle` to build on that state and exercise incomplete rejection, warning review, validation, activation, stale-CAS rejection and rollback. Both modes must be standalone and cleanup by default.

```bash
python3 -m unittest tests.test_abbott_mysql_candidate_rehearsal -v
```

Expected: failure because Task 3 exposes only `schema`.

- [ ] **Step 2: Implement import and lifecycle modes**

Reuse the protected container/schema helpers from Task 3. Use the real importer and release-operator entrypoints with rehearsal-only protected env files. Generate only aggregate fixture coverage/comparison evidence needed to exercise release gates; never fabricate source-import evidence, which must come from the real four-source importer transaction.

- [ ] **Step 3: Start Docker Desktop and prove the daemon is ready**

```bash
open -a Docker
docker info --format '{{.ServerVersion}}'
```

Expected: a non-empty Docker server version. Poll in intervals shorter than 60 seconds; do not continue if the daemon remains unavailable.

- [ ] **Step 4: Prepare protected real inputs**

```bash
umask 077
install -d -m 700 /tmp/abbott-rollout-rehearsal/inputs /tmp/abbott-rollout-rehearsal/evidence
install -m 600 /Users/nafanya/ReportingDash/dashboard-next/public/abbott/abbott-workbook.json /tmp/abbott-rollout-rehearsal/inputs/abbott-workbook.json
install -m 600 '/Users/nafanya/ReportingDash/Abbott names.xlsx' /tmp/abbott-rollout-rehearsal/inputs/Abbott-names.xlsx
install -m 600 /Users/nafanya/ReportingDash/dashboard-next/public/abbott/bitrix-analytics.json /tmp/abbott-rollout-rehearsal/inputs/bitrix-analytics.json
install -m 600 /Users/nafanya/ReportingDash/dashboard-next/public/abbott/bitrix-session-journeys.json /tmp/abbott-rollout-rehearsal/inputs/bitrix-session-journeys.json
```

- [ ] **Step 5: Run schema and import modes**

```bash
ops/local/abbott_mysql_rehearsal.sh schema \
  --dump-sql /Users/nafanya/ReportingDash/abbott_reader_analytics_abbottpro_db_2026-05-29_11-14-33.sql \
  --evidence /tmp/abbott-rollout-rehearsal/evidence
ops/local/abbott_mysql_rehearsal.sh import \
  --inputs /tmp/abbott-rollout-rehearsal/inputs \
  --evidence /tmp/abbott-rollout-rehearsal/evidence
```

Expected: all four source kinds imported; catalog count is exactly `1769`; rejected count is zero; private raw values appear only in private tables and are never printed.

- [ ] **Step 6: Exercise validation and pointer lifecycle**

Run `lifecycle` mode. It must demonstrate, in order: incomplete candidate rejected, unreviewed ambiguity warning rejected, locally named reviewer acceptance recorded, validation succeeds, expected pointer activates, stale compare-and-swap fails, and rollback restores the predecessor.

```bash
ops/local/abbott_mysql_rehearsal.sh lifecycle \
  --inputs /tmp/abbott-rollout-rehearsal/inputs \
  --evidence /tmp/abbott-rollout-rehearsal/evidence
```

- [ ] **Step 7: Fix only reproduced integration defects with TDD**

For each defect, add the smallest failing automated integration/contract test, prove RED, implement GREEN, rerun the failed rehearsal mode and focused suite, then commit with a defect-specific message.

- [ ] **Step 8: Write sanitized summary and commit**

The summary must contain image digest, MySQL version, source hashes/counts, ambiguity aggregates, schema/grant signatures, release lifecycle outcomes and limitations. It must not contain source paths, credentials, hosts, raw rows or lookup keys.

```bash
git add docs/abbott-rehearsal/2026-07-17-summary.md
git commit -m "docs: record Abbott local rollout rehearsal"
```

---

### Task 5: Backfill readiness and external-authority gate

**Files:**
- Create: `abbott_rollout_preflight.py`
- Create: `tests/test_abbott_rollout_preflight.py`
- Modify: `docs/ABBOTT-OPERATIONS-RUNBOOK.md`

**Interfaces:**
- Produces: a sanitized JSON gate report with `local_rehearsal`, `owner_token`, `release_db`, `production_runtime`, `cron`, and `hermes` statuses.
- Never reads or returns credential values; it checks explicit file existence, mode and required key names through a parser that discards values.

- [ ] **Step 1: Write preflight RED tests**

Require `blocked` for missing owner token/release DB files, `ready` only for mode-`0600` explicit files with the required key names, rejection of symlinks and multiline dotenv values, and recursive absence of value/host/path fields in JSON.

- [ ] **Step 2: Verify RED**

```bash
python3 -m unittest tests.test_abbott_rollout_preflight -v
```

Expected: failure because `abbott_rollout_preflight.py` does not exist.

- [ ] **Step 3: Implement fail-closed preflight**

Use only caller-supplied paths. Do not discover home-directory credentials. Exit `0` when local work is complete but external gates are blocked; exit `2` only for an invalid or unsafe supplied file. Print the sanitized JSON report only.

- [ ] **Step 4: Run the current-machine gate**

```bash
python3 abbott_rollout_preflight.py \
  --local-evidence /tmp/abbott-rollout-rehearsal/evidence \
  --collector-env /tmp/abbott-rollout-rehearsal/absent-collector.env \
  --import-env /tmp/abbott-rollout-rehearsal/absent-import.env \
  --release-env /tmp/abbott-rollout-rehearsal/absent-release.env \
  --owner-token /tmp/abbott-rollout-rehearsal/absent-token \
  > /tmp/abbott-rollout-rehearsal/evidence/external-gates.json
```

Expected: local rehearsal status from Task 4 and blocked owner/production statuses; no attempt to call Yandex, DB, cron, Telegram or Hermes.

- [ ] **Step 5: Update runbook and commit**

```bash
python3 -m unittest tests.test_abbott_rollout_preflight tests.test_abbott_operations_runbook -v
git diff --check
git add abbott_rollout_preflight.py tests/test_abbott_rollout_preflight.py docs/ABBOTT-OPERATIONS-RUNBOOK.md
git commit -m "feat: gate Abbott production rollout safely"
```

---

### Task 6: Full verification and independent branch review

**Files:**
- Modify: `.superpowers/sdd/progress.md` only as ignored execution ledger.
- Read: all files changed since `331ad22` in root and `7ab761a` in dashboard.

**Interfaces:**
- Consumes: reviewed commits from Tasks 1-5.
- Produces: final verification evidence, one whole-branch review and an exact production handoff with blocked external gates.

- [ ] **Step 1: Run root verification**

```bash
PYTHONWARNINGS=ignore python3 -m unittest discover -s tests -p 'test_*.py'
python3 -m py_compile abbott_rollout_preflight.py ops/local/abbott_dump_schema_filter.py
git diff --check
```

- [ ] **Step 2: Run dashboard verification**

```bash
cd dashboard-next
npm test
npm run lint
npm run typecheck
npm run security:public-assets
npm run build
git diff --check
```

- [ ] **Step 3: Run Nest security verification**

```bash
cd nest-second
npm test -- --runInBand legacy-trigger.guard.spec.ts
npm run typecheck
npm run build
git diff --check
```

- [ ] **Step 4: Run private-evidence and secret scans**

Confirm that no changed/tracked path contains the real source hashes as file content, private input filenames under a web root, known retired literals, dotenv values, raw UserID fixtures outside test-only synthetic values, or `/tmp/abbott-rollout-rehearsal` paths in deployable code.

- [ ] **Step 5: Dispatch final whole-branch review**

Generate review packages from root base `331ad22` and dashboard base `7ab761a`. The reviewer must verify source fidelity, ambiguity behavior, live-MySQL evidence, secret boundaries, no production mutation and exact blocked external gates.

- [ ] **Step 6: Record final state**

Append Task 1-6 commit ranges and review results to `.superpowers/sdd/progress.md`. Report the branch/HEADs, fresh test counts, local rehearsal outcome, remaining owner/production actions, and whether the known `2026-03-29..2026-04-07` gap was actually downloaded or remains blocked.
