# Abbott `file://` Visit Exclusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every local-file visit from the active Abbott read model through an audited successor release and prevent future `file://` visits from entering canonical visit facts.

**Architecture:** Filter invalid local-file visits at the Metrika Logs TSV parser boundary, before canonical evidence counts are formed. Build a DB-native successor from the immutable active release by copying all release-scoped facts and frozen source bindings, excluding only visits whose start or end URL uses `file://`; validate aggregate parity, activate with compare-and-swap, and preserve release 13 for rollback.

**Tech Stack:** Python 3, `unittest`, MySQL 8, Abbott canonical release operator, canonical control packs.

## Global Constraints

- Do not update or delete rows belonging to active release 13.
- Do not call the Yandex Metrika API and do not run a backfill.
- Do not print URL values, User IDs, visit IDs, credentials, tokens, or private paths.
- Exclude all visits where either start URL or end URL begins with `file://`, case-insensitively.
- Preserve Reports API aggregates, returning facts, source coverage, source snapshots, and other dashboards unchanged.
- Cutover only after exact count, coverage, session-integrity, comparison, manager/embed smoke, and rollback checks pass.

---

### Task 1: Filter future local-file visits at the Logs boundary

**Files:**
- Modify: `metrika_logs_api.py`
- Test: `tests/test_metrika_logs_api.py`

**Interfaces:**
- Consumes: TSV rows already validated by `parse_visits_tsv(payload, expected_day=...)`.
- Produces: a tuple containing only non-`file://` visits while retaining duplicate-ID and malformed-row rejection.

- [x] Add a parser test containing one normal visit, one `file://` start URL, and one mixed-case `FILE://` end URL; assert only the normal visit remains.
- [x] Run `python3 -m unittest tests.test_metrika_logs_api` and verify the new test fails because three visits are returned.
- [x] Add a private predicate that detects `file://` case-insensitively and skip the validated visit after duplicate tracking but before result append.
- [x] Run the focused test and the Abbott day-bundle tests; require zero failures.
- [x] Commit the collector change.

### Task 2: Add an audited DB-native successor materializer

**Files:**
- Create: `sanitize_abbott_file_url_release.py`
- Create: `tests/test_sanitize_abbott_file_url_release.py`

**Interfaces:**
- Consumes: predecessor release ID, committed code revision, operator/writer connections, and an explicit apply flag.
- Produces: one staging successor containing release-equivalent data except for local-file visits, a frozen control baseline, source-import receipts, adjusted user-behavior coverage counts, and aggregate-only sanitation evidence.

- [x] Add fail-closed pointer, predecessor, candidate, and exact source-set checks before copying.
- [x] Write a failing test proving visit copy SQL contains a case-insensitive exclusion for both start and end URLs while every other release-scoped copy remains unfiltered.
- [x] Bind candidate source IDs and source-import receipts to the new code revision without mutating predecessor rows.
- [x] Reconcile user-behavior `persisted_rows` to successor per-day visit counts and reject any remaining local-file visit.
- [x] Implement the explicit table inventory, transaction, dry-run preflight, exact frozen-source gate, source binding, coverage reconciliation, and health-visible sanitation receipt.
- [x] Run the focused successor tests and release-store/control/health tests; 114 tests pass.
- [x] Commit the materializer.

### Task 3: Verify code and freeze the production checkpoint

**Files:**
- Modify only if tests require it: `ops/abbott-runtime-manifest.sha256`

**Interfaces:**
- Consumes: committed collector/materializer revision.
- Produces: a clean reviewed branch plus aggregate-only pre-cutover evidence.

- [ ] Run the full Python suite and confirm zero failures.
- [x] Verify the branch diff contains only Abbott collector, successor tooling, tests, plan, runtime attestation, and the minimal health-role grant.
- [x] Independently review the diff for data-plane isolation and secret/PII safety.
- [x] On production, assert active release 13 and capture aggregate-only counts for all release-scoped tables, 18 local-file visits, coverage dates, and session integrity.
- [x] Confirm runtime paths and deploy the committed collector files through the attested runtime; update only the Abbott cron revision after successful cutover.

### Task 4: Materialize and validate the successor without API calls

**Files:** None beyond Task 2.

**Interfaces:**
- Consumes: active release 13 and the committed sanitation revision.
- Produces: one validated staging successor ready for atomic activation.

- [x] Reuse frozen baseline 27 for the exact `2026-01-01..2026-08-07` completed-day range and verify both immutable source fingerprints.
- [x] Create successor release 14 with predecessor 13 and frozen baseline 27.
- [x] Hold `/run/lock/reportingdash-metrika.lock` from the final predecessor max-date check through materialization, comparison, validation, activation, and smoke so cron cannot append across the cutover.
- [x] Run the materializer once; the receipt makes reruns fail closed.
- [x] Assert successor visit count is `111133 = 111151 - 18` and contains zero `file://` rows.
- [x] Assert every other copied table count matches release 13 and returning aggregates match exactly.
- [x] Assert exactly five valid coverage rows on each of 219 days (1095 rows) and `user_behavior.persisted_rows` equals successor visit counts.
- [x] Run the canonical release comparator; every control passed.
- [x] Run release validation; release 14 reached `validated` status.

### Task 5: Activate, smoke-test, and retain rollback

**Files:** None.

**Interfaces:**
- Consumes: validated successor and expected active release 13.
- Produces: active sanitized release and an intact retired release 13 rollback target.

- [x] Activate through the release operator compare-and-swap with expected active release 13.
- [x] Verify active pointer/status, health, five-scope coverage, traffic session integrity, authenticated manager rendering, and manager/private boundaries.
- [x] Verify the live user-actions response for `2026-08-01..2026-08-07` contains no `file://` value; the active private fact also contains zero such rows for the full release period.
- [x] Verify cron retains the approved schedule and references runtime/code revision `42122ddecf37f89d120ac3ae639d36f9739805e5` twice on its Abbott line.
- [x] Exercise automatic pointer/cron rollback on two smoke-gate failures before the final successful activation; public PII was never restored.
- [x] Record final aggregate result: active release 14, 111133 visits, 18 excluded, 0 remaining local-file visits, health OK.
