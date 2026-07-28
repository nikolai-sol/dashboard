# Abbott directions — процесс (stable + new pages)

## Цель

1. **Не скакать** между направлениями: что уже было задано/принято раньше — **жёсткий lock**.
2. Чем **старее** acceptance, тем **больше вес**.
3. **Новые** страницы с сайта (Metrika) → предложение направления → batch approve.

## Источники истины (по весу)

| Приоритет | Источник | Вес |
|---|---|---|
| 1 (макс) | `direction_registry.jsonl` lock, `source=workbook_initial` (seed 2020) | oldest |
| 2 | registry lock, `source=batch_approve` / human | по `approved_at` |
| 3 | Workbook `Abbott names.xlsx` (если ещё не в registry) | при seed |
| 4 | URL path / Bitrix section id | heuristic |
| 5 | Keywords | только proposal → approve |

**Запрет:** heuristic **не может** переписать locked direction.

## Файлы

| Path | Role |
|---|---|
| `out/direction_registry.jsonl` | append-only locks |
| `registry.py` | seed / lookup / lock / stats |
| `classify.py` | cascade + registry first + Metrika discover |
| `sheets_sync.py` | batch approve UI; pull → registry lock |
| `Abbott names.xlsx` | human catalog (merge target) |

## Workflow

### A) Один раз — seed старых направлений

```bash
cd agents/abbott_page_classifier
python3 registry.py seed-workbook --workbook "../../Abbott names.xlsx"
python3 registry.py stats
```

Все ненулевые направления из workbook → locks с `approved_at=2020-01-01` (максимальный вес).

### B) Регулярно (2×/week) — новые страницы сайта

```bash
python3 classify.py \
  --workbook "../../Abbott names.xlsx" \
  --from-metrika-new \
  --approve-queue-only \
  --out out/approve_pack

python3 sheets_sync.py publish \
  --classifications out/approve_pack/classifications.jsonl \
  --share nikolai.sol@gmail.com
```

Metrika source: `canonical_fact_site_analytics_daily`
counter `90602537`, scope `page`, last N days.

В очередь попадают только страницы:
- **не** locked в registry
- **не** с direction в workbook

### C) Human batch approve

1. Tab **«Апрув batch»** → `Принять batch …`
2. Опционально: Отклонить отдельные строки

### D) Pull → lock forever

```bash
python3 sheets_sync.py pull-approved --out out/approved_from_sheets.csv
```

Каждая accepted строка → `registry.lock_entity(source=batch_approve)`.
Conflict (попытка другого direction) → **не перезаписывает**, пишет conflict в result.

### E) Merge в workbook (отдельно)

`approved_from_sheets.csv` → append/update `Abbott names.xlsx` / `pages`
→ dashboard `abbott-bi.ts` enrichment без schema change.

## Анти-скачки (правила)

1. `classify_one` **сначала** `registry.lookup` → `rule=registry_lock:*`, conf=1.0
2. `registry.append` при другом direction без `human_force` → **conflict**, keep old
3. Weight = older `approved_at` wins
4. Batch re-publish **не** шлёт locked rows (`--approve-queue-only`)

## Force override (редко)

Только явно:

```python
reg.lock_entity(..., direction="...", force=True, notes="reason")
```

## Критерий успеха

- Старые направления **стабильны** после seed
- Новые URL из Metrika появляются в Sheet с proposal
- После batch accept они **locked** и больше не в queue
- Нет flip «Гастро → Кардио» от keyword noise
