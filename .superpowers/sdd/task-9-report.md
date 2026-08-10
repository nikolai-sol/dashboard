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
- `reconcile --execute` requires explicit Registry 1/Registry 2 paths and returns a new immutable `run_id`; `classify --run-id N --execute` finalizes the numeric `batch_id`; only later batch stages require `--batch-id N`. Dry runs remain batchless/offline inspections.
- `classify` asks for `OPENAI_API_KEY` only for eligible rows with explicit `--execute-llm`; locked/zero-eligible rows make no classifier call. Explicit `--execute-llm` is a deliberately separate non-persistence authorization and may run during a dry-run classification evaluation.
- Only `publish-projection --execute` reaches the injected Sheets gateway. `pull-accepted` reads it only; `materialize` has no Sheets or activation dependency and tests prove no activation call exists.
- The lazy production adapter calls Tasks 1–8 authorities (`ContentRegistryRepository`, projection/pull/ingest helpers, and candidate materialize/validate helpers) only when its matching command reaches that stage. Offline reconciliation uses `reconcile_entity`, not a second merge implementation, and never constructs a repository.
- Results are allow-listed to counts, hashes, status, and candidate release IDs. Tests inject title, URL, and user ID fields and prove stdout omits them.

## Concerns / operational boundary

No live DB, Sheets, OpenAI, source API, secret, migration, deploy, cron, Telegram, Hermes schedule, or release activation was called or changed. The production adapter keeps immutable batch/snapshot loaders and Task-5 classification persistence as explicit injected seams: existing Tasks 1–8 intentionally do not expose a broad mutable-batch loader, so this task does not add a parallel DB read/write path. Supplying those reviewed loaders is required for a separately authorized real operator execution.

Commit: `6c0595cf32e02989390935af6a008965df80bf05`.

## Rejection follow-up

Golden provenance is now regenerated through `evaluation.source_attest_records`.
The fixture binds workbook SHA-256 `d75ad984a0b2168518b0ad74f2d2083f93a780e2433bba102c45e72476b68756`
and a normalized payload/fingerprint for each source-row selection. URLs are
derived only from an exact nonempty source slug (`portal_from_source_slug` or
the one documented `academy_from_source_slug` case); no `reviewed-*` title,
slug, or URL placeholder remains. Two genuinely slug-less source rows remain
locator-insufficient. Classifier output now has an exact four-code schema and
its schema/taxonomy validity, not the expected fixture values, drives hard
gates. `.venv/bin/python -m unittest discover -s tests/abbott_page_classifier -t . -v`
passes 299 tests.

CLI follow-up adds sanitized parser failures, mutually exclusive execute/dry
run flags, a zero-I/O dry-run validate path, explicit execute-time reconciliation
persistence authority, and an executable no-argument compatibility failure.
The production gateway remains lazy; its separately authorized reconciliation
persistence and existing immutable batch/snapshot loader seams are tested with
actual `ProductionWorkflowGateway` construction fakes and make no live call.

Follow-up commit: `384eab1947ddbac2bccb63fe67ca6f1186e4db98`.

## Task 9A/9B correction — canonical weekly proposal pipeline

The rejected pre-existing-batch model has been replaced. Registry 1 and the
accepted Registry 2 capture now create a content-addressed reconciliation run;
classification resumes by numeric `run_id`, creates exactly one immutable
approval batch, and returns its numeric `batch_id`. Publication is the only
Sheet-writing stage. Pull is read-only, ingest resumes from either the published
Sheet or an accepted canonical DB snapshot, and materialization cannot activate.

### Schema and least privilege

- Nested dashboard commit `13b155493be88fed94942893cff1d9775c45789e`
  adds repeat-safe migration 047 with reconciliation runs/items, append-only
  LLM attempts, a nullable unique approval-batch run link, and fail-closed
  `abbott.v1` taxonomy seed/attestation.
- Approval-batch `source_snapshot_ids` continue to bind the predecessor release;
  Registry 1 and Registry 2 have separate capture snapshot IDs, hashes, parser
  versions, and exact source/accepted/rejected/duplicate-collapse accounting.
- `abbott_content_workflow_role` is separate from the materializer and has no
  `DELETE`, release activation, active-pointer, catalog-fact, private-fact, or
  OAuth authority. LLM attempts have no update/delete workflow grant.
- Migrations 033 and 046 stayed byte-for-byte unchanged. Their SHA-256 values
  remain `c3d23b0ccbee8ddf2fd77906f7fe3045dcf7e59b8ed8c4d978dd7d774a56c2aa`
  and `460406eb14d98e32ec8b71576a5fd06812384434ba12c74545e118cc0ac3c456`.

### Repository, service, and operator behavior

The canonical repository now reconstructs persisted approval batches and
accepted snapshots while recomputing item, batch, taxonomy, and acceptance
hashes. `MySqlWorkflowStore` locks the active predecessor and ordered snapshot
digests, preserves eventless entities, repeat-safely bootstraps the baseline,
registers Registry captures, persists and reloads immutable reconciliation
state, appends minimized LLM attempts, creates Registry 1 entities before a
ready batch is finalized, and keeps identity collisions non-ready.

The production gateway has no missing-authority placeholder and remains lazy.
Correct commands are:

```text
reconcile --registry1 PATH --registry2 PATH --execute
classify --run-id N --execute [--execute-llm]
publish-projection --batch-id N --execute
pull-accepted --batch-id N
ingest --batch-id N --execute
materialize --batch-id N --execute
validate --batch-id N
status --batch-id N
```

Write-capable stages default to a zero-authority dry run. Explicit `--dry-run`
for read-only stages also performs zero DB, Sheets, OpenAI, source API, or
materializer calls. `--execute-llm` without `--execute` is zero-call. All errors
and stdout are allow-listed status/ID/count/hash receipts without traceback or
content.

`weekly_proposal.py` requires explicit Registry paths, taxonomy version, prompt
version, model-routing version, and a reviewed 40-hex code revision. Execution
composes only `reconcile -> classify -> publish-projection` and stops for manual
approval. Its dry run does not even construct the gateway. The runbook contains
a reviewed command and candidate weekly cron shape; no schedule was installed.

### RED -> GREEN evidence

RED was captured before each production surface existed:

- migration/schema/grant tests: missing migration caused one nested file failure
  and Python collection failed before running a test;
- workflow service: missing-module import error, followed by an idempotency fake
  failure while the repeat-safe contract was completed;
- persisted batch/snapshot loaders: three missing-method errors;
- concrete MySQL workflow store: missing-module import error;
- corrected CLI: nine failures and one error against the superseded batch-ID
  reconciliation adapter;
- weekly orchestration: missing-module collection error;
- read-only default policy: one dispatch assertion failed before correction.

GREEN verification:

```text
focused schema/grant/repository/service/CLI/weekly: 132 tests, all passed
Abbott page-classifier suite: 319 tests, all passed
dashboard-next npm test: 532 tests, all passed
dashboard-next lint: 0 errors (4 unchanged warnings)
dashboard-next typecheck: passed
dashboard-next public-asset scan: passed
dashboard-next production build: passed
Python py_compile: passed
git diff --check: passed
```

The first full root discovery ran 781 tests with five rehearsal-contract
failures because the committed nested migration revision had not yet been
recorded in the root gitlink. This is an expected attestation gate, not a schema
or runtime failure. After root implementation commit
`43c940a165aebe594e7aac51d6e4aebca91c8e98` recorded nested commit `13b1554`,
the focused rehearsal contract passed 17/17 and full root discovery passed
783/783.

### Deferred live work and concerns

No live DB/Sheet/OpenAI/source API call, migration/grant execution, deployment,
secret change, cron/Hermes/Telegram action, candidate activation, or active
pointer mutation occurred. Installing the workflow-role credentials, applying
migration/grants, selecting live Registry snapshots, and authorizing a first
proposal remain separate reviewed operator work. Task 10 owns bootstrap/runtime
manifest synchronization; Task 9 deliberately did not vendor the new workflow
closure or change Task 8 runtime hashes.

## Task 9 final-review corrections

The final review identified four replay and attestation gaps. All four are now
closed without broadening runtime authority:

- Materialization retry idempotency is anchored in stored batch history. A
  `candidate_materialized` receipt with its numeric `candidate_release_id`
  returns a no-op through a freshly constructed gateway and does not call the
  predecessor loader or materializer again. Missing or misplaced receipts fail
  closed as `CANDIDATE_RECEIPT_INCONSISTENT`.
- Baseline bootstrap is no longer gated by whole-table emptiness. It locks every
  predecessor catalog row, exact-attests each existing entity, alias, and
  baseline event, inserts only missing rows, preserves unrelated eventless
  entities, and rolls back on alias ownership, taxonomy, or event-payload
  conflicts.
- Migration 047 exact-attests any pre-existing `abbott.v1` taxonomy before
  inserting canonical terms. Missing, extra, relabelled, duplicate,
  deprecated, or wrong-evidence rows execute an explicit `SIGNAL SQLSTATE
  '45000'`; only an absent taxonomy is seeded and an exact replay is a no-op.
- Reconciliation-run rehydration now joins the stored taxonomy-version row and
  loads its stored version and digest. Non-v1 versions round-trip correctly;
  stored version/digest mismatches fail closed.

### Final correction RED -> GREEN evidence

RED was captured against the pre-correction code: a fresh-gateway materialize
retry called the materializer twice; partial bootstrap skipped missing catalog
members; migration tests exposed repair-style seeding; and a persisted non-v1
run failed because rehydration hard-coded `abbott.v1`.

GREEN verification after root commit
`cf2e2c571ce90cb56ef56f88562d970ab7220595` and nested dashboard commit
`96f3ebf5b620fb7b15c457882f091a0f2e1fc324`:

```text
focused corrected Python/schema suite: 135 tests, all passed
MySQL rehearsal contracts: 17 tests, all passed
full root discovery: 790 tests, all passed
dashboard-next npm test: 534 tests, all passed
dashboard-next lint: 0 errors (4 unchanged warnings)
dashboard-next typecheck: passed
dashboard-next public-asset scan: passed
dashboard-next production build: passed
Python py_compile: passed
git diff --check: passed
```

Migrations 033 and 046 remain byte-for-byte unchanged at SHA-256
`c3d23b0ccbee8ddf2fd77906f7fe3045dcf7e59b8ed8c4d978dd7d774a56c2aa`
and `460406eb14d98e32ec8b71576a5fd06812384434ba12c74545e118cc0ac3c456`.

No live DB, Sheet, OpenAI, source API, migration/grant execution, deployment,
secret, cron, Hermes, Telegram, release activation, or active-pointer change
occurred. Task 10 runtime-manifest synchronization remains separately reviewed
work.

## Runtime closure completion

### Delivered

- Added a runtime-closure contract covering byte-identical vendored classifier
  authorities, one-and-only-one bootstrap migration `050`, and the exact
  page-identity/Metrika-backfill boundary in all four operator authorities.
- Re-copied the reviewed runtime closure with `install -m 644`; the three
  vendored shell wrappers are intentionally regular mode-`0644` files.
- Regenerated the sorted root SHA-256 inventory and verified every listed file.
  The bootstrap manifest independently verifies all 44 synchronized entries.
- Corrected the stale Task 6 report opening: aliases are mutated only inside
  `record_batch_acceptance`; ingestion remains read-only for aliases.

### RED -> GREEN

Before documentation or manifest work, the new focused contract was run:

```text
python3 -m unittest tests.test_abbott_runtime_closure.AbbottRuntimeClosureTest.test_url_identity_runtime_closure_and_operator_boundary -v
FAILED: all four required operator documents omitted the exact page-identity boundary.
```

After the changes, the same command passed (`Ran 1 test ... OK`).

### Verification commands and results

```text
sha256sum -c ops/abbott-runtime-manifest.sha256
# all 36 attested files: OK

python3 bootstrap-manifest verifier
# bootstrap manifest verified: 44 synchronized entries

PYTHONPATH=/tmp/abbott-task1-deps:. /Users/nafanya/.local/bin/python3.11 -m unittest discover -s tests/abbott_page_classifier -p 'test_*.py'
# Ran 423 tests: FAILED (1 failure, 1 skipped):
# test_normalize_url_wrapper_keeps_string_surface_and_semantic_direction
# expected a lowercase query key; the current normalizer preserves `DIRECTION`.

PYTHONPATH=/tmp/abbott-task1-deps:. /Users/nafanya/.local/bin/python3.11 -m unittest discover -s tests -p 'test_abbott_*.py'
# Ran 200 tests: FAILED (3 errors), all in test_abbott_health_probe because
# healthy_snapshot no longer matches sanitize_snapshot's exact root schema.

PYTHONPATH=/tmp/abbott-task1-deps:. /Users/nafanya/.local/bin/python3.11 -m unittest tests.test_canonical_release_store tests.test_abbott_release_retention
# Ran 45 tests: OK

cd dashboard-next && npm run ci:verify
# passed: public-asset scan, lint (8 warnings, 0 errors), typecheck, and production build
```

### Pre-existing local warnings / blockers

- The established supported Python command is the Python 3.11 executable above
  with `/tmp/abbott-task1-deps` on `PYTHONPATH`; it removes the earlier
  system-Python/dependency blocker. Two pre-existing unrelated failures remain:
  one URL query-key casing compatibility expectation and three exact
  health-probe fixture/schema errors. This task changed only docs, runtime file
  mode, manifests, and the closure assertion; it did not alter either surface.
- `npm run ci:verify` succeeds with eight unchanged lint warnings: five unused
  symbols, two hook dependency warnings, and one unused `DbRow` type.

### Commits

- Nested dashboard/bootstrap: `fa4f966d5175eec78d3d2ffda2d25b138e2489a6`
  (`chore(abbott): attest URL identity runtime`)
- Root closure: `2f10c5b4ab793cf7b5c6ee86fe6d2122ca6ff9fd`
  (`docs(abbott): close URL identity operations`)
