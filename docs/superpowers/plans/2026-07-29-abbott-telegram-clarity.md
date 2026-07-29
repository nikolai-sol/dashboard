# Abbott Telegram Health Summary Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ambiguous Abbott Telegram health block with a concise Russian operational summary that distinguishes integrity, freshness, coverage, and technical row counts.

**Architecture:** Keep `abbott_health_probe.py` as the aggregate-only source of truth and change only the pure formatter in `send_canonical_telegram_report.py`. Add small pure helpers for compact date ranges, incident lookup, and grouped coverage incidents; do not add API or database access.

**Tech Stack:** Python 3, `unittest`, HTML Telegram formatting.

## Global Constraints

- External APIs remain collector-only; this formatter consumes only the sanitized canonical health snapshot.
- Do not expose PII, secrets, raw User IDs, visit IDs, URLs, or source OAuth tokens.
- Explanatory labels are Russian; operational identifiers and UTC timestamps remain unchanged.
- Dashboard redeployment is permitted only after July coverage is complete, release validation passes, and the successor release is active.

---

### Task 1: Implement the clearer Abbott message with regression tests

**Files:**
- Modify: `send_canonical_telegram_report.py`
- Modify: `tests/test_send_canonical_telegram_report.py`

**Interfaces:**
- Consumes: `build_abbott_lines(snapshot: Dict) -> List[str]`.
- Produces: the clearer formatter plus executable output expectations for healthy, stale/incomplete, mismatched, and HTML-sensitive snapshots.

- [ ] **Step 1: Add a production-shaped stale snapshot fixture**

Create a fixture with release 8, a successful run finished on `2026-07-23T06:13:08Z`, `4/10` complete days, the shared missing range `2026-07-23..2026-07-28`, and one freshness plus five scope coverage incidents.

- [ ] **Step 2: Add failing output tests**

Assert that the generated block contains these concepts and does not contain five repeated generic coverage lines:

```python
self.assertIn("последний запуск релиза: SUCCESS, НО УСТАРЕЛ", text)
self.assertIn("покрытие последних 10 завершённых дней: 4/10", text)
self.assertIn("нет дат: 2026-07-23…2026-07-28", text)
self.assertIn("целостность сессий на доступных датах (4 дня): OK", text)
self.assertIn("технические строки canonical", text)
self.assertEqual(text.count("нет coverage"), 1)
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run: `python3 -m unittest tests.test_send_canonical_telegram_report.TelegramReportTests.test_abbott_stale_incomplete_summary_is_explicit`

Expected: FAIL because the current formatter still emits `run: SUCCESS`, `coverage: 4/10 complete days`, and five generic `scope_date_coverage` lines.

- [ ] **Step 4: Add compact date formatting**

Add a pure helper that turns identical contiguous ISO dates into `YYYY-MM-DD…YYYY-MM-DD`, preserves a single date, and joins non-contiguous values with commas.

- [ ] **Step 5: Render freshness and coverage explicitly**

Detect `latest_release_run_freshness`, append `НО УСТАРЕЛ` to the last release run, display its covered `date_to`, and label coverage as the last completed-day lookback with the missing date range once.

- [ ] **Step 6: Clarify integrity and row semantics**

Use `backfill.complete_days` as the number of available dates in the integrity label and render one `технические строки canonical` line with each scope's `persisted_rows` total.

- [ ] **Step 7: Aggregate missing coverage incidents**

Group `scope_date_coverage` incidents by their identical `missing_dates`, list affected scope keys once, and retain all non-coverage incidents with severity, check ID, and scope identity.

- [ ] **Step 8: Run focused and full tests and verify GREEN**

Run:

```bash
python3 -m unittest tests.test_send_canonical_telegram_report
python3 -m unittest tests.test_send_canonical_telegram_report tests.test_abbott_health_probe
```

Expected: all tests pass with zero failures.

- [ ] **Step 9: Commit implementation**

```bash
git add send_canonical_telegram_report.py tests/test_send_canonical_telegram_report.py
git commit -m "fix: clarify Abbott Telegram health summary"
```

---

### Task 2: Verify integration and delivery gates

**Files:**
- Verify only: repository and production aggregate state.

**Interfaces:**
- Consumes: git diff, test output, production release pointer, coverage rows, and backfill process state.
- Produces: a merge/push decision and an independent dashboard deployment decision.

- [ ] **Step 1: Verify branch scope and tests**

Run:

```bash
git diff main...HEAD --check
python3 -m unittest tests.test_send_canonical_telegram_report tests.test_abbott_health_probe
```

Expected: only the specification, plan, formatter, and formatter tests differ; all tests pass.

- [ ] **Step 2: Merge and push the formatter change**

Merge the reviewed feature branch into `main`, rerun the same tests on merged `main`, then push `main` without force.

- [ ] **Step 3: Recheck July before any dashboard deployment**

Require the successor release to have complete coverage for every date through `2026-07-28`, five valid scopes per date, zero bad rows, successful validation, and the active Abbott pointer. If any condition is false, do not redeploy the dashboard and report the exact remaining coverage.

- [ ] **Step 4: Deploy only when the gate passes**

If and only if Step 3 passes, use the repository's reviewed deployment procedure, verify application health and Abbott July smoke results, and preserve the previous release for rollback.
