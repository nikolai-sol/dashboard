# Migration Manifest

This manifest maps current unversioned root files to their intended locations
in the future `reportingdash-canonical` repository.

## Canonical synchronized runtime files

These files are byte-for-byte copies of the root canonical authorities. Verify
the SHA-256 values before packaging or importing this bootstrap into the
private runtime repository.

| Bootstrap path | Root authority | SHA-256 | Runtime role |
| --- | --- | --- | --- |
| `collectors/fetch_yandex_metrika_canonical.py` | `fetch_yandex_metrika_canonical.py` | `57fb530aa38d09d102744c711f4cf2fe1225384ea5929ed36462d14c591cf75f` | Yandex Metrika canonical collector and Abbott counter backfill entrypoint |
| `lib/canonical_writer.py` | `canonical_writer.py` | `f7e0ac999cf9438fdc3161d893a101f778622c69d01a1b6a4076f24c2239e0b8` | Staging resume writer and current-active append-only Abbott day publisher |
| `lib/metrika_logs_api.py` | `metrika_logs_api.py` | `bfb6e5ec504f0e89f2ab5547102efa1a59fedeaf5e1b88f7e6179f3658a85f5f` | Exact Metrika Logs request lifecycle and visit parser |
| `lib/canonical_release_store.py` | `canonical_release_store.py` | `749de8478c1712e7f0255461afe61ab80bfd57d1349a10cd89ecf7759b119f1c` | Candidate release store, persisted validation gate, atomic activation, and rollback pointer management |

## Runnable Abbott runtime closure

The flat `runtime/` directory is an importable deployment unit. It contains
every runbook entrypoint and each repository-local Python dependency.

| Bootstrap path | Root authority | SHA-256 | Runtime role |
| --- | --- | --- | --- |
| `runtime/fetch_yandex_metrika_canonical.py` | `fetch_yandex_metrika_canonical.py` | `57fb530aa38d09d102744c711f4cf2fe1225384ea5929ed36462d14c591cf75f` | Exact five-scope Metrika collector |
| `runtime/canonical_writer.py` | `canonical_writer.py` | `f7e0ac999cf9438fdc3161d893a101f778622c69d01a1b6a4076f24c2239e0b8` | Atomic staging and active append-only writer |
| `runtime/metrika_logs_api.py` | `metrika_logs_api.py` | `bfb6e5ec504f0e89f2ab5547102efa1a59fedeaf5e1b88f7e6179f3658a85f5f` | Exact Metrika Logs request lifecycle and visit parser |
| `runtime/canonical_release_store.py` | `canonical_release_store.py` | `749de8478c1712e7f0255461afe61ab80bfd57d1349a10cd89ecf7759b119f1c` | Exact validation and pointer store |
| `runtime/run_abbott_metrika_active_release.py` | `run_abbott_metrika_active_release.py` | `1b0f78c0d40bcd1fd7d1428f6c348f6c2167a05adf59b6dc72f2ce37875354c7` | Committed-manifest cron launcher |
| `runtime/abbott_release_operator.py` | `abbott_release_operator.py` | `4fea3b284743e168011bb4518276576890d76c375a557b9732e6491f326ecd9f` | Least-privilege lifecycle CLI |
| `runtime/probe_yandex_metrika_access.py` | `probe_yandex_metrika_access.py` | `430603922de9cd3cdbc6d0a7dc103f841924087c39462fc137ec8a26684674bc` | Read-only counter access proof |
| `runtime/capture_abbott_canonical_baseline.py` | `capture_abbott_canonical_baseline.py` | `24692288fd1e8c6bf61b0b59b52963c60068df13e068bf4336e6d9fd9ce998e2` | Frozen baseline CLI |
| `runtime/compare_abbott_canonical_release.py` | `compare_abbott_canonical_release.py` | `3cbe72196853ec89d435b214cb7ac106732d94e5b2a05ac95e035e7942d5c015` | Candidate comparator CLI |
| `runtime/abbott_canonical_controls.py` | `abbott_canonical_controls.py` | `4c9fb6291a6ae54958cdcd15eb654be0eefc6a7264b70c894bd01a4b8b9def17` | Baseline/control evidence library |
| `runtime/metrika_pagination.py` | `metrika_pagination.py` | `7dcb1a05ad8babcc7d696934babb1ab50747ca140c910efc88f3685674386a7c` | Metrika pagination dependency |
| `runtime/backfill_abbott_metrika_2026.py` | `backfill_abbott_metrika_2026.py` | `d9c4a02b2032aa25ed648d17671c749f54352588e95ef8801fe79044b90d9f09` | Gap-first full-year backfill CLI |
| `runtime/abbott_health_probe.py` | `abbott_health_probe.py` | `d0fbda945ab014eedeb0be5eea34601af3d45750567e3a7450c804e27fa68105` | Deterministic Abbott health CLI |
| `runtime/send_canonical_telegram_report.py` | `send_canonical_telegram_report.py` | `5e5f9f26f6fb66349d4b9af9d002575518c1430f8d57c647d4c0ed1db0ea152c` | Summary entrypoint |
| `runtime/sources_health_dashboard.py` | `sources_health_dashboard.py` | `2884007260389b013daff0523617d9cdf6e6dde241889ef534599d76bd4ea9d0` | Summary health dependency |

## collectors/

- `fetch_getintent_canonical.py`
- `fetch_hybrid_canonical.py`
- `fetch_linkedin_canonical.py`
- `fetch_vk_ads_v2_canonical.py`
- `fetch_yandex_direct_canonical.py`
- `fetch_yandex_direct_canonical_api.py`
- `fetch_yandex_metrika_canonical.py`
- `fetch_reddit_ads.py`

## lib/

- `canonical_writer.py`
- `canonical_release_store.py`
- `metrika_logs_api.py`
- `yandex_direct_shared.py`

## ops/

- `check_cron_status.py`
- `monitor_canonical_shadow.py`
- `send_canonical_telegram_report.py`
- `sources_health_dashboard.py`
- `setup_oauth.py`

## docs/

- `CANONICAL-V1-TRACKER.md`
- `CANONICAL-ROLLING-VERIFICATION-CHECKLIST.md`
- `SHADOW-CRON-POLICY.md`
- `YANDEX-DIRECT-REPORTING-ONBOARDING.md`
- `YANDEX-METRIKA-CANONICAL-V1-DESIGN.md`
- `YANDEX-METRIKA-SHADOW-VALIDATION.md`

## deploy/

To add during repo creation:

- cron templates
- env rendering helper
- runbook snippets
- server cutover notes

## not in first move

Do not move in the first bootstrap phase:

- Abbott runtime code
- `dashboard-next` UI/runtime files
- legacy Nest runtime
- ad hoc spreadsheets and screenshots
