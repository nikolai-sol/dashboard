# Abbott Content Registry, LLM Classification, and Approval Design

**Date:** 2026-08-05

**Status:** approved design; implementation requires a separately reviewed plan

**Project:** ReportingDash / Abbott

**Audience:** Abbott content/project operators and ReportingDash engineers

## Goal

Create one canonical, auditable registry of Abbott portal materials that combines the supplied registry, the existing canonical classification, and the accepted Google Sheets batch. New and incomplete materials receive deterministic and LLM-assisted proposals for direction and material type, while a hard anti-flip rule prevents an existing page from silently changing direction.

The dashboard continues to read only canonical MySQL. Google Sheets is the human approval surface, not a runtime data source.

## Approved Product Decisions

1. Canonical MySQL is the only runtime source of truth.
2. The supplied workbook adds missing materials and missing metadata but does not overwrite active canonical classification.
3. Differences in direction, material type, or access are routed to a dedicated conflict queue.
4. The Google Sheet batch published as `2026-07-21 10:55 UTC` is business-approved, subject to the technical publication gates in this design.
5. A previously classified page never changes direction automatically. A correction requires an explicit reviewed event with an actor, reason, and timestamp.
6. Site scanning and approval packages run weekly.
7. Google Sheets remains the approval format used by the content manager/project operator.
8. The first pass covers the complete registry, including historical gaps, not only newly discovered pages.
9. Public and access-restricted Abbott medical content may be sent to the external LLM. It is professional medical content, not a secret or commercial dataset.
10. Raw User ID is not sent to the LLM because it is unnecessary for content classification and remains manager-only under the Abbott data contract. Permission to process it does not override data minimization.

## Current-State Findings

### Supplied Registry 1

The supplied workbook contains eight direction-oriented tabs and 5,096 populated material rows. Normalizing title and locator identities collapses those rows to approximately 1,095 unique material identities. The direction-tab layout repeats the same material across multiple sheets and is unsuitable as a canonical master structure.

Compared with the current `Abbott names.xlsx` content catalog, the supplied workbook contains:

- 90 unique material identities not found in the current workbook;
- 26 matched identities with direction differences;
- 44 matched identities with material-type differences;
- 242 matched identities with access-label differences.

The workbook also contains noncanonical spelling, case, and abbreviation variants, including `КР`, `КС`, `Брошюры`, `Научно-брошюры`, `статьи`, `фарм`, and multiple access-label spellings.

### Registry 2 / Google Sheet

The Google Sheet contains 377 candidate rows. Under the existing pull logic, 234 rows have a usable final direction and 143 rows have no direction. The latter must remain visible as unresolved work and must not be silently skipped.

The current sheet also contains 146 rows whose final material type is `Архив`, while only four rows have an explicit archive override. `Архив` is lifecycle state, not a material type. These rows require validation before publication.

The existing sheet shows substantial differences between proposal columns and final columns without consistently recording an explicit override. The new workflow therefore records source provenance and decision reason for every final value.

Registry 2 is accepted classification evidence, not authority to originate a
canonical material identity. A Registry 2 row may enrich an already matched
entity or join an unambiguous new Registry 1 identity. An otherwise complete,
unmatched Registry 2-only row remains in the review projection as `rejected`
with stable reason/conflict code `REGISTRY1_IDENTITY_REQUIRED`; its Registry 2
values remain visible on the `Не определено` tab, and no registry entity is
created from it. A later Registry 1 capture can supply the missing identity
authority in a new content-addressed reconciliation run.

### Existing Automation

`agents/abbott_page_classifier/` already provides deterministic classification, a Google Sheets approval UI, and a local append-only JSONL lock registry. The local registry currently contains only workbook-seed events and no accepted batch events. It is not read by the dashboard and is not canonical production storage.

The active Abbott dashboard already reads release-scoped canonical MySQL tables, principally `portal_content_catalog` and `portal_content_lookup_projection`. This design preserves that runtime boundary.

## Scope

### In scope

- normalize and reconcile Registry 1, the current canonical catalog, and Registry 2;
- introduce stable material identities and aliases;
- preserve active canonical classification during the first merge;
- add deterministic and LLM-assisted proposals;
- add conflict and unresolved queues;
- record batch decisions and classification history in MySQL;
- materialize accepted, nonconflicting decisions into a reviewed successor release;
- make direction and material-type filters consume the successor release after activation;
- provide tests, evaluation, reconciliation, and publication gates.

### Out of scope

- editing the Abbott Bitrix CMS;
- exposing raw User ID or manager-only visit records to the LLM or Google Sheets;
- allowing the dashboard request path to read Google Sheets, source APIs, or OAuth tokens;
- automatic activation of a candidate release;
- changing cron, deploying, migrating production, installing secrets, sending Telegram messages, or calling source APIs as part of the design phase;
- using an LLM as an unreviewed production writer;
- silently rewriting an active release.

## Operating Constraints

External source APIs remain collector-only. Discovery, classification, approval ingestion, dashboard rendering, filtering, export, and read models read canonical MySQL or immutable local review artifacts. They do not call source APIs from dashboard requests.

Successful-empty collection is represented by canonical coverage. Failed or incomplete collection is represented by collector/request logs and is never replaced with another period.

Abbott raw User ID remains manager-only. The LLM classifier works on material content metadata and does not receive raw User ID, raw visit ID, raw client ID, or private visit rows.

Active Abbott releases remain append-only. Accepted classification changes are materialized into a reviewed successor release and never update the active release in place.

## Architecture

The approved architecture is a hybrid workflow:

```text
collectors -> canonical MySQL snapshots -> identity resolver
           -> deterministic classifier -> LLM classifier/verifier
           -> Google Sheets approval snapshot
           -> canonical approval events -> candidate release
           -> validation and review -> active release -> dashboard
```

Google Sheets is a disposable projection of a database-backed approval batch. The canonical decision is the immutable approval snapshot ingested into MySQL, not the mutable live cells after ingestion.

## Canonical Taxonomies

Taxonomies use stable machine codes and separately rendered Russian labels. The model and all write paths emit codes, not free-form labels.

### Directions

| Code | Label |
|---|---|
| `gastroenterology` | `Гастроэнтерология [262340]` |
| `cardiology` | `Кардиология [262338]` |
| `neurology_psychiatry` | `Неврология и психиатрия [262339]` |
| `womens_health` | `Женское здоровье [262337]` |
| `respiratory_health` | `Здоровье дыхательной системы [263746]` |
| `diabetes_management` | `Управление сахарным диабетом [620888]` |
| `pharmacists` | `Фармацевты` |
| `dermatology` | `Дерматология [624635]` |
| `not_applicable` | `Не относится / служебная` |
| `undetermined` | `Не определено` |

One primary direction is required for publication. Existing explicit multi-direction values remain historical evidence and enter manual review before conversion; the classifier does not invent multi-direction values.

### Material types

- `articles` — Статьи
- `video` — Видео
- `tables` — Таблицы
- `clinical_guidelines` — Клинические рекомендации
- `calculators` — Калькуляторы
- `clinical_cases` — Клинические случаи
- `educational_brochures` — Научно-образовательные брошюры
- `products` — Препараты и продукты
- `pharmacist_assistant` — Помощник фармацевта
- `podcasts` — Подкасты
- `personal_effectiveness` — Личная эффективность
- `knowledge_check` — Проверить знания
- `pharmacy_consulting_algorithms` — Алгоритмы фармацевтического консультирования
- `child_nutrition` — Детское питание
- `devices` — Приборы и устройства
- `respiratory_assistant` — Респираторный помощник
- `clinical_decision_support` — Цифровой консультант врача
- `events` — Мероприятия
- `general_materials` — Общие материалы
- `section` — Раздел
- `subsection` — Подраздел
- `special_project` — Спецпроект

`Архив` is explicitly excluded from material types.

### Access

- `all` — Все
- `doctors` — Врачи
- `pharmacists` — Фармацевты
- `unspecified` — Не указано

### Lifecycle

- `active`
- `archive_candidate`
- `archived`
- `unknown`

HTTP 404 or 410 may create an `archive_candidate`; it does not directly publish `archived`. HTTP 500, timeout, or missing probe coverage does not imply archive.

## Stable Identity and Anti-Flip

### Stable entity

Every material receives an internal `content_entity_id`. Identity evidence is resolved in this order:

1. exact CMS/material ID, when present;
2. exact canonical URL identity;
3. a unique previously approved URL alias;
4. a unique slug alias combined with compatible host/path context;
5. a unique normalized title plus compatible material-type evidence;
6. otherwise create an identity conflict or a new entity candidate.

The final step creates a new entity only when Registry 1 supplies the source
identity. Every collapsed Registry 1 occurrence keeps its source row locator,
fingerprint, normalized URL/title, and identity variant in immutable entity
provenance; materialization emits all such occurrences instead of replacing
them with a representative row.

Canonical URL normalization lowercases scheme and host, removes fragments and tracking parameters, normalizes percent encoding and trailing slashes, and preserves query parameters that change the semantic page identity. Direction-filter landing-page parameters are normalized deterministically rather than discarded blindly.

### Alias safety

Aliases have types `material_id`, `canonical_url`, `url`, `slug`, and `title`. A strong alias (`material_id`, `canonical_url`, `url`) can map to only one entity. A weak alias (`slug`, `title`) may be stored for evidence but cannot select an entity when more than one compatible candidate exists.

If URL, slug, and title evidence resolve to different locked entities, the item receives `IDENTITY_COLLISION` and cannot enter a ready batch.

### Anti-flip rule

An entity with an active approved direction behaves as follows:

- same proposed direction: record a no-op observation;
- missing proposed direction: retain the active direction but do not represent it as a new decision;
- different proposed direction: create `ANTI_FLIP_CONFLICT`; do not change active state;
- explicit correction: require final direction, reason, approver, approval batch, and timestamp; create a successor classification event while preserving the previous event.

The first reconciliation always gives the active canonical assignment priority over Registry 1, Registry 2, deterministic rules, and LLM output.

## Canonical Database Model

### `portal_content_registry_entities`

Stable non-PII identity table.

Required fields:

- `id` / `content_entity_id`;
- `dataset_key = 'abbott'`;
- optional `material_id`;
- canonical URL and SHA-256 hash;
- normalized path and hash;
- current display title;
- creation and update timestamps.

The table does not contain model decisions or active classification values.

### `portal_content_registry_aliases`

Required fields:

- entity ID;
- alias type;
- normalized alias hash;
- optional display value for nonprivate material metadata;
- source snapshot ID;
- first-seen and last-seen timestamps;
- uniqueness/resolution status.

Strong aliases have a uniqueness constraint scoped to the Abbott dataset. Ambiguous weak aliases are never selected automatically.

### `portal_content_taxonomy_versions` and `portal_content_taxonomy_terms`

Store an immutable taxonomy version and its allowed direction, material-type, access, and lifecycle codes. A batch and every LLM decision reference exactly one taxonomy version.

### `portal_content_approval_batches`

Required fields:

- stable batch ID;
- dataset key;
- taxonomy version;
- source snapshot IDs;
- prompt and model-routing versions;
- published input hash;
- accepted decision hash;
- counts for ready, conflict, unresolved, accepted, skipped, and rejected rows;
- status: `draft`, `published`, `accepted`, `ingested`, `candidate_materialized`, `rejected`, or `failed`;
- approver identity and timestamps;
- Google Sheet file ID as workflow metadata only.

Batch ID and accepted decision hash make ingestion idempotent.

### `portal_content_approval_items`

One row per entity candidate and batch. Required fields include:

- entity ID or unresolved identity fingerprint;
- current canonical values;
- Registry 1 values;
- deterministic proposal;
- primary LLM proposal;
- verifier proposal when used;
- final approved codes;
- readiness state;
- conflict code;
- short evidence JSON;
- input hash and row hash.

The table never stores chain-of-thought.

### `portal_content_classification_events`

Append-only approved history. Required fields include:

- entity ID;
- direction, material type, access, and lifecycle codes;
- event kind: `baseline`, `approve`, `correct`, `reject`, or `revoke`;
- source batch/item IDs;
- actor and reason;
- effective timestamp;
- predecessor event ID;
- immutable event fingerprint.

There is at most one effective approved classification per entity for a given materialized release.

### Release materialization

Accepted, nonconflicting events are projected into the existing release-scoped `portal_content_catalog` and `portal_content_lookup_projection` structures for a successor release. The dashboard read model remains DB-only and does not join approval workflow tables at request time.

## Merge Precedence

For the first consolidated registry:

1. active canonical classification is authoritative;
2. an explicit reviewed correction event may supersede it in a successor release;
3. Registry 1 may add a missing entity or fill an empty metadata field;
4. accepted Registry 2 values may add missing classification for an unlocked entity;
5. deterministic and LLM results are proposals only;
6. any nonempty disagreement with active canonical values becomes a conflict.

Empty incoming values never erase nonempty canonical values.

Normalization maps abbreviations and case variants to taxonomy codes before comparison. Normalization never resolves a genuine semantic conflict.

## Treatment of Accepted Batch 2

Batch `2026-07-21 10:55 UTC` is treated as business-approved input. Technical ingestion applies these rules:

1. Capture the exact sheet decision snapshot and compute `accepted_decision_hash`.
2. Reconcile all 377 source rows; no row may disappear from counts.
3. Rows with usable final values and no canonical conflict become accepted candidates.
4. The 143 observed rows without a direction remain `unresolved`.
5. Differences from active canonical classification become conflicts even though the batch is accepted.
6. `material_type = Архив` becomes an archive candidate only with explicit archive override or HTTP 404/410 evidence.
7. Other `Архив` material-type values receive `ARCHIVE_TYPE_INVALID`.
8. The candidate release is not activated until all hard gates pass.

Business approval therefore authorizes ingestion and reconciliation; it does not authorize silent canonical overwrites.

## Deterministic Classification

The deterministic cascade runs before the LLM:

1. canonical entity lock;
2. exact approved material ID or URL;
3. exact unique approved alias;
4. Bitrix direction/section ID;
5. known path prefix;
6. known material-type path prefix;
7. normalized Registry 1 metadata for missing fields;
8. keyword evidence;
9. unresolved.

Each result records a rule code, taxonomy version, input hash, and evidence signals. Deterministic results cannot bypass approval for a new entity.

## LLM Classification

### Provider and API

The initial provider is OpenAI through the Responses API.

- primary classifier: `gpt-5.6-terra`;
- verifier for ambiguous or conflicting items: `gpt-5.6-sol`;
- response persistence: `store: false`;
- output format: strict Structured Output JSON Schema;
- one material per logical classification request;
- provider/model routing remains behind an internal adapter so a future provider change does not alter canonical contracts.

Official references:

- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/guides/your-data#default-usage-policies-by-endpoint

### Input

The classifier receives only canonical or immutable snapshot data:

- title;
- normalized URL and path;
- breadcrumbs;
- H1;
- meta description;
- a bounded extracted content excerpt;
- access-restriction label;
- current material-type hint when present;
- deterministic result and evidence;
- exact taxonomy terms and definitions;
- a small versioned set of approved examples.

Access-restricted professional medical content is allowed. Raw User ID, visit ID, raw client ID, and user-level behavior rows are excluded.

Aggregate audience signals remain disabled in the first implementation. They may be added only by a separately reviewed version that exports minimum-cohort, aggregate distributions from canonical MySQL and never sends per-user identifiers.

### Output schema

The strict output contains:

- `direction_code`;
- `material_type_code`;
- `direction_confidence` between 0 and 1;
- `material_type_confidence` between 0 and 1;
- `alternative_direction_codes`;
- `evidence`, limited to short source-grounded signals;
- `requires_medical_review`;
- `insufficient_evidence`.

Unknown fields and free-form taxonomy values are rejected by schema validation.

### Routing and verification

- locked entity: no LLM call is required for active classification;
- deterministic rule and Terra agree: ready proposal;
- deterministic result is incomplete: Terra supplies the missing field proposal;
- Terra confidence below `0.85`, multiple alternatives, or rule disagreement: run Sol verifier;
- Terra and Sol agree on the relevant field with verifier confidence at least `0.85`: mark `llm_verified`;
- Terra and Sol disagree: `LLM_DISAGREEMENT` conflict;
- evidence is insufficient: unresolved;
- any proposal different from an active direction: `ANTI_FLIP_CONFLICT` regardless of confidence.

Model self-confidence is evidence, not sole authority. Publication also requires taxonomy validity, rule/model agreement state, identity safety, and human approval.

### Reproducibility and data handling

Each decision stores:

- model IDs;
- prompt version;
- taxonomy version;
- normalized input hash;
- request attempt count;
- structured result;
- latency and token usage metadata when returned;
- concise evidence signals.

Prompts do not request hidden reasoning. The system stores no chain-of-thought.

OpenAI API content is not used for training unless the organization explicitly opts in. Default abuse-monitoring retention may be up to 30 days. `store: false` is required; Zero Data Retention may be adopted later without changing the classification contract.

## Google Sheets Approval Projection

### `Апрув batch`

Shows:

- batch ID;
- published input hash;
- taxonomy and prompt versions;
- ready, conflict, and unresolved counts;
- decision dropdown;
- accepted decision hash and ingestion timestamp after pull.

Accepting the batch approves only the ready projection. Conflicts and unresolved rows remain open.

### `Предложения`

One row per ready item with:

- entity ID;
- title and URL;
- current canonical values;
- proposed direction, material type, access, and lifecycle;
- deterministic rule;
- LLM/verifier status;
- confidence and concise evidence;
- editable final values;
- optional decision reason;
- batch and row hashes.

Proposal columns are read-only. Final columns have taxonomy-backed dropdowns.

### `Конфликты`

Shows sources side by side:

- canonical value;
- Registry 1 value;
- accepted Registry 2 value;
- rule result;
- Terra result;
- Sol result;
- conflict code;
- explicit final decision and mandatory reason fields.

### `Не определено`

Contains insufficient-evidence and incomplete rows. A row moves to ready only after both required classification fields are supplied and validated.

### `История`

Read-only batch history with decision hashes, approvers, timestamps, counts, import outcome, candidate release ID, and activation status.

### `Справочники`, `Сводка`, and `Как это работает`

These tabs expose the exact taxonomy version, validation rules, batch counts, and operator instructions. They do not become canonical authority.

## Weekly Workflow

1. Complete canonical collection and coverage checks.
2. Discover new, changed, unresolved, and Registry 1-only material candidates from canonical MySQL snapshots.
3. Resolve entity identity and aliases.
4. Apply canonical locks and deterministic classification.
5. Call Terra only for eligible incomplete/new items.
6. Call Sol only for the defined verification cases.
7. Persist the draft batch and publish its Google Sheet projection.
8. The content/project operator edits final fields, resolves chosen exceptions, and accepts the batch.
9. Pull the exact current decision snapshot, compute its accepted hash, and ingest it idempotently.
10. Store approved events and keep conflicts/unresolved rows open.
11. Materialize accepted nonconflicting changes into a candidate successor release.
12. Run reconciliation, taxonomy, identity, anti-flip, coverage, and dashboard smoke gates.
13. Activate only through the existing reviewed release process.

No dashboard request, filter, render, or export waits for Google Sheets or an LLM call.

## Failure Handling

- missing canonical coverage: do not publish affected candidates; report incomplete coverage;
- LLM timeout or provider error: retry once for a transient failure, then mark unresolved;
- invalid structured output: retry once with the same immutable input, then mark `LLM_SCHEMA_FAILURE`;
- source content unavailable: preserve candidate and mark `CONTENT_UNAVAILABLE`;
- identity disagreement: `IDENTITY_COLLISION` conflict;
- direction disagreement with active canonical: `ANTI_FLIP_CONFLICT`;
- rule/model disagreement: verifier or conflict according to routing rules;
- changed Google Sheet after ingestion: ignored until a new batch; the ingested hash remains immutable;
- repeat pull of the same accepted hash: no-op;
- partial DB write: roll back the transaction and retain the batch as failed;
- candidate release validation failure: do not activate and do not substitute an older or different period.

## Publication Gates

Activation requires all of the following:

1. zero anti-flip violations;
2. zero unresolved strong identity collisions;
3. zero values outside the referenced taxonomy version;
4. zero `Архив` material-type values;
5. exact 100% reconciliation of source, ready, conflict, unresolved, accepted, and rejected counts;
6. exact accepted decision hash match;
7. 100% strict-schema compliance for stored LLM results;
8. no unresolved accepted-row conflict;
9. no mutation of the active release during candidate construction;
10. successful Abbott page-stat filter smoke tests for direction and material type.

## Evaluation and Testing

### Golden evaluation set

Build a versioned evaluation set from reviewed canonical materials. Separate training examples from evaluation examples. The evaluation set includes:

- every canonical direction;
- every canonical material type with available examples;
- generic `/academy/` paths;
- conflicting title/path signals;
- duplicate titles and slugs;
- access-restricted medical materials;
- archive candidates;
- insufficient-evidence cases;
- anti-flip attempts.

Before enabling LLM proposals for the weekly workflow, the evaluation must achieve:

- at least 95% exact primary-direction accuracy;
- at least 95% exact material-type accuracy;
- 100% detection of anti-flip fixtures;
- 100% output taxonomy validity;
- 100% strict JSON-schema compliance after the single allowed retry.

LLM accuracy does not relax any hard publication gate.

### Required test layers

- unit tests for normalization, taxonomy mapping, URL identity, alias ambiguity, and anti-flip;
- parser tests for both registries;
- deterministic classifier tests;
- mocked Responses API structured-output and retry tests;
- golden-set evaluation runner;
- Google Sheet projection and pull hash tests;
- DB transaction and idempotency tests;
- candidate release reconciliation tests;
- dashboard read-model and filter tests;
- release-content tests ensuring private/user-level data is absent from public artifacts.

## Success Criteria

1. Registry 1, Registry 2, and current canonical data reconcile without silent row loss.
2. Active canonical classification is unchanged by the first merge unless an explicit reviewed correction is approved.
3. The same page cannot silently change direction through URL, slug, title, rule, or LLM variation.
4. New materials receive direction and material-type proposals within the weekly cycle.
5. Conflicts and unresolved rows are visible and actionable.
6. Google Sheet approval produces an immutable, idempotent database decision snapshot.
7. The dashboard reads only the activated canonical successor release.
8. No raw User ID or user-level behavior data is sent to the LLM or Google Sheet.
9. Every published classification can be traced to entity identity, source snapshots, rules/models, human approval, and release.

## Rollout Boundaries

Implementation proceeds through reviewed local changes, tests, dry-run reconciliation, LLM evaluation, Google Sheet projection verification, candidate release construction, and a separate activation decision.

This design authorizes no production migration, deployment, secret installation, source API call, cron edit, Telegram send, Google Sheet mutation, or release activation.
