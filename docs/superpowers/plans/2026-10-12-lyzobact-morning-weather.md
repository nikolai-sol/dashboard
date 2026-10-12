# Lysobact morning weather implementation plan

**Goal:** Display a dated regional-centre morning temperature and whether seven consecutive morning samples are strictly below 12°C.

**Architecture:** A bounded OpenWeather Current Weather collector stores dedicated canonical daily observations; the dashboard reads MySQL and attaches a separately dated weather overlay. Existing epidemiology/Wordstat snapshots and advertising status remain immutable.

**Stack:** Existing Python HTTP/MySQL tooling with pytz on the VPS; existing TypeScript/MySQL/React dashboard; a source-specific systemd oneshot and hourly timer following the installed collector pattern.

## Accepted constraints

- 85 existing region keys map to verified city coordinates and IANA zones; shared cities may reuse one provider request.
- Nominal 09:00 local sample; collector runs only 09:00–09:15. Until 09:15 the latest completed due morning is yesterday, unless today's valid sample already exists. After 09:15 a missing today sample is unknown.
- Provider observation must be from the same local date, at most three hours old at retrieval, and not more than five minutes in the future. Unrounded finite `main.temp` is compared with `<12`; exactly 12 clears the streak.
- Successful facts are immutable per centre/local date. Repeated collection skips them. Failed attempts can retry only inside the morning window; no historical Current Weather backfill.
- Current weather is labelled separately from the selected source snapshot. Missing/stale/error is not zero or an active signal. Seven morning observations do not claim continuously cold days.
- No campaign changes. No live DDL, collector install, timer enablement, or app deployment before a valid user-provided API key and coordinator gate.
- Collector-only key location: `/etc/reportingdash/collectors/openweather.env`, key name `OPENWEATHER_API_KEY`. Never expose the key in logs, URLs in errors, or dashboard environment.

## Task 1 — Daily facts and deterministic signal

- Add `src/db/migrations/068_lyzobact_weather_daily.sql`: one centre/day fact with observation/retrieval timestamps, local date, unrounded temperature, status and sanitized error; successful facts preserved on retries.
- Add `src/lib/lyzobact-weather.ts` and tests for seven-day truth, threshold equality, local-date rollover, grace period, gaps, stale/future observations and shared centres.
- Add the independently verified `src/lib/lyzobact-weather-centres.json` catalogue and exact 85-key/coordinate/time-zone validation.
- Run focused tests red before implementation, then green.

## Task 2 — Collector and inactive scheduler definitions

- Add a Python collector under `scripts/lyzobact-weather/` using bounded HTTPS to `api.openweathermap.org/data/2.5/weather`, coordinates and `units=metric`; redact all failures and limit requests below provider free-tier rate.
- Use the dedicated table only; lazy database connection, no writes in dry-run, no migrations in collector. Keep successful rows on rerun, record failed attempts independently of successful facts.
- Add meaningful offline tests for parsing, local morning scheduling, request deduplication, idempotency and failed/stale samples.
- Prepare inactive systemd service/timer definitions with a oneshot process and lock. No installed service changes in preparation phase.

## Task 3 — Canonical reader and UI

- Extend `RegionalModuleData` with a dated weather overlay; load weather separately so unavailable weather never hides epidemiology facts.
- Explicitly allowlist public weather fields in `lyzobact-regions-http.ts`; no raw payload or credentials.
- Replace the selected card's temperature placeholder with city/date/temperature and morning streak state. Preserve current map, five-column table, Wordstat periods and campaign status.
- Verify UI render, public allowlist, existing regional tests, scoped lint and typecheck; stop before expensive release build until activation is possible.

## Release gate

Independent review, validated key, migration/app/collector ordering, read-only baseline hashes, guarded normal deployment, one valid morning sample when due, timer/health checks, exact historical fact/config/runtime preservation. No fabricated initial seven-day history; the first possible confirmed signal is after seven successful scheduled mornings.
