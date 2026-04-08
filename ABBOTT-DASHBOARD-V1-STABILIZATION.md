# Abbott Dashboard V1 Stabilization

## Pages 1-6

### 1. Общая таблица по пользователям
- grain: `UserID + Источник` over selected date range
- current fact source: `yandex_metrika_params`
- external mapping:
  - `id` sheet from `Abbott names.xlsx` for `Направление`
  - `yandex_metrika_traffic` for source labels
- fallback logic:
  - in-app traffic label fallback for missing `traffic_id` dictionary values
- current status: `legacy-backed`
- future migration target:
  - optional future `user_behavior` / user proxy scope

### 2. Действия пользователя на сайте
- grain: `UserID + Источник + Start URL + End URL`
- current fact source: `yandex_metrika_params`
- external mapping:
  - `id` sheet from `Abbott names.xlsx` for `Направление`
  - `yandex_metrika_traffic` for source labels
- fallback logic:
  - in-app traffic label fallback for missing `traffic_id` dictionary values
- current status: `legacy-backed`
- future migration target:
  - future `user_behavior` layer if session-level contour is introduced

### 3. Статистика страниц
- grain: `page_name + url`
- current fact source: `yandex_metrika_internal`
- external mapping:
  - workbook enrichment from `Abbott names.xlsx` for `direction / material_type / access / ignore`
  - URL-based direction fallback
- fallback logic:
  - if workbook enrichment is missing, the page still renders as raw page stats
- current status: `mixed`
- future migration target:
  - canonical `page_performance` scope

### 4. Внешние переходы
- grain: aggregated `external_url`, with optional event enrichment
- current fact source: normalized `yandex_metrika_external`
- external mapping:
  - `events` sheet from `Abbott names.xlsx`
- fallback logic:
  - unmatched fact rows are still shown without enrichment
- current status: `mixed`
- future migration target:
  - cleaner external fact layer / possible API-backed outbound layer

### 5. Вернувшиеся
- grain: `url` aggregated over selected date range from daily `endURL` rows
- current fact source:
  - Abbott-scoped `Yandex Metrika Reports API` prototype on:
    - `ym:s:endURL`
    - `ym:s:visits`
    - `ym:s:upToDayUserRecencyPercentage`
    - `ym:s:upToWeekUserRecencyPercentage`
    - `ym:s:upToMonthUserRecencyPercentage`
- external mapping:
  - `url_return` direction mapping from workbook when available
  - otherwise URL-based direction inference
- fallback logic:
  - if API path fails, fallback to:
    - `yandex_metrika_returned` for visits
    - `ym_url_return` workbook overlay for return buckets
- current status: `api-backed`
- future migration target:
  - dedicated clean `returned` collector scope

### 6. Общие материалы
- grain: `material_name + url`
- current fact source: `yandex_metrika_internal`
- external mapping:
  - `general_materials` sheet from `Abbott names.xlsx`
- fallback logic:
  - if a material URL has no stats match, the row remains with `0`
- current status: `mixed`
- future migration target:
  - canonical `page_performance` plus optional enrichment layer

## QA Checklist

- Verify each tab opens and filters work without client-side errors.
- Confirm pages 1 and 2 no longer show raw `traffic_id:*` values.
- Confirm page 3 charts exclude unnamed buckets while the table keeps raw rows.
- Confirm page 4 shows external fact rows even when event enrichment is missing.
- Confirm page 5 shows non-zero return buckets on a fresh `2026` date range.
- Confirm page 6 row set matches `general_materials` names and URLs.

## Known Limitations

- Pages 1 and 2 still rely on legacy user-proxy data, not a true session/user layer.
- Page 3 enrichment is incomplete for some pages and still depends on workbook coverage.
- Page 4 is Abbott-specific and not yet a generalized outbound analytics contour.
- Page 5 API path is Abbott-only and on-demand, not collector-backed.
- Page 6 depends on exact URL matching from `general_materials`.
- Workbook enrichment remains important for content labeling and exclusions.

## Production Support Note

- Abbott v1 is production-ready, but intentionally hybrid: legacy facts, workbook enrichment, and one Abbott-specific API-backed path for `Вернувшиеся`.
- If page 5 returns to zeros, first verify `METRIKA_TOKEN` and Metrika API availability.
- No cron or schema dependency was introduced for the final Abbott stabilization; support should treat this as dashboard-runtime logic, not collector infrastructure.
