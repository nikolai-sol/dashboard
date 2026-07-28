# RD-13/RD-15/RD-16 Runtime Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the production runtime with repository code, make RD-11 source-specific, and prevent Zaruku collectors from requesting dates newer than each source can publish.

**Architecture:** Production inventory is derived only from active crontab entries and does not mutate remote state. Each collector owns explicit `COLLECTION_FLOOR_DAYS` and `RECOLLECT_SPAN_DAYS` constants so a one-file runtime deployment remains self-contained; default and explicit windows are clipped before any source API call. RD-11 normalizes GSC core/optional state in `zaruku_collector_health.py` and renders partial dates under their owning source.

**Tech Stack:** Python 3, `unittest`, MySQL read-only diagnostics, SSH/SCP operational rollout.

## Global Constraints

- Do not run collectors or backfills.
- Do not change cron, environment files, schema, or secrets.
- RD-16 §1 may replace only `/root/reportingdash-canonical/fetch_gsc_canonical.py` after a clean diff and dated backup.
- `--layers optional` remains gated on the successful scheduled GSC cron on 2026-07-29 at 06:55.
- Unknown HTTP 400 responses remain fatal; only dates excluded by the configured collection floor are skipped.

---

### Task 1: Synchronize the active GSC runtime

**Files:**
- Source: `fetch_gsc_canonical.py`
- Remote target: `/root/reportingdash-canonical/fetch_gsc_canonical.py`

**Interfaces:**
- Consumes: active crontab path and repository `HEAD`.
- Produces: byte-identical runtime file with a dated recoverable backup.

- [x] **Step 1: Diff runtime against the repository and verify it is exact commit `2a20347` with no runtime-only lines.**
- [x] **Step 2: Compile the staged file with the runtime venv.**
- [x] **Step 3: Back up the old file under `/root/reportingdash-canonical/backups/rd16-<UTC timestamp>/`.**
- [x] **Step 4: Atomically replace the runtime file and verify SHA-256 and mode.**
- [x] **Step 5: Stop without a forced collector run.**

### Task 2: Inventory runtime paths from active crontab

**Files:**
- Read-only remote input: root crontab and every explicitly invoked script, wrapper, collector, manifest, interpreter, and environment file.

**Interfaces:**
- Consumes: active non-comment crontab lines.
- Produces: classification of each path as repository match, repository diff, production-only, or external/system-owned, plus interpreter and environment provenance.

- [x] **Step 1: Parse active crontab and identify the three ReportingDash runtime roots.**
- [x] **Step 2: Resolve relative scripts against each `cd` and resolve the Webmaster wrapper to its collector and interpreter.**
- [x] **Step 3: Compare every repository-owned invoked file by SHA-256 and content diff.**
- [x] **Step 4: Record environment precedence without reading secret values.**
- [x] **Step 5: Publish the inventory classification in the completion report.**

### Task 3: Make RD-11 source-specific and core/optional-aware

**Files:**
- Modify: `zaruku_collector_health.py`
- Modify: `send_canonical_telegram_report.py`
- Test: `tests/test_zaruku_collector_health.py`
- Test: `tests/test_send_canonical_telegram_report.py`

**Interfaces:**
- Produces: health rows with `core_status`, `optional_status`, `optional_failure_count`, and `optional_http_statuses`.
- Consumes: `canonical_collector_runs.status`, `error_count`, and sanitized `error_summary`.

- [x] **Step 1: Add failing health tests for GSC `partial` → core success plus optional HTTP status/count normalization.**
- [x] **Step 2: Add failing Telegram tests requiring source labels on partial-date lines and explicit GSC core/optional copy.**
- [x] **Step 3: Run both test modules and confirm failures are caused by the missing normalized fields/copy.**
- [x] **Step 4: Implement minimal normalization in `load_zaruku_health`; malformed summaries expose an unknown optional failure, never raw text.**
- [x] **Step 5: Render each `partial_scope.sources` entry with its source label and render GSC partial as `core=SUCCESS; optional=HTTP 400` rather than a bare `PARTIAL`.**
- [x] **Step 6: Run both modules and the existing RD-11 profile tests to green.**
- [x] **Step 7: Commit the independently testable RD-11 change.**

### Task 4: Clip collection windows before source API calls

**Files:**
- Modify: `fetch_yandex_webmaster_canonical.py`
- Modify: `fetch_yandex_metrika_canonical.py`
- Modify: `fetch_yandex_metrika_returning_canonical.py`
- Modify: `fetch_gsc_canonical.py`
- Test: `tests/test_fetch_yandex_webmaster_canonical.py`
- Test: `tests/test_fetch_yandex_metrika_canonical.py`
- Test: `tests/test_fetch_yandex_metrika_returning_canonical.py`
- Test: `tests/test_fetch_gsc_canonical.py`

**Interfaces:**
- Produces per source: `COLLECTION_FLOOR_DAYS` and `RECOLLECT_SPAN_DAYS` plus deterministic date selection.
- Policies: Webmaster `2/3`, Metrika `1/2`, returning content `1/3`, GSC `3/3` (`floor/span`).

- [x] **Step 1: Add failing date-window tests proving the newest selected dates are `anchor−2`, `anchor−1`, `anchor−1`, and `anchor−3` respectively.**
- [x] **Step 2: Add failing explicit-range tests proving dates newer than the source floor are removed before `start_run` or an API function can be called.**
- [x] **Step 3: Run the four focused modules and verify RED failures against the current yesterday-based windows.**
- [x] **Step 4: Add self-contained floor/span constants and minimal window clipping to each collector, preserving historical explicit dates and existing CLI names.**
- [x] **Step 5: Return a sanitized skipped-window result when no requested date is collectable; do not create a run row and do not call an API.**
- [x] **Step 6: Keep any HTTP 400 for an included date fatal because the historical response body was not retained and cannot be safely classified.**
- [x] **Step 7: Run focused tests, `py_compile`, and the full Zaruku collector profile.**
- [x] **Step 8: Commit the independently testable RD-15 change.**

### Task 5: Hold the optional-only GSC backfill gate

**Files:**
- Future modify: `fetch_gsc_canonical.py`
- Future test: `tests/test_fetch_gsc_canonical.py`

- [ ] **Step 1: On 2026-07-29 after 06:55, verify the scheduled GSC run has `status=success` and `error_count=0`.**
- [ ] **Step 2: Only after that gate, design `--layers optional` so query/core upserts are unreachable in optional mode.**
- [ ] **Step 3: Do not implement or execute this task in the current session.**
