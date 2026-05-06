# Field Mapping: Legacy -> Canonical

Дата фиксации: `2026-03-13`

Цель: зафиксировать mapping между текущими legacy-таблицами/полями и будущей canonical schema нового collector stack.

## Canonical daily fact fields

Минимальный superset для нового стека:

- `platform`
- `source_system`
- `account_id`
- `campaign_id`
- `ad_group_id`
- `creative_id`
- `report_date`
- `spend`
- `impressions`
- `clicks`
- `conversions`
- `views`
- `reach`
- `frequency`
- `ctr`
- `cpm`
- `cpc`
- `cpv`
- `cpa`
- `video_views_25`
- `video_views_50`
- `video_views_75`
- `video_views_100`
- `link_clicks`
- `likes`
- `comments`
- `shares`
- `reactions`
- `follows`
- `raw_payload_ref`
- `ingested_at`
- `ingestion_run_id`

## Source mappings

### LinkedIn local ETL
- source table: `ad_analytics_daily`
- filters: `platform = linkedin`
- mapping:
  - `report_date` <- `report_date`
  - `account_id` <- `account_id`
  - `campaign_id` <- `campaign_id`
  - `spend` <- `cost_local`
  - `impressions` <- `impressions`
  - `clicks` <- `clicks`
  - `conversions` <- `conversions`
  - others currently zero-filled

### Reddit local ETL
- source table: `ad_analytics_daily`
- filters: `platform = reddit`
- mapping:
  - `report_date` <- `report_date`
  - `account_id` <- `account_id`
  - `campaign_id` <- `campaign_id`
  - `spend` <- `cost_local`
  - `impressions` <- `impressions`
  - `clicks` <- `clicks`
  - `conversions` <- `conversions`
  - `video_views` <- `video_views`
  - `video_views_100` <- `video_completions`
  - `link_clicks` <- `link_clicks`

### Yandex Direct
- source tables: `yandex_new`, `yandex_market_stat`
- mapping:
  - `report_date` <- `date`
  - `campaign_id` <- `campaign_id`
  - `ad_group_id` <- `ad_group_id`
  - `creative_id` <- `ad_id`
  - `spend` <- `cost`
  - `impressions` <- `impressions`
  - `clicks` <- `clicks`
  - `conversions` <- `conversions`
  - `reach` <- `impressionsReach` only in `yandex_new`
  - `ctr` <- `ctr`
  - `cpc` <- `avgCpc`
  - `avg_position_legacy` <- `avgImpr`

### Hybrid
- source table: `hyb_stats`
- mapping:
  - `report_date` <- `date`
  - `campaign_id` <- `campaign_id`
  - `creative_id` <- `creative_id`
  - `impressions` <- `impr`
  - `views` <- `views`
  - `clicks` <- `clicks`
  - `reach` <- `reach`
  - `video_views_25` <- `view_25`
  - `video_views_50` <- `view_50`
  - `video_views_75` <- `view_75`
  - `video_views_100` <- `view_100`
  - `ctr` <- `ctr`
  - `frequency` <- `frequency`
  - `viewability_legacy` <- `viewability`
  - `spend` <- not available in current legacy table

### GetIntent
- source table: `git_statistic`
- mapping:
  - `report_date` <- `day`
  - `campaign_id` <- `campaign_id`
  - `ad_group_id` <- `campaign_group_id`
  - `creative_id` <- `creative_id`
  - `impressions` <- `imps`
  - `reach` <- `unique_imps` if used as legacy approximation
  - `clicks` <- `clicks`
  - `ctr` <- `ctr`
  - `video_views_25` <- `video_completion_25`
  - `video_views_50` <- `video_completion_50`
  - `video_views_75` <- `video_completion_75`
  - `video_views_100` <- `video_completion_100`
  - `frequency` <- `frequency` (currently mostly null)
  - `spend` <- not available in current legacy table

### VK Ads v2
- source table: `vk_creative_stats`
- mapping:
  - `report_date` <- `date`
  - `creative_id` <- `creative_id`
  - `impressions` <- `impressions`
  - `clicks` <- `clicks`
  - `ctr` <- `ctr`
  - `video_views_25` <- `views25`
  - `video_views_50` <- `views50`
  - `video_views_75` <- `views75`
  - `video_views_100` <- `views100`
  - `spend` <- not available in current legacy table
  - `reach` / `frequency` exist in API response types but are not persisted in current legacy DB

### Sape
- source table: `sape_stats`
- mapping:
  - `report_date` <- `date`
  - `campaign_id` <- `campaign_id`
  - `creative_id` <- `creative_id`
  - `impressions` <- `impressions`
  - `clicks` <- `clicks`
  - `views` <- `views`
  - `spend` <- not available

### Yandex Metrika
- source tables: `yandex_metrika`, `yandex_metrika_goals_stat`, `yandex_metrika_internal`, `yandex_metrika_params`, `yandex_metrika_returned`, `yandex_abbot_stats`
- note:
  - should live in separate analytics domain, not mixed into ad-spend fact table
  - metrics are web/session/goal oriented
  - canonical mapping should target `analytics_daily` or a dedicated `site_analytics_fact` family
