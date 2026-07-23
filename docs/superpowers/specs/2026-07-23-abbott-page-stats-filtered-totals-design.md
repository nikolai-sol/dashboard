# Abbott Page Statistics Filtered Totals Design

## Goal

Add a first data row labelled `Итого` to the Abbott “Статистика страниц” table. The row displays the sum of `Просмотры` and the sum of page-level `Посетители` for the complete set of rows that remains after the current table filters and search are applied.

## Behaviour

- The total is calculated from `pageStatRows`, after text search, page search, direction, material type, and access filters.
- The total covers all filtered rows, not only the current pagination page.
- Changing any filter or search term recalculates the total.
- Moving between pagination pages does not change the total.
- The summary appears as the first body row and is visually distinct with bold text and a light lime background.
- The first cell contains `Итого`; intermediate descriptive cells are empty.
- Only `Просмотры` and `Посетители` are totalled. Optional Bitrix columns remain empty because they were not requested.
- When no rows match the filters, the table keeps its existing empty state and does not render a zero summary row.

## Architecture

Add a pure `summarizeAbbottPageStats` helper beside the existing Abbott page-stat filtering and export helpers. Extend the local `DataTable` component with an optional `summaryRow` prop so the summary is rendered separately from paginated rows. The Abbott page-stat tab passes a formatted summary based on the complete filtered row collection.

## Data semantics

`Посетители` is a sum of page-level visitor counts across displayed page rows. It is not a deduplicated site-wide visitor count, because one visitor can appear on several pages. This matches the requested “sum of rows” behaviour.

## Verification

- Unit test the pure summary helper with multiple rows and an empty input.
- Add a UI contract test confirming that the page-stat table summary uses filtered `pageStatRows`, is passed through `summaryRow`, and is rendered before ordinary rows.
- Run the focused tests, full test suite, lint, typecheck, and production build.

