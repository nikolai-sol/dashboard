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

## Corrected verification

The supported offline environment is:

```text
PYTHONPATH=/tmp/abbott-task1-deps:. /Users/nafanya/.local/bin/python3.11
```

With it, the exact Task 8 gate passed:

```text
python -m unittest tests.abbott_page_classifier.test_candidate_release \
  tests.test_abbott_canonical_controls tests.test_abbott_release_operator \
  tests.test_canonical_release_store -v
Ran 123 tests ... OK
```

The full runtime closure passed:

```text
python -m unittest tests.test_abbott_runtime_closure -v
Ran 23 tests ... OK
```

The runtime manifests and root/bootstrap copies were rechecked after the
correction; `shasum -a 256 -c ops/abbott-runtime-manifest.sha256` and
`git diff --check` exit 0. No database, source API, provider, service, token,
or production system was contacted.
