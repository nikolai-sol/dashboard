# Abbott UTM and Return-Frequency Design

## Goal

Improve the Abbott manager dashboard without changing Zaruku or other dashboard
types:

1. Add a visit-level `UTM Source` filter to tab 2, “Действия пользователя на
   сайте ABBOTT”.
2. Hide tab 4, “Внешние переходы”, while preserving its data and code for a
   reversible rollback.
3. Make visit frequency the primary view on tab 5, “Вернувшиеся”, and explain
   which user directions and return landing pages drive repeat visits.

All dashboard reads remain DB-native and canonical-first. Source APIs remain
collector-only.

## Scope and isolation

- Work uses coordinated branches named `codex/abbott-utm-return-frequency` in
  both repositories: the `dashboard-next` application repository and the
  ReportingDash operational superproject. Each repository gets a dedicated
  worktree. The application worktree is created from its current
  `origin/main`; the operational worktree is created from its local `main`
  because that repository has no configured remote.
- The operational branch owns the source collector, Logs client, canonical
  writer, operational schema/grants, Python tests, and the final
  `dashboard-next` gitlink. The application branch owns the dashboard read
  model, UI, application migration, packaged runtime copies, TypeScript tests,
  and this specification.
- The implementation may change Abbott collector, canonical-writer, schema,
  loader, type, component, test, and Abbott operations documentation files.
- Zaruku components, read models, migrations, collectors, and presentation are
  out of scope and must remain byte-for-byte unchanged relative to the branch
  baseline.
- Production deployment, production migration execution, backfill execution,
  cron edits, source API calls, Telegram sends, and Hermes schedules are not
  part of this implementation phase.

## Current-state findings

- One Abbott Metrika visit is stored in
  `report_bd_private.canonical_fact_metrika_visits`.
- The row already contains the hashed Metrika client ID, raw manager-only User
  ID values, traffic source, entry and exit URL, visit time, pageviews,
  duration, and bounce state.
- The current Logs API request does not request a UTM field, and the private
  visit table does not store one.
- Yandex Metrika Logs API supports the visit field
  `ym:s:<attribution>UTMSource`. Abbott uses `lastsign` attribution, so the
  collector will request `ym:s:lastsignUTMSource`.
- The current returning-page facts are Reports API percentages in the
  `next_day`, `days_2_7`, and `days_8_31` recency buckets. They cannot answer
  how many distinct visitors made one, two-to-three, or four-or-more visits in
  an arbitrary selected period.

## Data design

### Visit-level UTM Source

Add nullable `utm_source VARCHAR(500)` to
`report_bd_private.canonical_fact_metrika_visits`. Blank source values are
normalized to `NULL`. Add a read index beginning with
`canonical_release_id, report_date` and including an indexed prefix of
`utm_source` so period-filtered manager reads remain bounded.

Update the Logs API visit field contract and parser to accept
`ym:s:lastsignUTMSource`. The parsed value flows through the Abbott release
row, atomic canonical writer, packaged bootstrap copies, and manager read
model. The UTM value belongs to the same visit as the User ID, URLs, and visit
metrics; no aggregate Reports API row is joined to a user.

The schema migration is repeat-safe and additive. It does not update active
release rows in place.

### Visitor identity for frequency analysis

The selected-period frequency denominator is the set of distinct non-null
`client_id_hash` values in the active release and selected counter/date range.
This matches a Metrika browser visitor as closely as the stored visit facts
allow, without storing or returning raw Client ID.

Frequency groups are mutually exclusive:

- `one`: exactly 1 visit;
- `two_to_three`: 2 or 3 visits;
- `four_plus`: 4 or more visits.

Visits with no usable client hash are excluded from the visitor denominator.
Their visit count is returned only as an aggregate data-quality metric named
`unidentified_visits`; it is never silently folded into a frequency group.

Frequency is period-local. A visitor with one June visit and earlier visits
outside June is in the `one` group when June is selected. The UI explains this
explicitly.

### User direction resolution

For each hashed visitor, collect the distinct non-empty directions obtained
from the raw User IDs present on that visitor’s selected-period visits and the
active Abbott manager-only user-direction snapshot.

- Exactly one distinct known direction: use it.
- No known direction: `Направление не определено`.
- More than one distinct known direction: `Несколько направлений`.

The browser-level aggregate never exposes the client hash. Raw User IDs remain
available only in existing manager-only surfaces and are not added to tab 5.

### Return visit and return landing page

Within each visitor’s selected-period visits, order visits by
`session_started_at`, then by `visit_id_hash` as a deterministic tie-breaker.
The first visit is the period’s initial visit. Every later visit is a repeat
visit.

The return landing page is the normalized `start_url` of a repeat visit.
Direction is enriched using the active canonical Abbott content lookup. A URL
without a unique mapping is labeled `Направление не определено`; the loader
does not guess from arbitrary URL substrings.

The return-page output contains aggregate rows only:

- normalized return landing URL;
- page direction;
- frequency group of the visitor;
- distinct returning visitors;
- repeat visits.

Visitor counts across different pages are non-additive and are labeled as
such. The current visit facts do not contain the complete page sequence inside
a visit, so this feature describes return landing pages, not every page read
after returning.

## Read-model contract

Extend `AbbottBiUserActionRow` with nullable `utm_source`.

Add a dedicated returning-frequency model with:

- `available`: whether the manager-only visit source was queried successfully;
- `period_local`: always `true` for this model;
- `identified_visitors`;
- `unidentified_visits`;
- `groups`: three rows containing group code, Russian label, visitors, share,
  and visits;
- `user_directions`: direction, frequency group, visitors, and repeat visits;
- `return_pages`: URL, page direction, frequency group, returning visitors,
  and repeat visits.

Only the manager audience queries the private visit table. The embed audience
performs zero private-schema queries and receives `available: false` with empty
aggregate arrays. No dashboard request calls Metrika or reads an OAuth token.

All manager visit processing is pinned to the one active Abbott canonical
release already selected by the release bundle.

## UI design

### Tab 2: user actions

Add a fifth select filter labeled `UTM Source` after `Источник` and before
`Направление`. Options are built from the visit rows and include:

- `Все`;
- each exact non-empty UTM Source value;
- `Без UTM` when at least one visit has no UTM Source.

Add a `UTM Source` table column so managers can verify why a row matches the
filter. Search also matches UTM Source. Filtering occurs before pagination and
before chart aggregation.

### Hidden external-transitions tab

Remove `external_events` from the array returned by `buildTabs`. Preserve the
tab ID, data fields, loader query, table branch, chart branch, and theme. This
is a presentation-only hide and can be reverted without restoring deleted
logic.

### Tab 5: returning visitors

When manager visit-frequency data is available, place these sections in order:

1. Three KPI cards for `1 визит`, `2–3 визита`, and `4+ визита`, each showing
   visitor count and percentage of identified visitors.
2. One count-first chart of visitors by frequency group. Percent remains in
   tooltip/card supporting text rather than replacing the count.
3. Filters for frequency group, user direction, page direction, and return
   landing URL.
4. “Направления вернувшихся пользователей” table with visitors and repeat
   visits.
5. “Страницы возврата” table with URL, page direction, returning visitors, and
   repeat visits.
6. A compact data-quality note with `unidentified_visits` when non-zero.
7. The existing Reports API recency view, retitled “Интервалы возврата по
   Метрике”, retained below the new sections as a comparison/control view.

For embed or an unavailable private source, show the existing recency view and
an explicit message that visit-frequency details are unavailable in that
access mode. Do not show zero-filled frequency cards.

## Publication and historical data

Changing the Logs field list changes the request fingerprint and parser
contract. Historical UTM and frequency data must be collected into a reviewed
successor canonical release. Active releases remain append-only; existing
visit rows are never silently updated.

The successor release must pass the existing Abbott coverage and session
integrity gates. UTM completeness is observational rather than mandatory:
visits legitimately may have no UTM Source. The validation report will include
identified visitor count, unidentified visit count, visits with UTM, visits
without UTM, and the three frequency-group counts.

## Error handling

- A malformed Logs UTM value or visit row fails the affected Abbott
  `user_behavior` scope before publication.
- Missing or failed required coverage keeps the release fail-closed, following
  the existing Abbott loader contract.
- A valid blank UTM Source is stored as `NULL` and rendered as `Без UTM`.
- Missing user or page direction is labeled explicitly; it is not discarded.
- No error response or log contains raw User ID, visit ID, Client ID, URL query
  parameters, cookies, OAuth tokens, or SQL parameters.

## Verification

Implementation follows red-green-refactor cycles and adds tests for:

- Logs TSV field order, UTM parsing, blank UTM normalization, and lifecycle
  cleanup;
- release-row and atomic-writer propagation of `utm_source`;
- repeat-safe private schema migration and grants;
- manager query release/counter/date scoping;
- embed zero-private-query behavior;
- exact frequency boundaries `1`, `2–3`, and `4+`;
- period-local grouping and unidentified-visit reporting;
- deterministic visitor direction resolution;
- second-and-later visit ordering and return landing-page aggregation;
- UTM filtering before pagination and chart aggregation;
- external tab hidden while its implementation remains present;
- count-first returning UI and retained recency control block;
- private-data projection and no-cache contracts;
- full unit suite, lint, typecheck, production build, public-asset scan, and an
  Abbott-only diff guard that rejects Zaruku changes.

## Rollback

Before production rollout, retain the current application release and active
canonical release IDs. Application rollback points to the previous app
release. Data rollback points the Abbott active-release selector back to the
previous canonical release. No rollback restores private files to `public/` or
deletes successor-release evidence.
