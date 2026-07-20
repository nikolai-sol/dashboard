# Repository agent guidance

## Abbott visit-level operational truth

- Abbott source summaries use Reports API attribution `lastsign` and exact traffic segments `all`, `with_user_id`, and `without_user_id`. Per day/source, `all.sessions = with_user_id.sessions + without_user_id.sessions` is a hard publication gate.
- `user_behavior` uses Logs API `source=visits`. One private database row is one Metrica visit. Data is stored only in `report_bd_private.canonical_fact_metrika_visits`. Raw User ID, visit ID, start URL, and end URL are manager-only. Raw client ID is never stored; only its hash is persisted.
- The Logs lifecycle is evaluate → create → poll → download all parts → clean in finally. Prepared files count against the 10 GB quota until cleaned.
- `METRIKA_TOKEN` remains the only OAuth environment key. Never print it. The owner installs or revokes it; this change does not issue or rotate a token.
- Current cron remains collection `06:12`, health `07:05`, and one summary `07:10`. The summary includes session integrity; a mismatch is `CRITICAL`.
- Logs cannot return the current day. Active releases remain append-only: late visit changes require a reviewed successor release/backfill and are never silently rewritten.
- Bitrix dump remains test-only; the live connector is deferred.
- No deployment, secret installation, API call, database migration, cron edit, Telegram send, or Hermes schedule occurred.
