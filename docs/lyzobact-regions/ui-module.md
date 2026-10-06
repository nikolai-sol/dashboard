# Prepared regional UI

Routes: `/dashboard/[id]/regions`, `/api/dashboard/[id]/regions`. API uses existing dashboard authorization, canonical `context.id`, opt-in config and exact client key `lyzobact`/`lisobact`. Public dashboard contexts and non-manager audiences are rejected. No fixture endpoint, auth bypass, new auth service, scheduler, production import or deployment is included.

Existing media page changes only import and render the opt-in link component. It makes no request for other slugs. The current shared payload lacks canonical client ID, so numeric `/dashboard/19` does not show the new navigation link; the canonical portal slug `/dashboard/lyzobact` does. Direct numeric `/dashboard/19/regions` still undergoes all canonical authorization/identity gates. No shared loader or report exports were changed.

`RegionalDashboard` displays the source-audit snapshot, literal row periods, source-reported vs calculated changes, nullable counts and prior counts, exact provenance and 230-row source history. Report periods are not aligned by relabeling. Historical rows remain visible but do not color the growth map. Campaign status, Wordstat and weather remain unknown/null until separately verified data exists; no trigger activates advertising.

Geometry is static public cartographic metadata only. Facts are canonical-MySQL-only. The display source is geoBoundaries, attribution/license in `public/lyzobact/license.md`. Projection creates a render-only winding-normalized copy to account for d3's spherical polygon convention, including antimeridian clipping; retained source geometry is unchanged.

Offline review command (no DB connection):

```sh
node --import tsx scripts/preview-lyzobact-regions.ts OUTPUT_DIRECTORY VERIFIED_WORKBOOK_DIRECTORY
```

The script reads frozen `register-85.json` and `source-pages.csv`, normalizes through the importer, bundles the real React component with static geometry and built CSS into a **local file only**. It adds an explicit local/non-production banner. It is not imported by any app route. Browser review is separate; close owned browser in finally. No local server is needed.

Prepared candidate only. No existing Lysobact dashboard row was identified during the separate parent review; production dashboard/access setup, migration/import and deployment remain explicit operational steps, not results of this implementation.
