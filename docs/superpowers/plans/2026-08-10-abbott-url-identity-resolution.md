# Abbott URL Identity Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve Abbott analytics pages through reviewed strong URL identity so direction and material type are complete without recollecting Metrika facts.

**Architecture:** Merge the already deployed canonical content-registry authority, add a release-scoped `url` lookup kind and a new `service_page` taxonomy term, then materialize reviewed aliases into a DB-native successor release. The dashboard resolves exact URL before path/title/slug, while Google Sheets remains the human approval projection and canonical MySQL remains the only runtime source.

**Tech Stack:** Python 3.11, MySQL 8/InnoDB, TypeScript, Next.js, Node test runner, Python `unittest`, Google Sheets approval workflow, Playwright smoke tests.

## Global Constraints

- Abbott only; do not change Zaruku, Gidrofuril, Bitrix live integration, or unrelated dashboards.
- Dashboard requests, filters, exports, and renders read canonical MySQL only and never call Metrika, Google Sheets, or an LLM.
- Do not recollect or rewrite Metrika facts. The successor is cloned DB-native from active release `24` with exact reconciliation.
- Preserve release `24` as the rollback target until post-cutover smoke checks pass.
- Batch `6` is immutable evidence; create a new reconciliation run and approval batch.
- Existing direction/type values never flip without an accepted correction event, actor, reason, and predecessor event.
- Raw User ID, visit ID, client ID, and private visit rows never enter classification, Sheets, logs, fixtures, or prompts.
- Every migration, runtime copy, manifest, and nested dashboard gitlink must be byte-attested before deployment.
- Use TDD for every behavior change and commit after each independently reviewable task.

---

## File Structure

- `agents/abbott_page_classifier/normalization.py`: canonical Python URL and taxonomy normalization.
- `agents/abbott_page_classifier/domain.py`: immutable taxonomy codes and workflow value objects.
- `agents/abbott_page_classifier/candidate_release.py`: catalog overlay, URL projection, DB-native candidate, and publication gates.
- `agents/abbott_page_classifier/workflow_service.py`: weekly discovery and reconciliation orchestration.
- `agents/abbott_page_classifier/workflow_repository.py`: canonical MySQL reads for aliases, observed page URLs, and workflow persistence.
- `agents/abbott_page_classifier/reconcile.py`: archive, service-page, conflict, and anti-flip decisions.
- `agents/abbott_page_classifier/sheets_sync.py`: Google Sheet projection for reviewed URL/entity choices.
- `dashboard-next/src/lib/abbott-page-url.ts`: TypeScript content-identity normalization.
- `dashboard-next/src/lib/abbott-private-types.ts`: URL lookup map in the aggregate read model.
- `dashboard-next/src/lib/abbott-private-store.ts`: load only safe URL/path/title/slug projections from canonical MySQL.
- `dashboard-next/src/lib/abbott-bi.ts`: exact URL-first metadata lookup shared by table, charts, filters, and export.
- `dashboard-next/src/db/migrations/050_abbott_content_url_identity.sql`: lookup-kind schema extension.
- `dashboard-next/reportingdash-canonical-bootstrap/src/db/migrations/050_abbott_content_url_identity.sql`: packaged migration authority.
- `ops/sql/abbott_private_schema_and_grants.sql`: replay-safe canonical schema authority.
- `ops/abbott-runtime-manifest.sha256` and bootstrap manifests: deployed runtime closure.

---

### Task 1: Integrate the deployed content-registry authority

**Files:**
- Merge source: `codex/abbott-returning-registry-batch`
- Preserve: `abbott_release_retention.py`
- Preserve: `docs/superpowers/specs/2026-08-10-abbott-url-identity-resolution-design.md`

**Interfaces:**
- Consumes: active content workflow represented by root commit `d23519c` and nested dashboard commit `52d7444d1c56afdbe7fdf0208ceb46f5a76f90bb`.
- Produces: one feature branch containing both retention safeguards and the production content-registry code used by subsequent tasks.

- [ ] **Step 1: Verify merge scope before mutation**

Run:

```bash
git log --oneline main..codex/abbott-returning-registry-batch
git diff --name-status main...codex/abbott-returning-registry-batch
git -C dashboard-next merge-base --is-ancestor \
  02c57effa8d909d91bc68cc1ae74cf590753841c \
  52d7444d1c56afdbe7fdf0208ceb46f5a76f90bb
```

Expected: the root diff contains the Abbott registry pipeline, Abbott runtime contracts, tests, docs, and the dashboard gitlink; the nested ancestry command exits `0`.

- [ ] **Step 2: Merge the authority branch**

Run:

```bash
git merge --no-ff codex/abbott-returning-registry-batch \
  -m "merge: adopt Abbott content registry authority"
git -C dashboard-next checkout --detach \
  "$(git rev-parse HEAD:dashboard-next)"
```

Expected: the root merge succeeds without changing `nest-second`; nested dashboard HEAD equals the root gitlink.

- [ ] **Step 3: Run the imported pipeline baseline**

Run:

```bash
python3 -m unittest discover -s tests/abbott_page_classifier -p 'test_*.py'
python3 -m unittest \
  tests.test_abbott_content_registry_schema \
  tests.test_abbott_content_reconciliation_schema \
  tests.test_abbott_runtime_closure \
  tests.test_abbott_release_operator \
  tests.test_canonical_release_store \
  tests.test_abbott_release_retention
```

Expected: all imported registry, release, runtime, and retention tests pass.

---

### Task 2: Add URL lookup and service-page taxonomy contracts

**Files:**
- Modify: `agents/abbott_page_classifier/domain.py`
- Modify: `ops/sql/abbott_private_schema_and_grants.sql`
- Create: `dashboard-next/src/db/migrations/050_abbott_content_url_identity.sql`
- Create: `dashboard-next/reportingdash-canonical-bootstrap/src/db/migrations/050_abbott_content_url_identity.sql`
- Create: `dashboard-next/src/db/abbott-content-url-identity-migration.test.ts`
- Modify: `tests/abbott_page_classifier/test_domain.py`
- Modify: `tests/test_abbott_schema_contract.py`

**Interfaces:**
- Consumes: `MATERIAL_TYPE_LABELS`, `portal_content_lookup_projection.lookup_kind`.
- Produces: taxonomy code `service_page` and schema-supported lookup kind `url`.

- [ ] **Step 1: Write failing taxonomy and migration tests**

Add assertions equivalent to:

```python
def test_service_page_is_a_canonical_material_type(self):
    self.assertEqual(MATERIAL_TYPE_LABELS["service_page"], "Служебная страница")
    self.assertIn("service_page", MATERIAL_TYPE_CODES)
```

```ts
test("migration adds url without dropping existing lookup kinds", () => {
  assert.match(sql, /ENUM\('title','slug','path','url'\)/);
  for (const kind of ["title", "slug", "path", "url"]) {
    assert.match(sql, new RegExp(kind));
  }
});
```

Run:

```bash
python3 -m unittest tests.abbott_page_classifier.test_domain
cd dashboard-next && node --test src/db/abbott-content-url-identity-migration.test.ts
```

Expected: both fail because `service_page` and migration `050` do not exist.

- [ ] **Step 2: Implement the taxonomy and replay-safe migration**

Add to `MATERIAL_TYPE_LABELS`:

```python
"service_page": "Служебная страница",
```

Migration body:

```sql
ALTER TABLE portal_content_lookup_projection
  MODIFY COLUMN lookup_kind
    ENUM('title','slug','path','url') NOT NULL;
```

Apply the same enum definition to the canonical replay schema. Do not alter an active taxonomy version in place; the workflow creates a new taxonomy version and digest for the successor batch.

- [ ] **Step 3: Verify schema contracts**

Run:

```bash
python3 -m unittest \
  tests.abbott_page_classifier.test_domain \
  tests.test_abbott_schema_contract
cd dashboard-next && node --test src/db/abbott-content-url-identity-migration.test.ts
```

Expected: all tests pass and both migration copies are byte-identical.

- [ ] **Step 4: Commit**

```bash
git -C dashboard-next add src/db/migrations/050_abbott_content_url_identity.sql \
  reportingdash-canonical-bootstrap/src/db/migrations/050_abbott_content_url_identity.sql \
  src/db/abbott-content-url-identity-migration.test.ts
git -C dashboard-next commit -m "feat(abbott): add URL lookup migration"
git add dashboard-next agents/abbott_page_classifier/domain.py \
  ops/sql/abbott_private_schema_and_grants.sql \
  tests/abbott_page_classifier/test_domain.py tests/test_abbott_schema_contract.py
git commit -m "feat(abbott): define URL identity taxonomy"
```

---

### Task 3: Make Python and TypeScript URL identity deterministic

**Files:**
- Modify: `agents/abbott_page_classifier/normalization.py`
- Modify: `tests/abbott_page_classifier/test_normalization.py`
- Create: `tests/fixtures/abbott_url_identity_cases.json`
- Modify: `dashboard-next/src/lib/abbott-page-url.ts`
- Modify: `dashboard-next/src/lib/abbott-page-url.test.ts`
- Create: `dashboard-next/src/lib/abbott-url-identity-cases.json`
- Modify: `tests/test_abbott_runtime_closure.py`

**Interfaces:**
- Consumes: raw page URL.
- Produces: Python `normalize_url(raw: str) -> NormalizedUrl` and TypeScript `normalizeAbbottContentIdentityUrl(raw: unknown): string` with byte-identical normalized URL values.

- [ ] **Step 1: Add shared parity fixtures and failing tests**

Fixture cases must include:

```json
[
  {"raw":"HTTP://WWW.ABBOTTPRO.RU/academy/articles/test/?utm_source=x#part","value":"https://abbottpro.ru/academy/articles/test","path":"/academy/articles/test"},
  {"raw":"https://abbottpro.ru/search/?q=heart&utm_campaign=x","value":"https://abbottpro.ru/search?q=heart","path":"/search"},
  {"raw":"/auth/","value":"https://abbottpro.ru/auth","path":"/auth"},
  {"raw":"file:///C:/Users/user/page.html","value":"","path":""}
]
```

Python and TypeScript tests iterate every row and assert exact `value` and `path` equality. A closure test asserts the two fixture files have identical SHA-256.

Run:

```bash
python3 -m unittest tests.abbott_page_classifier.test_normalization
cd dashboard-next && node --test src/lib/abbott-page-url.test.ts
```

Expected: failures on host aliasing, scheme canonicalization, semantic query preservation, and file URL rejection.

- [ ] **Step 2: Implement the identity normalizer without changing display grouping**

Keep `normalizeAbbottPageUrl()` as the page-display/grouping function. Add a separate lookup identity function:

```ts
export function normalizeAbbottContentIdentityUrl(rawValue: unknown): string {
  const value = String(rawValue ?? "").trim().replaceAll("&amp;", "&");
  if (!isAbbottWebPageUrl(value)) return "";
  const url = new URL(value.startsWith("/") ? `https://abbottpro.ru${value}` : value);
  if (url.hostname.toLowerCase() === "www.abbottpro.ru") url.hostname = "abbottpro.ru";
  if (url.hostname.toLowerCase() === "abbottpro.ru") url.protocol = "https:";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    const normalized = key.toLowerCase();
    if (normalized.startsWith("utm_") || TRACKING_QUERY_KEYS.has(normalized)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  url.pathname = normalizeIdentityPath(url.pathname);
  return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
}
```

Mirror these rules in Python `normalize_url()`. Preserve encoded path delimiters and semantic query parameters.

- [ ] **Step 3: Run parity and regression tests**

Run:

```bash
python3 -m unittest \
  tests.abbott_page_classifier.test_normalization \
  tests.test_abbott_runtime_closure
cd dashboard-next && node --test \
  src/lib/abbott-page-url.test.ts \
  src/lib/abbott-content-lookup.test.ts
```

Expected: all tests pass; existing page grouping remains unchanged.

- [ ] **Step 4: Commit**

```bash
git -C dashboard-next add src/lib/abbott-page-url.ts \
  src/lib/abbott-page-url.test.ts src/lib/abbott-url-identity-cases.json
git -C dashboard-next commit -m "feat(abbott): normalize content URL identity"
git add dashboard-next agents/abbott_page_classifier/normalization.py \
  tests/abbott_page_classifier/test_normalization.py \
  tests/fixtures/abbott_url_identity_cases.json tests/test_abbott_runtime_closure.py
git commit -m "feat(abbott): align URL identity normalization"
```

---

### Task 4: Materialize strong URL aliases into the lookup projection

**Files:**
- Modify: `agents/abbott_page_classifier/candidate_release.py`
- Modify: `agents/abbott_page_classifier/workflow_repository.py`
- Modify: `tests/abbott_page_classifier/test_candidate_release.py`
- Modify: `tests/abbott_page_classifier/test_workflow_repository.py`

**Interfaces:**
- Consumes: candidate catalog rows and active `canonical_url`/`url` aliases.
- Produces: `build_lookup_projection(catalog_rows, page_facts=(), strong_aliases=())` rows with `lookup_kind="url"` and fail-closed collisions.

- [ ] **Step 1: Write failing projection tests**

Add tests asserting:

```python
rows = build_lookup_projection(
    catalog_rows,
    strong_aliases=(
        {"content_entity_id": 7, "alias_type": "url", "alias_value": "https://abbottpro.ru/legacy"},
    ),
)
url_rows = [row for row in rows if row.lookup_kind == "url"]
self.assertEqual(len(url_rows), 2)
self.assertTrue(all(row.resolution_status == "unique" for row in url_rows))
```

Add a collision test where one normalized URL belongs to two entities and assert `CandidateMaterializationError("STRONG_IDENTITY_COLLISION")` before any candidate insert.

Run:

```bash
python3 -m unittest \
  tests.abbott_page_classifier.test_candidate_release \
  tests.abbott_page_classifier.test_workflow_repository
```

Expected: fail because projection accepts no aliases and emits no `url` groups.

- [ ] **Step 2: Add the strong-alias value object and repository read**

Add:

```python
@dataclass(frozen=True)
class StrongUrlAlias:
    content_entity_id: int
    alias_type: str
    alias_value: str
```

Repository SQL must select only active strong aliases:

```sql
SELECT content_entity_id, alias_type, alias_value
FROM portal_content_registry_aliases
WHERE dataset_key = 'abbott'
  AND alias_status = 'active'
  AND uniqueness_scope = 'strong'
  AND alias_type IN ('canonical_url', 'url')
ORDER BY content_entity_id, alias_type, alias_hash;
```

- [ ] **Step 3: Build URL groups by entity, not by representative row**

Extend the signature:

```python
def build_lookup_projection(
    catalog_rows: Iterable[CandidateCatalogRow],
    *,
    page_facts: Iterable[Mapping[str, object]] = (),
    strong_aliases: Iterable[StrongUrlAlias] = (),
) -> tuple[LookupProjectionRow, ...]:
```

For each normalized canonical URL or alias, select catalog rows with the same
`content_entity_id`. If that URL identifies multiple entities, raise
`STRONG_IDENTITY_COLLISION`. Otherwise emit one `url` projection group whose
selected fingerprint belongs to that entity.

- [ ] **Step 4: Extend all materialization gates and hashes**

Update lookup row counts, expected kinds, validation SQL, manifests, and smoke
queries from `('title','slug','path')` to
`('title','slug','path','url')`. Candidate hashes must include URL rows.

- [ ] **Step 5: Verify**

Run:

```bash
python3 -m unittest \
  tests.abbott_page_classifier.test_candidate_release \
  tests.abbott_page_classifier.test_workflow_repository \
  tests.test_abbott_canonical_controls
```

Expected: projection, collision, hash, and publication-gate tests pass.

- [ ] **Step 6: Commit**

```bash
git add agents/abbott_page_classifier/candidate_release.py \
  agents/abbott_page_classifier/workflow_repository.py \
  tests/abbott_page_classifier/test_candidate_release.py \
  tests/abbott_page_classifier/test_workflow_repository.py \
  tests/test_abbott_canonical_controls.py
git commit -m "feat(abbott): materialize strong URL lookups"
```

---

### Task 5: Discover observed gaps and create a successor review batch

**Files:**
- Modify: `agents/abbott_page_classifier/workflow_service.py`
- Modify: `agents/abbott_page_classifier/workflow_repository.py`
- Modify: `agents/abbott_page_classifier/reconcile.py`
- Modify: `agents/abbott_page_classifier/sources.py`
- Modify: `tests/abbott_page_classifier/test_workflow_service.py`
- Modify: `tests/abbott_page_classifier/test_workflow_repository.py`
- Modify: `tests/abbott_page_classifier/test_reconcile.py`

**Interfaces:**
- Consumes: observed page facts from active release `24`, active aliases, registry entities, immutable Registry 1/2 captures.
- Produces: new immutable reconciliation items for unmapped/ambiguous observed URLs and corrected archive/service proposals.

- [ ] **Step 1: Write failing observed-page discovery tests**

Define:

```python
@dataclass(frozen=True)
class ObservedPage:
    normalized_url: str
    page_title: str
    pageviews: int
    first_seen: date
    last_seen: date
```

Tests must prove that an observed URL absent from strong aliases becomes one
reconciliation item, repeated daily rows collapse with summed pageviews, and a
known alias produces no duplicate item.

- [ ] **Step 2: Add aggregate-only canonical discovery SQL**

Repository query:

```sql
SELECT
  JSON_UNQUOTE(JSON_EXTRACT(scope_dimensions, '$.page_url')) AS page_url,
  MAX(JSON_UNQUOTE(JSON_EXTRACT(scope_dimensions, '$.page_title'))) AS page_title,
  SUM(pageviews) AS pageviews,
  MIN(report_date) AS first_seen,
  MAX(report_date) AS last_seen
FROM canonical_fact_metrika_site_analytics_daily
WHERE canonical_release_id = %s
  AND counter_id = 90602537
  AND analytics_scope = 'page'
  AND pageviews > 0
GROUP BY JSON_UNQUOTE(JSON_EXTRACT(scope_dimensions, '$.page_url'))
ORDER BY page_url;
```

Normalize after reading and drop non-web/off-domain values. Do not read private
visit rows.

- [ ] **Step 3: Reconcile service pages explicitly**

Add deterministic service-route evidence for `/auth`, `/registration.php`,
`/personal/`, `/rules`, `/privacy`, `/cookies`, and `/sitemap.php`. It emits:

```python
Proposal(
    direction_code="not_applicable",
    material_type_code="service_page",
    access_code="unspecified",
    lifecycle_code="active",
    rule_code="SERVICE_ROUTE",
    confidence=Decimal("1.0"),
    evidence=("reviewed service route",),
)
```

The proposal remains human-reviewed for a new entity/alias.

- [ ] **Step 4: Correct archive semantics without rewriting batch 6**

When raw material type is `Архив`, emit lifecycle `archive_candidate` and leave
material type at the active canonical value or unresolved. `ARCHIVE_TYPE_INVALID`
must disappear only when lifecycle evidence and a valid material type are both
present.

- [ ] **Step 5: Verify batch accounting**

Run:

```bash
python3 -m unittest \
  tests.abbott_page_classifier.test_workflow_service \
  tests.abbott_page_classifier.test_workflow_repository \
  tests.abbott_page_classifier.test_reconcile \
  tests.abbott_page_classifier.test_sources
```

Expected: exact source + observed-gap count reconciliation and no mutation of batch `6`.

- [ ] **Step 6: Commit**

```bash
git add agents/abbott_page_classifier/workflow_service.py \
  agents/abbott_page_classifier/workflow_repository.py \
  agents/abbott_page_classifier/reconcile.py \
  agents/abbott_page_classifier/sources.py \
  tests/abbott_page_classifier/test_workflow_service.py \
  tests/abbott_page_classifier/test_workflow_repository.py \
  tests/abbott_page_classifier/test_reconcile.py \
  tests/abbott_page_classifier/test_sources.py
git commit -m "feat(abbott): review observed URL identity gaps"
```

---

### Task 6: Make URL/entity decisions explicit in Google Sheets

**Files:**
- Modify: `agents/abbott_page_classifier/domain.py`
- Modify: `agents/abbott_page_classifier/approval_hashes.py`
- Modify: `agents/abbott_page_classifier/sheets_sync.py`
- Modify: `agents/abbott_page_classifier/repository.py`
- Modify: `agents/abbott_page_classifier/workflow_repository.py`
- Modify: `tests/abbott_page_classifier/test_sheets_sync.py`
- Modify: `tests/abbott_page_classifier/test_approval_ingestion.py`

**Interfaces:**
- Consumes: conflict/unresolved items with candidate entities and normalized URL.
- Produces: immutable accepted alias decision bound to batch/item hashes and classification event.

- [ ] **Step 1: Write failing Sheet and ingestion tests**

For conflict rows, require columns:

```text
Нормализованный URL
Текущий entity ID
Кандидат entity ID
Решение по URL
Причина решения
```

Tests assert an `IDENTITY_COLLISION` row cannot be accepted without one selected
entity and a nonempty reason, and that changing the selected entity changes the
accepted decision hash.

- [ ] **Step 2: Add immutable alias decision fields**

Extend `ApprovalItem` with nullable fields:

```python
selected_content_entity_id: int | None = None
url_alias_decision: str | None = None
```

Allowed decisions are `attach`, `retire`, and `reject`. `attach` requires a
positive entity ID and reason; `retire` requires an existing active alias and
reason; `reject` creates no alias.

- [ ] **Step 3: Persist accepted alias events transactionally**

Inside the existing batch acceptance transaction, lock the selected entity and
strong alias rows, recheck uniqueness, append the reviewed event/evidence, and
then update the alias. A uniqueness race raises `IDENTITY_COLLISION` and rolls
back the whole acceptance.

- [ ] **Step 4: Verify projection and replay safety**

Run:

```bash
python3 -m unittest \
  tests.abbott_page_classifier.test_sheets_sync \
  tests.abbott_page_classifier.test_approval_ingestion \
  tests.abbott_page_classifier.test_repository \
  tests.abbott_page_classifier.test_workflow_repository
```

Expected: accepted hashes include alias decisions; repeated ingestion is a no-op.

- [ ] **Step 5: Commit**

```bash
git add agents/abbott_page_classifier/domain.py \
  agents/abbott_page_classifier/approval_hashes.py \
  agents/abbott_page_classifier/sheets_sync.py \
  agents/abbott_page_classifier/repository.py \
  agents/abbott_page_classifier/workflow_repository.py \
  tests/abbott_page_classifier/test_sheets_sync.py \
  tests/abbott_page_classifier/test_approval_ingestion.py \
  tests/abbott_page_classifier/test_repository.py \
  tests/abbott_page_classifier/test_workflow_repository.py
git commit -m "feat(abbott): approve strong URL alias decisions"
```

---

### Task 7: Resolve dashboard metadata URL-first

**Files:**
- Modify: `dashboard-next/src/lib/abbott-private-types.ts`
- Modify: `dashboard-next/src/lib/abbott-private-store.ts`
- Modify: `dashboard-next/src/lib/abbott-bi.ts`
- Modify: `dashboard-next/src/lib/abbott-private-store.test.ts`
- Modify: `dashboard-next/src/lib/abbott-bi-loader.test.ts`
- Modify: `dashboard-next/src/lib/abbott-data-projection.test.ts`

**Interfaces:**
- Consumes: canonical projection kinds `url`, `path`, `title`, `slug`.
- Produces: one metadata resolver used by page table, charts, filters, return pages, and XLSX export.

- [ ] **Step 1: Write the failing precedence regression**

Test setup:

```ts
const workbook = {
  contentByUrl: new Map([[hash("https://abbottpro.ru/academy/articles/a"), gastroArticle]]),
  urlReturnDirections: new Map([[hash("/academy/articles/a"), gastroArticle]]),
  contentByTitle: new Map([[abbottTitleLookupHash("Одинаковый заголовок"), cardioArticle]]),
  contentBySlug: new Map([[hash("a"), cardioArticle]]),
};
```

Assert that the page resolves to `gastroArticle`, proving exact URL wins over a
conflicting title and slug. Add a second test proving ambiguous URL rows are not
loaded.

- [ ] **Step 2: Add `contentByUrl` to the private aggregate model**

```ts
export type AbbottAggregateWorkbookData = {
  contentByUrl: Map<string, AbbottContentMetadata>;
  contentByTitle: Map<string, AbbottContentMetadata>;
  contentBySlug: Map<string, AbbottContentMetadata>;
  urlReturnDirections: Map<string, AbbottContentMetadata>;
};
```

`loadAggregateWorkbook()` routes `lookup_kind="url"` into `contentByUrl` and
continues to reject duplicate hashes.

- [ ] **Step 3: Implement exact lookup precedence**

```ts
const identityUrl = normalizeAbbottContentIdentityUrl(rawUrl);
const normalized = normalizePage(rawUrl);
const path = normalizedPagePath(identityUrl || normalized);
const slug = path.split("/").filter(Boolean).at(-1) ?? "";
const metadata = (identityUrl ? workbook.contentByUrl.get(lookupHash(identityUrl)) : undefined)
  ?? workbook.urlReturnDirections.get(lookupHash(path))
  ?? (rawTitle ? workbook.contentByTitle.get(abbottTitleLookupHash(rawTitle)) : undefined)
  ?? workbook.contentBySlug.get(lookupHash(slug));
```

Pass the raw source URL into `metadataForPage()` before applying display URL
normalization. Keep table grouping and metric totals unchanged.

- [ ] **Step 4: Run dashboard tests**

Run:

```bash
cd dashboard-next
node --test \
  src/lib/abbott-private-store.test.ts \
  src/lib/abbott-bi-loader.test.ts \
  src/lib/abbott-data-projection.test.ts \
  src/components/abbott-page-stats.test.ts \
  src/components/abbott-page-stats-summary.ui.test.ts
npm run lint
npm run build
```

Expected: URL-first tests pass, existing July/August totals and UI tests remain unchanged, build exits `0`.

- [ ] **Step 5: Commit nested dashboard and gitlink**

```bash
git -C dashboard-next add src/lib/abbott-page-url.ts \
  src/lib/abbott-private-types.ts src/lib/abbott-private-store.ts \
  src/lib/abbott-bi.ts src/lib/abbott-private-store.test.ts \
  src/lib/abbott-bi-loader.test.ts src/lib/abbott-data-projection.test.ts
git -C dashboard-next commit -m "fix(abbott): resolve page metadata URL-first"
git add dashboard-next
git commit -m "chore: advance Abbott URL identity dashboard"
```

---

### Task 8: Add DB-native clone and metadata-only publication controls

**Files:**
- Modify: `agents/abbott_page_classifier/candidate_release.py`
- Modify: `abbott_canonical_controls.py`
- Modify: `tests/abbott_page_classifier/test_candidate_release.py`
- Modify: `tests/test_abbott_canonical_controls.py`
- Modify: `ops/runbooks/abbott_content_registry.md`

**Interfaces:**
- Consumes: active release `24`, accepted successor batch, rebuilt catalog/projection.
- Produces: staging candidate with fact totals identical to `24` and content metadata changes only.

- [ ] **Step 1: Write failing metadata-only control tests**

Controls must compare releases for June, July, and August:

```python
METRIC_COLUMNS = ("sessions", "users", "pageviews", "goal_conversions")
PERIODS = (
    ("2026-06-01", "2026-06-30"),
    ("2026-07-01", "2026-07-31"),
    ("2026-08-01", "2026-08-09"),
)
```

Tests mutate one cloned pageview and assert validation fails with
`FACT_TOTAL_MISMATCH`. Tests mutate only direction/type metadata and assert the
fact control still passes.

- [ ] **Step 2: Make clone receipts exact and source-free**

For every release-scoped fact table, store predecessor count, candidate count,
and deterministic hash. The clone function accepts no Metrika token/client and
does not import collector modules. Coverage rows must be cloned exactly.

- [ ] **Step 3: Add observed-page resolution gates**

Candidate validation fails when an observed content-like URL has no direction
or material type, or a non-content URL has neither `service_page` nor a reviewed
exclusion. Store aggregate counts only; do not store raw User IDs in evidence.

- [ ] **Step 4: Verify candidate and controls**

Run:

```bash
python3 -m unittest \
  tests.abbott_page_classifier.test_candidate_release \
  tests.test_abbott_canonical_controls \
  tests.test_abbott_release_operator \
  tests.test_canonical_release_store
```

Expected: all metadata-only, resolution, rollback, and append-only gates pass.

- [ ] **Step 5: Commit**

```bash
git add agents/abbott_page_classifier/candidate_release.py \
  abbott_canonical_controls.py \
  tests/abbott_page_classifier/test_candidate_release.py \
  tests/test_abbott_canonical_controls.py \
  ops/runbooks/abbott_content_registry.md
git commit -m "feat(abbott): gate metadata-only successor releases"
```

---

### Task 9: Close runtime manifests, operator guidance, and full verification

**Files:**
- Modify: `agents/abbott_page_classifier/PROCESS.md`
- Modify: `agents/abbott_page_classifier/README.md`
- Modify: `docs/ABBOTT-OPERATIONS-RUNBOOK.md`
- Modify: `AGENTS.md`
- Modify: `ops/abbott-runtime-manifest.sha256`
- Modify: `dashboard-next/reportingdash-canonical-bootstrap/MIGRATION-MANIFEST.md`
- Synchronize: `dashboard-next/reportingdash-canonical-bootstrap/runtime/agents/abbott_page_classifier/`
- Modify: `tests/test_abbott_runtime_closure.py`

**Interfaces:**
- Consumes: reviewed implementation from Tasks 1-8.
- Produces: byte-attested deployable runtime and unambiguous future-agent procedure.

- [ ] **Step 1: Add failing runtime-closure assertions**

Assert root/runtime copies of changed classifier files are byte-identical,
migration `050` is listed exactly once, and operator docs state:

```text
Observed page identity fixes use a DB-native successor release and never trigger a Metrika backfill.
```

- [ ] **Step 2: Synchronize reviewed files and regenerate manifests**

Use `install -m 644` for file copies, then regenerate sorted SHA-256 manifests
with the repository's existing manifest command. Do not copy `.env`, tokens,
workbooks, Sheets credentials, caches, or generated batch files.

- [ ] **Step 3: Run the complete local gate**

Run:

```bash
python3 -m unittest discover -s tests/abbott_page_classifier -p 'test_*.py'
python3 -m unittest discover -s tests -p 'test_abbott_*.py'
python3 -m unittest tests.test_canonical_release_store tests.test_abbott_release_retention
cd dashboard-next
npm run ci:verify
```

Expected: all Python tests and `ci:verify` pass with zero failures.

- [ ] **Step 4: Commit**

```bash
git -C dashboard-next add reportingdash-canonical-bootstrap
git -C dashboard-next commit -m "chore(abbott): attest URL identity runtime"
git add dashboard-next agents/abbott_page_classifier/PROCESS.md \
  agents/abbott_page_classifier/README.md docs/ABBOTT-OPERATIONS-RUNBOOK.md \
  AGENTS.md ops/abbott-runtime-manifest.sha256 tests/test_abbott_runtime_closure.py
git commit -m "docs(abbott): close URL identity operations"
```

---

### Task 10: Stage the successor batch and production rollout

**Files and production artifacts:**
- Deploy: reviewed root runtime under `/root/reportingdash-abbott-canonical`
- Checkpoint: `/root/reportingdash-private/abbott/url-identity/$(date -u +%Y%m%dT%H%M%SZ)/`
- Apply: migration `050_abbott_content_url_identity.sql`
- Produce: new Google Sheet approval projection and immutable batch receipt
- Produce: candidate release comparison and validation evidence
- Deploy: reviewed dashboard standalone release after candidate activation

**Interfaces:**
- Consumes: committed and reviewed implementation, current active release `24`, human-approved successor batch.
- Produces: activated successor release, URL-first dashboard, rollback artifacts, and aggregate-only completion evidence.

- [ ] **Step 1: Capture read-only production baseline**

Record mode-`0600` evidence for active/previous pointers, release `24` counts,
June/July/August totals, lookup ambiguity, batch `6` counts, health, disk, cron,
and deployed runtime/application revisions. Do not print secrets or row-level
identifiers.

- [ ] **Step 2: Deploy migration and runtime with rollback copies**

Install exact committed files into a timestamped staging directory, verify
SHA-256, back up replaced files, apply migration `050`, run schema probes, and
activate no release yet.

- [ ] **Step 3: Generate and publish the successor approval batch**

Run the weekly workflow against the immutable Registry 1/2 captures and
observed canonical page facts. Verify batch `6` is unchanged and the new batch
has exact ready/conflict/unresolved/rejected/no-change reconciliation. Publish
the Google Sheet link without sending PII.

- [ ] **Step 4: Pause for human approval**

Do not ingest, materialize, validate, or activate until the manager accepts the
new Sheet batch. Record the accepted decision hash after approval.

- [ ] **Step 5: Ingest and materialize the DB-native candidate**

Ingest idempotently, create the candidate from active release `24`, clone facts
inside MySQL, rebuild catalog/projection with URL aliases, and verify no source
API request log or Logs API job was created.

- [ ] **Step 6: Validate and activate**

Require exact June/July/August metric equality, zero bad coverage rows, zero
accepted strong-identity collisions, and complete observed URL classification.
Activate through the existing CAS release operator only after all gates pass.

- [ ] **Step 7: Deploy dashboard and smoke test**

Build and install the reviewed standalone release atomically. Verify health,
Abbott authentication, July and August page totals, direction/type filters,
charts, XLSX export, public Abbott asset `404`, and no client-side exception.

- [ ] **Step 8: Roll back on failure**

On candidate or smoke failure, restore the active pointer to release `24` and
the previous application release. Never restore public PII and never launch a
Metrika backfill.

- [ ] **Step 9: Record aggregate completion evidence**

Store mode-`0600` production receipts and commit only sanitized counts,
revisions, hashes, and gate results. Confirm Zaruku runtime, gitlink, and health
are unchanged.
