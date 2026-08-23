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
| `lib/canonical_release_store.py` | `canonical_release_store.py` | `bf3b2dd0426af1c68fee8b184cb3ef8ae77c762794f65f5eb40cf79d32748497` | Candidate release store with least-privilege evidence reads, atomic activation, rollback, and audited staging failure management |

## Runnable Abbott runtime closure

The flat `runtime/` directory is an importable deployment unit. It contains
every runbook entrypoint and each repository-local Python dependency.

| Bootstrap path | Root authority | SHA-256 | Runtime role |
| --- | --- | --- | --- |
| `runtime/fetch_yandex_metrika_canonical.py` | `fetch_yandex_metrika_canonical.py` | `406a20103186e4557fdde1ac8998002f94452f8dcca3b5b1f5540a45dca8c588` | Exact five-scope Metrika collector |
| `runtime/canonical_writer.py` | `canonical_writer.py` | `3f287a42d1f79360d49a1f484dee823b70683ec5bd0448a205b0f352219a4e19` | Atomic staging and active append-only writer |
| `runtime/metrika_dashboard_breakdowns.py` | `metrika_dashboard_breakdowns.py` | `879822ee16108abccbb0b0c726d88f6d3835e36f2566d2531bdb4cd1a461f6c8` | Shared dashboard breakdown definitions |
| `runtime/metrika_logs_api.py` | `metrika_logs_api.py` | `16b80558fbeca808d2dc28a8a163c9a2604e50d28a903725728f26cef7f10084` | Exact Metrika Logs request lifecycle and visit parser |
| `runtime/canonical_release_store.py` | `canonical_release_store.py` | `bf3b2dd0426af1c68fee8b184cb3ef8ae77c762794f65f5eb40cf79d32748497` | Exact validation, least-privilege pointer activation, and audited staging-failure store |
| `runtime/run_abbott_metrika_active_release.py` | `run_abbott_metrika_active_release.py` | `907cfc442f29563814f0fc0cc9ee5d3fc976e7b841e027ccab4d88547450d8e7` | Committed-manifest cron launcher |
| `runtime/abbott_release_operator.py` | `abbott_release_operator.py` | `493decb85ca7ac25ae55e125023b1aff3e3146b2a122e190097243790c76067d` | Least-privilege lifecycle CLI with audited staging failure |
| `runtime/probe_yandex_metrika_access.py` | `probe_yandex_metrika_access.py` | `430603922de9cd3cdbc6d0a7dc103f841924087c39462fc137ec8a26684674bc` | Read-only counter access proof |
| `runtime/capture_abbott_canonical_baseline.py` | `capture_abbott_canonical_baseline.py` | `24692288fd1e8c6bf61b0b59b52963c60068df13e068bf4336e6d9fd9ce998e2` | Frozen baseline CLI |
| `runtime/compare_abbott_canonical_release.py` | `compare_abbott_canonical_release.py` | `3cbe72196853ec89d435b214cb7ac106732d94e5b2a05ac95e035e7942d5c015` | Candidate comparator CLI |
| `runtime/abbott_canonical_controls.py` | `abbott_canonical_controls.py` | `25c30e54f3a38b0d2f8d8e121d98510c3b8ed2269daabf302557f9cdcf0a0c9b` | Baseline/control evidence library |
| `runtime/abbott_mnn_successor.py` | `abbott_mnn_successor.py` | `8a9e1fd1f32950875d7097aa0e9c2bf619802d16d74473966fb308876a62dcd9` | MNN successor operator entrypoint |
| `runtime/metrika_pagination.py` | `metrika_pagination.py` | `7dcb1a05ad8babcc7d696934babb1ab50747ca140c910efc88f3685674386a7c` | Metrika pagination dependency |
| `runtime/backfill_abbott_metrika_2026.py` | `backfill_abbott_metrika_2026.py` | `1dce2c65082a18848d21cf0659d5a52a4258334fc38be25079308afef977bf9c` | Gap-first full-year backfill CLI |
| `runtime/abbott_health_probe.py` | `abbott_health_probe.py` | `6ed7a6c2af250c40ac23bca702a15c2cd60dac5331a392e7e3ac45cc091011ef` | Deterministic Abbott health CLI |
| `runtime/send_canonical_telegram_report.py` | `send_canonical_telegram_report.py` | `8ae155f4f1a81a50fa29730bfe1f7e19e1c01d0ab56719a60327c59b37e22da3` | Summary entrypoint |
| `runtime/sources_health_dashboard.py` | `sources_health_dashboard.py` | `072a3270fa0cac9c7b7384f19aba636485dc89b8c03da2eb80bbde1c50c71116` | Summary health dependency |
| `runtime/agents/__init__.py` | `agents/__init__.py` | `cf17c37c950a6d792c42de4580180ddefa478dbebc01109674658756473d9cc8` | Vendored content-attestor package root |
| `runtime/agents/abbott_page_classifier/__init__.py` | `agents/abbott_page_classifier/__init__.py` | `ea902dc7a2b24b5bdc073342296a16a013af63a3b7afc26789f82e2511f576b0` | Vendored content-attestor package |
| `runtime/agents/abbott_page_classifier/approval_hashes.py` | `agents/abbott_page_classifier/approval_hashes.py` | `06f66dae8fcd878ab824a27876902f01f6daef73ed5fe3b055168e2461b9a78c` | Lightweight canonical approval hash authority |
| `runtime/agents/abbott_page_classifier/candidate_release.py` | `agents/abbott_page_classifier/candidate_release.py` | `af80254ea14dce81e97be55c4fe27056e973afd15f0a3deb35e95589cb8b9f7d` | Shared content materializer with active-catalog authority, entity continuity, exact direction deltas, and MNN controls |
| `runtime/agents/abbott_page_classifier/entity_continuity.py` | `agents/abbott_page_classifier/entity_continuity.py` | `6dcd39eaf1e5e0e2a81b53cdf60468cd690e714c365bfa15bf1ce36294a3fe86` | Reviewed predecessor-to-candidate entity continuity authority |
| `runtime/agents/abbott_page_classifier/classify.py` | `agents/abbott_page_classifier/classify.py` | `470f8bba006719e58b14cc741eb31f17994fd6981c923fb2d8126c9abfb458eb` | Legacy-compatible deterministic classifier helpers; operational CLI remains disabled |
| `runtime/agents/abbott_page_classifier/domain.py` | `agents/abbott_page_classifier/domain.py` | `572ea1e6516706c092ef051c9ef84751ca616a8bd28055763cbb5d8ffb520a74` | Content taxonomy domain dependency |
| `runtime/agents/abbott_page_classifier/normalization.py` | `agents/abbott_page_classifier/normalization.py` | `2e8949b8c017e75a54555058ca02fcfb148dafcdf8ce687f4c8f166da9fe7d15` | Content normalization dependency |
| `runtime/agents/abbott_page_classifier/local_acceptance.py` | `agents/abbott_page_classifier/local_acceptance.py` | `1e91aff4cc8a2a145b925f5034eacbf0548f4154f858757c38363a16009584ff` | Descriptor-safe owner-only local acceptance authority |
| `runtime/agents/abbott_page_classifier/weekly_proposal.py` | `agents/abbott_page_classifier/weekly_proposal.py` | `b17d597a0d0bc2437942a967df253459c1d623b989224ab6f2a2c8404a9fb2a5` | Weekly reconcile/classify/publish entrypoint; direct execution rejects non-3.11 Python and stops for manual approval |
| `runtime/agents/abbott_page_classifier/mnn.py` | `agents/abbott_page_classifier/mnn.py` | `cc52405d12229554d5474f2e6c4736524f50bb14563a3e5829968562cbf1f703` | MNN workbook normalization and parsing authority |
| `runtime/agents/abbott_page_classifier/mnn_decisions.py` | `agents/abbott_page_classifier/mnn_decisions.py` | `a03ac34f8574959eac22118e8a9daab9ba645f342c9eea4ca442b3bccc3d126b` | Optional primary/additional MNN review authority |
| `runtime/agents/abbott_page_classifier/mnn_operator.py` | `agents/abbott_page_classifier/mnn_operator.py` | `aaa8c7116f354a432437cc90fea600931d1c0f0a402759b1dc37252bf3dc5472` | Reviewed MNN import operator |
| `runtime/agents/abbott_page_classifier/mnn_projection.py` | `agents/abbott_page_classifier/mnn_projection.py` | `0cf1f1efc0c9ad7605ce086d91e1e40b6f4c91146b7a329747b645b682262312` | Exact MNN successor projection across entity continuity |
| `runtime/agents/abbott_page_classifier/mnn_repository.py` | `agents/abbott_page_classifier/mnn_repository.py` | `1844b0165082dd887c2465a6f66e3047fe868ae00f18ac63a9363d5537e2b84d` | Transactional MNN snapshot and claim repository |
| `runtime/agents/abbott_page_classifier/workflow.py` | `agents/abbott_page_classifier/workflow.py` | `097b1c6365bf66f57880c736ed83e2391b3b9f5595009d4da8cf87cac9735ff6` | Sanitized operator workflow CLI; direct execution rejects non-3.11 Python |
| `runtime/agents/abbott_page_classifier/python311_runtime.sh` | `agents/abbott_page_classifier/python311_runtime.sh` | `15a135ba0d6db46c91c238a712f32cf6079b9dcf3761744a261521c677d401d9` | Fail-closed absolute exact-Python-3.11 launcher |
| `runtime/agents/abbott_page_classifier/run_classifier.sh` | `agents/abbott_page_classifier/run_classifier.sh` | `d16f21b08c0b0eee8c8eea50d1ab1d4018c54a373ec5a6a13ddff300d5bf557b` | Reviewed workflow wrapper through the exact-3.11 launcher |
| `runtime/agents/abbott_page_classifier/run_weekly_proposal.sh` | `agents/abbott_page_classifier/run_weekly_proposal.sh` | `71b76309ff5f96084c9d9e62654db9383e957f4a4d4acc821a7c723531243656` | Reviewed weekly proposal wrapper through the exact-3.11 launcher |
| `runtime/agents/abbott_page_classifier/workflow_service.py` | `agents/abbott_page_classifier/workflow_service.py` | `b29151a9063433327dc04e1e1bb3e0e3e3d4a937f43fce4f5b1d1b4f6073ec93` | Canonical weekly proposal service |
| `runtime/agents/abbott_page_classifier/workflow_repository.py` | `agents/abbott_page_classifier/workflow_repository.py` | `46918a2056993d9f7a4c5c3a093b45654b6f42136671940bf8370787b1198cdc` | MySQL reconciliation staging repository bound to active catalog authority |
| `runtime/agents/abbott_page_classifier/repository.py` | `agents/abbott_page_classifier/repository.py` | `bb4ca90055af8cf338afd298f9f03e2a04605ab7a2f3be1f6e88204bc6ab50e8` | Canonical content registry repository |
| `runtime/agents/abbott_page_classifier/batch_service.py` | `agents/abbott_page_classifier/batch_service.py` | `546899fdcde7a225467f7e72437973a2faab9bd256613ced88e2c089dc6884e6` | Immutable batch construction and acceptance ingestion |
| `runtime/agents/abbott_page_classifier/reconcile.py` | `agents/abbott_page_classifier/reconcile.py` | `73a4aff2e193815e111d577b9721d205c79c99e6da98563148e1f5c8d76bff13` | Deterministic reconciliation and anti-flip gate |
| `runtime/agents/abbott_page_classifier/identity.py` | `agents/abbott_page_classifier/identity.py` | `fda1f771f4dd0584382f063351ee092b49faf7bedf1d5fcc09df771570ee35b3` | Canonical identity resolution |
| `runtime/agents/abbott_page_classifier/sources.py` | `agents/abbott_page_classifier/sources.py` | `963e717859bbb5a88465fc98f7e599a59de8461cd6dbc00abc975d2949ac9615` | Offline Registry 1/Registry 2/MNN snapshot parsers |
| `runtime/agents/abbott_page_classifier/llm_classifier.py` | `agents/abbott_page_classifier/llm_classifier.py` | `43cfd180f64da3afe74aa8252e644fa4ddecc1d294783f9660274b0b17eb3ce7` | Privacy-minimized classifier adapter, invoked only with execute authorization |
| `runtime/agents/abbott_page_classifier/sheets_sync.py` | `agents/abbott_page_classifier/sheets_sync.py` | `12b8b17ef3121e333f93ccac91ea43c641ca110673750f0ee19d85aad53f1097` | Approval projection publisher and accepted snapshot reader |
| `src/db/migrations/049_abbott_content_reconciliation_staging.sql` | `dashboard-next/src/db/migrations/049_abbott_content_reconciliation_staging.sql` | `783414b93e48edf29c5eece51de21db97bf37d9dfeeb6e01490e12729e6afca9` | Additive reconciliation staging schema; package only, never applied by runtime |
| `src/db/migrations/050_abbott_content_url_identity.sql` | `dashboard-next/src/db/migrations/050_abbott_content_url_identity.sql` | `43340bffb352662ef25f5b9b841de8580d5948ad6d49ff2a47824b5d0be62094` | URL lookup identity schema; package only, never applied by runtime |
| `src/db/migrations/051_abbott_content_url_alias_decisions.sql` | `dashboard-next/src/db/migrations/051_abbott_content_url_alias_decisions.sql` | `d58475989f43d43541094db4fef39c5ac23f9759f8c9a0e9766ecfa1c0f7710f` | Immutable reviewed URL-decision event authority; package only, never applied by runtime |
| `src/db/migrations/052_abbott_content_taxonomy_v2.sql` | `dashboard-next/src/db/migrations/052_abbott_content_taxonomy_v2.sql` | `2ddd08ea9b737d6a10ee4149b765ce0ef536783401b2abb4e5c2ba7e3e2c16c6` | Reviewed service-page taxonomy v2; package only, never applied by runtime |
| `src/db/migrations/053_abbott_observed_pages_hash.sql` | `dashboard-next/src/db/migrations/053_abbott_observed_pages_hash.sql` | `e81aee4cd8395760622a0e5e9a65817769c14b533c9cc90427adc67a508c2dad` | Immutable observed-page aggregate hash; package only, never applied by runtime |
| `src/db/migrations/054_abbott_observed_page_creation.sql` | `dashboard-next/src/db/migrations/054_abbott_observed_page_creation.sql` | `5caff3d07c991e6365e7a26e0af1981fc8bb9bc74c76b70b9b3d58b1b698d409` | Reviewed local observed-page creation decision; package only, never applied by runtime |
| `src/db/migrations/055_abbott_projection_modality.sql` | `dashboard-next/src/db/migrations/055_abbott_projection_modality.sql` | `912e96c30eac08fdf352699d93173ac2420298c070db9ade95e37a298434eb87` | Disjoint local and Google projection receipts; package only, never applied by runtime |
| `src/db/migrations/060_abbott_content_mnn.sql` | `dashboard-next/src/db/migrations/060_abbott_content_mnn.sql` | `02f860151017f4431fe73e6aafee845fe9fd1aed57a2ead57bad441e63a455c4` | Release-scoped multi-value MNN metadata; package only, never applied by runtime |
| `src/db/migrations/061_abbott_optional_mnn_decisions.sql` | `dashboard-next/src/db/migrations/061_abbott_optional_mnn_decisions.sql` | `053048d6f0266d38e63d449f8571d25b1938d8e764950a8d9d5a2755c875f41d` | Optional primary/additional MNN approval and immutable event authority; package only, never applied by runtime |
| `src/db/migrations/062_abbott_admin_user_exclusions.sql` | `dashboard-next/src/db/migrations/062_abbott_admin_user_exclusions.sql` | `d6e4c64eb2aca0c1198f640d135c2c95b648f3bebadf82015823c4c25f491ab1` | Private dashboard-scoped administrator User ID settings; package only, never copied to public facts |

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
