# Abbott Content Registry, LLM Classification, and Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an auditable Abbott material-registry pipeline that merges both supplied registries without overwriting active canonical classifications, proposes direction and material type with deterministic rules plus OpenAI models, routes conflicts through Google Sheets, and materializes approved decisions into a validated successor release.

**Architecture:** Python collectors and workflow commands read immutable source artifacts and canonical MySQL, resolve stable content identities, apply canonical locks, run deterministic and LLM proposal stages, and persist a database-backed approval batch. Google Sheets is a mutable human review projection; an accepted cell snapshot is hashed and ingested transactionally into append-only classification events. Only a reviewed successor release populates `portal_content_catalog` and `portal_content_lookup_projection`, so dashboard request paths remain MySQL-only.

**Tech Stack:** Python 3.11, `unittest`, MySQL 8/InnoDB, OpenAI Python SDK Responses API with Pydantic Structured Outputs, Google Sheets/Drive APIs, TypeScript 5, Node test runner, Next.js 16.

## Global Constraints

- Work in an isolated implementation worktree created with `using-git-worktrees`; preserve the existing user changes in `dashboard-next/src/lib/manual-data-fetcher.ts` and `dashboard-next/src/lib/manual-data-fetcher.test.ts`.
- Canonical MySQL is the only dashboard runtime source. Dashboard request, render, filter, export, and read-model code must not call Google Sheets, OpenAI, source APIs, or use source OAuth tokens.
- The active Abbott release is immutable. Registry 1 may add missing entities and missing metadata; it never overwrites nonempty active direction, material type, or access values.
- Every incoming direction, material-type, or access disagreement with active canonical data becomes a review conflict.
- Registry 2 batch `2026-07-21 10:55 UTC` is business-approved input, but all 377 rows must reconcile: the observed 143 rows without direction remain unresolved, and technical gates still control materialization and activation.
- `Архив` is lifecycle state, never a material type. Only an explicit archive override or HTTP 404/410 evidence can create `archive_candidate`; transport failure and HTTP 500 cannot.
- A stable entity with an approved direction cannot change direction automatically. A change requires an explicit `correct` event with final value, reason, approver, batch, predecessor event, and timestamp.
- Deterministic rules run first. `gpt-5.6-terra` proposes missing classification; `gpt-5.6-sol` verifies low-confidence, ambiguous, or rule-disagreement cases. LLM output is never an active write.
- OpenAI requests use the Responses API, `store=False`, a strict Pydantic/JSON schema, one material per logical request, and no tools. Raw User ID, visit ID, client ID, per-user behavior, and private visit rows are excluded.
- Access-restricted professional medical content may be sent to the classifier. Aggregate audience signals remain disabled in this release.
- Every production-code change follows red-green-refactor and is committed at its task boundary.
- Implementation does not authorize a production migration, deployment, secret installation, source API call, Google Sheet mutation, cron edit, Telegram send, Hermes schedule, or release activation.

## File and Responsibility Map

### New Python modules

- `agents/abbott_page_classifier/domain.py` — immutable taxonomy codes, workflow dataclasses, enums, and serialization contracts shared by every stage.
- `agents/abbott_page_classifier/normalization.py` — URL, title, slug, label, access, lifecycle, and hash normalization.
- `agents/abbott_page_classifier/sources.py` — Registry 1 workbook, Registry 2 snapshot, and canonical catalog readers.
- `agents/abbott_page_classifier/identity.py` — strong/weak alias resolution and identity-collision decisions.
- `agents/abbott_page_classifier/reconcile.py` — precedence, anti-flip, conflict, unresolved, and ready-item state machine.
- `agents/abbott_page_classifier/repository.py` — parameterized workflow-table reads and transactional writes.
- `agents/abbott_page_classifier/llm_classifier.py` — OpenAI adapter, strict schema, retry, verifier routing, and sanitized telemetry.
- `agents/abbott_page_classifier/batch_service.py` — batch construction, immutable hashes, approval ingestion, and event creation.
- `agents/abbott_page_classifier/candidate_release.py` — successor catalog/lookup materialization and publication gates.
- `agents/abbott_page_classifier/workflow.py` — operator CLI that composes the modules without runtime dashboard coupling.
- `agents/abbott_page_classifier/evaluation.py` — versioned golden-set runner and threshold report.

### Existing files to modify

- `agents/abbott_page_classifier/classify.py` — retain the CLI compatibility surface while delegating normalized deterministic rules to the new modules.
- `agents/abbott_page_classifier/sheets_sync.py` — publish/pull the database-backed tabs and exact row/batch hashes.
- `agents/abbott_page_classifier/README.md` and `PROCESS.md` — document dry-run, approval, ingestion, materialization, and activation boundaries.
- `requirements.txt` — add bounded OpenAI, Pydantic, openpyxl, and Google client dependencies used by the workflow.
- `dashboard-next/src/lib/abbott-private-store.test.ts` — prove the activated catalog remains the only content read path and the new workflow tables are never queried by dashboard requests.

### New schema and tests

- `dashboard-next/src/db/migrations/045_abbott_content_registry_workflow.sql` — canonical taxonomy, entity, alias, batch, item, and event tables.
- `dashboard-next/src/db/abbott-content-registry-workflow-migration.test.ts` — repeat-safe migration contract.
- `tests/test_abbott_content_registry_schema.py` — static schema, privacy, and append-only invariants.
- `tests/abbott_page_classifier/` — focused Python unit and integration tests.
- `agents/abbott_page_classifier/evals/golden.v1.jsonl` — reviewed, nonprivate evaluation examples with immutable expected codes.
- `ops/runbooks/abbott_content_registry.md` — sanitized local/reviewed rollout procedure.

---

### Task 1: Canonical taxonomy and normalization package

**Files:**
- Create: `agents/abbott_page_classifier/__init__.py`
- Create: `agents/abbott_page_classifier/domain.py`
- Create: `agents/abbott_page_classifier/normalization.py`
- Create: `tests/abbott_page_classifier/__init__.py`
- Create: `tests/abbott_page_classifier/test_domain.py`
- Create: `tests/abbott_page_classifier/test_normalization.py`
- Modify: `agents/abbott_page_classifier/classify.py`

**Interfaces:**
- Produces: `TaxonomyVersion`, `MaterialCandidate`, `CanonicalClassification`, `Proposal`, `ApprovalItem`, `ApprovalBatch`, `AcceptedBatchSnapshot`, `ClassificationEvent`, `IngestResult`, and `ConflictCode`.
- Produces: `normalize_url(raw: str) -> NormalizedUrl`, `normalize_title(raw: str) -> str`, `normalize_taxonomy_label(kind: TaxonomyKind, raw: str) -> str | None`, and `sha256_text(value: str) -> str`.
- Preserves: `classify.normalize_url`, `classify.extract_slug`, and existing CLI output fields as compatibility wrappers.

- [ ] **Step 1: Write taxonomy and normalization RED tests**

```python
from agents.abbott_page_classifier.domain import MATERIAL_TYPE_CODES, DIRECTION_CODES
from agents.abbott_page_classifier.normalization import normalize_taxonomy_label, normalize_url

def test_archive_is_not_a_material_type():
    assert "archive" not in MATERIAL_TYPE_CODES
    assert normalize_taxonomy_label("material_type", "Архив") is None

def test_known_variants_normalize_to_codes():
    assert normalize_taxonomy_label("material_type", "КР") == "clinical_guidelines"
    assert normalize_taxonomy_label("material_type", "Научно-брошюры") == "educational_brochures"
    assert normalize_taxonomy_label("direction", "Дерматология") == "dermatology"
    assert normalize_taxonomy_label("access", "фарм") == "pharmacists"

def test_url_normalization_preserves_semantic_query_and_drops_tracking():
    result = normalize_url("HTTPS://ABBOTTPRO.RU/cardio/?utm_source=x&DIRECTION=262338#top")
    assert result.value == "https://abbottpro.ru/cardio?direction=262338"
    assert len(result.sha256) == 64
```

- [ ] **Step 2: Run RED**

Run: `python3 -m unittest tests.abbott_page_classifier.test_domain tests.abbott_page_classifier.test_normalization -v`

Expected: FAIL because `domain.py` and `normalization.py` do not exist.

- [ ] **Step 3: Implement the immutable domain contracts**

```python
TaxonomyKind = Literal["direction", "material_type", "access", "lifecycle"]

@dataclass(frozen=True)
class NormalizedUrl:
    value: str
    path: str
    sha256: str
    path_sha256: str

@dataclass(frozen=True)
class MaterialCandidate:
    source_name: str
    source_row_id: str
    title: str
    url: str
    material_id: str | None
    direction_code: str | None
    material_type_code: str | None
    access_code: str | None
    lifecycle_code: str
    source_fingerprint: str
```

Define the exact codes and labels from the approved specification, including `dermatology = Дерматология [624635]`, and reject free-form values. Normalize percent encoding, fragments, trailing slashes, tracking parameters, and semantic `direction` query keys deterministically.

- [ ] **Step 4: Replace duplicated classifier constants with compatibility wrappers**

Keep current Russian-label JSONL/CSV output stable, but source all direction/material/access dictionaries from `domain.py`. Map the old `page_status == "Архив"` field to lifecycle `archive_candidate`; never add `Архив` to `MATERIAL_TYPES`.

- [ ] **Step 5: Run GREEN and compile**

```bash
python3 -m unittest tests.abbott_page_classifier.test_domain tests.abbott_page_classifier.test_normalization -v
python3 -m py_compile agents/abbott_page_classifier/domain.py agents/abbott_page_classifier/normalization.py agents/abbott_page_classifier/classify.py
```

Expected: all tests PASS and compilation exits 0.

- [ ] **Step 6: Commit**

```bash
git add agents/abbott_page_classifier/__init__.py agents/abbott_page_classifier/domain.py agents/abbott_page_classifier/normalization.py agents/abbott_page_classifier/classify.py tests/abbott_page_classifier
git commit -m "refactor: define Abbott content taxonomy contracts"
```

---

### Task 2: Canonical workflow schema and repository

**Files:**
- Create: `dashboard-next/src/db/migrations/045_abbott_content_registry_workflow.sql`
- Create: `dashboard-next/src/db/abbott-content-registry-workflow-migration.test.ts`
- Create: `tests/test_abbott_content_registry_schema.py`
- Create: `agents/abbott_page_classifier/repository.py`
- Create: `tests/abbott_page_classifier/test_repository.py`

**Interfaces:**
- Produces tables: `portal_content_registry_entities`, `portal_content_registry_aliases`, `portal_content_taxonomy_versions`, `portal_content_taxonomy_terms`, `portal_content_approval_batches`, `portal_content_approval_items`, and `portal_content_classification_events`.
- Produces: `ContentRegistryRepository.load_active_catalog()`, `create_batch(batch)`, `insert_items(batch_id, items)`, `ingest_accepted_snapshot(snapshot)`, and `load_effective_classifications()`.
- All DB writes accept an injected PEP-249 connection for unit tests and use `%s` parameters.

- [ ] **Step 1: Write migration RED tests**

```typescript
test("migration 045 creates append-only Abbott registry workflow tables", () => {
  const sql = readFileSync(path.resolve("src/db/migrations/045_abbott_content_registry_workflow.sql"), "utf8");
  for (const table of [
    "portal_content_registry_entities",
    "portal_content_registry_aliases",
    "portal_content_taxonomy_versions",
    "portal_content_taxonomy_terms",
    "portal_content_approval_batches",
    "portal_content_approval_items",
    "portal_content_classification_events",
  ]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /UNIQUE KEY uniq_registry_strong_alias/);
  assert.match(sql, /accepted_decision_hash CHAR\(64\)/);
  assert.doesNotMatch(sql, /raw_user_id|visit_id|client_id/i);
});
```

The Python static test also requires foreign keys, InnoDB, `dataset_key = 'abbott'` scoping, immutable event fingerprints, and no `UPDATE portal_content_classification_events` statement.

- [ ] **Step 2: Run schema RED**

```bash
cd dashboard-next
node --import tsx --test src/db/abbott-content-registry-workflow-migration.test.ts
cd ..
python3 -m unittest tests.test_abbott_content_registry_schema -v
```

Expected: FAIL because migration 045 does not exist.

- [ ] **Step 3: Create the repeat-safe InnoDB schema**

Use these exact uniqueness grains:

```sql
UNIQUE KEY uniq_registry_entity_dataset_id (dataset_key, id);
UNIQUE KEY uniq_registry_material_id (dataset_key, material_id);
UNIQUE KEY uniq_registry_strong_alias (dataset_key, alias_type, alias_hash, uniqueness_scope);
UNIQUE KEY uniq_taxonomy_code (taxonomy_version_id, taxonomy_kind, term_code);
UNIQUE KEY uniq_approval_batch_key (dataset_key, batch_key);
UNIQUE KEY uniq_approval_batch_entity (approval_batch_id, content_entity_id, input_hash);
UNIQUE KEY uniq_classification_event_fingerprint (event_fingerprint);
```

Store source/proposal evidence as JSON, restrict status fields with enums, and index open items by `(approval_batch_id, readiness_state, conflict_code)`. Do not add triggers that mutate historical events.

- [ ] **Step 4: Write repository transaction RED tests**

Using a recording fake connection, assert that `ingest_accepted_snapshot` locks the batch with `SELECT ... FOR UPDATE`, checks published and accepted hashes, inserts items/events, updates only batch status, commits once, rolls back on any row failure, and returns a no-op for the same accepted hash.

- [ ] **Step 5: Implement the minimal repository**

```python
class ContentRegistryRepository:
    def __init__(self, connection_factory: Callable[[], Connection]): ...
    def load_active_catalog(self) -> tuple[CanonicalClassification, ...]: ...
    def create_batch(self, batch: ApprovalBatch) -> int: ...
    def insert_items(self, batch_id: int, items: Sequence[ApprovalItem]) -> None: ...
    def ingest_accepted_snapshot(self, snapshot: AcceptedBatchSnapshot) -> IngestResult: ...
    def load_effective_classifications(self) -> dict[int, ClassificationEvent]: ...
```

Errors expose only stable classes such as `BATCH_HASH_MISMATCH`, `BATCH_NOT_ACCEPTED`, and `DB_TRANSACTION_FAILED`; never include DSNs, SQL parameters, sheet cell content, or model input.

- [ ] **Step 6: Run GREEN**

```bash
cd dashboard-next
node --import tsx --test src/db/abbott-content-registry-workflow-migration.test.ts
cd ..
python3 -m unittest tests.test_abbott_content_registry_schema tests.abbott_page_classifier.test_repository -v
```

Expected: all tests PASS.

- [ ] **Step 7: Commit nested migration and root pointer separately**

```bash
git -C dashboard-next add src/db/migrations/045_abbott_content_registry_workflow.sql src/db/abbott-content-registry-workflow-migration.test.ts
git -C dashboard-next commit -m "feat: add Abbott content registry workflow schema"
git add dashboard-next agents/abbott_page_classifier/repository.py tests/test_abbott_content_registry_schema.py tests/abbott_page_classifier/test_repository.py
git commit -m "feat: add Abbott content registry repository"
```

---

### Task 3: Registry readers, stable identity, and exact source reconciliation

**Files:**
- Create: `agents/abbott_page_classifier/sources.py`
- Create: `agents/abbott_page_classifier/identity.py`
- Create: `tests/abbott_page_classifier/test_sources.py`
- Create: `tests/abbott_page_classifier/test_identity.py`
- Create: `tests/fixtures/abbott_registry2_accepted_minimal.csv`

**Interfaces:**
- Produces: `read_registry1(path: Path) -> SourceSnapshot`, `read_registry2_csv(path: Path) -> SourceSnapshot`, and `read_canonical_catalog(rows) -> SourceSnapshot`.
- Produces: `IdentityResolver.resolve(candidate, entities, aliases) -> IdentityResolution` with status `matched`, `new_candidate`, or `collision`.
- A `SourceSnapshot` has `source_name`, `source_hash`, `source_row_count`, `candidates`, and `rejected_rows`.

- [ ] **Step 1: Write parser RED tests with generated fixture content**

Build the XLSX fixture inside the test setup using openpyxl and `tempfile.TemporaryDirectory` with two direction tabs, one repeated page, `КР`, `Научно-брошюры`, `фарм`, a missing URL, and one truly new page. Require deterministic source-row IDs and source hashes and assert the repeated page becomes one candidate with two pieces of provenance rather than two entities.

```python
snapshot = read_registry1(FIXTURE)
assert snapshot.source_row_count == 6
assert len(snapshot.candidates) == 5
assert snapshot.candidates_by_key["material:100"].material_type_code == "clinical_guidelines"
assert len(snapshot.candidates_by_key["material:100"].provenance) == 2
```

- [ ] **Step 2: Run parser RED**

Run: `python3 -m unittest tests.abbott_page_classifier.test_sources -v`

Expected: FAIL because `sources.py` does not exist.

- [ ] **Step 3: Implement source readers without source API access**

Registry 1 accepts the supplied XLSX path. Registry 2 accepts a captured CSV/JSON snapshot, never a live Sheets call in the parser. Canonical input comes from `repository.load_active_catalog()`. Every raw row is counted exactly once as accepted, duplicate-collapsed, or rejected with a stable reason code.

- [ ] **Step 4: Write identity RED tests**

Cover exact material ID, canonical URL, approved URL alias, unique slug with compatible path, unique normalized title/type, ambiguous weak title, and conflicting strong aliases. Require `IDENTITY_COLLISION` when URL and material ID point at different entities.

- [ ] **Step 5: Implement ordered identity resolution**

```python
@dataclass(frozen=True)
class IdentityResolution:
    status: Literal["matched", "new_candidate", "collision"]
    content_entity_id: int | None
    matched_by: Literal["material_id", "canonical_url", "url", "slug", "title_type", "none"]
    conflict_code: str | None
    evidence_hashes: tuple[str, ...]
```

Strong aliases select only one entity. Weak aliases select only when exactly one compatible entity remains. Store raw display metadata only for content fields; identity diagnostics use hashes.

- [ ] **Step 6: Run GREEN and compile**

```bash
python3 -m unittest tests.abbott_page_classifier.test_sources tests.abbott_page_classifier.test_identity -v
python3 -m py_compile agents/abbott_page_classifier/sources.py agents/abbott_page_classifier/identity.py
```

- [ ] **Step 7: Commit**

```bash
git add agents/abbott_page_classifier/sources.py agents/abbott_page_classifier/identity.py tests/abbott_page_classifier/test_sources.py tests/abbott_page_classifier/test_identity.py tests/fixtures/abbott_registry2_accepted_minimal.csv
git commit -m "feat: reconcile Abbott registry identities"
```

---

### Task 4: Merge precedence, anti-flip, and accepted Batch 2 semantics

**Files:**
- Create: `agents/abbott_page_classifier/reconcile.py`
- Create: `tests/abbott_page_classifier/test_reconcile.py`
- Modify: `agents/abbott_page_classifier/classify.py`

**Interfaces:**
- Produces: `reconcile_entity(ReconciliationInput) -> ApprovalItem`.
- Produces readiness states exactly `ready`, `conflict`, `unresolved`, `rejected`, and `no_change`.
- Produces conflict codes `IDENTITY_COLLISION`, `ANTI_FLIP_CONFLICT`, `DIRECTION_CONFLICT`, `MATERIAL_TYPE_CONFLICT`, `ACCESS_CONFLICT`, `ARCHIVE_TYPE_INVALID`, `LLM_DISAGREEMENT`, and `CONTENT_UNAVAILABLE`.

- [ ] **Step 1: Write precedence RED tests**

```python
def test_registry1_fills_empty_metadata_but_never_overwrites_active_classification():
    item = reconcile_entity(case(active_dir="cardiology", registry1_dir="gastroenterology", active_title="", registry1_title="Новый заголовок"))
    assert item.title == "Новый заголовок"
    assert item.final_direction_code == "cardiology"
    assert item.readiness_state == "conflict"
    assert item.conflict_codes == ("DIRECTION_CONFLICT",)

def test_existing_page_direction_never_flips_automatically():
    item = reconcile_entity(case(active_dir="cardiology", rule_dir="gastroenterology", llm_dir="gastroenterology"))
    assert item.final_direction_code == "cardiology"
    assert "ANTI_FLIP_CONFLICT" in item.conflict_codes
```

Also test empty incoming values, simultaneous direction/type/access differences, new Registry 1 entity, Registry 2 filling an unlocked entity, and lifecycle mapping.

- [ ] **Step 2: Run precedence RED**

Run: `python3 -m unittest tests.abbott_page_classifier.test_reconcile -v`

Expected: FAIL because `reconcile.py` does not exist.

- [ ] **Step 3: Implement the pure reconciliation state machine**

Apply precedence in this exact order: active canonical → explicit reviewed correction → Registry 1 missing metadata → accepted Registry 2 missing classification → deterministic proposal → LLM proposal. Never infer that a business-approved batch permits canonical overwrite.

- [ ] **Step 4: Add exact Batch 2 gate fixtures**

Build a 377-row synthetic fixture in the test: 234 rows with a usable final direction and 143 without. Require output counts to sum to 377 and require all directionless rows to remain `unresolved`. Add 146 `Архив` material-type inputs, four explicit archive overrides, two HTTP 404 rows, and assert every remaining archive value becomes `ARCHIVE_TYPE_INVALID`.

- [ ] **Step 5: Run GREEN and legacy classifier tests**

```bash
python3 -m unittest tests.abbott_page_classifier.test_reconcile -v
python3 agents/abbott_page_classifier/classify.py --workbook "Abbott names.xlsx" --self-test
```

Expected: tests PASS and legacy self-test reports `5/5`.

- [ ] **Step 6: Commit**

```bash
git add agents/abbott_page_classifier/reconcile.py agents/abbott_page_classifier/classify.py tests/abbott_page_classifier/test_reconcile.py
git commit -m "feat: enforce Abbott registry precedence and anti-flip"
```

---

### Task 5: OpenAI Structured Outputs classifier and verifier routing

**Files:**
- Create: `agents/abbott_page_classifier/llm_classifier.py`
- Create: `tests/abbott_page_classifier/test_llm_classifier.py`
- Modify: `requirements.txt`

**Interfaces:**
- Produces: `LlmClassification`, a Pydantic model containing `direction_code`, `material_type_code`, two confidence values, alternative directions, short evidence, `requires_medical_review`, and `insufficient_evidence`.
- Produces: `OpenAIContentClassifier.classify(request: LlmRequest, model: str) -> LlmAttempt`.
- Produces: `route_llm(deterministic: Proposal, primary: LlmAttempt, verifier_factory) -> LlmRouteResult`.
- Consumes only `OPENAI_API_KEY`; no OAuth token or user-level data.

- [ ] **Step 1: Write strict-output and minimization RED tests**

Use a fake OpenAI client and require this request shape:

```python
client.responses.parse(
    model="gpt-5.6-terra",
    input=[{"role": "system", "content": SYSTEM_PROMPT_V1}, {"role": "user", "content": immutable_json}],
    text_format=LlmClassification,
    store=False,
)
```

Assert serialized input contains title, normalized URL/path, breadcrumbs, H1, meta description, bounded excerpt, access code, deterministic evidence, taxonomy version, and approved examples. Assert it contains none of `raw_user_id`, `visit_id`, `client_id`, `user_behavior`, email, phone, or source OAuth values.

- [ ] **Step 2: Run LLM RED**

Run: `python3 -m unittest tests.abbott_page_classifier.test_llm_classifier -v`

Expected: FAIL because `llm_classifier.py` does not exist.

- [ ] **Step 3: Add bounded SDK dependencies**

Add these lines to `requirements.txt`:

```text
openai>=2.0,<3
pydantic>=2.8,<3
openpyxl>=3.1,<4
google-api-python-client>=2.0,<3
google-auth-oauthlib>=1.2,<2
```

- [ ] **Step 4: Implement the adapter and sanitized retry policy**

Call `responses.parse` with `store=False`, `reasoning={"effort": "low"}` for Terra and `reasoning={"effort": "medium"}` for Sol, no tools, one immutable material input, and a bounded excerpt of 12,000 Unicode characters. Retry once only for timeout, rate-limit, 5xx, incomplete output, refusal, or schema failure; then return a stable unresolved code without response bodies.

- [ ] **Step 5: Implement verifier routing tests and code**

Require Sol when Terra confidence is below `0.85`, alternatives are nonempty, deterministic evidence disagrees, or medical review is required. Terra/Sol agreement at confidence `>= 0.85` yields `llm_verified`; disagreement yields `LLM_DISAGREEMENT`; a locked entity never calls either model for its active field.

- [ ] **Step 6: Run GREEN without a network call**

```bash
python3 -m unittest tests.abbott_page_classifier.test_llm_classifier -v
python3 -m py_compile agents/abbott_page_classifier/llm_classifier.py
rg -n "raw_user_id|visit_id|client_id|METRIKA_TOKEN" agents/abbott_page_classifier/llm_classifier.py
```

Expected: tests PASS; the scan matches only the explicit deny-list, never request-field construction.

- [ ] **Step 7: Commit**

```bash
git add requirements.txt agents/abbott_page_classifier/llm_classifier.py tests/abbott_page_classifier/test_llm_classifier.py
git commit -m "feat: add Abbott LLM classification routing"
```

---

### Task 6: Database-backed approval batch and Google Sheets projection

**Files:**
- Create: `agents/abbott_page_classifier/batch_service.py`
- Create: `tests/abbott_page_classifier/test_batch_service.py`
- Modify: `agents/abbott_page_classifier/sheets_sync.py`
- Create: `tests/abbott_page_classifier/test_sheets_sync.py`

**Interfaces:**
- Produces: `build_batch(inputs, taxonomy_version, prompt_version) -> ApprovalBatch` and `compute_batch_hash(items) -> str`.
- Produces Sheets tabs exactly `Апрув batch`, `Предложения`, `Конфликты`, `Не определено`, `История`, `Справочники`, `Сводка`, and `Как это работает`.
- Produces: `publish_batch_projection(batch, sheets_gateway) -> PublishedProjection` and `read_accepted_projection(batch, sheets_gateway) -> AcceptedBatchSnapshot`.

- [ ] **Step 1: Write deterministic batch-hash RED tests**

Require row order to be `content_entity_id`, then `input_hash`; JSON uses UTF-8, sorted keys, compact separators, and normalized newline handling. Changing an editable final value changes `accepted_decision_hash`; formatting, row colors, formulas, or tab order do not.

- [ ] **Step 2: Run batch RED**

Run: `python3 -m unittest tests.abbott_page_classifier.test_batch_service -v`

Expected: FAIL because `batch_service.py` does not exist.

- [ ] **Step 3: Implement batch construction and persistence**

Persist the draft batch before any sheet write. Every item stores current canonical values, both registry values, deterministic result, Terra result, optional Sol result, readiness, conflicts, concise evidence, `input_hash`, and `row_hash`. The published hash covers every item, including conflicts and unresolved rows.

- [ ] **Step 4: Write fake-Sheets projection RED tests**

Assert proposal columns are protected/read-only, final columns use taxonomy-backed validation, conflict reasons are mandatory, and the batch tab displays exact ready/conflict/unresolved totals plus the published hash. Verify that acceptance approves only `ready` rows and keeps other states open.

- [ ] **Step 5: Refactor `sheets_sync.py` behind a gateway**

```python
class SheetsGateway(Protocol):
    def ensure_tabs(self, spreadsheet_id: str, titles: Sequence[str]) -> Mapping[str, int]: ...
    def replace_values(self, spreadsheet_id: str, range_name: str, values: Sequence[Sequence[object]]) -> None: ...
    def read_values(self, spreadsheet_id: str, range_name: str) -> list[list[str]]: ...
    def batch_update(self, spreadsheet_id: str, requests: Sequence[dict[str, object]]) -> None: ...
```

Keep Google credentials in the existing operator-only path. Unit tests use the fake gateway and perform zero network calls.

- [ ] **Step 6: Implement accepted-snapshot validation**

Reject missing rows, duplicate row hashes, unknown taxonomy codes, edited identity/hash cells, an accepted conflict without reason, and count mismatches. Do not silently skip a row without direction; keep it in `unresolved`.

- [ ] **Step 7: Run GREEN**

```bash
python3 -m unittest tests.abbott_page_classifier.test_batch_service tests.abbott_page_classifier.test_sheets_sync -v
python3 -m py_compile agents/abbott_page_classifier/batch_service.py agents/abbott_page_classifier/sheets_sync.py
```

- [ ] **Step 8: Commit**

```bash
git add agents/abbott_page_classifier/batch_service.py agents/abbott_page_classifier/sheets_sync.py tests/abbott_page_classifier/test_batch_service.py tests/abbott_page_classifier/test_sheets_sync.py
git commit -m "feat: publish Abbott approval batches from canonical state"
```

---

### Task 7: Idempotent approval ingestion and append-only corrections

**Files:**
- Modify: `agents/abbott_page_classifier/batch_service.py`
- Modify: `agents/abbott_page_classifier/repository.py`
- Create: `tests/abbott_page_classifier/test_approval_ingestion.py`

**Interfaces:**
- Produces: `ingest_accepted_batch(snapshot, repository) -> IngestResult`.
- Produces event kinds exactly `baseline`, `approve`, `correct`, `reject`, and `revoke`.
- A correction consumes `content_entity_id`, final codes, reason, approver, approval batch/item IDs, effective time, and predecessor event ID.

- [ ] **Step 1: Write ingestion RED tests**

Test normal approval, duplicate accepted hash no-op, changed hash rejection, partial insert rollback, active-direction difference without reason rejection, explicit correction success, and an attempt to update/delete the predecessor event.

```python
result = ingest_accepted_batch(snapshot, repository)
assert result.accepted_count == 12
assert result.conflict_count == 3
assert result.unresolved_count == 2
assert repository.updated_event_rows == 0
```

- [ ] **Step 2: Run ingestion RED**

Run: `python3 -m unittest tests.abbott_page_classifier.test_approval_ingestion -v`

Expected: FAIL on missing ingestion orchestration.

- [ ] **Step 3: Implement transactional event creation**

For a locked entity with a changed direction, require event kind `correct`, nonempty reason, approver, predecessor ID, and matching batch item. For unchanged values create a no-op item outcome rather than a duplicate effective event. Hash the normalized event payload and rely on its unique index for retry safety.

- [ ] **Step 4: Add lifecycle and archive ingestion rules**

An `archive_candidate` event is valid only when the item has `explicit_archive_override` or evidence code `HTTP_404`/`HTTP_410`. No ingested event may have material type `Архив` or a code outside its taxonomy version.

- [ ] **Step 5: Run GREEN**

Run: `python3 -m unittest tests.abbott_page_classifier.test_approval_ingestion tests.abbott_page_classifier.test_repository -v`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add agents/abbott_page_classifier/batch_service.py agents/abbott_page_classifier/repository.py tests/abbott_page_classifier/test_approval_ingestion.py
git commit -m "feat: ingest Abbott approvals append-only"
```

---

### Task 8: Successor release materialization and hard publication gates

**Files:**
- Create: `agents/abbott_page_classifier/candidate_release.py`
- Create: `tests/abbott_page_classifier/test_candidate_release.py`
- Modify: `canonical_release_store.py`
- Modify: `tests/test_canonical_release_store.py`

**Interfaces:**
- Produces: `materialize_content_candidate(batch_id, predecessor_release_id, code_revision) -> CandidateMaterialization`.
- Produces: `validate_content_candidate(candidate_release_id, expected_counts, accepted_hash) -> GateReport`.
- Uses existing `create_candidate_release(...)` and `require_mutable_candidate_release(...)`; does not call `activate_release(...)`.

- [ ] **Step 1: Write candidate-copy RED tests**

Using a recording fake DB, require predecessor active-pointer lock, a new staging release, copied non-content source snapshots/facts, a new immutable `abbott_workbook_catalog` snapshot, release-scoped catalog rows, rebuilt lookup projection, and no update to active tables or predecessor rows.

- [ ] **Step 2: Run materializer RED**

Run: `python3 -m unittest tests.abbott_page_classifier.test_candidate_release tests.test_canonical_release_store -v`

Expected: FAIL because `candidate_release.py` does not exist.

- [ ] **Step 3: Implement transactional successor materialization**

Select accepted effective events plus unchanged predecessor classifications, insert exactly one content row per source row/entity projection, and preserve source provenance. Replace only the predecessor's workbook-catalog snapshot reference; keep the exact remaining source snapshot IDs. Roll back the whole materialization if row counts or hashes differ.

- [ ] **Step 4: Rebuild lookup groups deterministically**

Generate `title`, `slug`, and `path` hashes. Set status `unique`, `identical_collapsed`, or `ambiguous`; select a source fingerprint only for the first two. Strong alias collisions block materialization rather than becoming ambiguous dashboard lookups.

- [ ] **Step 5: Implement the ten hard gates**

`GateReport.passed` is true only when anti-flip violations, strong identity collisions, out-of-taxonomy values, `Архив` material types, unresolved accepted-row conflicts, active-release mutations, and dashboard smoke failures are all zero; source/count/hash/schema reconciliation must each be exactly 100%.

- [ ] **Step 6: Prove activation is not part of the command**

Add a test that patches `canonical_release_store.activate_release` to raise if called, runs materialization and validation, and asserts the candidate remains `staging` or becomes `validated` only through the existing reviewed validation path.

- [ ] **Step 7: Run GREEN**

```bash
python3 -m unittest tests.abbott_page_classifier.test_candidate_release tests.test_canonical_release_store -v
python3 -m py_compile agents/abbott_page_classifier/candidate_release.py canonical_release_store.py
```

- [ ] **Step 8: Commit**

```bash
git add agents/abbott_page_classifier/candidate_release.py tests/abbott_page_classifier/test_candidate_release.py canonical_release_store.py tests/test_canonical_release_store.py
git commit -m "feat: materialize Abbott content candidate releases"
```

---

### Task 9: Golden evaluation and end-to-end operator CLI

**Files:**
- Create: `agents/abbott_page_classifier/evaluation.py`
- Create: `agents/abbott_page_classifier/evals/golden.v1.jsonl`
- Create: `agents/abbott_page_classifier/workflow.py`
- Create: `tests/abbott_page_classifier/test_evaluation.py`
- Create: `tests/abbott_page_classifier/test_workflow.py`
- Modify: `agents/abbott_page_classifier/run_classifier.sh`

**Interfaces:**
- Produces: `evaluate_golden_set(records, classifier) -> EvaluationReport`.
- CLI commands: `reconcile`, `classify`, `publish-projection`, `pull-accepted`, `ingest`, `materialize`, `validate`, and `status`.
- Every mutating command requires an explicit `--batch-id` and prints only sanitized counts, hashes, statuses, and candidate release IDs.

- [ ] **Step 1: Build and review the golden fixture**

Create at least 80 nonprivate reviewed records drawn from `Abbott names.xlsx`, covering every direction, every material type with an available example, generic `/academy/` paths, duplicate titles/slugs, restricted materials, archive candidates, insufficient evidence, and anti-flip attempts. Store only material content metadata and expected taxonomy codes; do not store visit or user data.

- [ ] **Step 2: Write evaluation RED tests**

Require exact calculations for direction accuracy, material-type accuracy, anti-flip detection, taxonomy validity, schema compliance, disagreement count, and unresolved count. Fail the gate below 0.95 direction or material-type accuracy or below 1.0 for the three hard metrics.

- [ ] **Step 3: Implement and run the mocked evaluation**

```bash
python3 -m unittest tests.abbott_page_classifier.test_evaluation -v
python3 agents/abbott_page_classifier/evaluation.py --fixture agents/abbott_page_classifier/evals/golden.v1.jsonl --classifier fixture
```

Expected: tests PASS and fixture-mode report has `gate_passed=true`.

- [ ] **Step 4: Write CLI orchestration RED tests**

With fake repository, fake classifier, and fake Sheets gateway, assert command order, dry-run default, batch ID requirements, idempotency, no OpenAI call for locked fields, no Sheet call in `materialize`, and no activation call anywhere.

- [ ] **Step 5: Implement the workflow CLI**

```python
COMMANDS = (
    "reconcile", "classify", "publish-projection", "pull-accepted",
    "ingest", "materialize", "validate", "status",
)

def main(argv: Sequence[str] | None = None) -> int:
    """Compose operator-only stages; default every write-capable stage to --dry-run."""
```

`reconcile` requires explicit Registry 1 and Registry 2 snapshot paths. `classify` requires `OPENAI_API_KEY` only when eligible rows exist and `--execute-llm` is set. `publish-projection` is the only command allowed to write Sheets. `materialize` never activates.

- [ ] **Step 6: Run GREEN and an offline end-to-end fixture pass**

```bash
python3 -m unittest tests.abbott_page_classifier.test_evaluation tests.abbott_page_classifier.test_workflow -v
python3 agents/abbott_page_classifier/workflow.py reconcile --registry1 tests/fixtures/abbott_registry1_minimal.xlsx --registry2 tests/fixtures/abbott_registry2_accepted_minimal.csv --dry-run
```

Expected: tests PASS; dry run reports exact source, ready, conflict, unresolved, and rejected counts and performs no network or DB writes.

- [ ] **Step 7: Commit**

```bash
git add agents/abbott_page_classifier/evaluation.py agents/abbott_page_classifier/evals/golden.v1.jsonl agents/abbott_page_classifier/workflow.py agents/abbott_page_classifier/run_classifier.sh tests/abbott_page_classifier/test_evaluation.py tests/abbott_page_classifier/test_workflow.py
git commit -m "feat: orchestrate Abbott content approval workflow"
```

---

### Task 10: Dashboard boundary, documentation, and full verification

**Files:**
- Modify: `dashboard-next/src/lib/abbott-private-store.test.ts`
- Modify: `agents/abbott_page_classifier/README.md`
- Modify: `agents/abbott_page_classifier/PROCESS.md`
- Create: `ops/runbooks/abbott_content_registry.md`
- Modify: `ops/abbott-runtime-manifest.sha256`

**Interfaces:**
- Proves dashboard content reads remain limited to active-release `portal_content_catalog` and `portal_content_lookup_projection`.
- Documents reviewed operator handoffs without embedding credentials or authorizing production actions.

- [ ] **Step 1: Add dashboard DB-only RED assertions**

Extend the store test to require SQL references to active release, catalog, and lookup projection, and to reject `portal_content_approval_`, `portal_content_classification_events`, Google domains, OpenAI endpoints, and source OAuth keys from all dashboard content query paths.

- [ ] **Step 2: Run dashboard RED/GREEN**

No production store change is expected unless the test exposes a current boundary violation.

```bash
cd dashboard-next
node --import tsx --test src/lib/abbott-private-store.test.ts src/db/abbott-content-registry-workflow-migration.test.ts
npm run typecheck
cd ..
```

Expected: tests PASS and typecheck exits 0.

- [ ] **Step 3: Write the operator runbook**

Document these exact phases: dependency setup, local unit tests, read-only source snapshot capture, dry-run reconciliation, offline fixture evaluation, separately authorized LLM evaluation, draft batch persistence, separately authorized Sheets projection, approval hash ingestion, candidate materialization, gate review, and separate activation decision. State rollback as “do not activate failed candidate”; never instruct silent active-release rewrite.

- [ ] **Step 4: Update classifier documentation and runtime manifest**

Replace the old “pull-approved → merge workbook → dashboard filters” flow with the canonical DB pipeline. Include all eight sheet tabs, Batch 2 treatment, anti-flip correction fields, `Архив` lifecycle semantics, data minimization, stable failure codes, and exact CLI commands. Update `ops/abbott-runtime-manifest.sha256` only for runtime files added to the manifest's existing scope.

- [ ] **Step 5: Run the complete verification matrix**

```bash
python3 -m unittest discover -s tests/abbott_page_classifier -t . -v
python3 -m unittest tests.test_abbott_content_registry_schema tests.test_canonical_release_store -v
python3 -m compileall -q agents/abbott_page_classifier
cd dashboard-next
node --import tsx --test src/db/abbott-content-registry-workflow-migration.test.ts src/lib/abbott-private-store.test.ts
npm run lint
npm run typecheck
npm run build
npm run security:public-assets
cd ..
python3 agents/abbott_page_classifier/workflow.py reconcile --registry1 tests/fixtures/abbott_registry1_minimal.xlsx --registry2 tests/fixtures/abbott_registry2_accepted_minimal.csv --dry-run
git diff --check
```

Expected: zero test failures, compile/lint/typecheck/build/security commands exit 0, dry-run counts reconcile exactly, and `git diff --check` emits no output.

- [ ] **Step 6: Verify forbidden operational side effects**

```bash
if git diff --name-only HEAD~10..HEAD | rg -n 'crontab|\.env|google_token|telegram|hermes.*schedule'; then exit 1; fi
git status --short
```

Expected: the forbidden-path scan produces no matches. Status contains only the planned implementation changes and preserves any pre-existing user-owned changes outside the isolated worktree.

- [ ] **Step 7: Commit documentation and dashboard verification**

```bash
git -C dashboard-next add src/lib/abbott-private-store.test.ts
git -C dashboard-next commit -m "test: enforce Abbott registry read boundary"
git add dashboard-next agents/abbott_page_classifier/README.md agents/abbott_page_classifier/PROCESS.md ops/runbooks/abbott_content_registry.md ops/abbott-runtime-manifest.sha256
git commit -m "docs: document Abbott content registry workflow"
```

## Post-Implementation Review Gates

Implementation completion means code, offline fixtures, tests, documentation, and dry-run reconciliation are ready for review. It does not mean production rollout.

Before any separately authorized rollout:

1. Review migration 045 and the role grants with the database owner.
2. Run the golden set with real Terra/Sol calls and retain only sanitized metrics; require at least 95% exact direction and material-type accuracy and 100% anti-flip, taxonomy, and schema results.
3. Capture and reconcile the exact supplied Registry 1 and accepted Registry 2 snapshots; require all 377 Batch 2 rows to appear in ready, conflict, unresolved, or rejected totals.
4. Review the generated `Конфликты` and `Не определено` tabs before treating any row as publishable.
5. Apply migration, install `OPENAI_API_KEY`, publish the Google projection, create a candidate release, validate, activate, and schedule weekly operation only through separate explicit approvals.
