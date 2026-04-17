# reportingdash-canonical bootstrap

This is a versioned bootstrap skeleton for the future `reportingdash-canonical` repository.

It exists here temporarily so we can:

- define the target repo shape
- stage collector migration work in git
- keep rollout notes next to the dashboard repo until the separate collectors repo is created

## Important

This folder is not the live collector runtime.

Current live/runtime paths are still:

- local unversioned collector root: `/Users/nafanya/ReportingDash`
- server runtime: `/root/reportingdash-canonical`

## Current migration reality

The Yandex Direct cutover has already started.

Confirmed current state:

- legacy bridge collector still exists
- new API-first collector exists:
  - `fetch_yandex_direct_canonical_api.py`
- shadow source is already in use:
  - `source_key = yandex_direct_api_shadow`
- shadow cron has already been introduced on server
- current cutover readiness is monitored in:
  - `monitor_canonical_shadow.py`
  - `sources_health_dashboard.py`
  - `send_canonical_telegram_report.py`

This bootstrap therefore assumes:

- Yandex Direct is not a greenfield migration
- Yandex Direct should be treated as an in-progress cutover source
- first repo migration should preserve that shadow structure exactly

## Intended repo structure

```text
reportingdash-canonical/
  README.md
  requirements.txt
  .env.example
  collectors/
  lib/
  ops/
  docs/
  deploy/
```

See:

- [MIGRATION-MANIFEST.md](./MIGRATION-MANIFEST.md)
- [docs/YANDEX-DIRECT-CUTOVER-STATUS.md](./docs/YANDEX-DIRECT-CUTOVER-STATUS.md)
- [docs/BOOTSTRAP-ROLLOUT-CHECKLIST.md](./docs/BOOTSTRAP-ROLLOUT-CHECKLIST.md)
