# Abbott Page Classifier Agent

## Purpose
Automatically classify ABBOTT portal pages by **направление** / **тип материала** and get human approval in **Google Sheets** — **one decision per batch**, not per row.

## Approval loop (batch)

```
classify → publish to Google Sheet
         → human on tab «Апрув batch» chooses «Принять batch YYYY-MM-DD HH:MM UTC»
         → pull-approved → all rows with a direction (minus Отклонить)
         → merge into Abbott names.xlsx → dashboard filters
```

### Commands

```bash
cd /Users/nafanya/ReportingDash/agents/abbott_page_classifier

# 1) Classify gaps / candidates
python3 classify.py --from-workbook-gaps --out out/approve_pack

# 2) Publish / refresh Google Sheet (colors + batch tab)
python3 sheets_sync.py publish \
  --classifications out/approve_pack/classifications.jsonl \
  --share nikolai.sol@gmail.com

# 3) After batch accept on tab «Апрув batch»:
python3 sheets_sync.py pull-approved --out out/approved_from_sheets.csv

# Show current sheet id/url
python3 sheets_sync.py state
```

### Sheet tabs

| Tab | Role |
|---|---|
| **Апрув batch** | One dropdown: `Принять batch …` / `Отклонить batch …` |
| **Предложения** | Full table (Excel-like colors). Override only if needed |
| **Сводка** | Counts |
| **Справочник** | Directions list |
| **Как это работает** | Help |

### Batch decision (primary)
Cell **B10** on «Апрув batch»:
- `Принять batch 2026-07-17 11:08 UTC` → pull takes **all** rows with a direction
- `Отклонить batch …` → pull refuses

### Optional row overrides on «Предложения»
- empty → included when batch accepted
- **Отклонить** / **Пропустить** → excluded
- **Исправить** + direction in column G → use that direction

### Colors (Excel-like)
- Header dark blue `#1F4E79` + white bold
- Proposal columns green `#E2EFDA` when agent suggested a direction
- Rows without proposal — gray
- Direction column — per-specialty color (gastro green, cardio red, neuro purple, …)
- High confidence ≥ 0.7 — green on confidence cell
- Batch decision cell: amber pending → green when «Принять…»

## Local fallback
`ABBOTT_approve_directions.xlsx` still works offline.

## Auth
Uses Hermes Google OAuth for project **`hermes-reportsdash`**.

| File | Purpose |
|---|---|
| `~/.hermes/google_client_secret.json` | Desktop OAuth client (Hermes runtime) |
| `ReportingDash/.secrets/google_oauth_client.json` | Project-local copy (gitignored via `.secrets/`) |
| `~/.hermes/google_token.json` | User token after browser consent (required by `sheets_sync.py`) |

GCP: enable **Google Sheets API** + **Google Drive API**. Consent screen in **Testing** → add the login account as **Test user**.
