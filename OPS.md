# OPS

Короткий operational runbook для production.

Важно:
- authoritative memory now lives in [AGENTS.md](/Users/nicko/ReportingDash/dashboard-next/AGENTS.md)
- если этот файл расходится с `AGENTS.md`, сначала верить `AGENTS.md`, потом чинить `OPS.md`

## Production runtime

`dashboard-next` сейчас работает так:

- runtime: `PM2`
- PM2 app: `dashboard-next`
- bind: `127.0.0.1:3001`
- app dir: `/var/www/dashboard`
- staged releases dir: `/var/www/dashboard-releases`
- rollback backups dir: `/var/www/dashboard-backups`
- public URL: `https://dashboards.adreports.ru`

Legacy runtime отдельно:

- `nest-analytics` остаётся в root PM2

## SSH

Подключение:

```bash
ssh beget
```

## Основные команды

### Статус приложения

```bash
pm2 status
pm2 describe dashboard-next
```

### Перезапуск приложения

```bash
pm2 restart dashboard-next
```

### Остановить

```bash
pm2 stop dashboard-next
```

### Запустить

```bash
cd /var/www/dashboard
pm2 start ecosystem.config.js --only dashboard-next
```

### Сохранить PM2 state

```bash
pm2 save
```

## Логи

### Live logs

```bash
tail -f /var/log/dashboard-next-out.log /var/log/dashboard-next-error.log
```

### Последние 200 строк

```bash
tail -n 200 /var/log/dashboard-next-out.log
tail -n 200 /var/log/dashboard-next-error.log
```

### Логи за сегодня

```bash
grep "$(date +%F)" /var/log/dashboard-next-out.log | tail -n 200
grep "$(date +%F)" /var/log/dashboard-next-error.log | tail -n 200
```

## Health checks

### Локально на VPS

```bash
curl -s http://127.0.0.1:3001/api/health
```

### Публичный health

```bash
curl -s https://dashboards.adreports.ru/api/health
```

### Проверка main routes

```bash
curl -I https://dashboards.adreports.ru/dashboard/rag_mp
curl -I https://dashboards.adreports.ru/admin/dashboards
```

## Nginx

### Проверить конфиг

```bash
nginx -t
```

### Перезагрузить nginx

```bash
systemctl reload nginx
```

### Конфиг dashboard

```text
/etc/nginx/conf.d/dashboard-next.conf
```

Важно:

- bootstrap script `scripts/setup-vps.sh` должен рендерить `dashboards.adreports.ru`
- TLS должен смотреть на реальный cert/key этого домена
- не возвращать старый `dashboard.bayesly.digital` или ISPmanager cert как default

## PM2 app

### PM2 config

```text
/var/www/dashboard/ecosystem.config.js
```

### App directory

```text
/var/www/dashboard
```

## Deploy

Локальный deploy с Mac:

```bash
cd dashboard-next
npm run deploy
```

Что делает deploy теперь:

- локально выполняет `npm ci` и `npm run build`
- тянет production secrets из `/var/www/www-root/data/.production.env`
- валидирует обязательные env до upload
- загружает сборку в staging release dir на VPS
- атомарно меняет `/var/www/dashboard` на новую release-папку
- автоматически откатывает релиз, если `pm2 restart` или local health check не проходят

После deploy проверить:

```bash
ssh beget 'pm2 status'
ssh beget 'curl -s http://127.0.0.1:3001/api/health'
curl -s https://dashboards.adreports.ru/api/health
```

## Rollback

Откатить на последний backup-релиз:

```bash
cd dashboard-next
npm run deploy:rollback
```

Откатить на конкретный backup-директори:

```bash
cd dashboard-next
bash scripts/rollback-release.sh /var/www/dashboard-backups/<release-id>-previous
```

## Advertising canonical read-model gate

The advertising dashboard runtime must read actuals from canonical MySQL only. Before enabling
`AD_CANONICAL_READ_V2=1`, run the read-only comparison after migrations, import publication, and
binding preflight are complete:

```bash
cd /var/www/dashboard
npm run compare:advertising-read-model -- --from 2026-07-01 --to 2026-09-15
```

The default run checks Gidrofuril first and then every active advertising dashboard. A focused run is:

```bash
npm run compare:advertising-read-model -- --dashboard gidrofuril --from 2026-07-01 --to 2026-09-15
```

The JSON result is `ready` only when all plan, period fact, line/day fact, and dashboard/day metrics
match and no canonical campaign with facts is unbound. Each mismatch includes dashboard, line key,
date, metric, old/new values, and delta. Unbound campaign identity and account are reported separately.
The command performs no source API call, migration, write, feature-flag change, or deployment.

Cutover checklist:

1. Confirm import requests and canonical publications are successful for the requested dates.
2. Resolve binding diagnostics: no legacy binding, unbound campaign, or missing due coverage.
3. Archive the comparison JSON with `status: ready`.
4. Enable `AD_CANONICAL_READ_V2=1`, restart the app, and smoke-check screen plus Excel export.
5. Roll back by restoring the prior environment value and restarting the app if smoke differs.

## Advertising source cutover order

The app comparison is one input to the root collector's final gate. For every
source, save a sanitized comparison evidence file containing the publication
parity mismatch count and this dashboard comparison mismatch count, then run:

```bash
cd /root/reportingdash-canonical
python3 verify_advertising_rollout.py \
  --source <source-key> \
  --comparison-evidence /protected/advertising-rollout/<timestamp>/comparison-evidence.json \
  --json
```

The fixed order is Between, uploaded/Google Sheet sources, Hybrid, VK,
GetIntent, LinkedIn, Reddit, Yandex Direct, and Google Ads. Do not batch-enable
multiple source cutovers. A source is blocked by missing or failed due
coverage, parity mismatch, duplicate identity, unresolved or unbound campaign,
dashboard mismatch, missing comparison evidence, or a daily advertising
Telegram delivery not audited as `sent`.

For each ready source: enable only that source's publication cutover, enable
its V2 dashboard read, smoke Collection, Bindings, dashboard, and Excel/PDF
exports, then verify the next scheduled collector and next Telegram summary.
Only after those checks may its legacy writer/read path be disabled. The root
runbook is `docs/ADVERTISING-CANONICAL-INGESTION-RUNBOOK.md` in the collector
repository.

## SSL

Домен:

- `dashboards.adreports.ru`

Сертификат:

- Let's Encrypt

Проверка:

```bash
openssl s_client -connect dashboards.adreports.ru:443 -servername dashboards.adreports.ru </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates
```

Автообновление:

```bash
systemctl list-timers --all | grep certbot
```

## Что не трогать

Не трогать без отдельной задачи:

- root PM2 для `nest-analytics`
- cron legacy collector
- `/var/www/www-root/data/`

## Troubleshooting

### Приложение не стартует

Проверить:

```bash
pm2 status
pm2 describe dashboard-next
tail -n 200 /var/log/dashboard-next-error.log
```

### Health не отвечает

Проверить по цепочке:

```bash
curl -s http://127.0.0.1:3001/api/health
nginx -t
curl -I https://dashboards.adreports.ru/api/health
```

### После deploy открылся старый код

Проверить:

```bash
pm2 restart dashboard-next
curl -s http://127.0.0.1:3001/api/health
```

### Если кто-то снова смотрит только в systemd

Важно:

- `dashboard-next` живёт в `PM2`
- смотреть надо через `pm2`
