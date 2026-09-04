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

### Одноразовый bootstrap метаданных для первого guarded rollout

Эта процедура нужна только для перехода уже активного fixed-path приложения
`/var/www/dashboard`, созданного до появления `.release-source-sha`. Скрипт не определяет commit из имени `/var/www/dashboard`.
Сначала оператор независимо устанавливает точный полный SHA по
проверенному deployment record/release-артефакту и сохраняет это доказательство в журнале изменения.
Отдельно, read-only, оператор фиксирует точный Next.js build identity активного приложения:

```bash
ssh beget 'cat /var/www/dashboard/.next/BUILD_ID'
```

Из clean candidate checkout, история которого должна содержать установленный активный commit,
выполнить:

```bash
bash scripts/bootstrap-release-source-metadata.sh <full-source-sha> <exact-active-build-id>
```

Команда принимает только 40-символьный lowercase SHA и проверяет, что он является прямым локальным commit-объектом и предком candidate `HEAD`.
Затем она получает общий lock
`/var/www/.dashboard-next-deploy.lock`, затем повторно сверяет переданный build ID с активным
`/var/www/dashboard/.next/BUILD_ID`. Только после этих проверок она атомарно публикует ровно
переданный SHA, читает его обратно и оставляет `.release-source-sha` с mode `0600`. Существующие
конфликтующие или symlink-метаданные сохраняются, а команда останавливается. У команды нет режима
обхода или замены существующей аттестации.

Зафиксировать в audit log полный SHA, build ID и успешную строку команды. После перехода обычный
deploy остаётся fail-closed и повторный bootstrap не заменяет метаданные.

Локальный deploy с Mac:

```bash
cd dashboard-next
npm run deploy
```

Что делает deploy теперь:

- обновляет `origin/main` и отклоняет dirty worktree, commit без актуального `origin/main` или
  commit без полного активного production-релиза в своей истории
- локально выполняет `npm ci`, рекурсивные тесты, typecheck, lint, public-asset check и production build
- тянет production secrets из `/var/www/www-root/data/.production.env`
- валидирует обязательные env до upload
- атомарно получает dashboard-specific lock `/var/www/.dashboard-next-deploy.lock`, повторно читает
  активный production commit и ещё раз проверяет его происхождение
- всегда использует именно `origin/main`, `/usr/bin/ssh` для реального SSH-reader активного релиза и
  фиксированный lock; `DEPLOY_REMOTE`, `DEPLOY_BASE_BRANCH`, `DEPLOY_ACTIVE_RELEASE_READER`,
  `DEPLOY_LOCK_DIR`, `DASHBOARD_DEPLOY_LOCK_DIR`, `SSH_BIN`, `DEPLOY_SSH_BIN`, `GIT_SSH`,
  `GIT_SSH_COMMAND` и `RSYNC_RSH` запрещены для production-команды
- до построения remote paths проверяет `RELEASE_ID` и все передаваемые SSH параметры по ограниченным
  allowlist-контрактам; SSH shell получает значения как экранированные позиционные аргументы
- записывает полный Git SHA в `.release-source-sha`
- загружает сборку в staging release dir на VPS
- атомарно меняет `/var/www/dashboard` на новую release-папку
- автоматически откатывает релиз, если PM2 reload, local health, listener isolation или SHA attestation
  не проходят
- после активации сверяет `.release-source-sha` и снимает lock через cleanup trap при любом исходе

Нормальные защитные остановки и восстановление:

- `HEAD does not contain current origin/main` — объединить актуальный `origin/main` с release-веткой,
  заново пройти проверки и повторить deploy.
- `HEAD does not contain active production commit <sha>` — остановиться, получить названный commit,
  объединить его с release-веткой и пересобрать кандидат. Не использовать force/bypass.
- `active fixed release ... has no trusted full-SHA metadata` — выполнить описанную выше одноразовую
  audited bootstrap-процедуру с двумя независимыми доказательствами; не записывать metadata вручную
  и не выводить commit из fixed-path имени.
- `Deployment lock is already held` — дождаться владельца из owner metadata. Если процесса deploy уже
  точно нет, оператор вручную проверяет lock и только после этого удаляет его; скрипт неизвестный lock
  автоматически не удаляет.
- Ошибка SSH во время acquire считается неоднозначной: cleanup всегда пытается снять только lock с
  token текущего запуска. Lock другого или неизвестного владельца остаётся нетронутым.
- `mandatory deploy authority override` или `Invalid RELEASE_ID`/`Invalid *_DIR` — убрать запрещённую
  переменную или исправить значение. Проверка срабатывает до первого remote action.
- `Failed to release deployment lock` — активный релиз уже мог быть успешно включён; до следующего
  deploy вручную сверить owner metadata, активный `.release-source-sha` и отсутствие процесса-владельца.

После deploy проверить:

```bash
ssh beget 'pm2 status'
ssh beget 'curl -s http://127.0.0.1:3001/api/health'
curl -s https://dashboards.adreports.ru/api/health
```

Полный SHA активного приложения:

```bash
ssh beget 'cat /var/www/dashboard/.release-source-sha'
```

## Rollback

Обе части manual rollback используют тот же фиксированный lock
`/var/www/.dashboard-next-deploy.lock`, что и deploy. При неоднозначном результате SSH acquire cleanup
пытается снять только lock с token текущего запуска; чужой или неизвестный lock сохраняется. Target и
текущий release должны иметь regular `.release-source-sha` ровно с одним полным lowercase SHA.
Metadata-less legacy backup не активируется: его нужно пересобрать как проверенный release с доверенной
full-SHA metadata, а не восстанавливать SHA из имени каталога.

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
