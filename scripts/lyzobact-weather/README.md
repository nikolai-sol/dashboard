# Lysobact morning weather

Prepared integration; installation is separate. Existing epidemiology/Wordstat snapshots, ad campaigns and other collectors are untouched. Dashboard requests read only `canonical_fact_lyzobact_weather_daily` in canonical MySQL. Failure or absent weather schema leaves epidemiology available.

The catalogue is `src/lib/lyzobact-weather-centres.json`: 85 region associations, 84 unique city points. Coordinates and IANA zones: [GeoNames](https://www.geonames.org/), CC BY 4.0, cities15000/cities5000 publisher extracts obtained 2026-10-12. Per-row source URLs and mapping notes are retained. Moscow Oblast explicitly uses Moscow; Leningrad Oblast uses Gatchina. City weather is not a regional territorial average. Detailed source receipts: `outputs/lyzobact-openweather-20261012/catalogue` in the ReportingDash workspace.

## Observation contract

- Hourly UTC oneshot filters centres at local 09:00, completion allowed before 09:15. No historical backfill from Current Weather.
- OpenWeather `/data/2.5/weather`, coordinates and `units=metric`; provider `dt` must be on the same local day, no older than 3 hours, no more than 5 minutes in the future. Preserve raw temperature as MySQL DOUBLE; compare strictly `<12` before display formatting.
- Seven consecutive calendar dates with valid morning samples activate the weather signal. A value `>=12` breaks the streak. Missing/invalid data breaks the proof and stays unknown. This is seven morning readings, not continuous cold or a daily average. Campaign status is never derived from weather.
- Before 09:15 the latest due date is yesterday, unless today's valid observation already exists. After 09:15 an absent current morning is missing, never yesterday's temperature relabelled as today.
- A successful centre/date is immutable on reruns. Failed rows contain no temperature and may be repaired only inside the same morning window. Requests are deduplicated by centre ID and spaced at least 1.1 seconds apart. HTTP401/403/429 stops the run immediately with exit2, without automatic retry. Other failures exit1; systemd allows at most three starts in 15 minutes, 60 seconds apart, still subject to the morning deadline.

## Production inputs (not installed by preparation)

1. Validate a user-provided key with one diagnostic Current Weather request. A diagnostic outside the morning window is never a fact. Never print URLs containing `appid`, exception bodies or the key.
2. With coordinator production gate, apply only `src/db/migrations/068_lyzobact_weather_daily.sql`. Preserve existing data/config/runtime boundary receipts before/after.
3. Create isolated `reportingdash-openweather` service account and `/opt/reportingdash/collectors/openweather/venv` using existing server Python3.8. Runtime dependencies: existing approved `mysql-connector-python` and `pytz` versions from collector runtimes; use pinned installed versions, do not modify their venvs. Python3.9+ uses standard zoneinfo.
4. Install `/etc/reportingdash/collectors/openweather.env` root:root 0600 (parent directory root-controlled). Keys: `OPENWEATHER_API_KEY`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME=report_bd`. Use a dedicated DB principal: SELECT/INSERT/UPDATE only on the new weather table. Dashboard reader needs SELECT only on that table through existing canonical access. Do not put the key into app env, frontend, Git, logs or build artifacts. Remove task-local key input only after confirmed secure installation.
5. Use existing immutable collector release convention: `/opt/reportingdash/collectors/openweather/releases/<40-char source commit>/` with flat closure `collector.py`, `centres.json` (copied from catalogue), `collector_release_launcher.py`. `release.json` exactly `{version:1,source:"openweather",revision:<commit>,entrypoint:"collector.py",closure:[...]}`. `runtime-manifest.sha256` hashes sorted closure plus release.json. Existing generic launcher is copied unchanged from verified Hybrid collector release, and verifies closure/hash before exec. Keep files root-owned, non-writable by service account. Set `current` atomically after verification.
6. Install included service/timer definitions, validate them, then enable timer only after key works and production approval. Timer is nonpersistent: missed historical mornings remain missing. Dedicated runtime directory/flock prevents overlap. A manual run outside the window is a no-source-call/no-fact check; do not use clock overrides in production.
7. Run the normal guarded Media app deployment with `ARTIFACT_BOOT_TIMEOUT_MS=60000`, preserving held source guards. Verify public allowlist/admin401, old audits plus dated weather, all85 regions, five-column table, widened map, neighbour isolation, canonical snapshot/config parity. Weather starts insufficient until seven actual mornings exist.

Rollback: disable/stop only this timer/service and restore the predecessor Media app through normal release policy. Preserve the weather table and recorded facts; no destructive rollback migration.

## Offline checks

`python3 -m unittest discover -s scripts/lyzobact-weather -p 'test_*.py'`

`node --import tsx --test src/lib/lyzobact-weather.test.ts src/lib/lyzobact-regions-store.test.ts src/lib/lyzobact-regions-http.test.ts src/components/lyzobact/RegionalDashboard.test.tsx`

Tests use synthetic measurements, never installed as canonical facts. A full production build, live schema/application check and live timer verification remain release gates.
