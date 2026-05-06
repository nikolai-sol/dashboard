# Google Ads Reporting Onboarding

Status on 2026-05-04: the project has a read-only Google Ads API collector
entrypoint in `fetch_google_ads_canonical.py` plus reusable client helpers in
`google_ads_api_client.py`.

## What We Need From Google Ads

1. A Google Ads manager account (MCC) for API access.
2. A Google Ads API developer token from the MCC API Center.
3. OAuth 2.0 client credentials from Google Cloud:
   - `client_id`
   - `client_secret`
   - `refresh_token`
4. The Google Ads customer IDs to import.
5. If using an MCC, the login customer ID for request headers.

The OAuth scope for reporting access is:

```text
https://www.googleapis.com/auth/adwords
```

## Environment Variables

Use environment variables, not committed config files:

```bash
export GOOGLE_ADS_DEVELOPER_TOKEN="..."
export GOOGLE_ADS_CLIENT_ID="..."
export GOOGLE_ADS_CLIENT_SECRET="..."
export GOOGLE_ADS_REFRESH_TOKEN="..."
export GOOGLE_ADS_LOGIN_CUSTOMER_ID="1234567890"
export GOOGLE_ADS_CUSTOMER_IDS="1112223333,4445556666"
```

The official Python client can load the standard variables with
`GoogleAdsClient.load_from_env()`. `GOOGLE_ADS_CUSTOMER_IDS` is project-specific
and should be parsed by our collector.

## First Reporting Query

Start with daily campaign metrics. Google Ads reports map UI date ranges to
`segments.date` filters in GAQL.

```sql
SELECT
  segments.date,
  customer.id,
  customer.descriptive_name,
  campaign.id,
  campaign.name,
  campaign.status,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions
FROM campaign
WHERE segments.date BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'
  AND campaign.status != 'REMOVED'
```

## Database Target

For the canonical pipeline, write Google Ads as:

```text
source_key = google
fact_scope = campaign
```

Recommended canonical tables:

```text
canonical_source_accounts
canonical_source_account_collection_settings
canonical_source_campaigns
canonical_fact_ads_daily
```

Legacy dashboard compatibility may still read `ad_campaigns` and
`ad_analytics_daily` for `platform = google`, but new ingestion should prefer the
canonical tables and only mirror to legacy tables if a dashboard still requires
them.

## Implementation Checklist

1. Confirm or request the developer token in the Google Ads MCC API Center.
2. Create OAuth consent + OAuth client in Google Cloud.
3. Generate a refresh token for the Ads user that has access to all required
   customer accounts.

```bash
PYTHONPATH=.pydeps python3 setup_google_ads_oauth.py
```

4. Add the environment variables on the server and local collector environment.
5. Create account settings rows for each customer ID.
6. Check local configuration:

```bash
PYTHONPATH=.pydeps python3 fetch_google_ads_canonical.py --check-config
```

7. Test the API connection by listing customers visible to the OAuth user:

```bash
PYTHONPATH=.pydeps python3 fetch_google_ads_canonical.py list-accessible-customers
```

8. List campaigns for configured `GOOGLE_ADS_CUSTOMER_IDS`:

```bash
PYTHONPATH=.pydeps python3 fetch_google_ads_canonical.py list-campaigns
```

9. Run a dry-run for one day:

```bash
PYTHONPATH=.pydeps python3 fetch_google_ads_canonical.py --date-from 2026-04-28 --date-to 2026-04-28 --dry-run
```

10. Run a write into canonical and Google detail tables:

```bash
PYTHONPATH=.pydeps python3 fetch_google_ads_canonical.py --date-from 2026-04-28 --date-to 2026-04-28
```

11. Validate daily spend totals. The generated table stores API campaign totals
    and a UI comparison note for the same account/date/currency scope:

```bash
PYTHONPATH=.pydeps python3 fetch_google_ads_canonical.py validate-spend --date-from 2026-04-28 --date-to 2026-04-28
```

12. Backfill March and April data.
13. Add a cron job after a successful manual run.

## Collector Scope

The first version is read-only against Google Ads:

- campaign daily performance is written to `canonical_fact_ads_daily`
  with `fact_scope='campaign'`
- cross-platform `conversion_value` is stored in `canonical_fact_ads_daily`
- PMax asset group performance is written to `canonical_fact_ads_daily`
  with `fact_scope='delivery_entity'` and `breakdown_scope='pmax_asset_group'`
- Google-specific asset group, search term, and product rows are stored in
  `google_ads_*_performance_daily` detail tables
- Google-specific operational tables include `google_ads_search_term_performance_daily`,
  `google_ads_keyword_performance_daily`, `google_ads_product_performance_daily`,
  `google_ads_pmax_asset_group_daily`, `google_ads_negative_keyword_recommendations`,
  and `google_ads_mutation_log`
- `google_ads_negative_keyword_recommendation_todos` is only a future workflow
  placeholder; no mutate APIs are called

## Official References

- Developer token: https://developers.google.com/google-ads/api/docs/api-policy/developer-token
- OAuth overview: https://developers.google.com/google-ads/api/docs/oauth/overview
- Single-user OAuth flow: https://developers.google.com/google-ads/api/docs/oauth/single-user-authentication
- Python client: https://developers.google.com/google-ads/api/docs/client-libs/python
- Python configuration: https://developers.google.com/google-ads/api/docs/client-libs/python/configuration
- Reporting and GAQL mapping: https://developers.google.com/google-ads/api/docs/reporting/uireports
