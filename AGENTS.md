# Repository agent guidance

## Analytics dashboard data-plane rule

External source APIs are collector-only. Dashboard request, render, filter,
export, and read-model code must read canonical MySQL and must not use source
OAuth tokens or call source APIs. Successful-empty collection is represented
by canonical coverage; failed collection is represented by collector/request
logs and never by silently reusing another period.

## Abbott visit-level operational truth

- Abbott source summaries use Reports API attribution `lastsign` and exact traffic segments `all`, `with_user_id`, and `without_user_id`. Per day/source, `all.sessions = with_user_id.sessions + without_user_id.sessions` is a hard publication gate.
- `user_behavior` uses Logs API `source=visits`. One private database row is one Metrica visit. Data is stored only in `report_bd_private.canonical_fact_metrika_visits`. Raw User ID, visit ID, start URL, and end URL are manager-only. Raw client ID is never stored; only its hash is persisted.
- The Logs lifecycle is evaluate → create → poll → download all parts → clean in finally. Prepared files count against the 10 GB quota until cleaned.
- `METRIKA_TOKEN` remains the only OAuth environment key. Never print it. The owner installs or revokes it; this change does not issue or rotate a token.
- Current cron remains collection `06:12`, health `07:05`, and one summary `07:10`. The summary includes session integrity; a mismatch is `CRITICAL`.
- Logs cannot return the current day. Active releases remain append-only: late visit changes require a reviewed successor release/backfill and are never silently rewritten.
- Observed page identity fixes use a DB-native successor release and never trigger a Metrika backfill.
- Bitrix dump remains test-only; the live connector is deferred.
- Abbott embed reads use the separate aggregate-only `abbott_embed_reader_role` and
  `ABBOTT_EMBED_DB_*=report_bd`; manager reads keep `ABBOTT_PRIVATE_DB_*=report_bd_private`.
- Abbott release returning facts use `canonical_fact_metrika_returning_pages_release_daily`;
  Zaruku retains `canonical_fact_metrika_returning_pages_daily` unchanged.
- No deployment, secret installation, API call, database migration, cron edit, Telegram send, or Hermes schedule occurred.

## Abbott UTM rollout status 2026-07-29

- App release `20260729130916-d86cf45` and private migration `044` are deployed; health, listener isolation, manager/embed boundary, and public-asset checks passed.
- Canonical runtime server commit is `b2f172190e22aaa0454a858e10689d146607df44` with a clean attested manifest.
- Canonical release `8` remains active. Successor release `10` is staging and resume-safe backfill is running for `2026-01-01..2026-07-28`; cutover requires exactly `210` dates, `1050` coverage rows, `0` bad rows, comparison, validation, activation, and smoke.
- No cron edit, Telegram send, token change, or Hermes schedule was performed in this rollout so far.

## Zaruku Webmaster query→page rollout status 2026-07-29

- The exact standard Query Analytics URL-filter probe matched the existing Enhanced Export sample: 152/152 normalized query rows, 13/13 clicks, 191/191 impressions, and zero mismatches.
- Migration `045` is applied in `report_bd`; exact pairs live only in `canonical_fact_webmaster_query_pages_daily`, and successful page-day coverage including empty results lives in `canonical_webmaster_query_page_coverage_daily`.
- Manual weekly run `1715` succeeded for 15 priority pages over `2026-07-21..2026-07-27`: 105 coverage rows, 67 pair facts, 88 successful-empty page-days, and zero bad facts. The separate health layer is `healthy` with an expected frequency of 168 hours.
- Dashboard commit `833db89` is merged and pushed to `main`, but it is not deployed while Abbott successor release `10` remains staging. Production therefore does not yet expose the new `Яндекс:` links.
- The proposed cron `20 3 * * 1` with `--layers query_pages --priority-limit 15` is not installed. Enable it only after the Abbott gate, dashboard deploy, and production SEO smoke pass.
- Never infer a query/page relationship from separate Webmaster query/page totals or from `popular_complementary_indicator`. Enhanced Export remains the historical-backfill and exact fallback path; paid quota requires separate approval.
