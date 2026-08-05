# Task 9 report — golden evaluation and operator CLI

## Delivered files

- `agents/abbott_page_classifier/evaluation.py` — offline, versioned golden evaluator and fixture CLI.
- `agents/abbott_page_classifier/evals/golden.v1.jsonl` — reviewed content-metadata-only fixture.
- `agents/abbott_page_classifier/workflow.py` — injected operator CLI and lazy production authority adapter.
- `agents/abbott_page_classifier/run_classifier.sh` — compatibility delegation only; the legacy classifier/Sheets body is unreachable.
- `tests/abbott_page_classifier/test_evaluation.py` and `test_workflow.py` — evaluation, privacy, orchestration, command-order, replay, and boundary contracts.
- `tests/fixtures/abbott_registry1_minimal.xlsx` — offline Registry 1 fixture required by the prescribed end-to-end command.

## Golden fixture coverage and derivation

`golden.v1.jsonl` contains exactly **80** reviewed records. Its metadata documents deterministic selection: earliest populated `pages` rows selected first by canonical material type, then source direction, then source-row order; source-derived archive and insufficient-evidence review rows are appended from named content sheets. Each row retains only content metadata, expected taxonomy codes, a reviewed source sheet/row ordinal, and a SHA-256 content fingerprint. It contains no source filesystem path, visit/user/client/behavior data, email, phone, OAuth value, token, or secret.

The source workbook has **17 populated canonical material-type codes**: `articles`, `video`, `tables`, `clinical_guidelines`, `calculators`, `clinical_cases`, `educational_brochures`, `products`, `pharmacist_assistant`, `podcasts`, `personal_effectiveness`, `knowledge_check`, `pharmacy_consulting_algorithms`, `child_nutrition`, `devices`, `respiratory_assistant`, and `clinical_decision_support`. All 17 are fixture-covered. `Архив` is lifecycle evidence and was not counted as a material type.

Source-labelled directions are **7**: cardiology, gastroenterology, neurology/psychiatry, women’s health, respiratory health, diabetes management, and pharmacists. The fixture also has a reviewed `undetermined` insufficient-evidence row. The workbook contains no source-labelled dermatology or `not_applicable` record; metadata and tests explicitly record that absence rather than fabricate evidence. Edge coverage includes generic `/academy/` review paths, duplicate slug evidence, restricted access, archive candidate, insufficient evidence, and **8** locked anti-flip records.

## RED → GREEN evidence

RED was captured before production code:

- `python3 -m unittest tests.abbott_page_classifier.test_evaluation tests.abbott_page_classifier.test_workflow -v` initially failed with missing `evaluation` and `workflow` imports.
- Fixture contract initially failed with `FileNotFoundError` for `golden.v1.jsonl`.
- Wrapper contract initially failed because `run_classifier.sh` still contained the old Sheets-publish body.

GREEN:

```text
python3 -m unittest tests.abbott_page_classifier.test_evaluation tests.abbott_page_classifier.test_workflow -v
Ran 14 tests ... OK

python3 agents/abbott_page_classifier/evaluation.py --fixture agents/abbott_page_classifier/evals/golden.v1.jsonl --classifier fixture
record_count=80 direction_accuracy=1.0 material_type_accuracy=1.0
anti_flip=8/8 taxonomy_valid=80/80 schema_compliant=80/80 unresolved=0 gate_passed=true

python3 agents/abbott_page_classifier/workflow.py reconcile --registry1 tests/fixtures/abbott_registry1_minimal.xlsx --registry2 tests/fixtures/abbott_registry2_accepted_minimal.csv --dry-run
source_count=9 ready_count=7 conflict_count=0 unresolved_count=0 rejected_count=1
```

The wider classifier suite ran **245 tests successfully**; its only failure was pre-existing environment dependency collection for `test_llm_classifier` (`ModuleNotFoundError: openai`). No dependency was installed and no external provider was contacted.

## CLI safety proofs

- Fixed command set: `reconcile`, `classify`, `publish-projection`, `pull-accepted`, `ingest`, `materialize`, `validate`, `status`.
- Every `--execute` stage, including `reconcile`, rejects a missing `--batch-id`; dry-run remains batchless for offline inspection.
- `classify` asks for `OPENAI_API_KEY` only for eligible rows with explicit `--execute-llm`; locked/zero-eligible rows make no classifier call. Explicit `--execute-llm` is a deliberately separate non-persistence authorization and may run during a dry-run classification evaluation.
- Only `publish-projection --execute` reaches the injected Sheets gateway. `pull-accepted` reads it only; `materialize` has no Sheets or activation dependency and tests prove no activation call exists.
- The lazy production adapter calls Tasks 1–8 authorities (`ContentRegistryRepository`, projection/pull/ingest helpers, and candidate materialize/validate helpers) only when its matching command reaches that stage. Offline reconciliation uses `reconcile_entity`, not a second merge implementation, and never constructs a repository.
- Results are allow-listed to counts, hashes, status, and candidate release IDs. Tests inject title, URL, and user ID fields and prove stdout omits them.

## Concerns / operational boundary

No live DB, Sheets, OpenAI, source API, secret, migration, deploy, cron, Telegram, Hermes schedule, or release activation was called or changed. The production adapter keeps immutable batch/snapshot loaders and Task-5 classification persistence as explicit injected seams: existing Tasks 1–8 intentionally do not expose a broad mutable-batch loader, so this task does not add a parallel DB read/write path. Supplying those reviewed loaders is required for a separately authorized real operator execution.

Commit: pending.
