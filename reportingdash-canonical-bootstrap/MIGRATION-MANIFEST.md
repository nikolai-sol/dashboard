# Migration Manifest

This manifest maps current unversioned root files to their intended locations
in the future `reportingdash-canonical` repository.

## Canonical synchronized runtime files

These files are byte-for-byte copies of the root canonical authorities. Verify
the SHA-256 values before packaging or importing this bootstrap into the
private runtime repository.

| Bootstrap path | Root authority | SHA-256 | Runtime role |
| --- | --- | --- | --- |
| `collectors/fetch_yandex_metrika_canonical.py` | `fetch_yandex_metrika_canonical.py` | `406a20103186e4557fdde1ac8998002f94452f8dcca3b5b1f5540a45dca8c588` | Yandex Metrika canonical collector and Abbott counter backfill entrypoint |
| `lib/canonical_writer.py` | `canonical_writer.py` | `3f287a42d1f79360d49a1f484dee823b70683ec5bd0448a205b0f352219a4e19` | Staging resume writer and current-active append-only Abbott day publisher |
| `lib/metrika_dashboard_breakdowns.py` | `metrika_dashboard_breakdowns.py` | `879822ee16108abccbb0b0c726d88f6d3835e36f2566d2531bdb4cd1a461f6c8` | Shared Metrika dashboard breakdown definitions |
| `lib/metrika_logs_api.py` | `metrika_logs_api.py` | `16b80558fbeca808d2dc28a8a163c9a2604e50d28a903725728f26cef7f10084` | Exact Metrika Logs request lifecycle and visit parser |
| `lib/canonical_release_store.py` | `canonical_release_store.py` | `3ad66bbfc399529099ff6995158520c4127434ff7ca04e0c64179b234fe9365a` | Candidate release store with least-privilege evidence reads, atomic activation, rollback, and audited staging failure management |

## Runnable Abbott runtime closure

The flat `runtime/` directory is an importable deployment unit. It contains
every runbook entrypoint and each repository-local Python dependency.

| Bootstrap path | Root authority | SHA-256 | Runtime role |
| --- | --- | --- | --- |
| `runtime/fetch_yandex_metrika_canonical.py` | `fetch_yandex_metrika_canonical.py` | `406a20103186e4557fdde1ac8998002f94452f8dcca3b5b1f5540a45dca8c588` | Exact five-scope Metrika collector |
| `runtime/canonical_writer.py` | `canonical_writer.py` | `3f287a42d1f79360d49a1f484dee823b70683ec5bd0448a205b0f352219a4e19` | Atomic staging and active append-only writer |
| `runtime/metrika_dashboard_breakdowns.py` | `metrika_dashboard_breakdowns.py` | `879822ee16108abccbb0b0c726d88f6d3835e36f2566d2531bdb4cd1a461f6c8` | Shared dashboard breakdown definitions |
| `runtime/metrika_logs_api.py` | `metrika_logs_api.py` | `16b80558fbeca808d2dc28a8a163c9a2604e50d28a903725728f26cef7f10084` | Exact Metrika Logs request lifecycle and visit parser |
| `runtime/canonical_release_store.py` | `canonical_release_store.py` | `3ad66bbfc399529099ff6995158520c4127434ff7ca04e0c64179b234fe9365a` | Exact validation, least-privilege pointer activation, and audited staging-failure store |
| `runtime/run_abbott_metrika_active_release.py` | `run_abbott_metrika_active_release.py` | `0f7c132b2cbd4f37ce51ceefa8479d36cf30088e2587dcda4cfc36cb29face0d` | Committed-manifest cron launcher |
| `runtime/abbott_release_operator.py` | `abbott_release_operator.py` | `493decb85ca7ac25ae55e125023b1aff3e3146b2a122e190097243790c76067d` | Least-privilege lifecycle CLI with audited staging failure |
| `runtime/probe_yandex_metrika_access.py` | `probe_yandex_metrika_access.py` | `430603922de9cd3cdbc6d0a7dc103f841924087c39462fc137ec8a26684674bc` | Read-only counter access proof |
| `runtime/capture_abbott_canonical_baseline.py` | `capture_abbott_canonical_baseline.py` | `24692288fd1e8c6bf61b0b59b52963c60068df13e068bf4336e6d9fd9ce998e2` | Frozen baseline CLI |
| `runtime/compare_abbott_canonical_release.py` | `compare_abbott_canonical_release.py` | `3cbe72196853ec89d435b214cb7ac106732d94e5b2a05ac95e035e7942d5c015` | Candidate comparator CLI |
| `runtime/abbott_canonical_controls.py` | `abbott_canonical_controls.py` | `744d8d7ec21089c25b3253ae194d4e390f9bc472ca18657806d4ab7a0b33bbe3` | Baseline/control evidence library |
| `runtime/metrika_pagination.py` | `metrika_pagination.py` | `7dcb1a05ad8babcc7d696934babb1ab50747ca140c910efc88f3685674386a7c` | Metrika pagination dependency |
| `runtime/backfill_abbott_metrika_2026.py` | `backfill_abbott_metrika_2026.py` | `1dce2c65082a18848d21cf0659d5a52a4258334fc38be25079308afef977bf9c` | Gap-first full-year backfill CLI |
| `runtime/abbott_health_probe.py` | `abbott_health_probe.py` | `6ed7a6c2af250c40ac23bca702a15c2cd60dac5331a392e7e3ac45cc091011ef` | Deterministic Abbott health CLI |
| `runtime/send_canonical_telegram_report.py` | `send_canonical_telegram_report.py` | `8ae155f4f1a81a50fa29730bfe1f7e19e1c01d0ab56719a60327c59b37e22da3` | Summary entrypoint |
| `runtime/sources_health_dashboard.py` | `sources_health_dashboard.py` | `072a3270fa0cac9c7b7384f19aba636485dc89b8c03da2eb80bbde1c50c71116` | Summary health dependency |
| `runtime/agents/__init__.py` | `agents/__init__.py` | `cf17c37c950a6d792c42de4580180ddefa478dbebc01109674658756473d9cc8` | Vendored content-attestor package root |
| `runtime/agents/abbott_page_classifier/__init__.py` | `agents/abbott_page_classifier/__init__.py` | `ea902dc7a2b24b5bdc073342296a16a013af63a3b7afc26789f82e2511f576b0` | Vendored content-attestor package |
| `runtime/agents/abbott_page_classifier/approval_hashes.py` | `agents/abbott_page_classifier/approval_hashes.py` | `2e651e0cc8627ea91fef10846929bf7d63870e1d341b459f1aab49c7e84fa042` | Lightweight canonical approval hash authority |
| `runtime/agents/abbott_page_classifier/candidate_release.py` | `agents/abbott_page_classifier/candidate_release.py` | `c7f5d30417c0d94fd23a431af4f896185bf4262e01a9d5c64f729eccf3ba4eb5` | Shared content materializer with pre-attested return paths, resume-safe candidate lifecycle receipts, and read-only staging/validated comparison evidence |
| `runtime/agents/abbott_page_classifier/domain.py` | `agents/abbott_page_classifier/domain.py` | `c2d54e20e09fac9772b176b7f51e78750af78d71cdcea409e1f6d78508d37efb` | Content taxonomy domain dependency |
| `runtime/agents/abbott_page_classifier/normalization.py` | `agents/abbott_page_classifier/normalization.py` | `089b6a8ed3a2f47432a972bedb848a9c89d889981445eaf0804b40677899a1df` | Content normalization dependency |
| `runtime/agents/abbott_page_classifier/weekly_proposal.py` | `agents/abbott_page_classifier/weekly_proposal.py` | `b209e49ac51f5bba26f4e46ce6d6797d716968be5efc0030e30c29671267d706` | Weekly reconcile/classify/publish entrypoint; direct execution rejects non-3.11 Python and stops for manual approval |
| `runtime/agents/abbott_page_classifier/workflow.py` | `agents/abbott_page_classifier/workflow.py` | `bae6b518bff93199fe5cd7c6f9b066b9d3a5d5e9a25b4d17119ffb2f32246207` | Sanitized operator workflow CLI; direct execution rejects non-3.11 Python |
| `runtime/agents/abbott_page_classifier/python311_runtime.sh` | `agents/abbott_page_classifier/python311_runtime.sh` | `15a135ba0d6db46c91c238a712f32cf6079b9dcf3761744a261521c677d401d9` | Fail-closed absolute exact-Python-3.11 launcher |
| `runtime/agents/abbott_page_classifier/run_classifier.sh` | `agents/abbott_page_classifier/run_classifier.sh` | `d16f21b08c0b0eee8c8eea50d1ab1d4018c54a373ec5a6a13ddff300d5bf557b` | Reviewed workflow wrapper through the exact-3.11 launcher |
| `runtime/agents/abbott_page_classifier/run_weekly_proposal.sh` | `agents/abbott_page_classifier/run_weekly_proposal.sh` | `71b76309ff5f96084c9d9e62654db9383e957f4a4d4acc821a7c723531243656` | Reviewed weekly proposal wrapper through the exact-3.11 launcher |
| `runtime/agents/abbott_page_classifier/workflow_service.py` | `agents/abbott_page_classifier/workflow_service.py` | `94cfc22b20e819891fff30287949f04dedccff172804c73df99ab4faa9f93e70` | Canonical weekly proposal service |
| `runtime/agents/abbott_page_classifier/workflow_repository.py` | `agents/abbott_page_classifier/workflow_repository.py` | `13f39856fd1aa547fdcc4c2f6dc493e779446bdda13c2ba54e2ae66816d81c77` | MySQL reconciliation staging repository |
| `runtime/agents/abbott_page_classifier/repository.py` | `agents/abbott_page_classifier/repository.py` | `d303390fc2208bd3af233b5f7c46e30b1e4a6a5d6365fba1535e9dff5a7ac2a1` | Canonical content registry repository |
| `runtime/agents/abbott_page_classifier/batch_service.py` | `agents/abbott_page_classifier/batch_service.py` | `619d3b2ce8018be34c150b4b66c74086d04bf1ee6190eb778e9067d7fca589b7` | Immutable batch construction and acceptance ingestion |
| `runtime/agents/abbott_page_classifier/reconcile.py` | `agents/abbott_page_classifier/reconcile.py` | `d8f5cfb0f627929657ae1c4fe51c75a670c7751b0cc432f6073417febe3dc778` | Deterministic reconciliation and anti-flip gate |
| `runtime/agents/abbott_page_classifier/identity.py` | `agents/abbott_page_classifier/identity.py` | `39e0e961dbb5c91a65a737f953f1534141f84719d9690ddc648c4f313d6da6d7` | Canonical identity resolution |
| `runtime/agents/abbott_page_classifier/sources.py` | `agents/abbott_page_classifier/sources.py` | `7f0c7fca84b021eac669726165336a978d2eeff0c92a1626f44af60d363dce9d` | Offline Registry 1/Registry 2 snapshot parsers |
| `runtime/agents/abbott_page_classifier/llm_classifier.py` | `agents/abbott_page_classifier/llm_classifier.py` | `43cfd180f64da3afe74aa8252e644fa4ddecc1d294783f9660274b0b17eb3ce7` | Privacy-minimized classifier adapter, invoked only with execute authorization |
| `runtime/agents/abbott_page_classifier/sheets_sync.py` | `agents/abbott_page_classifier/sheets_sync.py` | `ac179656f8fe46988ef0abfac6ffe23356fd93cdbc49eba54eea14f0cdc1eaca` | Approval projection publisher and accepted snapshot reader |
| `src/db/migrations/049_abbott_content_reconciliation_staging.sql` | `dashboard-next/src/db/migrations/049_abbott_content_reconciliation_staging.sql` | `783414b93e48edf29c5eece51de21db97bf37d9dfeeb6e01490e12729e6afca9` | Additive reconciliation staging schema; package only, never applied by runtime |

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
- `metrika_dashboard_breakdowns.py`
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
