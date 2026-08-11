# Migration Manifest

This manifest maps current unversioned root files to their intended locations
in the future `reportingdash-canonical` repository.

Observed page identity fixes use a DB-native successor release and never
trigger a Metrika backfill.

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
| `lib/canonical_release_store.py` | `canonical_release_store.py` | `388937d78b6e05ad98493b35d0dd85103be475cedb972ff3859af634bf8efa5f` | Candidate release store with least-privilege evidence reads, atomic activation, rollback, and audited staging failure management |

## Runnable Abbott runtime closure

The flat `runtime/` directory is an importable deployment unit. It contains
every runbook entrypoint and each repository-local Python dependency.

| Bootstrap path | Root authority | SHA-256 | Runtime role |
| --- | --- | --- | --- |
| `runtime/fetch_yandex_metrika_canonical.py` | `fetch_yandex_metrika_canonical.py` | `406a20103186e4557fdde1ac8998002f94452f8dcca3b5b1f5540a45dca8c588` | Exact five-scope Metrika collector |
| `runtime/canonical_writer.py` | `canonical_writer.py` | `3f287a42d1f79360d49a1f484dee823b70683ec5bd0448a205b0f352219a4e19` | Atomic staging and active append-only writer |
| `runtime/metrika_dashboard_breakdowns.py` | `metrika_dashboard_breakdowns.py` | `879822ee16108abccbb0b0c726d88f6d3835e36f2566d2531bdb4cd1a461f6c8` | Shared dashboard breakdown definitions |
| `runtime/metrika_logs_api.py` | `metrika_logs_api.py` | `16b80558fbeca808d2dc28a8a163c9a2604e50d28a903725728f26cef7f10084` | Exact Metrika Logs request lifecycle and visit parser |
| `runtime/canonical_release_store.py` | `canonical_release_store.py` | `388937d78b6e05ad98493b35d0dd85103be475cedb972ff3859af634bf8efa5f` | Exact validation, least-privilege pointer activation, and audited staging-failure store |
| `runtime/run_abbott_metrika_active_release.py` | `run_abbott_metrika_active_release.py` | `0f7c132b2cbd4f37ce51ceefa8479d36cf30088e2587dcda4cfc36cb29face0d` | Committed-manifest cron launcher |
| `runtime/abbott_release_operator.py` | `abbott_release_operator.py` | `493decb85ca7ac25ae55e125023b1aff3e3146b2a122e190097243790c76067d` | Least-privilege lifecycle CLI with audited staging failure |
| `runtime/probe_yandex_metrika_access.py` | `probe_yandex_metrika_access.py` | `430603922de9cd3cdbc6d0a7dc103f841924087c39462fc137ec8a26684674bc` | Read-only counter access proof |
| `runtime/capture_abbott_canonical_baseline.py` | `capture_abbott_canonical_baseline.py` | `24692288fd1e8c6bf61b0b59b52963c60068df13e068bf4336e6d9fd9ce998e2` | Frozen baseline CLI |
| `runtime/compare_abbott_canonical_release.py` | `compare_abbott_canonical_release.py` | `3cbe72196853ec89d435b214cb7ac106732d94e5b2a05ac95e035e7942d5c015` | Candidate comparator CLI |
| `runtime/abbott_canonical_controls.py` | `abbott_canonical_controls.py` | `cd3fec6f3f12ff464142b924fea2cdb59167fb70c97ed5202fff6637c682e1bb` | Baseline/control evidence library |
| `runtime/metrika_pagination.py` | `metrika_pagination.py` | `7dcb1a05ad8babcc7d696934babb1ab50747ca140c910efc88f3685674386a7c` | Metrika pagination dependency |
| `runtime/backfill_abbott_metrika_2026.py` | `backfill_abbott_metrika_2026.py` | `1dce2c65082a18848d21cf0659d5a52a4258334fc38be25079308afef977bf9c` | Gap-first full-year backfill CLI |
| `runtime/abbott_health_probe.py` | `abbott_health_probe.py` | `6ed7a6c2af250c40ac23bca702a15c2cd60dac5331a392e7e3ac45cc091011ef` | Deterministic Abbott health CLI |
| `runtime/send_canonical_telegram_report.py` | `send_canonical_telegram_report.py` | `8ae155f4f1a81a50fa29730bfe1f7e19e1c01d0ab56719a60327c59b37e22da3` | Summary entrypoint |
| `runtime/sources_health_dashboard.py` | `sources_health_dashboard.py` | `072a3270fa0cac9c7b7384f19aba636485dc89b8c03da2eb80bbde1c50c71116` | Summary health dependency |
| `runtime/agents/__init__.py` | `agents/__init__.py` | `cf17c37c950a6d792c42de4580180ddefa478dbebc01109674658756473d9cc8` | Vendored content-attestor package root |
| `runtime/agents/abbott_page_classifier/__init__.py` | `agents/abbott_page_classifier/__init__.py` | `ea902dc7a2b24b5bdc073342296a16a013af63a3b7afc26789f82e2511f576b0` | Vendored content-attestor package |
| `runtime/agents/abbott_page_classifier/approval_hashes.py` | `agents/abbott_page_classifier/approval_hashes.py` | `93fa7f6751fe00ef75236c588615db1c10b4decfe23b444842b2fa34cdf6f773` | Lightweight canonical approval hash authority |
| `runtime/agents/abbott_page_classifier/candidate_release.py` | `agents/abbott_page_classifier/candidate_release.py` | `cb2fdaa559fcc78e19278aa7144accc8656958974899d3bbfa19c79d1e1cacfb` | Shared content materializer with pre-attested return paths, resume-safe candidate lifecycle receipts, and read-only staging/validated comparison evidence |
| `runtime/agents/abbott_page_classifier/classify.py` | `agents/abbott_page_classifier/classify.py` | `470f8bba006719e58b14cc741eb31f17994fd6981c923fb2d8126c9abfb458eb` | Legacy-compatible deterministic classifier helpers; operational CLI remains disabled |
| `runtime/agents/abbott_page_classifier/domain.py` | `agents/abbott_page_classifier/domain.py` | `5b69f3ec96626a3ded4b201602a8890b49dfda35e8e40f86a97b5ef76e769209` | Content taxonomy domain dependency |
| `runtime/agents/abbott_page_classifier/normalization.py` | `agents/abbott_page_classifier/normalization.py` | `2e8949b8c017e75a54555058ca02fcfb148dafcdf8ce687f4c8f166da9fe7d15` | Content normalization dependency |
| `runtime/agents/abbott_page_classifier/weekly_proposal.py` | `agents/abbott_page_classifier/weekly_proposal.py` | `b17d597a0d0bc2437942a967df253459c1d623b989224ab6f2a2c8404a9fb2a5` | Weekly reconcile/classify/publish entrypoint; direct execution rejects non-3.11 Python and stops for manual approval |
| `runtime/agents/abbott_page_classifier/workflow.py` | `agents/abbott_page_classifier/workflow.py` | `8c10af5cf7181fdb40a9e7527a87260a3078ee6eb7599a790fa09b6ebaac102c` | Sanitized operator workflow CLI; direct execution rejects non-3.11 Python |
| `runtime/agents/abbott_page_classifier/python311_runtime.sh` | `agents/abbott_page_classifier/python311_runtime.sh` | `15a135ba0d6db46c91c238a712f32cf6079b9dcf3761744a261521c677d401d9` | Fail-closed absolute exact-Python-3.11 launcher |
| `runtime/agents/abbott_page_classifier/run_classifier.sh` | `agents/abbott_page_classifier/run_classifier.sh` | `d16f21b08c0b0eee8c8eea50d1ab1d4018c54a373ec5a6a13ddff300d5bf557b` | Reviewed workflow wrapper through the exact-3.11 launcher |
| `runtime/agents/abbott_page_classifier/run_weekly_proposal.sh` | `agents/abbott_page_classifier/run_weekly_proposal.sh` | `71b76309ff5f96084c9d9e62654db9383e957f4a4d4acc821a7c723531243656` | Reviewed weekly proposal wrapper through the exact-3.11 launcher |
| `runtime/agents/abbott_page_classifier/workflow_service.py` | `agents/abbott_page_classifier/workflow_service.py` | `3328e44f9d026b67736dc39773a5c5dc8aa115e5d4483218c51996451b817cb9` | Canonical weekly proposal service |
| `runtime/agents/abbott_page_classifier/workflow_repository.py` | `agents/abbott_page_classifier/workflow_repository.py` | `a10b34116cadcc10470644f532991db221a0162e36eb8d200c7d3a03c40bc687` | MySQL reconciliation staging repository |
| `runtime/agents/abbott_page_classifier/repository.py` | `agents/abbott_page_classifier/repository.py` | `4a3f7978ec45ceb6580cb7c704cc268363108a48b654a8b30319d3b475f4bf82` | Canonical content registry repository |
| `runtime/agents/abbott_page_classifier/local_acceptance.py` | `agents/abbott_page_classifier/local_acceptance.py` | `8f22cf891eaa554889af5a70220c82ce032c80c3ce806262fd667b28e00183e4` | Descriptor-validated local owner acceptance contract |
| `runtime/agents/abbott_page_classifier/batch_service.py` | `agents/abbott_page_classifier/batch_service.py` | `619d3b2ce8018be34c150b4b66c74086d04bf1ee6190eb778e9067d7fca589b7` | Immutable batch construction and acceptance ingestion |
| `runtime/agents/abbott_page_classifier/reconcile.py` | `agents/abbott_page_classifier/reconcile.py` | `d9c81137e2738e88d880baca9140bcdc22206e6c3a2f2f89d34abefa5bd81e9f` | Deterministic reconciliation and anti-flip gate |
| `runtime/agents/abbott_page_classifier/identity.py` | `agents/abbott_page_classifier/identity.py` | `fda1f771f4dd0584382f063351ee092b49faf7bedf1d5fcc09df771570ee35b3` | Canonical identity resolution |
| `runtime/agents/abbott_page_classifier/sources.py` | `agents/abbott_page_classifier/sources.py` | `89580eca78d96442774ba37776c179249726211de871523d716f971230720e6d` | Offline Registry 1/Registry 2 snapshot parsers |
| `runtime/agents/abbott_page_classifier/llm_classifier.py` | `agents/abbott_page_classifier/llm_classifier.py` | `43cfd180f64da3afe74aa8252e644fa4ddecc1d294783f9660274b0b17eb3ce7` | Privacy-minimized classifier adapter, invoked only with execute authorization |
| `runtime/agents/abbott_page_classifier/sheets_sync.py` | `agents/abbott_page_classifier/sheets_sync.py` | `7e1e2ff2487d925d696e7c47426bea018fcf3e5bb3fcb045e3831919824cd31a` | Approval projection publisher and accepted snapshot reader |
| `src/db/migrations/049_abbott_content_reconciliation_staging.sql` | `dashboard-next/src/db/migrations/049_abbott_content_reconciliation_staging.sql` | `783414b93e48edf29c5eece51de21db97bf37d9dfeeb6e01490e12729e6afca9` | Additive reconciliation staging schema; package only, never applied by runtime |
| `src/db/migrations/050_abbott_content_url_identity.sql` | `dashboard-next/src/db/migrations/050_abbott_content_url_identity.sql` | `43340bffb352662ef25f5b9b841de8580d5948ad6d49ff2a47824b5d0be62094` | URL lookup identity schema; package only, never applied by runtime |
| `src/db/migrations/051_abbott_content_url_alias_decisions.sql` | `dashboard-next/src/db/migrations/051_abbott_content_url_alias_decisions.sql` | `59277a9bbde2bc2916effc773acb8a3ec31d6f1bae93be44215fef9320954dab` | Immutable reviewed URL-decision event authority; package only, never applied by runtime |
| `src/db/migrations/052_abbott_content_taxonomy_v2.sql` | `dashboard-next/src/db/migrations/052_abbott_content_taxonomy_v2.sql` | `2ddd08ea9b737d6a10ee4149b765ce0ef536783401b2abb4e5c2ba7e3e2c16c6` | Content-addressed Abbott taxonomy v2 with service pages; package only, never applied by runtime |
| `src/db/migrations/053_abbott_observed_pages_hash.sql` | `dashboard-next/src/db/migrations/053_abbott_observed_pages_hash.sql` | `e81aee4cd8395760622a0e5e9a65817769c14b533c9cc90427adc67a508c2dad` | Aggregate observed-page evidence digest binding; package only, never applied by runtime |
| `src/db/migrations/054_abbott_observed_page_creation.sql` | `dashboard-next/src/db/migrations/054_abbott_observed_page_creation.sql` | `5caff3d07c991e6365e7a26e0af1981fc8bb9bc74c76b70b9b3d58b1b698d409` | Reviewed observed-page creation decision enum; package only, never applied by runtime |
| `src/db/migrations/055_abbott_projection_modality.sql` | `dashboard-next/src/db/migrations/055_abbott_projection_modality.sql` | `912e96c30eac08fdf352699d93173ac2420298c070db9ade95e37a298434eb87` | Disjoint local and Google projection receipts; package only, never applied by runtime |

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
