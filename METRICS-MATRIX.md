# Metrics Matrix

Дата фиксации: `2026-03-13`

Цель документа: разделить
- метрики, которые текущие collectors реально запрашивают сейчас
- метрики, которые уже пишутся в таблицы
- минимальный канонический набор для parity-report нового стека

## Канонический parity baseline

Для всех performance/media источников новый стек должен уметь сравнивать минимум:

- `spend`
- `impressions`
- `clicks`
- `views`
- `conversions`

Дополнительные поля второго уровня:

- `reach`
- `frequency`
- `ctr`
- `cpm`
- `cpc`
- `cpv`
- `cpa`
- video quartiles / completion
- `link_clicks`
- engagement metrics (`likes`, `comments`, `shares`, `reactions`, `follows`)

## Current collectors

| Source | Current request / API values | Fields stored now | Notes |
|---|---|---|---|
| LinkedIn local ETL | `impressions`, `clicks`, `costInLocalCurrency`, `externalWebsiteConversions` | `impressions`, `clicks`, `cost_local`, `cost_usd`, `conversions` + zero-filled extra fields in `ad_analytics_daily` | Exists only in local Python ETL, not in legacy Nest |
| Reddit local ETL | `impressions`, `clicks`, `spend`, `app_install_total_conversions` | `impressions`, `clicks`, `cost_local`, `cost_usd`, `conversions` + zero-filled extra fields in `ad_analytics_daily` | Exists only in local Python ETL, not in legacy Nest |
| Yandex Direct | current collector stores `impressions`, `impressionsReach`, `clicks`, `conversions`, `ctr`, `cost`, `avgCpc`, `avgImpr` | same | Current runtime degraded |
| Yandex Metrika | env-driven metric sets: stats / goals / internal / params / returned / abbot | visits/users/newUsers/pageDepth/bounceRate/avgVDS/goal stats/page views/retention-like fields etc | This is web analytics, not ad platform spend collector |
| Hybrid | `ImpressionCount`, `completeEventsCount`, `ClickCount`, `Reach`, quartiles, `CTR`, `Viewability`, `Frequency` | `impr`, `views`, `clicks`, `reach`, `view_25`, `view_50`, `view_75`, `view_100`, `ctr`, `viewability`, `frequency` | No spend currently stored in legacy table |
| GetIntent | `imps`, `unique_imps`, `clicks`, `ctr`, `view_rate`, `video_completion_25/50/75/100` | same + `conv_rate`, `frequency` (currently null) | No spend currently stored in legacy table |
| Sape | `nofImps`, `nofClicks`, `vastComplete` | `impressions`, `clicks`, `views` | Source can be excluded from new flow |
| VK Ads v2 | `metrics=base,video,uniques` | `clicks`, `impressions`, `ctr`, `views25`, `views50`, `views75`, `views100` | No spend currently stored in legacy table |

## Implications for the new stack

1. `LinkedIn` and `Reddit` can be added directly into the new collector path without legacy parity dependency.
2. `Sape` can be removed from the new target list unless the business explicitly restores it.
3. For `Hybrid`, `GetIntent`, `VK Ads v2`, parity cannot rely on `spend` until the source mapping for spend is implemented or confirmed elsewhere.
4. `Yandex Metrika` should be treated as a separate analytics source, not merged blindly with paid media facts.
5. The new canonical schema should support more metrics than the parity baseline, but the cutover gate should use only metrics that exist and are trustworthy per source.

## Recommended parity set by source

| Source | Recommended parity metrics |
|---|---|
| LinkedIn | `spend`, `impressions`, `clicks`, `conversions` |
| Reddit | `spend`, `impressions`, `clicks`, `conversions` |
| Yandex Direct | `spend`, `impressions`, `clicks`, `conversions`, `ctr`, `avgCpc` |
| Hybrid | `impressions`, `views`, `clicks`, `reach`, quartiles |
| GetIntent | `impressions`, `unique_imps`, `clicks`, quartiles / `view_rate` |
| VK Ads v2 | `impressions`, `clicks`, quartiles |
| Yandex Metrika | `visits`, `users`, `newUsers`, goal-related metrics |
