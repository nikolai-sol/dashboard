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
| `lib/canonical_writer.py` | `canonical_writer.py` | `32f3e0401f94fb26cbaac448ba6fce3a076a01813a5aa0b13fc55acdbdcbdb3c` | Canonical run/event writer used by collectors |
| `lib/canonical_release_store.py` | `canonical_release_store.py` | `37785a680abfb7e60c8d588941de937edfe08db02495db278dab5c42e9fce4a6` | Candidate release store, comparator evidence, atomic activation, and rollback pointer management |

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
