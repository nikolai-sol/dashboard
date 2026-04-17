## Canonical Collectors Repo Migration Plan

### Goal

Move root-level canonical collectors into a versioned, deployable repository so collector changes can be:

- committed
- reviewed
- deployed repeatably
- rolled back safely

This migration must not break existing cron jobs or server runtime.

### Current State

Canonical collector code currently lives outside git in `/Users/nafanya/ReportingDash` and on the server in `/root/reportingdash-canonical`.

Observed root-level collector/runtime files:

- `canonical_writer.py`
- `yandex_direct_shared.py`
- `fetch_getintent_canonical.py`
- `fetch_hybrid_canonical.py`
- `fetch_linkedin_canonical.py`
- `fetch_vk_ads_v2_canonical.py`
- `fetch_yandex_direct_canonical.py`
- `fetch_yandex_direct_canonical_api.py`
- `fetch_yandex_metrika_canonical.py`
- `fetch_reddit_ads.py`
- `check_cron_status.py`
- `monitor_canonical_shadow.py`
- `send_canonical_telegram_report.py`
- `sources_health_dashboard.py`
- `setup_oauth.py`
- `requirements.txt`

Supporting documentation already exists in the same root area:

- `CANONICAL-V1-TRACKER.md`
- `CANONICAL-ROLLING-VERIFICATION-CHECKLIST.md`
- `SHADOW-CRON-POLICY.md`
- `YANDEX-DIRECT-REPORTING-ONBOARDING.md`
- `YANDEX-METRIKA-CANONICAL-V1-DESIGN.md`
- `YANDEX-METRIKA-SHADOW-VALIDATION.md`

### Constraints

- `dashboard-next` is already a separate git repository and should stay focused on dashboard runtime/UI.
- Current server runtime path is `/root/reportingdash-canonical`.
- Existing cron jobs should continue to run from that server path until cutover is complete.
- Abbott still depends on legacy runtime/data, so this plan only covers canonical collectors.

### Recommended Target

Create a separate git repository:

- repo name: `reportingdash-canonical`

Recommended structure:

```text
reportingdash-canonical/
  README.md
  requirements.txt
  .env.example
  collectors/
    fetch_getintent_canonical.py
    fetch_hybrid_canonical.py
    fetch_linkedin_canonical.py
    fetch_vk_ads_v2_canonical.py
    fetch_yandex_direct_canonical.py
    fetch_yandex_direct_canonical_api.py
    fetch_yandex_metrika_canonical.py
    fetch_reddit_ads.py
  lib/
    canonical_writer.py
    yandex_direct_shared.py
  ops/
    check_cron_status.py
    monitor_canonical_shadow.py
    send_canonical_telegram_report.py
    sources_health_dashboard.py
    setup_oauth.py
  docs/
    CANONICAL-V1-TRACKER.md
    CANONICAL-ROLLING-VERIFICATION-CHECKLIST.md
    SHADOW-CRON-POLICY.md
    YANDEX-DIRECT-REPORTING-ONBOARDING.md
    YANDEX-METRIKA-CANONICAL-V1-DESIGN.md
    YANDEX-METRIKA-SHADOW-VALIDATION.md
  deploy/
    render-production-env.sh
    cron/
    system-notes/
```

### Migration Scope

Phase 1 scope:

- copy canonical collector scripts
- copy shared collector libraries
- copy health/monitoring utilities
- copy relevant canonical docs
- add repo-level README and env example

Not in Phase 1:

- changing collector logic
- changing database schema
- changing source keys
- changing cron schedule semantics
- moving Abbott runtime

### Step-by-Step Rollout

#### Phase 1. Repository bootstrap

1. Create new repo `reportingdash-canonical`.
2. Add structure shown above.
3. Copy root-level canonical collector files into `collectors/`, `lib/`, and `ops/`.
4. Add import-safe package paths so collectors can run from the new layout.
5. Add `.env.example` with all required env names only, without secrets.

Done criteria:

- local `python -m py_compile` passes for all moved scripts
- local imports work from the new repo layout

#### Phase 2. Server shadow deploy

1. Deploy new repo to a shadow server path, for example:
   - `/root/reportingdash-canonical-repo`
2. Create venv and install `requirements.txt`.
3. Render env into the new path.
4. Run manual smoke checks:
   - one collector from ads
   - `yandex_metrika`
   - one ops utility

Done criteria:

- manual runs succeed from the new repo path
- `canonical_collector_runs` and `canonical_collector_run_events` still write normally

#### Phase 3. Cron shadow

1. Duplicate one low-risk cron line to the new repo path as a shadow job.
2. Use a safe shadow pattern:
   - no duplicate writes unless source key is explicitly shadow-safe
   - otherwise run dry or monitoring-only checks
3. Verify logs, run rows, and fact freshness.

Recommended first shadow candidate:

- `fetch_yandex_direct_canonical_api.py` with existing shadow source semantics

Done criteria:

- at least 3 successful scheduled shadow runs
- no duplicate fact writes
- parity/freshness stable

#### Phase 4. Production cutover by source

Per source:

1. disable old cron line
2. enable new cron line from repo path
3. verify same-day success
4. verify next-day facts
5. keep rollback command ready

Recommended order:

1. `linkedin`
2. `reddit`
3. `vk_ads_v2`
4. `getintent`
5. `hybrid`
6. `yandex_promopages`
7. `yandex_direct`
8. `yandex_metrika`

This order keeps the most sensitive and recently changing sources later.

#### Phase 5. Root cleanup

After all sources run from the new repo path:

1. freeze root-level collector files as deprecated
2. remove old cron references to `/root/reportingdash-canonical`
3. keep old path for rollback window only
4. archive or delete old path after acceptance window

### Rollback Plan

Per source rollback must be trivial:

1. disable cron line pointing to the new repo path
2. re-enable previous cron line pointing to old path
3. re-run one manual collector window if needed
4. confirm freshness in canonical tables

Do not delete the old runtime path before a completed rollback window.

### Verification Checklist

For each migrated source:

- collector script runs from new repo path
- env resolves correctly
- logs write to expected location
- `canonical_collector_runs` show `success`
- facts appear for expected date window
- no duplicate source rows
- no unexpected source key drift
- public dashboard freshness remains normal

### Open Decisions

These need explicit decisions before Phase 1 starts:

1. Keep collectors as a separate repo or as a git submodule/worktree under `dashboard-next`.
2. Whether `fetch_reddit_ads.py` should keep its current name or be normalized to `fetch_reddit_canonical.py`.
3. Where to store deploy helpers and cron templates:
   - inside the new repo
   - or in a separate ops repo
4. Whether shadow-only collectors keep `_shadow` source keys permanently or only during migration.

### Recommendation

Safest path:

- create a separate repo `reportingdash-canonical`
- migrate files without changing behavior first
- shadow one source at a time
- cut over cron source by source
- only after that retire the unversioned root path

This gives us clean commits, predictable deploys, and a reversible path without mixing collector infrastructure into `dashboard-next`.
