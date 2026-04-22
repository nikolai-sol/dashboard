# Abbott Dashboard V1 Scope

## Included in v1

Access:
- password-only viewer login remains enabled
- permanent website embed is allowed via:
  - `embed_key`
  - current key source:
    - `process.env.ABBOTT_DASHBOARD_EMBED_KEY`
    - fallback default: `Terasic1!`

Pages included in Abbott web dashboard v1:

1. `Общая таблица по пользователям`
   - source: `canonical_fact_user_behavior_daily`
   - enrichment: `id` sheet for direction
   - current grain: `UserID + traffic source`

2. `Действия пользователя на сайте`
   - source: `canonical_fact_user_behavior_daily`
   - mapping: `yandex_metrika_traffic`
   - current grain: `UserID + traffic source + startURL + endURL`

3. `Статистика страниц`
   - source: `yandex_metrika_internal`
   - current grain: `page_name + url`
   - pure legacy page stats

5. `Вернувшиеся`
   - source: `yandex_metrika_returned`
   - enrichment/fallback overlay: `ym_url_return`
   - current grain: `url`
   - mixed legacy/external page

6. `Общие материалы`
   - source facts: `yandex_metrika_internal`
   - external row list: `general_materials`
   - current grain: `material_name + url`
   - mixed legacy/external page

7. `Время на сайте`
   - source: `canonical_fact_user_behavior_daily`
   - overall grain: `UserID` over selected date range
   - materials filter: `general_materials.url -> params.endURL`
   - metric logic: weighted avg duration by visits, then user bucket counts

## Page 4 in v1

`Внешние переходы` stays reference-only in Abbott v1.

Current behavior:
- source: `events` sheet only
- fields:
  - `title`
  - `direction`
  - `registration_url`
  - `access`
- no external analytics fact layer in v1

What page 4 is **not** in v1:
- not a full analytics page
- not a canonical page
- not a normalized external fact page

## Explicitly out of v1

- full external links analytics for page 4
- canonical migration of all Abbott pages
- user behavior/session-level rebuild
- page 4 joins between events and external facts
- new dashboard structure/redesign

## Phase 2 Target

Page 4 analytics moves to phase 2.

Target external fact layer:
- source: `yandex_metrika_external`
- normalized grain: `day x counter x external_url`
- metric: `outbound_clicks` / `views`

Recommended phase 2 order:
1. normalize `yandex_metrika_external` to clean daily grain
2. validate coverage and top external URLs
3. add optional enrichment from `events`
4. only then build full page 4 analytics

Current source-of-truth decision:
- use `legacy-normalized external layer now`
- keep `events` as enrichment-only exact match
- keep `API-first external layer` for a later pass after a stable outbound report path is confirmed
