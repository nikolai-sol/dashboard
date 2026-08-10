# Task 8 report — DB-native metadata-only successor controls

## Delivered

- Exact release-to-release controls now compare `sessions`, `users`,
  `pageviews`, and `goal_conversions` for June, July, and August 1–9 with a
  zero threshold. A changed fact yields `FACT_TOTAL_MISMATCH`; direction/type
  metadata is deliberately excluded from those controls.
- Candidate-page resolution support returns aggregate-only unresolved counts:
  content-like pages require direction and material type; non-content pages
  require `service_page` or a reviewed exclusion. It accepts no URL or visitor
  identifier evidence.
- Runtime authorities were synchronized byte-for-byte and both SHA manifests
  updated. The operator runbook now states the DB-native/no-backfill boundary.

## TDD evidence

The new focused controls initially failed with missing imports for
`compare_metadata_only_fact_totals`; after implementation, both pass:

```text
python3 -m unittest ...test_metadata_only_fact_controls_fail_on_a_cloned_pageview_mutation ...test_metadata_only_fact_controls_ignore_direction_and_type_metadata
Ran 2 tests ... OK
```

## Verification

`python3 -m py_compile abbott_canonical_controls.py
agents/abbott_page_classifier/candidate_release.py` exited 0.

`python3 -m unittest tests.test_abbott_canonical_controls -v` ran 17 tests;
16 passed and one pre-existing environment collection error remains:
`ModuleNotFoundError: No module named 'openai'`, raised while importing
`candidate_release` through `workflow_repository -> llm_classifier`. No
dependency was installed and no external provider, database, service, token,
or source API was contacted.

`git diff --check` exited 0.
