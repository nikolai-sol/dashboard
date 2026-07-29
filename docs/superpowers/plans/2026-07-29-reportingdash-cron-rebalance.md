# ReportingDash UTC Cron Rebalance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved UTC collector schedule without executing any collector or exposing the legacy Direct secret.

**Architecture:** Treat the current root crontab as an immutable input guarded by an exact SHA-256 precondition. A remote in-memory transformer changes only uniquely matched ReportingDash schedules, comments out LinkedIn and Reddit, installs the result through `crontab -`, and verifies the installed bytes against a deterministic transform of the protected backup.

**Tech Stack:** Debian cron, Python 3 standard library, SSH, SHA-256, Git documentation.

## Global Constraints

- Production scheduling remains in UTC; do not rely on `CRON_TZ` for trigger times.
- Do not execute collectors, backfills, health probes, optional-only GSC collection, or Telegram.
- Do not print or copy the legacy Direct query string, environment values, tokens, passwords, or secrets.
- Do not change collector commands, arguments, paths, redirects, cron environment assignments, weekly SEO jobs, or ispmanager/system jobs.
- Preserve the legacy Direct safety path, canonical API-first path, and latest-closed-day retry.
- Abort before installation unless the current crontab SHA-256 is `c5cd49710223f6de63343b114590a2374fb67e34f099b21fbd4a142d498ff6e6` and every target has exactly one active match at its expected old schedule.
- Store a mode-`0600` backup under the mode-`0700` directory `/root/reportingdash-canonical/backups/cron-rebalance-20260729T072308Z/` before installation.

---

### Task 1: Install the guarded UTC schedule

**Files:**
- Read/modify: production root crontab
- Create: `/root/reportingdash-canonical/backups/cron-rebalance-20260729T072308Z/root.crontab`
- Reference: `docs/superpowers/specs/2026-07-29-reportingdash-cron-rebalance-design.md`

**Interfaces:**
- Consumes: exact pre-change crontab SHA-256 and uniquely matched active cron lines.
- Produces: installed root crontab with only the approved schedule changes and a recoverable protected backup.

- [ ] **Step 1: Recheck the pre-change SHA and ensure no target process is currently running.**

Run:

```bash
ssh beget 'crontab -l | sha256sum; pgrep -af "fetch_(linkedin|reddit|between|vk_ads|getintent|yandex_promopages|hybrid|yandex_direct|yandex_webmaster|gsc|yandex_metrika)|monitor_canonical_shadow|abbott_health_probe|send_canonical_telegram_report" || true'
```

Expected: SHA-256 `c5cd49710223f6de63343b114590a2374fb67e34f099b21fbd4a142d498ff6e6`; no collector/health/report process except the diagnostic command itself.

- [ ] **Step 2: Create the protected rollback backup.**

Run remotely with `umask 077`, create `/root/reportingdash-canonical/backups/cron-rebalance-20260729T072308Z/` with mode `0700`, and redirect `crontab -l` into `root.crontab` with mode `0600`. Print only the backup path, mode, size, and SHA-256.

Expected: backup SHA-256 equals the Step 1 pre-change SHA.

- [ ] **Step 3: Transform and install only the approved lines.**

Use a Python 3 stdin program on `beget` with this exact target table:

```python
targets = [
    ("linkedin", "fetch_linkedin_canonical.py", (), "20 6 * * *", None),
    ("reddit", "fetch_reddit_canonical.py", (), "30 6 * * *", None),
    ("between", "fetch_between_email_canonical.py", (), "40 5 * * *", "40 1 * * *"),
    ("direct_legacy", "http://127.0.0.1:5000/direct", (), "0 6 * * *", "0 2 * * *"),
    ("metrika_generic", "fetch_yandex_metrika_canonical.py", ("run_abbott_metrika_active_release.py",), "12 6 * * *", "12 2 * * *"),
    ("metrika_abbott", "run_abbott_metrika_active_release.py", (), "12 6 * * *", "12 2 * * *"),
    ("metrika_returning", "fetch_yandex_metrika_returning_canonical.py", (), "18 6 * * *", "18 2 * * *"),
    ("getintent", "fetch_getintent_canonical.py", (), "32 6 * * *", "32 2 * * *"),
    ("direct_primary", "fetch_yandex_direct_canonical_api.py", (), "34 6 * * *", "34 2 * * *"),
    ("vk", "fetch_vk_ads_v2_canonical.py", (), "35 6 * * *", "35 2 * * *"),
    ("promopages", "fetch_yandex_promopages_canonical.py", (), "36 6 * * *", "36 2 * * *"),
    ("hybrid", "fetch_hybrid_canonical.py", (), "37 6 * * *", "37 2 * * *"),
    ("webmaster", "collect-yandex-webmaster-canonical.sh", (), "50 6 * * *", "50 2 * * *"),
    ("gsc", "fetch_gsc_canonical.py", (), "55 6 * * *", "55 2 * * *"),
    ("direct_retry", "fetch_yandex_direct_canonical_api.py", (), "34 12 * * *", "30 4 * * *"),
    ("canonical_health", "monitor_canonical_shadow.py", (), "5 7 * * *", "40 4 * * *"),
    ("abbott_health", "abbott_health_probe.py", (), "5 7 * * *", "50 4 * * *"),
    ("telegram_summary", "send_canonical_telegram_report.py", (), "10 7 * * *", "0 5 * * *"),
]
```

For each tuple, match an active line containing `needle`, containing none of `excludes`, and whose first five fields equal `old_schedule`. Require exactly one match. For LinkedIn and Reddit, prefix the complete original line with `# DISABLED 2026-07-29 by operator request: `. For all other targets, replace only the first five fields with `new_schedule` and preserve the command remainder. Verify that the set of changed line indexes equals the target match indexes, then install the complete result with `subprocess.run(["crontab", "-"], input=result, text=True, check=True)`.

Expected: `crontab -` exits `0`; the program prints only target labels, old/new schedules, and the new whole-crontab SHA-256.

- [ ] **Step 4: Verify the installed crontab against the backup without printing commands.**

Re-run the deterministic transform against the protected backup and compare its full bytes with `crontab -l`. Then parse the active crontab and require:

```text
between=40 1 * * *
direct_legacy=0 2 * * *
metrika_generic=12 2 * * *
metrika_abbott=12 2 * * *
metrika_returning=18 2 * * *
getintent=32 2 * * *
direct_primary=34 2 * * *
vk=35 2 * * *
promopages=36 2 * * *
hybrid=37 2 * * *
webmaster=50 2 * * *
gsc=55 2 * * *
direct_retry=30 4 * * *
canonical_health=40 4 * * *
abbott_health=50 4 * * *
telegram_summary=0 5 * * *
linkedin_active=0
reddit_active=0
```

Also require that the full installed bytes equal the deterministic expected transform of the backup. This proves all unrelated lines and all command remainders are unchanged.

- [ ] **Step 5: Confirm no collector or report was exercised.**

Query `canonical_collector_runs` for rows with `started_at` later than the crontab installation timestamp and check the Telegram log timestamp without invoking any command. Expected: no run caused by the rollout and no Telegram send caused by the rollout.

### Task 2: Record the verified rollout

**Files:**
- Modify: `docs/superpowers/plans/2026-07-29-reportingdash-cron-rebalance.md`
- Modify: `docs/superpowers/plans/2026-07-28-rd13-rd16-runtime-health.md`

**Interfaces:**
- Consumes: backup path, installed SHA-256, sanitized schedule verification, and post-install no-execution check.
- Produces: repository evidence of the exact operational change and the successful 2026-07-29 Webmaster/GSC gate.

- [ ] **Step 1: Mark the completed steps and add the actual backup path and installed SHA-256.**
- [ ] **Step 2: Update the RD-13/RD-16 plan with the successful Webmaster/GSC scheduled gate, unchanged July recovery scopes, and the fact that optional-only GSC work was not executed.**
- [ ] **Step 3: Run `git diff --check`, inspect the complete documentation diff, and commit with `docs: record UTC collector schedule rollout`.**
