# Abbott Page Direction Classifier — Design

**Date:** 2026-07-17
**Project:** ReportingDash / Abbott dashboard (page stats filters)
**Goal:** Systematically and automatically assign each ABBOTT page (and related entities) to a **направление** + **тип материала** + **доступ**, so filters on tab «3. Статистика страниц» stay complete as new content appears.

---

## Problem

Today enrichment for page stats comes from `Abbott names.xlsx` (+ URL heuristics in `abbott-bi.ts`). New pages appear on abbottpro.ru / in Metrika without labels → filters miss them or show empty «направление».

There are **two live sources** that already define direction:

| # | Source | What it maps | Strengths | Weaknesses |
|---|--------|--------------|-----------|------------|
| 1 | **Workbook** `Abbott names.xlsx` | title / slug / Bitrix id / events / general materials | Human-curated, multi-entity | Manual, drifts, ~49 pages without direction |
| 2 | **URL / Bitrix section IDs** (code + path) | path prefix (`/gastro/`, `/cardio/`, …) and section ids `262337`… | Always available for new URLs | Fails on generic paths (`/articles/…`, `/video/…`) |

Dashboard join path (current):
`yandex_metrika_internal` → enrich via workbook (title/slug/type) → fallback URL inference → page_stats filters.

---

## Canonical taxonomies

### Направление (direction) — filter values

| Label | Bitrix / filter id | URL prefixes |
|-------|--------------------|--------------|
| Гастроэнтерология [262340] | 262340 | `/gastro/` |
| Кардиология [262338] | 262338 | `/cardio/` |
| Неврология и психиатрия [262339] | 262339 | `/nevro/`, `/nevro/mental-health/` |
| Женское здоровье [262337] | 262337 | `/wh/` |
| Здоровье дыхательной системы [263746] | 263746 | `/pulmo/`, `/respiratory-assistant/` |
| Управление сахарным диабетом [620888] | 620888 | `/diabet/` |
| Фармацевты | (audience bucket, not specialty id) | `/farmatsevtam/` |
| Дерматология | (UI present; sparse in workbook) | `/dermatology/` |

Multi-label rare cases: keep as `"A / B"` string only if both explicit in source; classifier default = single primary.

### Тип материала (material type) — filter values

Aligned with UI + workbook sheets:
- Алгоритмы / Алгоритмы фармацевтического консультирования
- Видео
- Калькуляторы
- Клинические рекомендации
- Клинические случаи
- Личная эффективность
- Научно-образовательные брошюры
- Подкасты
- Препараты и продукты
- Приборы и устройства
- Проверить знания
- Респираторный помощник
- Статьи
- Таблицы
- Цифровой консультант врача
- Детское питание
- Помощник фармацевта

### Entity kinds

| kind | Source sheet / discovery | Purpose |
|------|--------------------------|---------|
| `page` | Metrika pages + workbook `pages` / type sheets | Main page_stats enrichment |
| `event` | workbook `events` + external URLs | Tab 4 external |
| `general_material` | workbook `general_materials` | Tab 6 |
| `user_id_direction` | workbook `id` | Tabs 1–2 user direction |
| `url_return` | workbook `url_return` | Tab 5 returned |

---

## Classification cascade (priority order)

For a candidate URL + optional title + optional Bitrix id:

1. **Exact workbook URL match** (`url_return`, general_materials, known full URLs)
2. **Exact title + material type** (`contentByTitleAndType`)
3. **Exact title** (`contentByTitle`)
4. **Exact slug** (last non-numeric path segment vs `Символьный код`)
5. **Bitrix section / query id** in path or query (`/video/262339`, `?section=262340`) via `ABBOTT_DIRECTION_BY_QUERY_ID`
6. **Path prefix** (`/gastro/`, `/cardio/`, …) via `ABBOTT_DIRECTION_BY_PREFIX`
7. **Material type from path prefix** (`/articles/` → Статьи, `/video/` → Видео, …)
8. **Keyword / title heuristic** (optional LLM or keyword dictionary) — only if still unknown
9. **Human review queue** if confidence < threshold

Each result stores: `direction`, `material_type`, `access`, `entity_kind`, `confidence`, `rule`, `source`.

### Confidence

| rule | confidence |
|------|------------|
| exact workbook title/slug/url | 0.95–1.0 |
| Bitrix section id | 0.9 |
| path prefix direction | 0.8 |
| material type path only | 0.75 for type, direction may be null |
| keyword / LLM | 0.5–0.7 → review if &lt; 0.75 |
| unknown | 0 → review |

---

## Agent: `abbott_page_classifier`

### Location

`ReportingDash/agents/abbott_page_classifier/`

### Inputs

- `Abbott names.xlsx` (root or `dashboard-next/public/abbott/`)
- Candidate pages:
  - from Metrika / `yandex_metrika_internal` distinct URLs (preferred in production)
  - or CSV / JSON dump for offline runs
  - or “unmatched page_stats” export from dashboard

### Outputs

- `out/classifications.jsonl` — all classified rows
- `out/review_queue.csv` — low-confidence / unknown for human
- `out/proposed_pages_rows.csv` — rows ready to append to workbook `pages`
- Optional: regenerate `dashboard-next/public/abbott/abbott-workbook.json` from updated xlsx

### Schedule

- Cron **2× per week** (e.g. Tue + Fri 07:10 after Metrika collectors)
- Mode: discover new URLs since last run → classify → write review queue → notify Telegram/reportsDash topic if review count &gt; 0

### Human loop

1. Agent proposes labels
2. Human confirms in `review_queue` or edits Google Sheet / xlsx
3. Rebuild workbook JSON used by dashboard
4. Next page_stats load picks up labels

No auto-write to production DB without confirmation in v1.

---

## Dashboard integration (filters)

Page stats already consume enrichment fields:

- filter **Тип материала** ← `material_type`
- filter **Направление** (and related specialty UI) ← `direction`
- title/URL search unchanged

After classifier proposals are merged into the workbook, existing `abbott-bi.ts` path works without schema change.

---

## Success criteria

1. New abbottpro.ru content pages get a direction + material_type within 7 days without manual spreadsheet archaeology
2. Coverage of page_stats rows with non-null direction increases week over week
3. Review queue is small and actionable (&lt; ~20 items/run after warm-up)
4. Process documented and runnable via CLI + cron

---

## Non-goals (v1)

- Auto-edit Bitrix CMS
- Full LLM-only classification without rules
- Changing Metrika collector schema
