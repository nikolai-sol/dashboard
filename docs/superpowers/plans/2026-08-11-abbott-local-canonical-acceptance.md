# Abbott Local Canonical Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept reviewed Abbott batch decisions from an owner-only local artifact, create canonical entities for reviewed observed pages, and cut over a validated DB-native successor without changing release 24 beforehand.

**Architecture:** A focused `local_acceptance.py` module parses only mutable review intent from a descriptor-checked mode-0600 JSON file and rehydrates immutable batch state from MySQL. Repository acceptance gains a transaction-owned `create` URL action that derives the entity ID before computing the canonical accepted hash. The existing ingest/materialize/validate/activate pipeline remains the only route to an active dashboard release.

**Tech Stack:** Python 3.11, mysql-connector, MySQL 8 migrations, `unittest`, existing Abbott approval hashes/repository/workflow CLI, Next.js release tooling.

## Global Constraints

- Active Abbott release 24 and the current dashboard remain unchanged until a successor passes validation and smoke.
- The flow is Abbott-only and must not touch Zaruku, Gidrofuril, or the sales dashboard.
- No Yandex Metrika API, collector, backfill, cron, Telegram, token, or Bitrix action is permitted.
- Dashboard reads remain canonical-MySQL-only and release-scoped.
- Local decision files must be absolute, owner-owned regular files under the protected Abbott private root, mode `0600`, opened with `O_NOFOLLOW`, and read from the checked descriptor.
- Immutable batch fields come only from MySQL; local files provide reviewed mutable decisions only.
- New observed-page URLs must be query-free, fragment-free, non-`file:`, normalized Abbott URLs.
- Every write is transactional, replay-safe, append-only where audited, and fail-closed on collision or drift.
- Logs/stdout contain only counts, IDs, hashes, statuses, and stable failure codes.
- Candidate release construction is DB-native and cannot activate a release.

---

### Task 1: Descriptor-safe local decision artifact

**Files:**
- Create: `agents/abbott_page_classifier/local_acceptance.py`
- Test: `tests/abbott_page_classifier/test_local_acceptance.py`
- Modify: `ops/abbott-runtime-manifest.sha256`

**Interfaces:**
- Consumes: `PersistedApprovalBatch`, `ApprovalItem`, `compute_batch_hash`, and the batch-bound taxonomy.
- Produces: `LocalAcceptanceIntent`, `LocalDecision`, and `read_local_acceptance_intent(path, batch, private_root)`.

- [ ] **Step 1: Write failing parser and confinement tests**

```python
def test_local_intent_rehydrates_immutable_fields_and_preserves_identity():
    intent = read_local_acceptance_intent(decision_path, persisted_batch, private_root)
    assert intent.batch_id == persisted_batch.database_batch_id
    assert tuple(row.input_hash for row in intent.decisions) == tuple(
        item.input_hash for item in persisted_batch.batch.items
    )

def test_local_intent_rejects_symlink_mode_and_hash_drift():
    for bad_path in (symlink_path, mode_0644_path, outside_private_root):
        with self.assertRaisesRegex(LocalAcceptanceError, "LOCAL_DECISION_FILE_INVALID"):
            read_local_acceptance_intent(bad_path, persisted_batch, private_root)
```

- [ ] **Step 2: Run RED test**

Run: `PYTHONPATH=. python3.11 -m unittest tests.abbott_page_classifier.test_local_acceptance -v`

Expected: import failure because `local_acceptance.py` does not exist.

- [ ] **Step 3: Implement immutable intent parsing**

```python
@dataclass(frozen=True)
class LocalDecision:
    input_hash: str
    row_hash: str
    final_direction_code: str | None
    final_material_type_code: str | None
    final_access_code: str | None
    final_lifecycle_code: str | None
    selected_content_entity_id: int | None
    url_alias_decision: str | None
    decision_reason: str | None

@dataclass(frozen=True)
class LocalAcceptanceIntent:
    batch_id: int
    batch_key: str
    published_input_hash: str
    accepted_by: str
    accepted_at: datetime
    decisions: tuple[LocalDecision, ...]

def read_local_acceptance_intent(path: Path, batch: PersistedApprovalBatch,
                                 private_root: Path) -> LocalAcceptanceIntent:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or stat.S_IMODE(st.st_mode) != 0o600:
            raise LocalAcceptanceError("LOCAL_DECISION_FILE_INVALID")
        payload = json.loads(_read_bounded(fd, 8 * 1024 * 1024))
    finally:
        os.close(fd)
    return _validate_intent_against_batch(payload, batch, private_root, path)
```

The validator must require schema version `1`, `dataset_key == "abbott"`, exact batch ID/key/published hash, exact ordered `(input_hash,row_hash)` identity set, canonical UTC timestamp, non-empty reviewer, and permitted mutable fields only. It must recompute `compute_batch_hash(batch.items)` before returning.

- [ ] **Step 4: Run GREEN tests and closure**

Run: `PYTHONPATH=. python3.11 -m unittest tests.abbott_page_classifier.test_local_acceptance tests.test_abbott_runtime_closure -v`

Expected: all tests pass and runtime manifest attests the new module.

- [ ] **Step 5: Commit**

```bash
git add agents/abbott_page_classifier/local_acceptance.py tests/abbott_page_classifier/test_local_acceptance.py ops/abbott-runtime-manifest.sha256
git commit -m "feat(abbott): validate local acceptance intent"
```

### Task 2: Canonical `create` URL decision and migration

**Files:**
- Modify: `agents/abbott_page_classifier/domain.py`
- Modify: `agents/abbott_page_classifier/approval_hashes.py`
- Modify: `agents/abbott_page_classifier/sheets_sync.py`
- Modify: `agents/abbott_page_classifier/repository.py`
- Create: `dashboard-next/src/db/migrations/054_abbott_observed_page_creation.sql`
- Create: `dashboard-next/bootstrap/abbott-private-store/src/db/migrations/054_abbott_observed_page_creation.sql`
- Modify: `dashboard-next/bootstrap/abbott-private-store/MIGRATION-MANIFEST.sha256`
- Modify: `dashboard-next/src/lib/abbott-canonical-runtime/*` only where byte-identical runtime closure requires it.
- Test: `tests/abbott_page_classifier/test_local_acceptance_repository.py`
- Test: `tests/abbott_page_classifier/test_approval_ingestion.py`
- Test: `tests/test_abbott_runtime_closure.py`

**Interfaces:**
- Consumes: `LocalAcceptanceIntent` from Task 1.
- Produces: `ContentRegistryRepository.record_local_batch_acceptance(batch_id, intent, projection_locator)` returning `AcceptedBatchSnapshot`.

- [ ] **Step 1: Write RED transactional creation tests**

```python
def test_create_observed_page_is_one_atomic_acceptance_transaction():
    snapshot = repository.record_local_batch_acceptance(8, intent_with_create(), locator)
    assert snapshot.accepted_decision_hash == compute_accepted_decision_hash(snapshot.items)
    assert connection.created_entity_count == 1
    assert connection.active_strong_alias_kinds == {"canonical_url", "url"}
    assert connection.classification_event_count == 1
    assert connection.url_decision_event_count == 1
    assert connection.commit_count == 1

def test_create_collision_rolls_back_every_write():
    with self.assertRaisesRegex(RepositoryError, "IDENTITY_COLLISION"):
        repository.record_local_batch_acceptance(8, intent_with_competing_alias(), locator)
    assert connection.commit_count == 0
    assert connection.rollback_count == 1
    assert connection.persisted_mutations == ()
```

Add table-driven rejection cases for query, fragment, external host, `file:`, missing taxonomy, missing reason, selected ID supplied with `create`, and a non-observed published item.

- [ ] **Step 2: Run RED tests**

Run: `PYTHONPATH=. python3.11 -m unittest tests.abbott_page_classifier.test_local_acceptance_repository tests.abbott_page_classifier.test_approval_ingestion -v`

Expected: `create` is rejected by the current three-value decision contract.

- [ ] **Step 3: Add migration 054**

Migration 054 must idempotently change both enums to exactly:

```sql
ENUM('attach', 'retire', 'reject', 'create')
```

It must retain the existing immutable update/delete triggers and foreign keys.
Synchronize the bootstrap copy and migration manifest before committing the
nested repository.

- [ ] **Step 4: Implement locked create acceptance**

Within one repository transaction:

```python
if item.url_alias_decision == "create":
    normalized = normalize_observed_page_grouping_url(item.url)
    _require_query_free_abbott_url(item.url, normalized)
    _lock_registry_and_alias_gaps(cursor, normalized.sha256)
    _require_no_active_strong_target(cursor, normalized.sha256)
    entity_id = _insert_reviewed_observed_entity(cursor, item, evidence)
    _insert_strong_url_aliases(cursor, entity_id, normalized, evidence)
    accepted_item = replace(item, selected_content_entity_id=entity_id)
```

After all derived entity IDs exist, compute one accepted hash over the final
accepted items. Then insert classification and URL decision events using that
hash, update only mutable approval-item columns, and transition the exact batch
from `published` to `accepted`. The transaction must roll back on every error.

Extend `compute_url_alias_decision_event_fingerprint` and validation to accept
`create` with the derived selected entity ID while leaving Google `attach`,
`retire`, and `reject` behavior unchanged.

- [ ] **Step 5: Run GREEN tests and migration closure**

Run: `PYTHONPATH=. python3.11 -m unittest tests.abbott_page_classifier.test_local_acceptance_repository tests.abbott_page_classifier.test_approval_ingestion tests.test_abbott_runtime_closure -v`

Expected: all pass; root/bootstrap migrations are byte-identical and manifest-attested.

- [ ] **Step 6: Commit nested then root**

```bash
git -C dashboard-next add src/db/migrations/054_abbott_observed_page_creation.sql bootstrap/abbott-private-store
git -C dashboard-next commit -m "feat(abbott): add reviewed observed page creation"
git add dashboard-next agents/abbott_page_classifier tests ops/abbott-runtime-manifest.sha256
git commit -m "feat(abbott): create canonical observed pages"
```

### Task 3: Local publish/accept workflow commands

**Files:**
- Modify: `agents/abbott_page_classifier/workflow.py`
- Modify: `agents/abbott_page_classifier/workflow_repository.py`
- Modify: `agents/abbott_page_classifier/local_acceptance.py`
- Test: `tests/abbott_page_classifier/test_workflow.py`
- Test: `tests/abbott_page_classifier/test_local_acceptance.py`
- Modify: `ops/runbooks/abbott_content_registry.md`
- Modify: `ops/abbott-runtime-manifest.sha256`

**Interfaces:**
- Produces CLI commands `publish-local --batch-id N --decision-file PATH --execute` and `accept-local --batch-id N --decision-file PATH --execute`.
- Produces sanitized results with `status`, `batch_id`, `batch_key`, `published_input_hash`, `accepted_decision_hash`, and counts only.

- [ ] **Step 1: Write RED CLI tests**

```python
def test_publish_local_defaults_to_dry_run_without_opening_file():
    assert main(["publish-local", "--batch-id", "8", "--decision-file", path]) == 0
    assert gateway.calls == []

def test_accept_local_requires_execute_and_exact_batch():
    assert main(["accept-local", "--batch-id", "8", "--decision-file", path, "--execute"], dependencies=deps) == 0
    assert gateway.calls == [("accept_local", 8, Path(path))]
```

- [ ] **Step 2: Run RED test**

Run: `PYTHONPATH=. python3.11 -m unittest tests.abbott_page_classifier.test_workflow -v`

Expected: parser rejects the two new commands.

- [ ] **Step 3: Implement commands and local projection receipt**

Add both commands to `COMMANDS` and `_WRITE_COMMANDS`; add `--decision-file` and
reject it for all unrelated commands. `publish-local` must rehydrate/re-attest
the draft batch, hash the exact owner file, record an immutable local locator,
and transition only `draft -> published`. `accept-local` must require that same
locator/hash and call `record_local_batch_acceptance`.

Do not add decision-file paths to `_SAFE_OUTPUT_KEYS`.

- [ ] **Step 4: Run GREEN workflow and repository suites**

Run: `PYTHONPATH=. python3.11 -m unittest tests.abbott_page_classifier.test_workflow tests.abbott_page_classifier.test_local_acceptance tests.abbott_page_classifier.test_local_acceptance_repository -v`

Expected: all pass.

- [ ] **Step 5: Update runbook and commit**

```bash
git add agents/abbott_page_classifier ops tests/abbott_page_classifier
git commit -m "feat(abbott): operate local canonical acceptance"
```

### Task 4: Produce and independently review the batch 8 decision artifact

**Files:**
- Create outside git on VPS: `/root/reportingdash-private/abbott/reviews/batch-8/accepted-decisions.json`
- Create outside git on VPS: `/root/reportingdash-private/abbott/reviews/batch-8/accepted-decisions.sha256`
- Update Google review workbook for manager visibility only; it remains non-authoritative.

**Interfaces:**
- Consumes: batch 8 DB rows, the validated 155-item attach map, corrected agent classifications, and reviewed exclusion rules.
- Produces: one mode-0600 decision artifact accepted by Task 3.

- [ ] **Step 1: Build decisions from authoritative rows**

Generate exactly 2,333 decisions in canonical item order. Preserve all existing
non-empty direction/material values. Apply:

- `attach` only to the 155 prevalidated unique path mappings;
- `reject` only to reviewed 404/error/service/non-content groups;
- `create` to remaining real observed pages with valid query-free URLs,
  taxonomy-complete metadata, `access=unspecified`, `lifecycle=active`, and a
  non-empty review reason;
- no URL action for unchanged/non-observed conflict rows.

Use `undetermined` only where the batch taxonomy permits it and the evidence is
genuinely insufficient. Never emit an unknown material type.

- [ ] **Step 2: Verify artifact before upload**

Run the Task 1 parser locally against a read-only rehydrated batch fixture and
assert exact identity count 2,333, no query/fragment/file URL action, no changed
current taxonomy value, and no duplicate hashes.

- [ ] **Step 3: Copy owner-only and run production dry-runs**

On VPS, create the private directory mode `0700`, install the file mode `0600`,
then run `publish-local` and `accept-local` without `--execute`. Verify active
release remains 24 and batch 8 remains draft.

- [ ] **Step 4: Independent review gate**

Provide an aggregate-only review package to a fresh reviewer: action counts,
taxonomy counts, correction counts, excluded-page categories, attach-map hash,
decision-file hash, batch key, and published hash. Do not proceed on any
Critical or Important finding.

### Task 5: Execute acceptance, successor validation, and guarded cutover

**Files:**
- Production checkpoint under `/root/reportingdash-private/abbott/checkpoints/`.
- No tracked file changes unless a verified production-only defect requires a reviewed follow-up commit.

- [ ] **Step 1: Recapture production guard and checkpoint**

Verify active release 24, batch 8 draft, runtime/app commits, database schema,
PM2/nginx health, July/August dashboard controls, and current app release. Save
aggregate-only receipts and DB/app rollback instructions.

- [ ] **Step 2: Apply migration/runtime safely**

Deploy only the attested Abbott runtime and migration 054. Verify migration
shape/triggers/enums and runtime manifest. Do not deploy the application yet.

- [ ] **Step 3: Execute local publish and acceptance**

Run `publish-local ... --execute`, re-read batch/hash, then `accept-local ...
--execute`. Re-run both commands to prove idempotence. Verify accepted hash and
active release 24.

- [ ] **Step 4: Ingest, materialize, and validate successor**

Run existing `ingest`, `materialize`, `validate`, and `status` commands. Require
all release scopes present, zero bad rows, zero unresolved observed content and
non-content identities, exact source/import receipts, and exact sessions,
users, pageviews, and goals for June 1-30, July 1-31, and August 1-9.

- [ ] **Step 5: Deploy Abbott app and activate**

Build from the attested nested commit, scan public assets, atomically deploy the
Abbott app, and health-check it while release 24 is still active. Activate only
the validated candidate using expected predecessor 24.

- [ ] **Step 6: Smoke and rollback**

Using `Abbott2026`, verify manager and embed views, current-month date behavior,
July and August non-zero data, direction/type on attached and created pages,
aggregate controls, and sensitive public-asset 404. If any check fails, roll
back DB pointer and app to the checkpoint; never restore public sensitive data.

- [ ] **Step 7: Finish branch**

After successful smoke, remove temporary private decision/export files and the
temporary Google review sheet, retain only audit hashes/receipts, run final
whole-branch review, merge nested then root branches to main, push, and verify
production remains healthy.
