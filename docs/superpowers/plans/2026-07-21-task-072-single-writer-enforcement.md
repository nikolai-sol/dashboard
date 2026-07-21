# TASK-072 Single-Writer Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce one writer for Zaruku Webmaster, Metrika, and GSC facts and expose optional GSC failures in collector telemetry.

**Architecture:** Canonical daily collectors remain authoritative. Legacy writers are disabled or removed after coverage checks; deprecated tables remain as explicitly marked read-only historical storage; GSC optional-layer issues produce a partial collector run while core facts commit normally.

**Tech Stack:** Node.js, Python unittest, MySQL 8, root cron, Next.js read-model tests, Notion operational documentation.

## Global Constraints

- Preserve unrelated dirty files in ReportingDash, dashboard-next, and telegatask.
- No destructive table drop; use table comments for deprecated tables.
- Back up crontab and legacy GSC rows before production mutation.
- Canonical GSC contract does not require legacy `property_url`.
- Use TDD for code behavior changes.

---

### Task 1: Baseline and writer inventory

**Files:**
- Read: `dashboard-next/scripts/collect-yandex-webmaster.js`
- Read: `fetch_gsc_canonical.py`
- Read: production root crontab and MySQL metadata

**Interfaces:**
- Consumes: TASK-072 Notion scope.
- Produces: exact writer list, counts, coverage proof, and rollback paths used by later tasks.

- [ ] Record runtime grep for all three deprecated tables and all GSC query-table writers.
- [ ] Record canonical/legacy GSC counts, date ranges, business-key overlaps, and canonical coverage of legacy dates.
- [ ] Record legacy Metrika target and canonical scope/date coverage for account `66624469`.
- [ ] Save root crontab and identify the exact single line to remove.

### Task 2: Disable the legacy Webmaster weekly writer

**Files:**
- Modify: `dashboard-next/scripts/collect-yandex-webmaster.js`
- Modify: `dashboard-next/scripts/collect-yandex-webmaster.test.ts`

**Interfaces:**
- Produces: runtime that returns an explicit canonical-owner skip and performs no legacy-table DML.

- [ ] Add a failing source/runtime test proving no DML references to `seo_webmaster_queries_weekly` or `seo_webmaster_pages_weekly` remain.
- [ ] Run the targeted Node test and confirm the expected failure.
- [ ] Remove/disable the database writer path and return a clear deprecated/canonical-owner result.
- [ ] Run the targeted test and the full dashboard test suite.

### Task 3: Surface GSC optional-layer failures

**Files:**
- Modify: `tests/test_fetch_gsc_canonical.py`
- Modify: `fetch_gsc_canonical.py`

**Interfaces:**
- Produces: structured optional-layer issue collection and `partial` run completion.

- [ ] Add failing tests for tolerated 400/403 issue capture and partial final status.
- [ ] Run `python3 -m unittest tests.test_fetch_gsc_canonical -v` and confirm failure.
- [ ] Implement issue capture without changing mandatory query failure behavior.
- [ ] Finish the run as `partial` when issues exist and include error_count/error_summary.
- [ ] Re-run unit tests and `python3 -m py_compile fetch_gsc_canonical.py`.

### Task 4: Mark deprecated tables

**Files:**
- Create: `dashboard-next/src/db/migrations/038_task_072_deprecate_legacy_seo_tables.sql`
- Modify: canonical entity memory files.

**Interfaces:**
- Produces: repeatable table comments for the three historical contracts.

- [ ] Add migration SQL with explicit `ALTER TABLE ... COMMENT` statements.
- [ ] Run migration locally/production after confirming tables exist.
- [ ] Query `information_schema.TABLES` and verify all three comments.

### Task 5: Normalize GSC lineage

**Files:**
- Create: production backup artifact under `/root/reportingdash-canonical/backups/task-072/`.
- Modify: production rows in `canonical_fact_gsc_queries_daily` with a guarded, scoped source-key relabel only.

**Interfaces:**
- Produces: one lineage (`google_search_console`) in the canonical table and a rollback SQL dump.

- [ ] Dump only `analytics_account_id='66624469' AND source_key='seo_os'` rows.
- [ ] Verify backup row count and metric signature equal the live legacy-labelled rows.
- [ ] Relabel only the backed-up rows to `source_key='google_search_console'` in one transaction; do not delete the three covered dates.
- [ ] Verify zero legacy rows, canonical date coverage, business-key uniqueness, and dashboard payload availability.

### Task 6: Remove legacy Metrika cron

**Files:**
- Modify: production root crontab only after coverage proof.
- Preserve: `/root/reportingdash-canonical/backups/task-072/root-crontab-before.txt`.

**Interfaces:**
- Produces: canonical Metrika as the only scheduled writer.

- [ ] Install a crontab with only the exact legacy `/metrika` bridge line removed.
- [ ] Verify canonical `06:12` and returning `06:18` entries remain.
- [ ] Verify no other root cron lines changed.

### Task 7: Deploy, document, and verify

**Files:**
- Modify: `dashboard-next/AGENTS.md`
- Modify: root and dashboard platform/canonical memory files without overwriting unrelated edits.
- Modify: Notion TASK-072 status/result section.

**Interfaces:**
- Produces: deployed code, accurate memory, and an evidence-backed completion record.

- [ ] Deploy the GSC collector with a server-side backup and checksum verification.
- [ ] Deploy the dashboard script/migration through the normal dashboard release or scoped runtime copy as appropriate.
- [ ] Run a live bounded GSC collection and verify partial telemetry if Search Appearance still returns 400/403.
- [ ] Verify dashboard health, GSC availability, cron inventory, table comments, zero legacy GSC lineage, and runtime kill-list.
- [ ] Update Notion TASK-072 with exact counts, run IDs, backups, and remaining risks.
