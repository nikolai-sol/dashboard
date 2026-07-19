# Zaruku Russia Demand Map Design

## Goal

Replace the hand-drawn Russia outline and percentage-based city placement in the Zaruku Geo tab with a geographically correct, readable demand map for visits to `/map/`.

## Scope

- Keep the panel title `Карта спроса по России` and the existing Metrika data source.
- Continue showing only visits whose start URL belongs to `zaruku.ru/map/`; this is not all website traffic.
- Render Russia from a local GeoJSON asset so the dashboard does not depend on a tile server, API key, or third-party runtime request.
- Project city longitude and latitude through the same geographic projection as the country geometry.
- Keep persistent labels for the five cities with the most visits. Show the remaining city details on hover and keyboard focus.
- Keep the ranked city list beside the map for exact values and scanability.
- Do not change the Metrika collector or API request count in this pass.

## Architecture

Use `@visx/geo` with a local simplified Russia GeoJSON feature. A focused city-coordinate module maps normalized Metrika city names to longitude/latitude and exposes only cities that can be placed safely. The map component derives bubble size from visits, renders every resolved city as an accessible marker, and uses a compact tooltip instead of placing every label directly on the map.

Unknown or non-Russian city names are excluded from the map surface but may remain visible in the ranked list only when they are part of the Russia-filtered dataset. No fallback grid placement is allowed.

## Layout and Interaction

- Use an Albers-style conic projection fitted to the Russia geometry.
- Use a responsive SVG with a stable `viewBox` so the map remains readable from laptop to wide desktop.
- Render country fill and border with restrained neutral colors; bubbles use the existing teal source color.
- Scale bubble area with the square root of visits and cap the radius to prevent Moscow from hiding nearby cities.
- Offset the permanent top-five labels and connect them to markers with leader lines where needed.
- On pointer hover or keyboard focus, show city, visits, and share in a tooltip.
- The right-hand ranking remains the authoritative exact list.

## Data Flow

`data.map_city_demand` remains the input. The component normalizes `row.label`, resolves it against the local coordinate catalog, sorts by visits, projects coordinates, and calculates bubble radii. The percentage uses the existing `row.share`, which is the share of visits to `/map/` represented by that city.

## Empty and Partial States

- No input rows: show the existing selected-period empty state.
- Rows exist but none resolve to Russian coordinates: explain that the received city names cannot be placed on the Russia map.
- Some rows cannot be resolved: render the resolved rows and show a concise count of unplaced cities.

## Testing and Verification

- Unit-test city-name normalization, coordinate resolution, top-five label selection, and the absence of fallback grid placement.
- UI source test verifies use of the geographic map module, local GeoJSON, accessible markers, tooltip copy, and `/map/` clarification.
- Run the full test suite, typecheck, build, and browser QA at the production dashboard width.
- Verify that city markers are spatially separated and that only five permanent labels are present.

## Non-goals

- Interactive tile maps, street layers, zoom controls, and external geocoding.
- Changes to the Metrika request dimensions or collector schedule.
- A map of all website geo traffic.
