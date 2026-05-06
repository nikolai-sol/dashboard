# NEST SECOND AUDIT

Аудит локальной папки `nest-second/` и её текущего соответствия серверной копии на Beget VPS.

Дата проверки: `2026-03-13`

## Что это такое

`nest-second` это NestJS API-сервис, который запускает сбор и запись статистики по нескольким источникам.

Локальная папка:

- `/Users/nicko/ReportingDash/nest-second`

Серверная копия:

- `/var/www/www-root/data`

Сверка:

- `package.json` локально и на сервере совпадают
- `src/launch/launch.service.ts` локально и на сервере совпадает
- сервис реально запущен на VPS

## Что запущено на сервере

PM2 процессы:

- `nest-analytics` от `root`
- `adreports.ru` от `www-root`

Важно:

- daily cron бьёт в `http://5.35.85.218:5000/launch?...`
- это соответствует root-инстансу `nest-analytics`

## Расписание cron

Найденный cron:

```cron
0 6 * * * /usr/bin/node /var/www/www-root/data/ttt_cron_ttt_some-asaser.js >/dev/null 2>&1
```

Содержимое cron-скрипта:

```js
fetch('http://5.35.85.218:5000/launch?secret=nikolay-save-us-pls')
```

Таймзона сервера:

- `Etc/UTC`

Значит расписание сейчас:

- каждый день в `06:00 UTC`
- для `Europe/Vienna` это `07:00` зимой и `08:00` летом

## Главный orchestrator

Endpoint запуска:

- `GET /launch`

Файл:

- `/Users/nicko/ReportingDash/nest-second/src/launch/launch.service.ts`

Что делает:

- проверяет query secret
- если дата не передана, берёт дату `today - 2 days`
- запускает параллельно несколько сервисов
- отправляет итог в Telegram

## Таблица по площадкам

| Источник | Route | Входит в daily launch | API / источник данных | Таблицы записи |
|---|---|---:|---|---|
| Яндекс.Директ | `/direct` | Да | Yandex Direct Reports API | `req_system`, `yandex_names`, `yandex_group_names`, `yandex_new`, `yandex_market_stat` |
| Яндекс.Метрика | `/metrika` | Да | Yandex Metrika API | `yandex_metrika_names`, `yandex_metrika`, `yandex_metrika_goals`, `yandex_metrika_goals_stat`, `yandex_metrika_internal`, `yandex_metrika_params`, `yandex_metrika_returned`, `yandex_abbot_stats` |
| Hybrid | `/hybrid` | Да | `api.hybrid.ru` | `hyb_systems`, `hyb_stats`, `hyb_creatives` |
| GetIntent | `/getintent` | Да | `reporting.getintent.com/api/v2/reports` | `git_system`, `git_name`, `git_group_campaign`, `git_creative`, `git_statistic` |
| Sape | `/sape` | Да | `traffic.sape.ru/api/v2` | `sape_stats` |
| VK Ads v2 | `/vk/v2` | Да | `ads.vk.com/api/v2` | `vk_data`, `vk_creative_names`, `vk_creative_stats` |
| VK old | `/vk` | Нет | legacy VK API flow | не основной daily pipeline |
| Solovey | `/solovey` | Нет | отдельный POST flow | не основной daily pipeline |

## Что не найдено

В `nest-second` не найдено:

- Google Ads
- DV360

То есть этот сервис сейчас покрывает не все рекламные источники проекта.

## Где лежат ключи и токены

Основная часть ключей и доступов лежит на сервере в:

- `/var/www/www-root/data/.production.env`

Также найдены:

- `/var/www/www-root/data/.env`
- `/var/www/www-root/data/.development.env`

Там есть значения для:

- `MYSQL_*`
- `HYBRID_*`
- `VK_*`
- `VK_NEW_*`
- `DIRECT_URL`
- `METRIKA_*`
- `GETINTENT_*`
- `SAPE_*`
- `TG_TOKEN`
- `TG_CHAT_ID`

Важно:

- значения на сервере присутствуют и реально используются приложением
- это production secrets

Текущий production runtime для daily cron:

- PM2 app `nest-analytics`
- пользователь `root`
- публичный порт `:5000`

## Что зашито прямо в коде

Это отдельный риск. Не все секреты вынесены в env.

Зашито прямо в коде:

- query secret запуска: `nikolay-save-us-pls`
- hardcoded token в `metrika.service.ts`

Файлы:

- `/Users/nicko/ReportingDash/nest-second/src/launch/launch.service.ts`
- `/Users/nicko/ReportingDash/nest-second/src/services/direct/direct.service.ts`
- `/Users/nicko/ReportingDash/nest-second/src/services/getintent/getintent.service.ts`
- `/Users/nicko/ReportingDash/nest-second/src/services/hybrid/hybrid.service.ts`
- `/Users/nicko/ReportingDash/nest-second/src/services/metrika/metrika.service.ts`
- `/Users/nicko/ReportingDash/nest-second/src/services/sape/sape.service.ts`
- `/Users/nicko/ReportingDash/nest-second/src/services/vk/v2/vk.services.ts`

По факту:

- да, `nikolay-save-us-pls` это тот самый секрет, который используется для защиты `/launch`
- он совпадает в коде и в cron-URL

## Telegram

Отправка делается через:

- `/Users/nicko/ReportingDash/nest-second/src/services/sender/sender.service.ts`

Используются:

- `TG_TOKEN`
- `TG_CHAT_ID`

На сервере проверено:

- `TG_CHAT_ID` ведёт в Telegram group
- title: `Дашборды в бд`

## Текущий health legacy API

Важно:

- write-endpoint'ы с реальным secret намеренно не вызывались вручную, чтобы не менять текущую систему
- статус ниже собран по OpenAPI, PM2 логам, свежести таблиц и runtime

Доступные маршруты в OpenAPI:

- `/launch`
- `/direct`
- `/metrika`
- `/hybrid`
- `/getintent`
- `/sape`
- `/vk`
- `/vk/v2`

### Статус по источникам

| Источник | Признак runtime | Последняя дата в таблицах | Статус |
|---|---|---:|---|
| Яндекс.Директ | в error log повторяются `400` и `Invalid character in header content [\"Authorization\"]` | `2026-03-11` в `yandex_new`, `2026-03-11` в `yandex_market_stat` | `degraded` |
| Яндекс.Метрика | есть данные и активные токены, в коде найден hardcoded OAuth token | `2026-03-11` | `working`, но с security debt |
| Hybrid | в out log есть свежие `INSERT IGNORE INTO hyb_stats` | `2026-03-11` | `working` |
| GetIntent | env присутствуют, таблица заполнялась | `2026-03-11` в `git_statistic.day` | `likely working` |
| Sape | env присутствуют, таблица есть | `2025-11-26` в `sape_stats` | `stale / needs verification` |
| VK Ads v2 | в out log есть свежие `INSERT IGNORE INTO vk_creative_stats` | `2026-03-11` | `working` |
| VK old | route есть, но не участвует в daily launch | не проверялось отдельно | `legacy / not in main flow` |

## Диск и размер БД

Корневая файловая система:

- `/` = `29G`
- занято около `11G`

Основные потребители места:

- `/var/log/journal` = `2.9G`
- `/var/lib/mysql` = `1.1G`
- `/var/www` = `467M`
- `/root/.pm2/logs` = `341M`
- `/var/www/www-root/data/node_modules` = `241M`
- `/var/www/www-root/data/.nvm` = `224M`

Размер баз данных:

- `report_bd` = `465.36 MB`
- `mysql` = `2.73 MB`
- `roundcube` = `0.53 MB`

Значит основное занятие диска сейчас даёт не сама БД, а:

- systemd journal
- MySQL datadir в целом
- Node runtime / `node_modules`
- PM2 logs

## Риски

- `:5000` открыт наружу
- cron дёргает публичный URL, а не localhost или unix socket
- секрет запуска передаётся в query string
- секрет запуска захардкожен в коде
- часть токенов живёт в `.production.env`, часть всё ещё зашита в коде

## Что стоит сделать дальше

- перенести launch secret в env
- перестать вызывать `/launch` по публичному `http://5.35.85.218:5000`
- заменить вызов на `127.0.0.1` или internal-only маршрут
- закрыть наружу порт `5000`
- вынести hardcoded token из `metrika.service.ts`
- обновить `nest-second/README.md`, потому что сейчас там стандартный boilerplate Nest
