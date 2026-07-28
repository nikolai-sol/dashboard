# RD-06 / RD-07 / RD-08 Operational Verification

Date: 2026-07-28

## CI verification

`eslint.config.mjs` now ignores `.worktrees/**`. A single uninterrupted `npm run ci:verify` completed lint, TypeScript, and the production build successfully. ESLint reported zero errors and four existing warnings.

## RD-06 read-only counts

For W30 (`2026-07-20..2026-07-26`, partial source cutoffs):

- 4,528 unified query keys;
- 3,259 with a same-row GSC page;
- 1,269 Webmaster-only;
- 695 / 3,958 Webmaster impressions in the confirmed cohort = 17.5594%.

An authoritative distinct-URL count for all Webmaster-only queries cannot be calculated from separate query and page tables. The source-provided representative proxy covers 491 normalized URLs and must not be presented as a confirmed landing count.

## RD-07 POST gate and result

Preconditions were checked before the POST: `PRO_SERP` active, 100 free units remaining, selected date available, and the selected URL had the highest W30 impressions among representative candidates with a Webmaster-only query.

Task `26224340-8a5c-11f1-b8b7-21c9fbaae2a2` used exactly one free unit and no paid quota. It completed in 214 seconds. The downloaded gzip CSV was 5,737 bytes (`sha256 c4a76e1e5768e44c9bee43575690674844a336811059e3833d33e048ab6e272f`) and contained:

- 152 data rows;
- all 152 with `query`, `path`, and `clicks` fields in the same row;
- 13 positive-click rows, 13 clicks total, and 191 impressions;
- 152 normalized query strings; the selected representative query matched the canonical normalized W30 key.

The gate passed. No collector, DB schema, canonical write path, rotation, cron, deployment, or secret change was introduced for RD-07.

## RD-08 repair and verification

The installed 06:18 cron had two defects: removed `--counter-id` and missing `--run-type cron`. The line was changed to `--account-id 66624469 --run-type cron`; the prior crontab is backed up at `/root/crontab.backup-rd08-20260728T080419Z`.

The exact cron path then created run `1694` as `cron/success`, wrote 484 rows for `2026-07-24..2026-07-27`, and the live dashboard API returned `freshness_status = healthy` for `yandex_metrika_returning`.
