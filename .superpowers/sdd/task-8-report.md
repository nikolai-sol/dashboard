# Task 8 report — DB-native metadata-only successor controls

## Delivered

- Exact release-to-release controls now compare `sessions`, `users`,
  `pageviews`, and `goal_conversions` for June, July, and August 1–9 with a
  zero threshold. A changed fact yields `FACT_TOTAL_MISMATCH`; direction/type
  metadata is deliberately excluded from those controls.
- Candidate-page resolution support returns aggregate-only unresolved counts:
  content-like pages require direction and material type; non-content pages
  require `service_page` or an immutable accepted `reject` URL-decision event
  bound to the candidate batch and accepted-decision hash. It accepts no URL,
  private-visit, or visitor identifier evidence.
- The aggregate gate hashes the canonical `scope_dimensions.page_url` only for
  its SQL joins; it does not select URLs into evidence. It never reads
  `raw_payload`, private visit facts, or raw IDs.
- The transition requires exactly the 14 content controls and all 12 fixed
  fact-total controls. An incomplete or fabricated `GateReport` fails closed
  with `FACT_TOTAL_EVIDENCE_INVALID` before any lifecycle update.
- Runtime authorities were synchronized byte-for-byte and both SHA manifests
  updated. The operator runbook now states the DB-native/no-backfill boundary.

## TDD evidence

The production-boundary tests were written before the corresponding hardening
and initially exposed the incorrect `raw_payload` join, nonexistent mutable
`reviewed_exclusion` alias authority, and incomplete evidence set. They now
exercise `validate_content_candidate` and
`validate_and_transition_content_candidate` without a fabricated gate report:

```text
...test_real_validation_blocks_a_candidate_pageview_mutation_before_transition
...test_real_validation_blocks_observed_content_without_direction_or_type
...test_real_validation_blocks_non_content_without_service_page_or_reviewed_exclusion
...test_real_validation_writes_exact_full_control_evidence_before_validating
...test_transition_rejects_a_gate_report_that_omits_required_fact_controls
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
Ran 128 tests ... OK
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
