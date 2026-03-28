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

После deploy проверить:

```bash
ssh beget 'pm2 status'
ssh beget 'curl -s http://127.0.0.1:3001/api/health'
```

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
