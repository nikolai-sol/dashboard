# Lysobact regional module

Approved direction: isolated regional page within the existing app; no new server, login service or scheduler. Build candidate only, with no production migration/import/deploy.

Route `/dashboard/[id]/regions` and GET `/api/dashboard/[id]/regions` use existing dashboard authorization. The API resolves access before dedicated module queries and requires explicit `config.lyzobact_regions.enabled === true` with client key `lyzobact` or `lisobact`. Navigation is opt-in; shared metrics loader and exports remain unchanged.

Data is read exclusively from dedicated additive `lyzobact_regions_*` MySQL tables. Importers may read reviewed offline JSON derived from the verified 85-region workbook and 230 source observations; runtime may not. Missing data is null, never zero. Snapshot IDs are immutable, imports transactional, checksums/provenance retained. No source call or ad activation.

Russian interface: blue/orange header, snapshot selector, two independent map modes (reported weekly change / campaign status), region search/list and detail panel. Details identify period, source, publication/check date, scope, official vs secondary/historical quality. Weather and Wordstat explicitly unavailable unless actual observations imported. A map color is not an advertising decision. Campaign status defaults unknown. Counts are report observations, not a synchronized disease survey. Historical observations cannot imply current growth. Regional polygon geometry must map exactly the agreed 85 IDs, excluding four 2022 additions; provenance and license recorded. The existing Zaruku city bubble map is not a substitute.

Out of scope: automated collection, ad control, live sources, global authentication or report-schema changes, shared metrics/exports, production operations. Existing reports must have no changed calculation or navigation when feature disabled.

Access refinement: public dashboard contexts and embed audiences are rejected; explicit opt-in is checked before facts. Data contract also retains nullable casesPrior.
