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
| `lib/canonical_release_store.py` | `canonical_release_store.py` | `b3f8ef7129a76866cc8a875eebe2dd89a751a22eecc3e31ade5060ddafa2fc6a` | Candidate release store, persisted validation gate, atomic activation, and rollback pointer management |

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
