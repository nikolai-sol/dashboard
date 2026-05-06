# Canonical Rolling Verification Checklist

Use this file as the short operational checklist for newly enabled canonical cron sources.

Status markers:
- `[ ]` not checked
- `[x]` passed
- `[!]` requires investigation

## Hybrid 3-Day Manual Verification

Status:
- source: `hybrid`
- mode: `non-blocking shadow source`
- runtime: `/root/reportingdash-canonical`
- cron: `enabled`

Enabled cron line:

```cron
37 6 * * * cd /root/reportingdash-canonical && /root/reportingdash-canonical/venv/bin/python fetch_hybrid_canonical.py --days-back 2 --run-type cron >> /root/reportingdash-canonical/logs/hybrid-canonical-cron.log 2>&1
```

Accepted baseline alignment:
- file: `MANUAL-LEGACY-EXCEPTIONS.md`
- source: `hybrid`
- campaign: `f_626`
- dates: `2026-03-11 .. 2026-03-15`
- interpretation: accepted business-required baseline, not a blocking parity defect

### Day 1

- [x] cron line present in `crontab -l`
- [x] log file exists:
  - `/root/reportingdash-canonical/logs/hybrid-canonical-cron.log`
- [x] manual verification run completed without traceback
- [x] latest collector run is `success`
- [x] monitor block reviewed after scheduled run

SQL:

```sql
SELECT id, status, rows_read, rows_written, rows_updated, started_at
FROM canonical_collector_runs
WHERE source_key = 'hybrid'
ORDER BY id DESC
LIMIT 5;
```

Observed now:
- latest run id: `69`
- `status = success`
- `rows_read = 557`
- `rows_written = 146`
- `rows_updated = 146`

### Day 2

- [x] `rows_read` stable
- [x] `rows_written` stable
- [x] `rows_updated` stable
- [x] policy still loads from DB
- [x] `gate_scope = delivery_entity`
- [x] `is_blocking = 0`

### Day 3

- [x] parity acceptable on first-pass safe metrics:
  - `clicks`
  - `views`
  - `video_views_25`
  - `video_views_50`
  - `video_views_75`
  - `video_views_100`
- [x] accepted baseline alignment remains the only known manual legacy carry-over
- [x] `INFO_COVERAGE:canonical_ahead_of_legacy` treated as informational only if present

### Notes

- [x] 2026-03-18 .. 2026-03-20: scheduled cron runs remained `success`; Hybrid stays non-blocking
