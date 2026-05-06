# TODO

## Security

Ниже задачи, которые пока не применяем автоматически, потому что сервером параллельно пользуется программист и нужно менять доступ аккуратно.

- Проверить, что у второго компьютера есть рабочий SSH-ключ и отдельный доступ до отключения password auth
- Переключить SSH на `key-only auth`
- Поменять `PermitRootLogin yes` на `PermitRootLogin prohibit-password` или `no`
- Поменять `PasswordAuthentication yes` на `no`
- Проверить и при необходимости убрать переопределение из `/etc/ssh/sshd_config.d/50-cloud-init.conf`
- Перед reload `sshd` открыть вторую SSH-сессию и убедиться, что вход по ключу стабилен
- После изменений проверить `sshd -t`
- После reload проверить вход командой `ssh beget`
- Рассмотреть создание отдельного deploy-пользователя вместо постоянной работы под `root`
- Ограничить SSH-доступ по IP, если будет стабильный внешний IP у рабочих машин
- Решить вопрос с панелью ISPmanager на `:1501`: повесить нормальный домен и доверенный TLS-сертификат
- Не использовать self-signed доступ к панели для регулярной работы с чувствительными данными

## Infra

- Зафиксировать, где будет постоянно работать ETL: этот Mac или второй always-on компьютер
- Описать целевой способ запуска ETL по расписанию на второй машине
- Решить, нужен ли перенос ETL на сам VPS или оставить запуск с отдельной машины
- Зафиксировать `dashboards.adreports.ru` как временный operational-домен нового контура
- Не переносить `solgoood.ru` до полной готовности нового стека
- Подготовить отдельный migration plan для переноса `solgoood.ru` с `nic.ru` shared hosting на VPS
- После завершения сборки нового контура перевести бренд-домены `solgoood` на VPS
- Отдельно решить, нужен ли `adreports.ru` после переноса: оставить как landing для услуги dashboard или вывести из основного контура

## Dashboard

- Подключить реальные media plan URL для нужных клиентов через admin
- Пройти полный smoke-test создания дашборда через `/admin/dashboards`
- Проверить mobile UX admin-части на реальном устройстве
- Поддерживать `dashboard-next` на `https://dashboards.adreports.ru` как основной staging/integration deployment
- Добавить в admin-панель управление cron collection по платформам: отмечать, какие источники сейчас собираем по расписанию, а какие временно отключены, потому что не на всех платформах постоянно идут РК

## Data

- Проверить и документировать периодический refresh для LinkedIn и Reddit
- Добавить следующие платформы по очереди после стабилизации текущего контура
- Уточнить, какие поля нужны для video metrics по другим источникам
- `Yandex Direct`: проверить новый клиентский кабинет `porg-47e7bbnx` (`Client ID 322609311`)
  - прямой probe в `Reports API` уже делали без записи в БД
  - текущий ответ по всем нашим manager tokens: `404 / В HTTP-заголовке Client-Login указан несуществующий логин`
  - до подтверждения точного `Client-Login` / выдачи доступа не добавлять в `req_system` и не включать в cron
- `Yandex Direct`: future contour beyond reporting
  - спроектировать отдельный bidder / campaign management контур
  - уметь управлять ставками и статусами кампаний через API
  - разделить reporting-доступ и management-доступ
  - не смешивать bidder logic с текущим canonical reporting ETL
- После завершения текущей migration wave вернуться к `GetIntent v1.1`:
  - добавить `cpm`
  - добавить `cpc`
  - добавить informational `budget`
  - оценить derived `spend = impressions / 1000 * cpm`
  - не включать эти поля в legacy parity baseline
- После завершения текущей migration wave вернуться к `Hybrid v1.1`:
  - проверить documented stats endpoint `agencyStatistic/getSplit`
  - добавить canonical enrichment для `TotalSum -> spend`
  - добавить `eCPM -> cpm`
  - добавить `CPC -> cpc`
  - не включать эти поля в legacy parity baseline
