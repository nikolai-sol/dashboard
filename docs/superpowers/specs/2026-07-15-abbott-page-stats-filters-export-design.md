# ABBOTT Page Statistics Filters And Export

## Goal

Improve the third ABBOTT dashboard tab so users can select several material types, search page titles and URLs, and export the full filtered table to Excel without changing the existing data model or Bitrix join.

## Constraints

- Keep the existing `AbbottBiData.page_stats` payload and the `page_title + URL` page identity.
- Keep filtering client-side, because the full grouped page-stat rows are already loaded by the dashboard.
- Do not change SQL, database schema, Bitrix normalization, or the meaning of existing metrics.
- Preserve `All` behavior when no material types are selected.

## Design

The page-stat material filter will use a local array of selected values. Filtering will use OR semantics: a row remains visible when its material type is one of the selected values. An empty array means all material types. The table and all three page-stat charts will consume the same filtered `pageStatRows` collection, so there is one source of truth.

The page-title filter will become a searchable picker that searches both the title and URL. It will show a bounded result list and select the existing page-stat identity without merging pages that share a title. The existing general search remains available for searching across all visible fields.

The page-stat tab will expose an Excel export action in its header. It will serialize all filtered rows, not only the current pagination slice, with raw numeric values and explicit metric labels. The file will be `.xlsx`, using the already-installed `xlsx` dependency, and will include the selected date range in its filename.

## Verification

- Add focused pure-helper tests for multi-value material matching and export-row mapping.
- Run the focused tests, then `npm run lint`, `npm run typecheck`, and `npm run build` in `dashboard-next`.
- Check that unrelated files remain untouched and that no database or API migration is required.
