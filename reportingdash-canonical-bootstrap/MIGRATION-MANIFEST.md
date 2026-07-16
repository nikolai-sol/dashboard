# Migration Manifest

This manifest maps current unversioned root files to their intended locations
in the future `reportingdash-canonical` repository.

## Canonical synchronized runtime files

These files are byte-for-byte copies of the root canonical authorities. Verify
the SHA-256 values before packaging or importing this bootstrap into the
private runtime repository.

| Bootstrap path | Root authority | SHA-256 | Runtime role |
| --- | --- | --- | --- |
| `collectors/fetch_yandex_metrika_canonical.py` | `fetch_yandex_metrika_canonical.py` | `3febae5917a8c64baf4ff4f9fd5735f34add4d41fa381eae6159bf47d2da5e25` | Yandex Metrika canonical collector and Abbott counter backfill entrypoint |
| `lib/canonical_writer.py` | `canonical_writer.py` | `82e7661f4fb64e6f637d03179a1f567a70af428e3637fdaa356a3c16b9e0ab5e` | Staging resume writer and current-active append-only Abbott day publisher |
| `lib/canonical_release_store.py` | `canonical_release_store.py` | `284d410a24af17cf3a1a08a24e15dd38b1695ee526bdc9c6ab53b8f5c5ef698d` | Candidate release store, persisted validation gate, atomic activation, and rollback pointer management |

## Runnable Abbott runtime closure

The flat `runtime/` directory is an importable deployment unit. It contains
every runbook entrypoint and each repository-local Python dependency.

| Bootstrap path | Root authority | SHA-256 | Runtime role |
| --- | --- | --- | --- |
| `runtime/fetch_yandex_metrika_canonical.py` | `fetch_yandex_metrika_canonical.py` | `3febae5917a8c64baf4ff4f9fd5735f34add4d41fa381eae6159bf47d2da5e25` | Exact five-scope Metrika collector |
| `runtime/canonical_writer.py` | `canonical_writer.py` | `82e7661f4fb64e6f637d03179a1f567a70af428e3637fdaa356a3c16b9e0ab5e` | Atomic staging and active append-only writer |
| `runtime/canonical_release_store.py` | `canonical_release_store.py` | `284d410a24af17cf3a1a08a24e15dd38b1695ee526bdc9c6ab53b8f5c5ef698d` | Exact validation and pointer store |
| `runtime/run_abbott_metrika_active_release.py` | `run_abbott_metrika_active_release.py` | `59a4c7f166fb0df8e20a1fe0b6632f01179e53422478553f9d786bb976d3a8e6` | Committed-manifest cron launcher |
| `runtime/abbott_release_operator.py` | `abbott_release_operator.py` | `4fea3b284743e168011bb4518276576890d76c375a557b9732e6491f326ecd9f` | Least-privilege lifecycle CLI |
| `runtime/probe_yandex_metrika_access.py` | `probe_yandex_metrika_access.py` | `430603922de9cd3cdbc6d0a7dc103f841924087c39462fc137ec8a26684674bc` | Read-only counter access proof |
| `runtime/capture_abbott_canonical_baseline.py` | `capture_abbott_canonical_baseline.py` | `24692288fd1e8c6bf61b0b59b52963c60068df13e068bf4336e6d9fd9ce998e2` | Frozen baseline CLI |
| `runtime/compare_abbott_canonical_release.py` | `compare_abbott_canonical_release.py` | `3cbe72196853ec89d435b214cb7ac106732d94e5b2a05ac95e035e7942d5c015` | Candidate comparator CLI |
| `runtime/abbott_canonical_controls.py` | `abbott_canonical_controls.py` | `1d6a8f086bff938427efec37574cb1477daa5c87ed69ab86951bf086e1097bb0` | Baseline/control evidence library |
| `runtime/metrika_pagination.py` | `metrika_pagination.py` | `7dcb1a05ad8babcc7d696934babb1ab50747ca140c910efc88f3685674386a7c` | Metrika pagination dependency |
| `runtime/backfill_abbott_metrika_2026.py` | `backfill_abbott_metrika_2026.py` | `d9c4a02b2032aa25ed648d17671c749f54352588e95ef8801fe79044b90d9f09` | Gap-first full-year backfill CLI |
| `runtime/abbott_health_probe.py` | `abbott_health_probe.py` | `79895e830287d5ea38a7417502cc1463442ea0e0090647c5b3aa962c63227772` | Deterministic Abbott health CLI |
| `runtime/send_canonical_telegram_report.py` | `send_canonical_telegram_report.py` | `89700930a2d9f4e9c23370282281cabe50261eded34471808ed526c002b77759` | Summary entrypoint |
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
