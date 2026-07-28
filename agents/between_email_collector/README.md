# Between email collector (Gidrofuril)

## Purpose
Collect daily Between ad stats from email attachments (or local xlsx) into:
- `report_bd.canonical_*` (`source_key = between`)
- `report_bd.dashboard_manual_facts_daily` for dashboard **29** (gidrofuril) via `manual_source_key = manual:between_email`

## Report format
```
date, platform, channel, impressions, clicks, sessions, spend, views, conversions, reach, ctr, cr, cpc, cpm, cpv
```
Channels observed: `Serials`, `WL`, `Smart TV`, `rewarded`

## Gmail access (lifeipdesign@gmail.com)
1. OAuth token already has Gmail scopes at `~/.hermes/google_token.json`
2. **Enable Gmail API** (one-time):
   https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=626178337608
3. Then:
```bash
cd /Users/nafanya/ReportingDash
python3 fetch_between_email_canonical.py --from-gmail --days-back 60 --dashboard-id 29
```

## Local / backfill xlsx
```bash
python3 fetch_between_email_canonical.py --from-xlsx /path/to/report.xlsx --dashboard-id 29
python3 fetch_between_email_canonical.py --import-sample --dashboard-id 29
```

## Cron (VPS suggestion)
```cron
# Between email → DB (after Hybrid)
40 7 * * * cd /root/reportingdash-canonical && ./venv/bin/python fetch_between_email_canonical.py --from-gmail --days-back 7 --dashboard-id 29 >> logs/between-email-cron.log 2>&1
```

## Dashboard wiring (gidrofuril / 29)
- media plan platform label: `hybrid/between`
- bindings: `manual:between|Serials|WL|Smart TV|rewarded`
- manual source 1058 → `manual_source_key=manual:between_email` + `confirmed_manual_data`

## Files
- Collector: `fetch_between_email_canonical.py`
- Samples/state: `agents/between_email_collector/`
