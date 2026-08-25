# Abbott User ID Aggregate Filter Design

## Goal

Make the Abbott portal user filter internally comparable and add an aggregate
selection for every visit that contains at least one User ID.

## Filter order and meaning

The user selector starts with these aggregate options in this exact order:

1. `ВСЕ` — every visit from the canonical Metrika Logs API visit dataset,
   including administrator visits.
2. `ВСЕ с User ID` — every visit from the same dataset whose visit-level
   `raw_user_ids` collection is non-empty, including administrator visits.
3. `ВСЕ без админов` — every visit from the same dataset except visits whose
   `raw_user_ids` collection contains at least one configured administrator
   User ID.

Concrete User IDs follow the three aggregate options in the existing sorted
order.

## Data and selection behavior

All three aggregate options use the manager-only canonical visit read model
derived from `report_bd_private.canonical_fact_metrika_visits`. Selecting one
aggregate option must not switch to the Reports API traffic summary.

The existing protected Abbott administrator exclusion list remains the only
authority for administrator identity. `ВСЕ с User ID` deliberately includes
administrators; administrator removal happens only for `ВСЕ без админов`.

The existing traffic-presence selector (`Трафик с User ID` / `Трафик без User
ID`) remains separate. It continues to filter the currently selected visit
population and does not redefine the three aggregate user options.

## UI implementation

Add a dedicated internal sentinel for `ВСЕ с User ID`, next to the existing
`ВСЕ без админов` sentinel. Aggregate sentinels must never collide with a real
numeric User ID or appear as a raw identifier in rendered tables or exports.

When the user selector contains the new sentinel, the summary-row selector
uses the full visit summary and keeps only rows where `has_user_id` is true.
The user-action table applies the same visit-level predicate. Search,
pagination, traffic-source, UTM, and direction filters continue to run after
the aggregate population is selected.

## Tests and acceptance criteria

Automated tests must prove:

- aggregate options render in the approved order;
- `ВСЕ` uses Logs visit rows rather than the Reports traffic aggregate;
- `ВСЕ с User ID` includes all and only rows with `has_user_id=true`;
- administrator rows remain present in `ВСЕ с User ID`;
- `ВСЕ без админов` excludes administrator visits;
- concrete User ID selection retains its existing behavior;
- internal sentinels are not rendered as user identifiers.

For the production period `2026-08-01..2026-08-24`, the first two known smoke
values are `ВСЕ = 7,974` visits and `ВСЕ без админов = 7,927` visits. The
`ВСЕ с User ID` value must equal the count of canonical Logs visits with a
non-empty User ID collection for the same period; it must not be sourced from
the Reports API aggregate.

## Scope and operations

This change is limited to the Abbott manager dashboard read-model selection,
filter UI, and their tests. It does not change collectors, canonical facts,
administrator settings, database schema, OAuth tokens, cron, or release
activation. Deployment is a separate explicit operation after implementation
and verification.
