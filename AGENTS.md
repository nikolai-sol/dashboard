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
