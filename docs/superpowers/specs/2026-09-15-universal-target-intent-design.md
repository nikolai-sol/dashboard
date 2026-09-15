# Universal target-intent rules for SEO dashboards

## Purpose

Provide every site SEO dashboard with a site-scoped, administrator-managed definition of its target search intent. MedRoche uses the label «Мед. интент»; another site can configure a different label. The mechanism must support auditable weekly intent/noise reporting without embedding one site's vocabulary in application code.

## Terminology

- **Target intent**: a configurable category of search queries relevant to the site's SEO objective.
- **Other queries**: observed queries with impressions in the selected week that match no active target-intent rule.
- **Rule set**: an immutable, versioned collection of query matching rules belonging to one site.
- **Active version**: the one published rule-set version used by dashboard reads.
- **Preview**: a validated immutable import snapshot that has not changed the active version.

The site profile supplies the user-facing target label. The default is «Целевой интент»; MedRoche is configured as «Мед. интент». The complementary category is «Остальные запросы».

## Administrator workflow

The existing dashboard administration area gains a **Целевой интент** section for SEO-capable dashboards. It exposes:

1. the target-intent label;
2. Excel/CSV upload;
3. Google Sheets URL input;
4. **Проверить источник**;
5. preview totals, groups, duplicates, conflicts, validation errors and sample matches;
6. **Опубликовать новую версию**;
7. version history with author, timestamp, source transport, source identity/hash, comment and active status;
8. **Восстановить как новую версию** for an earlier snapshot.

Both transport methods produce the same protected snapshot and validation result. A Google Sheet is read only when an administrator explicitly starts a new preview. Subsequent edits in Google do not silently alter an active rule set.

Publication always replaces the site's complete active rule set. It never appends to or mutates an earlier version. An unsuccessful preview or publication leaves the current active version unchanged.

## Input contract

The logical input table has these columns:

| Column | Required | Contract |
|---|---:|---|
| `Ключ` | yes | Non-empty query word or phrase |
| `Группа` | no | Review label such as «Препараты» or «Онкология» |
| `Тип совпадения` | yes | `точное` or `фраза` |

Excel may contain one selected worksheet; CSV contains one table. The preview UI names the accepted worksheet and encoding/delimiter where relevant. Column names are matched after safe whitespace/case normalization, but unknown columns are rejected rather than silently interpreted.

CSV accepts UTF-8 (including BOM), detects comma, semicolon, tab or pipe with the same parser that reads the table, and records the actual encoding/delimiter in the immutable preview. Preview validates MySQL character limits: source and normalized keys are at most 512 Unicode characters; group labels are at most 255. Overflows produce row/column errors.

Rule normalization applies Unicode NFKC, lowercase, `ё → е`, punctuation/hyphen separation and repeated-whitespace collapse.

The shared contract implements normalization for imports, runtime integrity and matching. Every run of non-letter/non-number characters becomes a token boundary, including zero-width format characters and combining marks that remain after NFKC. New previews use contract identity `target-intent-preview-v2`; older immutable evidence is retained, and noncanonical historical preview rows cannot publish.

- `точное`: the normalized observed query equals the normalized key.
- `фраза`: the normalized key occurs as a complete token sequence inside the observed query.

The engine performs no hidden synonym generation, fuzzy matching or language-dependent stemming. Synonyms and inflected variants are explicit rows, making every match reproducible. Empty keys, unknown match types, normalized duplicates and contradictory rules block publication. Exact duplicate source rows are reported rather than silently removed.

The first MedRoche canonical version contains the current 802 expert queries plus the already reviewed explicit extensions and aliases. The legacy application-local classifier is removed from runtime once parity is proven.

## Canonical model

Add site-scoped canonical MySQL entities:

- immutable import/preview metadata;
- immutable rule-set versions;
- immutable rule rows with normalized key, group and match type;
- one active-version pointer per site;
- publication receipts linking an active transition to administrator identity and preview/source evidence.

Every unique key and foreign key includes the site identity where required. A version cannot mix rules from different sites. Activating or restoring a version happens in one database transaction under a site-scoped publication lock.

Source evidence records:

- upload or Google Sheet transport;
- original filename or normalized Sheets identity;
- protected artifact/snapshot reference;
- content SHA-256;
- importing administrator;
- creation and publication timestamps;
- optional administrator comment.

Restoring history does not move the pointer backwards to a mutable object. It creates and publishes a new immutable version copied from the chosen historical snapshot, preserving the complete audit chain.

## System boundaries and data flow

External files and Google Sheets are collector/import inputs only:

1. the authenticated admin UI submits a protected upload or reviewed Google Sheets URL;
2. the import layer obtains and stores a bounded immutable snapshot;
3. the parser validates the input contract and creates a preview;
4. the administrator reviews the preview and explicitly publishes it;
5. publication writes the immutable version and atomically switches the site-scoped active pointer;
6. SEO dashboard requests read the active canonical rules from MySQL;
7. the existing exact-week canonical GSC and Webmaster query facts are classified in the read model.

Dashboard render, filtering and export never read the uploaded file, fetch Google Sheets, use source OAuth credentials or call external source APIs.

The feature reuses the established protected upload/Google Sheet preview-confirm patterns where their contracts fit. Target-intent publication has its own site-scoped rule-set contract; it is not an advertising fact import and does not enter advertising collector SLAs.

## Dashboard experience

### Administrator preview examples

Preview distinguishes source-rule examples from observed-query matches. Each source samples at most 100 positive-impression canonical queries, ordered by impressions, clicks and query, and shows at most eight matches using the shared classifier. Samples and their actual periods are stored in the immutable validation receipt; an idempotent retry returns the original sample.

The admin form has no selected reporting period. Google examples use the latest published canonical ISO-week query import for the server-resolved client/site/dashboard and default all-country/all-device web-search filter. Yandex examples use the exact server-registered account/host and seven days ending at its latest canonical query fact date. Source periods are independent and explicitly rendered. These are illustrative samples, not weekly completeness checks, totals or inferred query/page relationships. A read failure is unavailable; zero sampled queries and zero matches within a nonempty sample are distinct. No source API, source credential or client-supplied site/account/period participates.

### Dashboard review

The overview goal panel retains its two metric cards:

- configurable target-intent label;
- «Остальные запросы».

Shares remain impression-weighted over observed query rows from the strictly selected ISO week. Each card shows share, impressions and clicks. Clicks are not presented as unique users. Missing, failed, different-period and confirmed-empty source semantics remain unchanged.

The previous source-status sentence is replaced by two review links:

- **<Target label> — N запросов**
- **Остальные запросы — N запросов**

`N` is the number of distinct observed query/source rows with impressions greater than zero in that category for the selected week. Activating a link reveals its table below the panel without leaving the selected dashboard period. Both tables may be opened independently.

Target-intent table columns:

- query;
- source (Google or Yandex);
- impressions;
- clicks;
- group;
- matched rule;
- match type.

Other-queries table columns:

- query;
- source;
- impressions;
- clicks;
- classification status («не найдено правило»).

Tables sort by impressions descending, then clicks descending, then query and source for deterministic output. They show only rows with impressions greater than zero. They are paginated for large weeks and support CSV/XLSX download using the same currently selected week and publication.

The dashboard tables are review surfaces, not write controls. An administrator corrects classification by preparing and publishing a complete replacement file in the admin panel. The «Остальные запросы» download is suitable as a source for that next version.

If a site has no active rule set, the goal panel reports «Классификация не настроена» and does not call every query “other” or “noise”. The admin view links directly to rule-set setup.

## Authorization and safety

- Only an authenticated dashboard administrator can create previews, publish, restore or change the target label.
- Dashboard viewers can inspect and export classifications for the site they are already authorized to view.
- Server-side scope resolution supplies dashboard/site identity. Clients cannot select another site, source account, active version or protected artifact by submitting identifiers.
- Uploads are bounded, content-addressed, stored outside public paths and parsed without macros or executable content.
- Google Sheet URLs follow the existing allow-listed URL normalization and credential boundary. Preview errors never expose tokens, protected paths or raw parser internals.
- Import idempotency is based on site, normalized source snapshot and rule contract. Repeating a publish request cannot create divergent active states.

## Failure handling

- Invalid columns, types, duplicates or conflicts produce a non-publishable preview with row-level errors.
- An unreachable or unauthorized Google Sheet produces an import failure while the active version remains unchanged.
- A transaction or publication failure rolls back the entire active transition.
- Dashboard rule reads fail closed: if active-version integrity cannot be proven, intent percentages are unavailable rather than calculated using packaged defaults or another site's rules.
- Runtime fetches metadata and the immutable validation receipt once, then ordered rules pinned to the captured site/dashboard/version on the same acquired connection. Receipt payload is never joined onto every rule. Missing linked metadata is unavailable; only an absent active pointer is not configured.
- Once preview COMMIT begins, a lost acknowledgement has unknown outcome and protected evidence is retained. A retry resolves the immutable receipt; evidence is discarded only after a definitive pre-commit failure or a confirmed unreferenced duplicate.
- A failed attempt is visible in admin history without replacing the last successful active version.

## Migration and compatibility

1. Add canonical schema and read/write contracts without activating the feature.
2. Import MedRoche's reviewed seed and explicit extensions as an initial preview.
3. Compare the canonical classifier against the existing MedRoche output for representative and observed queries.
4. Publish the initial MedRoche rule-set version and configure its target label.
5. Switch the read model from the application-local rule file to canonical active rules.
6. Remove the runtime dependency on the MedRoche-specific JSON and code paths only after parity, isolation, export and rollback gates pass.

Other dashboards retain their existing overview until an active target-intent version exists or the feature is explicitly enabled for them. No existing query facts are rewritten or recollected.

## Verification

Automated coverage must prove:

- Excel, CSV and Google Sheets produce the same canonical preview;
- exact and phrase matching follow normalization and token-boundary rules;
- invalid rows, duplicates and conflicts cannot publish;
- publishing fully replaces rather than appends;
- failed imports and failed publication preserve the current active version;
- restore creates a new immutable version;
- site A can never read, publish or restore site B's rules;
- admin authentication and server-resolved scope are mandatory;
- dashboard read paths use canonical MySQL only;
- no active version produces “not configured”, not 100% other;
- query detail links, sorting, pagination and downloads preserve the selected week and category;
- missing/partial/failed/empty query-source semantics remain truthful;
- MedRoche canonical results satisfy parity fixtures for the reviewed seed and extensions;
- unrelated dashboards and independent source-period behavior remain unchanged.

Release verification includes migration dry-run, canonical constraints, admin preview/publish/restore smoke in a non-production fixture, dashboard desktop/mobile visual checks, export checks, full SEO tests, typecheck, build and standalone health/login smoke.

## Out of scope

- Automatic polling or publication when a Google Sheet changes.
- Editing individual classification rules inside the read-only SEO dashboard.
- AI/fuzzy classification.
- Rewriting historical GSC or Webmaster facts.
- Deploying, importing production data, installing schedules or changing secrets without a separate owner-authorized release step.
