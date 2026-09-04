# Abbott returning-filter UX preview

## Goal

Build an isolated, local-only preview that makes tab 5 filters truthful and
understandable without changing production, canonical data, collectors,
database releases, or dashboard deployment.

The preview must also provide evidence for a later visual audit of every Abbott
filter. Production changes require separate user approval after the preview is
shown.

## Current problem

Tab 5 combines two independent analytics layers:

- period-local visit frequency from private visit facts;
- Reports API return intervals grouped by URL and direction.

The generic tab filters `URL` and `Направление` are rendered above both layers,
but they apply only to the Reports API control layer. The period-local cards and
chart remain global. For an incompatible pair, such as the home page plus
`Неврология и психиатрия`, the empty-state message appears only in the final
table, far below the filters.

## Preview design

### Period-wide frequency block

Keep the frequency chart and KPI cards mathematically unchanged. Add a visible
heading `Общая частота визитов за выбранный период` and supporting text:
`Показатели рассчитаны по всему сайту и не зависят от фильтров контрольного слоя ниже.`

The existing frequency-group, user-direction, page-direction, and return-page
filters remain inside this block because they filter its supporting tables.
They do not recalculate the global cards. Their placement and copy must make
that distinction visible.

### Reports API control block

Remove `URL` and `Направление` from the generic tab-filter area. Render them
inside the existing `Интервалы возврата по Метрике` section, immediately before
its three charts.

When the selected URL/direction combination has no rows, show this message
directly below the two filters:

`Для выбранного сочетания URL и направления данных нет.`

The existing empty table remains as a secondary safeguard.

### Mini data slice

Use a deterministic local fixture with three control rows:

1. the Abbott home page mapped to `Не относится / служебная`;
2. one neurology page mapped to `Неврология и психиатрия [262339]`;
3. one gastroenterology page mapped to `Гастроэнтерология [262340]`.

The fixture must demonstrate both a matching combination and the intentionally
empty home-page-plus-neurology combination. Frequency cards use a small fixed
period-wide distribution and remain unchanged between those two selections.

## Data and privacy boundaries

- No source API calls.
- No database reads or writes are required for the preview.
- No collector, cron, release, token, or deployment changes.
- The fixture contains aggregate synthetic values and no raw user identifiers.
- Existing canonical read models and production calculations remain unchanged.

## Verification

The preview is acceptable when:

1. component-contract tests prove the generic tab-filter area no longer owns
   the returning URL/direction controls;
2. a focused UI-model test proves an incompatible URL/direction pair produces
   the nearby empty-state message;
3. existing Abbott UI and return-frequency tests pass;
4. a local browser screenshot shows the mini slice at desktop width;
5. `git diff` confirms changes are limited to the isolated preview branch.

## Abbott filter audit after the preview

After the preview is rendered, inspect the production Abbott dashboard across
all available tabs and representative date periods. For every filter, record:

- the section and metric it actually controls;
- whether a visible result changes;
- whether its options contain unexplained or unknown values;
- whether it duplicates another filter;
- whether empty combinations have a nearby explanation;
- whether the label accurately describes the data grain.

This audit is diagnostic only. It produces a concise findings table and does
not authorize additional dashboard changes.

## Out of scope

- Recalculating period-wide unique-visitor frequency by URL or direction.
- Changing visit-level aggregation or adding a cross-dimensional read model.
- Modifying production data, releases, or deployments.
- Fixing unrelated Abbott tabs during the audit.
