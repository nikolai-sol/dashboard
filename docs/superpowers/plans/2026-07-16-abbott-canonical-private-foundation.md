# Abbott Canonical Private Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Abbott's public-file and mixed legacy/canonical dashboard path with a protected DB-native, release-versioned canonical read model, reproducible migration controls, and counter-scoped monitoring.

**Architecture:** Candidate Metrika data is collected into immutable release-scoped facts and published one Abbott counter/day at a time only when all five required scopes validate. The protected Next.js read model uses a private MySQL schema for raw `UserID` and Bitrix-linked data, while embed requests receive an aggregate-only projection. A deterministic baseline/comparator and active-release pointer make cutover and rollback auditable.

**Tech Stack:** Python 3.11, `unittest`, MySQL/InnoDB, TypeScript 5, Next.js 16 App Router, React 19, Node test runner, Bash deploy scripts, Telegram Bot API, Hermes sanitized-input adapter.

## Global Constraints

- Work only in `codex/abbott-canonical-private-foundation`; do not deploy, mutate production DB/env/crontab, or create a Hermes cron during implementation.
- Abbott counter is exactly `90602537`; Zaruku and other counters never satisfy Abbott coverage or health.
- Canonical cutover boundary is `2026-01-01`; there is no legacy fallback on or after that date.
- Required daily scopes are exactly `other`, `traffic`, `page`, `user_behavior`, and `returning`.
- `other` is the all-portal denominator; `traffic` is only the UTM/acquisition slice.
- Raw internal `UserID` is stored losslessly only in `report_bd_private` and may be returned only to an authenticated Abbott manager. Embed responses never contain raw IDs or row-level journeys.
- Abbott is fail-closed: missing users/password/secret configuration never resolves to public access.
- Sensitive API responses set `Cache-Control: private, no-store`; server authorization is required on API, Excel, PDF, and AI-summary routes.
- SQL uses parameters; logs, validation diagnostics, Telegram, and Hermes never contain raw IDs, row-level paths, tokens, cookies, passwords, or DSNs.
- No runtime DDL, no range delete before API validation, and no success coverage row outside the same transaction as all five daily scopes.
- `success` and reconciled `success_empty` satisfy coverage; `partial`, `skipped`, `sampled`, and `failed` block activation.
- Every production-code change follows red-green-refactor and is committed at the task boundary.

---

### Task 1: Release, coverage, and private-schema contracts

**Files:**
- Create: `dashboard-next/src/db/migrations/033_abbott_canonical_release_control.sql`
- Create: `ops/sql/abbott_private_schema_and_grants.sql`
- Create: `ops/sql/abbott_prebackfill_snapshot.sql`
- Create: `tests/test_abbott_schema_contract.py`

**Interfaces:**
- Produces primary tables `portal_data_releases`, `portal_active_data_releases`, `portal_dataset_snapshots`, `portal_migration_validation_runs`, `portal_content_catalog`, `portal_general_materials`, `portal_external_events`, `canonical_fact_metrika_site_analytics_daily`, `canonical_fact_metrika_returning_pages_release_daily`, and `canonical_source_coverage_daily`.
- Produces private tables `report_bd_private.canonical_fact_metrika_user_behavior_daily`, `portal_user_directions_private`, `portal_bitrix_page_facts`, and `portal_bitrix_journeys_private`.
- All candidate facts use `canonical_release_id + counter/account + report_date` in their unique key.

- [ ] **Step 1: Write the failing static schema tests**

```python
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class AbbottSchemaContractTest(unittest.TestCase):
    def test_release_keys_and_private_boundary(self):
        primary = (ROOT / "dashboard-next/src/db/migrations/033_abbott_canonical_release_control.sql").read_text()
        private = (ROOT / "ops/sql/abbott_private_schema_and_grants.sql").read_text()
        self.assertIn("portal_active_data_releases", primary)
        self.assertIn("canonical_release_id", primary)
        self.assertNotIn(" raw_user_id ", primary.lower())
        self.assertIn("raw_user_id TEXT NOT NULL", private)
        self.assertIn("ENGINE=InnoDB", primary)
        self.assertIn("ENGINE=InnoDB", private)

    def test_coverage_statuses_are_closed(self):
        sql = (ROOT / "dashboard-next/src/db/migrations/033_abbott_canonical_release_control.sql").read_text()
        for status in ("success", "success_empty", "partial", "skipped", "sampled", "failed"):
            self.assertIn(f"'{status}'", sql)
```

- [ ] **Step 2: Run RED**

Run: `python -m unittest tests.test_abbott_schema_contract -v`

Expected: FAIL because the SQL files do not exist.

- [ ] **Step 3: Add the minimal SQL contracts**

Use these exact grains:

```sql
UNIQUE KEY uniq_site_release_scope
  (canonical_release_id, source_key, analytics_account_id, report_date, analytics_scope, scope_hash);
UNIQUE KEY uniq_returning_release_page_bucket
  (canonical_release_id, counter_id, report_date, raw_page_hash, return_bucket_code);
UNIQUE KEY uniq_release_coverage
  (canonical_release_id, source_key, counter_id, scope_key, report_date);
```

The private behavior table contains lossless `raw_user_id TEXT NOT NULL`, start/end URL fields, request fingerprint, ingestion run, and the same release/counter/date key. The grants file creates passwordless MySQL roles named `abbott_collector_role`, `abbott_importer_role`, `abbott_release_operator_role`, and `abbott_runtime_reader_role`; it never creates user accounts or contains passwords. The DBA grants those roles to provisioned accounts during reviewed rollout.

- [ ] **Step 4: Run GREEN and contract scan**

Run: `python -m unittest tests.test_abbott_schema_contract -v`

Expected: PASS.

Run: `rg -n "IDENTIFIED BY|PASSWORD|y0_" dashboard-next/src/db/migrations/033_abbott_canonical_release_control.sql ops/sql`

Expected: no secret values or password clauses.

- [ ] **Step 5: Commit**

```bash
git -C dashboard-next add src/db/migrations/033_abbott_canonical_release_control.sql
git -C dashboard-next commit -m "feat: add Abbott canonical release schema"
git add dashboard-next ops/sql tests/test_abbott_schema_contract.py
git commit -m "feat: add Abbott canonical private schema contracts"
```

### Task 2: Immutable release store and atomic daily writer

**Files:**
- Create: `canonical_release_store.py`
- Modify: `canonical_writer.py`
- Create: `tests/test_canonical_release_store.py`
- Create: `tests/test_yandex_metrika_atomic_writer.py`

**Interfaces:**

```python
def create_candidate_release(*, portal_key: str, predecessor_release_id: int,
                             baseline_validation_run_id: int, code_revision: str) -> int: ...
def require_mutable_candidate_release(release_id: int, *, portal_key: str = "abbott") -> dict: ...
def activate_release(release_id: int, *, expected_active_release_id: int) -> None: ...
def rollback_release(*, from_release_id: int, to_release_id: int) -> None: ...
def publish_metrika_day_bundle(bundle: "MetrikaDayBundle") -> "MetrikaPublishResult": ...
def record_metrika_day_failure(*, release_id: int, counter_id: str, report_date: str,
                               run_id: int, scope: str, status: str, error_class: str) -> None: ...
```

- [ ] **Step 1: Write failing transaction and pointer tests**

Tests use recording fake connections and assert `SELECT ... FOR UPDATE`, compare-and-swap of the active pointer, one `start_transaction`, insert order site → private → returning → coverage, and rollback on any insert failure. They also assert failure recording executes no `DELETE`.

- [ ] **Step 2: Run RED**

Run: `python -m unittest tests.test_canonical_release_store tests.test_yandex_metrika_atomic_writer -v`

Expected: FAIL with missing modules/functions.

- [ ] **Step 3: Implement minimal release and writer modules**

Use parameterized SQL only. `_delete_release_day` is restricted by `canonical_release_id`, exact `counter_id`, and exact `report_date`. `publish_metrika_day_bundle` calls `require_mutable_candidate_release` before opening the transaction and writes five success coverage rows only after every fact insert succeeds.

- [ ] **Step 4: Run GREEN**

Run: `python -m unittest tests.test_canonical_release_store tests.test_yandex_metrika_atomic_writer -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add canonical_release_store.py canonical_writer.py tests/test_canonical_release_store.py tests/test_yandex_metrika_atomic_writer.py
git commit -m "feat: publish Abbott Metrika days atomically"
```

### Task 3: Pagination evidence, five-scope day bundles, and returned facts

**Files:**
- Modify: `metrika_pagination.py`
- Modify: `fetch_yandex_metrika_canonical.py`
- Modify: `tests/test_metrika_pagination.py`
- Create: `tests/test_yandex_metrika_day_bundle.py`
- Create: `tests/test_yandex_metrika_returning.py`

**Interfaces:**

```python
@dataclass(frozen=True)
class PaginationResult:
    rows: tuple[dict, ...]
    total_rows: int
    pages_fetched: int
    pagination_complete: bool
    sampled: bool
    sample_share: float | None

@dataclass(frozen=True)
class MetrikaScopeResult:
    scope: str
    rows: tuple[dict, ...]
    api_total_rows: int
    persisted_rows: int
    sampled: bool
    sample_share: float | None
    pagination_complete: bool
    status: str
    request_fingerprint: str

@dataclass(frozen=True)
class MetrikaDayBundle:
    canonical_release_id: int
    counter_id: str
    report_date: str
    run_id: int
    scopes: Mapping[str, MetrikaScopeResult]
```

- [ ] **Step 1: Add failing pagination tests**

Cover stable `total_rows`, sampling metadata, changed totals, short page before reported total, and compatibility of `collect_all_rows()`.

- [ ] **Step 2: Run pagination RED, implement `collect_all_pages`, then run GREEN**

Run before and after: `python -m unittest tests.test_metrika_pagination -v`

Expected before: missing `collect_all_pages`; expected after: PASS.

- [ ] **Step 3: Add failing bundle and returned tests**

Assert Abbott requires exactly the five scopes, `403`/sampling/incomplete pagination prevents publication, `success_empty` requires API total zero, raw returning URL is preserved separately from normalized URL, and three buckets are created without persisted rounded counts.

- [ ] **Step 4: Run bundle RED**

Run: `python -m unittest tests.test_yandex_metrika_day_bundle tests.test_yandex_metrika_returning -v`

Expected: FAIL because the new types/functions are absent.

- [ ] **Step 5: Implement the daily collector path**

Add constants:

```python
ABBOTT_COUNTER_ID = "90602537"
ABBOTT_REQUIRED_SCOPES = ("other", "traffic", "page", "user_behavior", "returning")
RETURN_BUCKETS = ("next_day", "days_2_7", "days_8_31")
```

`collect_metrika_day` stages all scopes before calling `publish_metrika_day_bundle`. Remove runtime DDL and range delete calls from the release path. Other counters retain the existing compatibility path until a separate migration.

- [ ] **Step 6: Run GREEN and existing regression tests**

Run: `python -m unittest tests.test_metrika_pagination tests.test_yandex_metrika_day_bundle tests.test_yandex_metrika_returning -v`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add metrika_pagination.py fetch_yandex_metrika_canonical.py tests/test_metrika_pagination.py tests/test_yandex_metrika_day_bundle.py tests/test_yandex_metrika_returning.py
git commit -m "feat: collect complete Abbott Metrika day bundles"
```

### Task 4: Frozen baseline, comparator, and 2026 backfill runner

**Files:**
- Create: `abbott_canonical_controls.py`
- Create: `capture_abbott_canonical_baseline.py`
- Create: `compare_abbott_canonical_release.py`
- Create: `backfill_abbott_metrika_2026.py`
- Create: `tests/test_abbott_canonical_controls.py`
- Create: `tests/test_abbott_metrika_backfill_2026.py`

**Interfaces:**

```python
def stable_json_hash(value: Any) -> str: ...
def file_snapshot(path: Path, *, source_kind: str, parser_version: str) -> dict: ...
def api_fingerprint(*, dimensions: Sequence[str], metrics: Sequence[str], filters: str,
                    attribution: str, accuracy: str, pagination_limit: int, timezone: str) -> str: ...
def capture_current_control_pack(conn, *, counter_id: str, date_from: str, date_to: str,
                                 private_archive_dir: Path, code_revision: str) -> int: ...
def compare_release_control_pack(conn, *, baseline_run_id: int,
                                 candidate_release_id: int) -> list["ControlResult"]: ...
def build_backfill_windows(today_utc: date) -> list[tuple[str, str]]: ...
```

- [ ] **Step 1: Write failing control/backfill tests**

Assert fingerprints change for metrics/filters/attribution/accuracy/timezone, baseline freeze is immutable, API delta over 1% fails, unapproved warning blocks cutover, diagnostics reject raw identifiers/paths, windows start `2026-01-01`, and resume skips a day only when all five coverage rows are reconciled.

- [ ] **Step 2: Run RED**

Run: `python -m unittest tests.test_abbott_canonical_controls tests.test_abbott_metrika_backfill_2026 -v`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement pure controls and CLI orchestration**

The backfill CLI requires `--canonical-release-id`, fixes counter to `90602537`, processes `2026-03-29..2026-04-07` first but still collects all five scopes, and never activates the release. Baseline files are read only from explicit paths and raw evidence is written to a caller-supplied private directory with mode `0700/0600`.

- [ ] **Step 4: Run GREEN**

Run: `python -m unittest tests.test_abbott_canonical_controls tests.test_abbott_metrika_backfill_2026 -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add abbott_canonical_controls.py capture_abbott_canonical_baseline.py compare_abbott_canonical_release.py backfill_abbott_metrika_2026.py tests/test_abbott_canonical_controls.py tests/test_abbott_metrika_backfill_2026.py
git commit -m "feat: add Abbott canonical migration controls"
```

### Task 5: Fail-closed Abbott auth and audience-bearing sessions

**Repository:** `dashboard-next`

**Files:**
- Create: `src/lib/dashboard-access-policy.ts`
- Create: `src/lib/dashboard-access-policy.test.ts`
- Modify: `src/lib/dashboard-access.ts`
- Modify: `src/lib/access-auth.ts`
- Create: `src/lib/access-auth.test.ts`
- Modify: `src/app/api/dashboard-auth/login/route.ts`

**Interfaces:**

```typescript
export type DashboardAudience = "manager" | "embed";
export function resolveDashboardAuthMode(clientId: string, activeUsers: number,
  hasSharedPassword: boolean): DashboardAuthMode;
export function resolveDashboardAudience(reason: "authorized" | "embed_key"): DashboardAudience;
export function createViewerSession(dashboardId: number, email: string,
  audience: DashboardAudience): string;
```

- [ ] **Step 1: Write failing policy/session tests**

```typescript
test("Abbott never resolves public", () => {
  assert.equal(resolveDashboardAuthMode("abbott", 0, false), "password_only");
});
test("embed and manager audiences survive signed sessions", () => {
  const token = createViewerSession(18, "manager@example.test", "manager");
  assert.equal(verifyViewerSession(token, 18)?.audience, "manager");
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/lib/dashboard-access-policy.test.ts src/lib/access-auth.test.ts`

Expected: FAIL with missing policy/audience signatures.

- [ ] **Step 3: Implement minimal fail-closed policy**

Abbott without a configured shared password remains `password_only`, causing credential verification to fail and API access to return `401`; it never becomes public. Signed dashboard tokens require audience. Portal sessions keep their existing type.

- [ ] **Step 4: Run GREEN and typecheck**

Run: `npm test -- src/lib/dashboard-access-policy.test.ts src/lib/access-auth.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit in `dashboard-next`**

```bash
git add src/lib/dashboard-access-policy.ts src/lib/dashboard-access-policy.test.ts src/lib/dashboard-access.ts src/lib/access-auth.ts src/lib/access-auth.test.ts src/app/api/dashboard-auth/login/route.ts
git commit -m "fix: make Abbott access fail closed"
```

### Task 6: Manager/private and embed/aggregate projections

**Repository:** `dashboard-next`

**Files:**
- Create: `src/lib/abbott-data-projection.ts`
- Create: `src/lib/abbott-data-projection.test.ts`
- Modify: `src/app/api/dashboard/[id]/route.ts`
- Modify: `src/app/api/dashboard/[id]/excel/route.ts`
- Modify: `src/app/api/dashboard/[id]/pdf/route.ts`
- Modify: `src/app/api/dashboard/[id]/ai-summary/generate/route.ts`

**Interfaces:**

```typescript
export function projectAbbottDashboardData(
  data: DashboardData,
  audience: "manager" | "embed",
): DashboardData;
```

- [ ] **Step 1: Write failing projection tests**

Manager projection retains `user_id` and row-level paths but strips URL query/fragment values; embed projection removes `user_id`, session IDs, `user_actions`, and journey rows while retaining traffic/page/material/returning aggregates. A recursive forbidden-key assertion covers embed output.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/lib/abbott-data-projection.test.ts`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement the pure projection and apply it server-side**

Each protected route consumes `access.audience`; `GET` responses set `Cache-Control: private, no-store`. PDF export tokens preserve the caller audience. Error responses remain sanitized and do not return exception details.

- [ ] **Step 4: Run GREEN and route regression suite**

Run: `npm test -- src/lib/abbott-data-projection.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/abbott-data-projection.ts src/lib/abbott-data-projection.test.ts src/app/api/dashboard/[id]/route.ts src/app/api/dashboard/[id]/excel/route.ts src/app/api/dashboard/[id]/pdf/route.ts src/app/api/dashboard/[id]/ai-summary/generate/route.ts
git commit -m "feat: isolate Abbott manager and embed data"
```

### Task 7: DB-native Abbott workbook/Bitrix store and importer

**Repository:** `dashboard-next`

**Files:**
- Create: `src/lib/abbott-private-types.ts`
- Create: `src/lib/abbott-private-store.ts`
- Create: `src/lib/abbott-private-store.test.ts`
- Create: `scripts/import-abbott-private-data.ts`
- Create: `scripts/import-abbott-private-data.test.ts`
- Modify: `src/lib/abbott-bi.ts`
- Modify: `src/lib/dashboard-data-loader.ts`
- Modify: `scripts/build_abbott_bitrix_analytics.py`
- Modify: `scripts/build_abbott_bitrix_session_journeys.py`

**Interfaces:**

```typescript
export async function loadActiveAbbottWorkbookData(dashboardId: number): Promise<ParsedAbbottWorkbook>;
export async function loadActiveAbbottBitrixAnalytics(dashboardId: number): Promise<ParsedBitrixAnalytics>;
export async function loadActiveAbbottSessionJourneys(dashboardId: number): Promise<AbbottBiSessionJourneysData>;
export async function loadAbbottBiData(dashboardId: number, counterIds: string[],
  from: string, to: string): Promise<AbbottBiData>;
```

- [ ] **Step 1: Write failing store/import normalization tests**

Tests assert exact active snapshot selection, missing required workbook fails closed, optional Bitrix returns labeled empty test data, importer removes URL query/fragment, preserves raw `UserID` only in private rows, rejects duplicates, and repeated checksum is idempotent.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/lib/abbott-private-store.test.ts scripts/import-abbott-private-data.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement parameterized private store and transactional importer**

Use separate server-only pools: embed uses `ABBOTT_EMBED_DB_*` with `ABBOTT_EMBED_DB_NAME=report_bd`, while manager uses `ABBOTT_PRIVATE_DB_*` with `ABBOTT_PRIVATE_DB_NAME=report_bd_private`. Import CLI accepts only explicit paths. It creates a staging snapshot, validates counts/fingerprints, then retires/activates snapshots in one transaction; failure leaves the previous active snapshot untouched.

- [ ] **Step 4: Switch Abbott loader from filesystem to DB**

Remove `fs/path/xlsx` asset candidates and on-demand returning API from `abbott-bi.ts`. Query the active canonical release and counter-scoped returning table. Do not retain `COUNT(*) > 0` or catch-to-legacy branches for dates on/after `2026-01-01`.

- [ ] **Step 5: Run GREEN and Abbott regressions**

Run: `npm test -- src/lib/abbott-private-store.test.ts scripts/import-abbott-private-data.test.ts src/components/abbott-summary.test.ts src/components/abbott-page-stats.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/abbott-private-types.ts src/lib/abbott-private-store.ts src/lib/abbott-private-store.test.ts scripts/import-abbott-private-data.ts scripts/import-abbott-private-data.test.ts src/lib/abbott-bi.ts src/lib/dashboard-data-loader.ts scripts/build_abbott_bitrix_analytics.py scripts/build_abbott_bitrix_session_journeys.py
git commit -m "feat: load Abbott private data from database"
```

### Task 8: Current-month default and private-asset release guard

**Repository:** `dashboard-next`

**Files:**
- Modify: `src/app/dashboard/[id]/page.tsx`
- Create: `src/lib/abbott-date-range.ts`
- Create: `src/lib/abbott-date-range.test.ts`
- Create: `src/lib/release-asset-policy.ts`
- Create: `src/lib/release-asset-policy.test.ts`
- Create: `scripts/assert-no-private-public-assets.ts`
- Modify: `scripts/render-production-env.sh`
- Create: `scripts/validate-production-release.sh`
- Create: `scripts/render-production-env.test.sh`
- Create: `scripts/validate-production-release.test.sh`
- Modify: `package.json`
- Modify: `scripts/deploy.sh`
- Modify: `.gitignore`
- Delete: `public/abbott/Abbott names.xlsx`
- Delete: `public/abbott/abbott-workbook.json`
- Delete: `public/abbott/bitrix-analytics.json`
- Delete: `public/abbott/bitrix-session-journeys.json`

- [ ] **Step 1: Write failing date and release-policy tests**

```typescript
test("Abbott defaults to current month through yesterday", () => {
  assert.deepEqual(defaultAbbottRange(new Date("2026-07-16T12:00:00+02:00")),
    { from: "2026-07-01", to: "2026-07-15" });
});
```

Policy tests create a temporary public tree and reject case-insensitive Abbott `.json`, `.xlsx`, `.xls`, `.csv`, `.sql`, and archives while allowing ordinary images.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/lib/abbott-date-range.test.ts src/lib/release-asset-policy.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement date helper, guard, and UI default**

`defaultAbbottRange` uses the configured business timezone and returns current calendar month through yesterday. Add `security:public-assets` and place it before build in `ci:verify`; deploy runs it before packaging and against standalone output before upload. Production env rendering requires non-empty `ABBOTT_DASHBOARD_PASSWORD`, `ABBOTT_DASHBOARD_EMBED_KEY`, `METRIKA_TOKEN`, all `ABBOTT_EMBED_DB_*`, and all `ABBOTT_PRIVATE_DB_*` connection keys without printing their values. `validate-production-release.sh` verifies required key names and exact database names and rejects a staged `public/abbott` directory before any upload.

- [ ] **Step 4: Remove tracked assets and verify GREEN**

Run: `npm test -- src/lib/abbott-date-range.test.ts src/lib/release-asset-policy.test.ts && bash scripts/render-production-env.test.sh && bash scripts/validate-production-release.test.sh && npm run security:public-assets && npm run typecheck`

Expected: PASS and no Abbott source files under `public/`.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/[id]/page.tsx src/lib/abbott-date-range.ts src/lib/abbott-date-range.test.ts src/lib/release-asset-policy.ts src/lib/release-asset-policy.test.ts scripts/assert-no-private-public-assets.ts scripts/render-production-env.sh scripts/validate-production-release.sh scripts/render-production-env.test.sh scripts/validate-production-release.test.sh package.json scripts/deploy.sh .gitignore public/abbott
git commit -m "fix: remove Abbott private assets from public release"
```

### Task 9: Generic Metrika health, Abbott probe, Telegram, and Hermes adapter

**Files:**
- Modify: `sources_health_dashboard.py`
- Create: `abbott_health_probe.py`
- Modify: `send_canonical_telegram_report.py`
- Create: `ops/hermes/abbott_health_prompt_input.py`
- Create: `ops/hermes/abbott-health-prompt.txt`
- Create: `tests/test_sources_health_dashboard.py`
- Create: `tests/test_abbott_health_probe.py`
- Create: `tests/test_send_canonical_telegram_report.py`
- Create: `tests/test_hermes_abbott_health_prompt_input.py`

**Interfaces:**

```python
def collect_snapshot(cur, today: date, counter_id: str) -> dict: ...
def evaluate_snapshot(snapshot: dict) -> list[dict]: ...
def sanitize_snapshot(snapshot: dict) -> dict: ...
def build_abbott_lines(snapshot: dict) -> list[str]: ...
def validate_payload(payload: dict) -> dict: ...
```

- [ ] **Step 1: Write failing source-health/probe tests**

Assert generic `yandex_metrika` queries site analytics and is non-blocking; Abbott probe uses exact counter, detects missing date/scope and skipped counter, and sanitized JSON rejects `user_id`, path fields, `?`, tokens, passwords, and DSNs.

- [ ] **Step 2: Run RED, implement health/probe, run GREEN**

Run before and after: `python -m unittest tests.test_sources_health_dashboard tests.test_abbott_health_probe -v`

- [ ] **Step 3: Write failing Telegram/Hermes tests**

Assert summary order includes Metrika, Abbott critical triggers alert, messages escape incident text, Hermes rejects unknown keys recursively, and SSH is invoked as an argument list without `shell=True`.

- [ ] **Step 4: Run RED, implement consumers, run GREEN**

Run before and after: `python -m unittest tests.test_send_canonical_telegram_report tests.test_hermes_abbott_health_prompt_input -v`

- [ ] **Step 5: Commit**

```bash
git add sources_health_dashboard.py abbott_health_probe.py send_canonical_telegram_report.py ops/hermes tests/test_sources_health_dashboard.py tests/test_abbott_health_probe.py tests/test_send_canonical_telegram_report.py tests/test_hermes_abbott_health_prompt_input.py
git commit -m "feat: monitor Abbott Metrika coverage"
```

### Task 10: Legacy secret cleanup, synchronized runtime copies, and runbooks

**Files:**
- Modify: `nest-second/src/services/metrika/metrika.service.ts`
- Create: `nest-second/src/auth/legacy-trigger.guard.ts`
- Create: `nest-second/src/auth/legacy-trigger.guard.spec.ts`
- Modify: legacy trigger controllers/services under `nest-second/src/launch` and `nest-second/src/services`
- Synchronize: `dashboard-next/reportingdash-canonical-bootstrap/collectors/fetch_yandex_metrika_canonical.py`
- Synchronize: `dashboard-next/reportingdash-canonical-bootstrap/lib/canonical_writer.py`
- Create: `dashboard-next/reportingdash-canonical-bootstrap/lib/canonical_release_store.py`
- Modify: `dashboard-next/reportingdash-canonical-bootstrap/MIGRATION-MANIFEST.md`
- Modify: `dashboard-next/AGENTS.md`
- Modify: `dashboard-next/DASHBOARDS-MEMORY.md`
- Modify: `dashboard-next/PLATFORMS-ACCESS-MEMORY.md`
- Create: `docs/ABBOTT-OPERATIONS-RUNBOOK.md`

- [ ] **Step 1: Write failing Nest guard tests**

Correct `x-internal-token` passes using timing-safe comparison; missing/wrong token returns unauthorized; missing `LEGACY_LAUNCH_SECRET` fails closed; exceptions contain no supplied value.

- [ ] **Step 2: Run RED, implement guard, remove committed OAuth literals, run GREEN**

Run from `nest-second`: `npm test -- --runInBand legacy-trigger.guard.spec.ts`

Then run: `rg -n "secret !==|'y0_|\"y0_|OAuth [A-Za-z0-9_-]{20,}" src`

Expected: no committed secret literals.

- [ ] **Step 3: Synchronize canonical bootstrap and write exact rollout/rollback runbook**

Runbook records baseline capture, private import, migrations, candidate creation, backfill, comparator, atomic activation, rollback pointer, removal of duplicate `/metrika` cron, `07:10` summary, Yandex owner token issuance/revocation, and deferred Hermes creation. Commands read values from documented environment variables or mode-600 files and never include secret values.

- [ ] **Step 4: Commit nested repositories and root gitlinks**

```bash
git -C nest-second add src
git -C nest-second commit -m "fix: remove legacy collector secrets"
git -C dashboard-next add reportingdash-canonical-bootstrap AGENTS.md DASHBOARDS-MEMORY.md PLATFORMS-ACCESS-MEMORY.md
git -C dashboard-next commit -m "docs: document Abbott canonical operations"
git add nest-second dashboard-next docs/ABBOTT-OPERATIONS-RUNBOOK.md
git commit -m "chore: package Abbott canonical rollout"
```

### Task 11: Full verification and review package

**Files:**
- Modify only files required by concrete verification failures, each with a reproducing failing test first.

- [ ] **Step 1: Run root verification**

```bash
python -m unittest discover -s tests -p 'test_*.py' -v
python -m py_compile canonical_release_store.py fetch_yandex_metrika_canonical.py abbott_canonical_controls.py backfill_abbott_metrika_2026.py sources_health_dashboard.py abbott_health_probe.py send_canonical_telegram_report.py ops/hermes/abbott_health_prompt_input.py
```

- [ ] **Step 2: Run dashboard verification**

```bash
cd dashboard-next
npm test
npm run security:public-assets
npm run lint
npm run typecheck
npm run build
```

- [ ] **Step 3: Run legacy verification and scans**

```bash
cd nest-second
npm test -- --runInBand
npm run build
cd ..
rg -n "y0_[A-Za-z0-9_-]{20,}|Terasic1!|LEGACY_LAUNCH_SECRET=.*[^>]" --glob '!docs/superpowers/**' .
```

- [ ] **Step 4: Verify requirements and produce final review package**

Compare the branch line-by-line with the design sections: privacy, release controls, five-scope atomicity, baseline, 2026 backfill, no fallback, current-month default, monitoring, secrets, and rollback. Generate a merge-base review package and obtain a whole-branch spec/code-quality review before proposing integration.
