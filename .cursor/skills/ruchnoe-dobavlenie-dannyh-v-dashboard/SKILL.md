---
name: ruchnoe-dobavlenie-dannyh-v-dashboard
description: Ручное добавление или корректировка дневных данных в ReportingDash. Use when the user asks in Russian to "добавь данные", "добавь к вчерашним данным", "поставь показы/просмотры/клики", or otherwise manually add campaign metrics to a dashboard.
---

# Ручное добавление данных в дашборд

## Когда применять

Используй этот skill, когда пользователь просит вручную добавить или скорректировать метрики кампании в ReportingDash: показы, просмотры, клики, расход, конверсии, охват или сессии.

Типичный запрос: "добавь к вчерашним данным кампании хзн леовит платформа гибрид 38546 просмотров и показов".

## База и CLI

- Локальный `mysql` CLI установлен через Homebrew `mysql-client`.
- В новых shell он доступен через `~/.zshrc`: `/opt/homebrew/opt/mysql-client/bin`.
- Подключение бери из `.env` с учётными данными MySQL (в воркспейсе обычно корень `ReportingDash`; из каталога `dashboard-next` используй родительский файл):

```bash
# из корня воркспейса ReportingDash
set -a; source .env; set +a

# из репозитория dashboard-next
set -a; source ../.env; set +a

mysql -h"$MYSQL_HOST" -P"${MYSQL_PORT:-3306}" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "${MYSQL_DB:-report_bd}"
```

Если `mysql` по какой-то причине недоступен в текущем shell, временно добавь PATH:

```bash
export PATH="/opt/homebrew/opt/mysql-client/bin:$PATH"
```

## Обязательный workflow

1. Определи дату.
   - "вчера" означает предыдущий календарный день относительно даты текущего сообщения пользователя.
   - Всегда переведи дату в ISO `YYYY-MM-DD` и озвучь ее в финальной проверке.

2. Нормализуй платформу и метрики.
   - "гибрид" -> `source_key='hybrid'`.
   - "показы" -> `impressions`.
   - "просмотры" -> `views`.
   - Если пользователь говорит "просмотров и показов 38546", ставь одно и то же значение в `views` и `impressions`.

3. Найди кампанию по описанию пользователя.
   - Ищи в `canonical_source_campaigns` по `source_key`, `campaign_name`, `platform_campaign_id`.
   - Дополнительно проверь дашборды и привязки:
     - `dashboards`
     - `dashboard_sources`
     - `media_plan_bindings`
     - `dashboard_media_plan_rows`
   - Не угадывай при нескольких близких совпадениях: покажи варианты и спроси, какую кампанию выбрать.

4. Проверь существующие факты перед записью.
   - Запроси строки из `canonical_fact_ads_daily` за дату, `source_key`, `platform_account_id`, `platform_campaign_id`.
   - Сохрани в голове текущие суммы `SUM(impressions)` и `SUM(views)`.
   - Если пользователь сказал "добавь к данным", не перезаписывай исходную строку коллектора.

5. Для добавления используй отдельную идемпотентную корректировочную строку.
   - Создай/обнови synthetic delivery entity и creative.
   - Вставь строку в `canonical_fact_ads_daily` с:
     - `fact_scope='delivery_entity'`
     - `native_grain='other'`
     - `breakdown_scope='manual_adjustment'`
     - `platform_delivery_entity_id='manual_adjustment::<short-key>::<date>'`
     - `platform_creative_id` таким же значением
   - Используй `INSERT ... ON DUPLICATE KEY UPDATE`, чтобы повторный запуск не задваивал корректировку.
   - Делай запись в транзакции.

6. Для явной замены значения.
   - Только если пользователь явно говорит "замени", "поставь вместо", "должно быть ровно".
   - Тогда либо обнови существующую ручную корректировку, либо рассчитай корректировку как `target - existing_collector_sum`.
   - Не затирай сырые collector facts без явного подтверждения.

7. Проверь результат.
   - После commit выполни агрегирующий SELECT по кампании и дате.
   - Финально сообщи: дату, кампанию/id, добавленную корректировку и итоговые `impressions` / `views`.

## SQL-паттерн для ручной корректировки

Используй этот паттерн как основу и подставляй найденные значения:

```sql
START TRANSACTION;

INSERT INTO canonical_source_delivery_entities (
  source_key, platform_account_id, platform_campaign_id, delivery_entity_type,
  platform_delivery_entity_id, delivery_entity_name, delivery_status,
  first_seen_at, last_seen_at, raw_payload
) VALUES (
  'hybrid', @account_id, @campaign_id, 'other',
  @adjustment_id, @adjustment_name, 'ACTIVE',
  @report_date, @report_date,
  JSON_OBJECT('manual_adjustment', true, 'reason', @reason)
)
ON DUPLICATE KEY UPDATE
  platform_campaign_id = VALUES(platform_campaign_id),
  delivery_entity_name = VALUES(delivery_entity_name),
  delivery_status = VALUES(delivery_status),
  last_seen_at = VALUES(last_seen_at),
  raw_payload = VALUES(raw_payload);

INSERT INTO canonical_source_creatives (
  source_key, platform_account_id, platform_campaign_id, platform_delivery_entity_id,
  platform_creative_id, creative_name, creative_status, creative_type,
  first_seen_at, last_seen_at, raw_payload
) VALUES (
  'hybrid', @account_id, @campaign_id, @adjustment_id,
  @adjustment_id, @adjustment_name, 'ACTIVE', 'manual_adjustment',
  @report_date, @report_date,
  JSON_OBJECT('manual_adjustment', true, 'reason', @reason)
)
ON DUPLICATE KEY UPDATE
  platform_campaign_id = VALUES(platform_campaign_id),
  platform_delivery_entity_id = VALUES(platform_delivery_entity_id),
  creative_name = VALUES(creative_name),
  creative_status = VALUES(creative_status),
  creative_type = VALUES(creative_type),
  last_seen_at = VALUES(last_seen_at),
  raw_payload = VALUES(raw_payload);

INSERT INTO canonical_fact_ads_daily (
  source_key, platform_account_id, platform_campaign_id, fact_scope, native_grain,
  breakdown_scope, platform_delivery_entity_id, platform_creative_id, report_date,
  impressions, views
) VALUES (
  'hybrid', @account_id, @campaign_id, 'delivery_entity', 'other',
  'manual_adjustment', @adjustment_id, @adjustment_id, @report_date,
  @impressions, @views
)
ON DUPLICATE KEY UPDATE
  impressions = VALUES(impressions),
  views = VALUES(views),
  updated_at = CURRENT_TIMESTAMP;

COMMIT;
```

## Example from this project

For "хзн леовит платформа гибрид 38546 просмотров и показов":

- Found Hybrid campaign `f_626`, account `698061f2810d981524e5d985`.
- Existing collector row for `2026-04-28` was `100840` impressions and `100840` views.
- Added idempotent adjustment row:
  - `manual_adjustment::hzn_leovit::2026-04-28`
  - `impressions=38546`
  - `views=38546`
- Verified total became `139386` impressions and `139386` views.

## Deployment rule

Database-only manual data additions do not require deploy. If code files are changed while doing this task, follow the workspace deploy rule and run `cd dashboard-next && npm run deploy`.
