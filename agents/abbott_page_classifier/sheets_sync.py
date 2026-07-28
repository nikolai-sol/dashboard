#!/usr/bin/env python3
"""Google Sheets approval board for Abbott page direction classifier.

Workflow (batch-first):
  1) classify.py produces candidates
  2) sheets_sync.py publish → Google Sheet with:
       - tab «Апрув batch»  — one decision for the whole publish batch
       - tab «Предложения» — full table (colors, optional row overrides)
  3) Human sets «Принять batch …» on the batch tab (not every row)
  4) sheets_sync.py pull-approved → all proposed rows (minus Отклонить)

Optional row overrides on «Предложения»:
  - Статус = Отклонить / Пропустить → exclude from pull
  - Статус = Исправить + Направление → use that direction
  - empty status → included when batch is accepted

Auth: ~/.hermes/google_token.json
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

HERMES_HOME = Path.home() / ".hermes"
TOKEN_PATH = HERMES_HOME / "google_token.json"
STATE_PATH = Path(__file__).resolve().parent / "out" / "google_sheet_state.json"

DIRECTIONS = [
    "Гастроэнтерология [262340]",
    "Кардиология [262338]",
    "Неврология и психиатрия [262339]",
    "Женское здоровье [262337]",
    "Здоровье дыхательной системы [263746]",
    "Управление сахарным диабетом [620888]",
    "Фармацевты",
    "Дерматология",
    "Не относится / служебная",
    "Не определено",
    "Архив",
]

MATERIAL_TYPES = [
    "Статьи",
    "Видео",
    "Таблицы",
    "Клинические рекомендации",
    "Калькуляторы",
    "Клинические случаи",
    "Научно-образовательные брошюры",
    "Препараты и продукты",
    "Помощник фармацевта",
    "Подкасты",
    "Личная эффективность",
    "Проверить знания",
    "Алгоритмы фармацевтического консультирования",
    "Детское питание",
    "Приборы и устройства",
    "Респираторный помощник",
    "Цифровой консультант врача",
    "Мероприятия",
    "Общие материалы",
    "Архив",
]

# Optional per-row overrides only (batch decide is primary)
ROW_STATUSES = ["", "Исправить", "Отклонить", "Пропустить", "Архив"]

# Excel-like palette (matches ABBOTT_approve_directions.xlsx header/direction fills)
COLOR_HEADER_BG = {"red": 0.122, "green": 0.306, "blue": 0.475}  # #1F4E79
COLOR_HEADER_FG = {"red": 1.0, "green": 1.0, "blue": 1.0}
COLOR_PROPOSAL_BG = {"red": 0.886, "green": 0.937, "blue": 0.855}  # #E2EFDA
COLOR_NO_PROPOSAL_BG = {"red": 0.96, "green": 0.96, "blue": 0.96}
COLOR_ALT_ROW = {"red": 0.97, "green": 0.98, "blue": 0.99}
COLOR_BATCH_OK_BG = {"red": 0.78, "green": 0.90, "blue": 0.79}  # soft green
COLOR_BATCH_PENDING_BG = {"red": 1.0, "green": 0.95, "blue": 0.80}  # soft amber
COLOR_BATCH_TITLE_BG = {"red": 0.122, "green": 0.306, "blue": 0.475}

DIRECTION_COLORS: dict[str, dict[str, float]] = {
    "Гастроэнтерология [262340]": {"red": 0.78, "green": 0.90, "blue": 0.79},
    "Кардиология [262338]": {"red": 0.98, "green": 0.80, "blue": 0.80},
    "Неврология и психиатрия [262339]": {"red": 0.85, "green": 0.82, "blue": 0.95},
    "Женское здоровье [262337]": {"red": 0.98, "green": 0.85, "blue": 0.92},
    "Здоровье дыхательной системы [263746]": {"red": 0.80, "green": 0.90, "blue": 0.98},
    "Управление сахарным диабетом [620888]": {"red": 1.0, "green": 0.90, "blue": 0.75},
    "Фармацевты": {"red": 0.78, "green": 0.92, "blue": 0.92},
    "Дерматология": {"red": 0.93, "green": 0.88, "blue": 0.80},
    "Не относится / служебная": {"red": 0.90, "green": 0.90, "blue": 0.90},
    "Не определено": {"red": 0.95, "green": 0.95, "blue": 0.95},
}

HEADERS = [
    "ID",
    "Название",
    "URL",
    "Символьный код",
    "Match key",
    "Тип материала (итог)",
    "Тип (предложение)",
    "Override (опц.)",
    "Направление (итог)",
    "Направление (предложение)",
    "Статус страницы",
    "HTTP",
    "Уверенность",
    "Правило",
    "Доступ",
    "Комментарий",
    "Batch",
    "Updated at",
]

TAB_BATCH = "Апрув batch"
TAB_PROPOSALS = "Предложения"
TAB_REF = "Справочник"
TAB_SUMMARY = "Сводка"
TAB_HELP = "Как это работает"

# Keep old tab name as alias when reading
LEGACY_PROPOSALS = "На апрув"


def load_creds() -> Credentials:
    if not TOKEN_PATH.exists():
        raise SystemExit(
            f"NOT_AUTHENTICATED: {TOKEN_PATH} missing. Run Google Workspace setup first."
        )
    creds = Credentials.from_authorized_user_file(str(TOKEN_PATH))
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        TOKEN_PATH.write_text(creds.to_json())
    if not creds.valid:
        raise SystemExit("TOKEN_INVALID: re-run Google OAuth setup")
    return creds


def services():
    creds = load_creds()
    return build("sheets", "v4", credentials=creds, cache_discovery=False), build(
        "drive", "v3", credentials=creds, cache_discovery=False
    )


def load_state() -> dict[str, Any]:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {}


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2))


def load_classifications(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            rows.append(json.loads(line))
    rows.sort(
        key=lambda r: (
            0 if r.get("direction") else 1,
            -float(r.get("confidence") or 0),
            r.get("title") or "",
        )
    )
    return rows


def batch_accept_label(batch: str) -> str:
    return f"Принять batch {batch}"


def is_batch_accepted(decision: str, batch: str) -> bool:
    d = (decision or "").strip().lower()
    if not d:
        return False
    if d in {"принять", "approved", "ok", "да", "принято", "approve"}:
        return True
    # full label match (case-insensitive)
    if d == batch_accept_label(batch).lower():
        return True
    if d.startswith("принять batch") and batch.lower() in d:
        return True
    if d.startswith("принять batch"):
        return True
    return False


def create_spreadsheet(sheets, title: str) -> str:
    body = {
        "properties": {"title": title},
        "sheets": [
            {"properties": {"title": TAB_BATCH, "gridProperties": {"frozenRowCount": 0}}},
            {"properties": {"title": TAB_PROPOSALS, "gridProperties": {"frozenRowCount": 1}}},
            {"properties": {"title": TAB_SUMMARY}},
            {"properties": {"title": TAB_REF}},
            {"properties": {"title": TAB_HELP}},
        ],
    }
    created = (
        sheets.spreadsheets()
        .create(body=body, fields="spreadsheetId,spreadsheetUrl")
        .execute()
    )
    return created["spreadsheetId"]


def get_sheet_ids(sheets, spreadsheet_id: str) -> dict[str, int]:
    meta = sheets.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    return {s["properties"]["title"]: s["properties"]["sheetId"] for s in meta["sheets"]}


def ensure_tabs(sheets, spreadsheet_id: str) -> dict[str, int]:
    """Create missing tabs / rename legacy «На апрув» → «Предложения»."""
    ids = get_sheet_ids(sheets, spreadsheet_id)
    requests: list[dict[str, Any]] = []

    if LEGACY_PROPOSALS in ids and TAB_PROPOSALS not in ids:
        requests.append(
            {
                "updateSheetProperties": {
                    "properties": {"sheetId": ids[LEGACY_PROPOSALS], "title": TAB_PROPOSALS},
                    "fields": "title",
                }
            }
        )

    # refresh after possible rename
    if requests:
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id, body={"requests": requests}
        ).execute()
        ids = get_sheet_ids(sheets, spreadsheet_id)
        requests = []

    needed = [TAB_BATCH, TAB_PROPOSALS, TAB_SUMMARY, TAB_REF, TAB_HELP]
    for title in needed:
        if title not in ids:
            requests.append({"addSheet": {"properties": {"title": title}}})

    if requests:
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id, body={"requests": requests}
        ).execute()
        ids = get_sheet_ids(sheets, spreadsheet_id)

    # Put batch tab first
    if TAB_BATCH in ids:
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={
                "requests": [
                    {
                        "updateSheetProperties": {
                            "properties": {"sheetId": ids[TAB_BATCH], "index": 0},
                            "fields": "index",
                        }
                    }
                ]
            },
        ).execute()
        ids = get_sheet_ids(sheets, spreadsheet_id)

    return ids


def write_reference_and_help(sheets, spreadsheet_id: str, batch: str, n_total: int, n_prop: int) -> None:
    values = [["Направления", "Типы материала", "Override (опц.)", "Статус страницы"]]
    page_statuses = ["active", "Архив"]
    overrides = ["Исправить", "Отклонить", "Пропустить", "Архив"]
    max_len = max(len(DIRECTIONS), len(MATERIAL_TYPES), len(overrides), len(page_statuses))
    for i in range(max_len):
        values.append(
            [
                DIRECTIONS[i] if i < len(DIRECTIONS) else "",
                MATERIAL_TYPES[i] if i < len(MATERIAL_TYPES) else "",
                overrides[i] if i < len(overrides) else "",
                page_statuses[i] if i < len(page_statuses) else "",
            ]
        )
    sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"{TAB_REF}!A1",
        valueInputOption="RAW",
        body={"values": values},
    ).execute()

    accept = batch_accept_label(batch)
    help_rows = [
        ["Abbott — согласование направлений + тип материала (batch)"],
        [""],
        ["Главное:"],
        [f"1. Открой вкладку «{TAB_BATCH}»."],
        [f"2. В ячейке «Решение» выбери: {accept}"],
        ["3. Это фиксирует, что предложения этого batch приняты целиком."],
        ["4. pull-approved заберёт строки с направлением и/или статусом Архив."],
        [""],
        ["Матч:"],
        ["• Колонка Match key = title|slug|url — ключ для merge в справочник."],
        ["• Тип материала (итог) — dropdown из справочника; правка = матч типа."],
        ["• Направление (итог) — dropdown; правка = матч направления."],
        [""],
        ["404 / мёртвые страницы:"],
        ["• HTTP 404/410 → Статус страницы = Архив, Тип = Архив (авто)."],
        ["• Override = Архив — вручную пометить строку архивной."],
        [""],
        ["Опционально:"],
        [f"• На «{TAB_PROPOSALS}» Отклонить/Пропустить отдельные строки."],
        ["• Исправить + другое направление/тип."],
        [""],
        [f"Текущий batch: {batch}"],
        [f"Всего строк: {n_total}, с предложением направления: {n_prop}"],
        [f"Обновлено: {datetime.now(timezone.utc).isoformat()}"],
    ]
    sheets.spreadsheets().values().clear(spreadsheetId=spreadsheet_id, range=TAB_HELP).execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"{TAB_HELP}!A1",
        valueInputOption="RAW",
        body={"values": help_rows},
    ).execute()


def write_batch_tab(
    sheets,
    spreadsheet_id: str,
    sheet_id: int,
    batch: str,
    n_total: int,
    n_prop: int,
    n_no: int,
    by_direction: list[tuple[str, int]],
) -> None:
    accept = batch_accept_label(batch)
    reject = f"Отклонить batch {batch}"
    # Preserve previous decision if same batch already set
    existing = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=spreadsheet_id, range=f"{TAB_BATCH}!B10")
        .execute()
        .get("values")
        or []
    )
    prev_decision = existing[0][0] if existing and existing[0] else ""
    # If batch id in previous accept label matches, keep; else reset pending
    if prev_decision and batch in prev_decision and prev_decision.startswith("Принять"):
        decision = prev_decision
    elif prev_decision and batch in str(prev_decision):
        decision = prev_decision
    else:
        decision = "— ожидает решения —"

    published = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    rows = [
        ["ABBOTT — ПРИНЯТЬ BATCH"],
        [""],
        ["Инструкция", "Не подтверждай каждую строку. Прими batch целиком."],
        ["Batch ID", batch],
        ["Опубликовано (UTC)", published],
        ["Строк всего", n_total],
        ["С предложением агента", n_prop],
        ["Без предложения (manual later)", n_no],
        [""],
        ["РЕШЕНИЕ ↓", decision],
        ["", f"Выбери из списка: «{accept}»"],
        [""],
        ["После выбора «Принять batch …» агент pull-approved заберёт все предложения."],
        ["Отдельные исключения — только на вкладке «Предложения» (Отклонить / Исправить)."],
        [""],
        ["Разбивка по направлениям", "Кол-во"],
    ] + [[k, v] for k, v in by_direction]

    sheets.spreadsheets().values().clear(spreadsheetId=spreadsheet_id, range=TAB_BATCH).execute()
    clear_conditional_formats(sheets, spreadsheet_id, sheet_id)
    sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"{TAB_BATCH}!A1",
        valueInputOption="USER_ENTERED",
        body={"values": rows},
    ).execute()

    # Formatting + dropdown on B10
    requests: list[dict[str, Any]] = [
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": 2,
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": COLOR_BATCH_TITLE_BG,
                        "textFormat": {
                            "foregroundColor": COLOR_HEADER_FG,
                            "bold": True,
                            "fontSize": 14,
                        },
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat)",
            }
        },
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 9,
                    "endRowIndex": 10,
                    "startColumnIndex": 0,
                    "endColumnIndex": 2,
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": COLOR_BATCH_PENDING_BG,
                        "textFormat": {"bold": True, "fontSize": 12},
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat)",
            }
        },
        {
            "setDataValidation": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 9,
                    "endRowIndex": 10,
                    "startColumnIndex": 1,
                    "endColumnIndex": 2,
                },
                "rule": {
                    "condition": {
                        "type": "ONE_OF_LIST",
                        "values": [
                            {"userEnteredValue": "— ожидает решения —"},
                            {"userEnteredValue": accept},
                            {"userEnteredValue": reject},
                        ],
                    },
                    "showCustomUi": True,
                    "strict": True,
                },
            }
        },
        {
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": 0,
                    "endIndex": 1,
                },
                "properties": {"pixelSize": 280},
                "fields": "pixelSize",
            }
        },
        {
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": 1,
                    "endIndex": 2,
                },
                "properties": {"pixelSize": 420},
                "fields": "pixelSize",
            }
        },
        # Conditional: green when starts with Принять
        {
            "addConditionalFormatRule": {
                "rule": {
                    "ranges": [
                        {
                            "sheetId": sheet_id,
                            "startRowIndex": 9,
                            "endRowIndex": 10,
                            "startColumnIndex": 1,
                            "endColumnIndex": 2,
                        }
                    ],
                    "booleanRule": {
                        "condition": {
                            "type": "TEXT_STARTS_WITH",
                            "values": [{"userEnteredValue": "Принять"}],
                        },
                        "format": {
                            "backgroundColor": COLOR_BATCH_OK_BG,
                            "textFormat": {"bold": True},
                        },
                    },
                },
                "index": 0,
            }
        },
        {
            "addConditionalFormatRule": {
                "rule": {
                    "ranges": [
                        {
                            "sheetId": sheet_id,
                            "startRowIndex": 9,
                            "endRowIndex": 10,
                            "startColumnIndex": 1,
                            "endColumnIndex": 2,
                        }
                    ],
                    "booleanRule": {
                        "condition": {
                            "type": "TEXT_STARTS_WITH",
                            "values": [{"userEnteredValue": "Отклонить"}],
                        },
                        "format": {
                            "backgroundColor": {"red": 0.96, "green": 0.80, "blue": 0.80},
                            "textFormat": {"bold": True},
                        },
                    },
                },
                "index": 1,
            }
        },
    ]
    sheets.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id, body={"requests": requests}
    ).execute()


def clear_conditional_formats(sheets, spreadsheet_id: str, sheet_id: int) -> None:
    """Remove all conditional format rules on a sheet (idempotent republish)."""
    meta = sheets.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields="sheets(properties(sheetId),conditionalFormats)",
    ).execute()
    for s in meta.get("sheets", []):
        if s.get("properties", {}).get("sheetId") != sheet_id:
            continue
        n = len(s.get("conditionalFormats") or [])
        if not n:
            return
        reqs = [
            {"deleteConditionalFormatRule": {"sheetId": sheet_id, "index": i}}
            for i in range(n - 1, -1, -1)
        ]
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id, body={"requests": reqs}
        ).execute()
        return


def format_proposals_sheet(
    sheets,
    spreadsheet_id: str,
    sheet_id: int,
    n_data_rows: int,
) -> None:
    """Header + conditional colors like Excel approve pack."""
    clear_conditional_formats(sheets, spreadsheet_id, sheet_id)
    last = n_data_rows + 1  # including header
    requests: list[dict[str, Any]] = [
        # clear old conditional rules by replacing sheet format carefully — add new rules
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": len(HEADERS),
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": COLOR_HEADER_BG,
                        "horizontalAlignment": "CENTER",
                        "textFormat": {
                            "foregroundColor": COLOR_HEADER_FG,
                            "bold": True,
                            "fontSize": 10,
                        },
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
            }
        },
        {
            "updateSheetProperties": {
                "properties": {
                    "sheetId": sheet_id,
                    "gridProperties": {"frozenRowCount": 1},
                },
                "fields": "gridProperties.frozenRowCount",
            }
        },
        # freeze first 2 cols
        {
            "updateSheetProperties": {
                "properties": {
                    "sheetId": sheet_id,
                    "gridProperties": {"frozenColumnCount": 2},
                },
                "fields": "gridProperties.frozenColumnCount",
            }
        },
        # column widths
        {
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": 1,
                    "endIndex": 2,
                },
                "properties": {"pixelSize": 280},
                "fields": "pixelSize",
            }
        },
        {
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": 2,
                    "endIndex": 3,
                },
                "properties": {"pixelSize": 320},
                "fields": "pixelSize",
            }
        },
        # column widths for type + direction finals
        {
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": 5,
                    "endIndex": 10,
                },
                "properties": {"pixelSize": 220},
                "fields": "pixelSize",
            }
        },
        # material type final col F (index 5)
        {
            "setDataValidation": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 1,
                    "endRowIndex": last,
                    "startColumnIndex": 5,
                    "endColumnIndex": 6,
                },
                "rule": {
                    "condition": {
                        "type": "ONE_OF_LIST",
                        "values": [{"userEnteredValue": m} for m in MATERIAL_TYPES],
                    },
                    "showCustomUi": True,
                    "strict": False,
                },
            }
        },
        # dropdown override col H (index 7)
        {
            "setDataValidation": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 1,
                    "endRowIndex": last,
                    "startColumnIndex": 7,
                    "endColumnIndex": 8,
                },
                "rule": {
                    "condition": {
                        "type": "ONE_OF_LIST",
                        "values": [
                            {"userEnteredValue": s}
                            for s in ["Исправить", "Отклонить", "Пропустить", "Архив"]
                        ],
                    },
                    "showCustomUi": True,
                    "strict": False,
                },
            }
        },
        # dropdown direction col I (index 8)
        {
            "setDataValidation": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 1,
                    "endRowIndex": last,
                    "startColumnIndex": 8,
                    "endColumnIndex": 9,
                },
                "rule": {
                    "condition": {
                        "type": "ONE_OF_LIST",
                        "values": [{"userEnteredValue": d} for d in DIRECTIONS],
                    },
                    "showCustomUi": True,
                    "strict": False,
                },
            }
        },
        # page status col K (index 10)
        {
            "setDataValidation": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 1,
                    "endRowIndex": last,
                    "startColumnIndex": 10,
                    "endColumnIndex": 11,
                },
                "rule": {
                    "condition": {
                        "type": "ONE_OF_LIST",
                        "values": [
                            {"userEnteredValue": "active"},
                            {"userEnteredValue": "Архив"},
                        ],
                    },
                    "showCustomUi": True,
                    "strict": False,
                },
            }
        },
    ]

    # Color direction proposal columns when non-empty (J = col 10)
    requests.append(
        {
            "addConditionalFormatRule": {
                "rule": {
                    "ranges": [
                        {
                            "sheetId": sheet_id,
                            "startRowIndex": 1,
                            "endRowIndex": last,
                            "startColumnIndex": 8,
                            "endColumnIndex": 10,
                        }
                    ],
                    "booleanRule": {
                        "condition": {
                            "type": "CUSTOM_FORMULA",
                            "values": [{"userEnteredValue": '=LEN($J2)>0'}],
                        },
                        "format": {"backgroundColor": COLOR_PROPOSAL_BG},
                    },
                },
                "index": 0,
            }
        }
    )
    # Archive rows: gray whole row when status = Архив (col K)
    requests.append(
        {
            "addConditionalFormatRule": {
                "rule": {
                    "ranges": [
                        {
                            "sheetId": sheet_id,
                            "startRowIndex": 1,
                            "endRowIndex": last,
                            "startColumnIndex": 0,
                            "endColumnIndex": len(HEADERS),
                        }
                    ],
                    "booleanRule": {
                        "condition": {
                            "type": "CUSTOM_FORMULA",
                            "values": [{"userEnteredValue": '=$K2="Архив"'}],
                        },
                        "format": {"backgroundColor": COLOR_NO_PROPOSAL_BG},
                    },
                },
                "index": 0,
            }
        }
    )
    # No proposal: gray whole row when J empty and not archive
    requests.append(
        {
            "addConditionalFormatRule": {
                "rule": {
                    "ranges": [
                        {
                            "sheetId": sheet_id,
                            "startRowIndex": 1,
                            "endRowIndex": last,
                            "startColumnIndex": 0,
                            "endColumnIndex": len(HEADERS),
                        }
                    ],
                    "booleanRule": {
                        "condition": {
                            "type": "CUSTOM_FORMULA",
                            "values": [{"userEnteredValue": '=AND(LEN($J2)=0,$K2<>"Архив")'}],
                        },
                        "format": {"backgroundColor": COLOR_NO_PROPOSAL_BG},
                    },
                },
                "index": 1,
            }
        }
    )
    # Direction-specific colors on column G
    for i, (direction, color) in enumerate(DIRECTION_COLORS.items()):
        requests.append(
            {
                "addConditionalFormatRule": {
                    "rule": {
                        "ranges": [
                            {
                                "sheetId": sheet_id,
                                "startRowIndex": 1,
                                "endRowIndex": last,
                                "startColumnIndex": 8,
                                "endColumnIndex": 9,
                            }
                        ],
                        "booleanRule": {
                            "condition": {
                                "type": "TEXT_EQ",
                                "values": [{"userEnteredValue": direction}],
                            },
                            "format": {"backgroundColor": color, "textFormat": {"bold": True}},
                        },
                    },
                    "index": 2 + i,
                }
            }
        )
    # Override Отклонить → red tint on F
    requests.append(
        {
            "addConditionalFormatRule": {
                "rule": {
                    "ranges": [
                        {
                            "sheetId": sheet_id,
                            "startRowIndex": 1,
                            "endRowIndex": last,
                            "startColumnIndex": 5,
                            "endColumnIndex": 6,
                        }
                    ],
                    "booleanRule": {
                        "condition": {
                            "type": "TEXT_EQ",
                            "values": [{"userEnteredValue": "Отклонить"}],
                        },
                        "format": {
                            "backgroundColor": {"red": 0.96, "green": 0.75, "blue": 0.75},
                            "textFormat": {"bold": True},
                        },
                    },
                },
                "index": 20,
            }
        }
    )
    requests.append(
        {
            "addConditionalFormatRule": {
                "rule": {
                    "ranges": [
                        {
                            "sheetId": sheet_id,
                            "startRowIndex": 1,
                            "endRowIndex": last,
                            "startColumnIndex": 5,
                            "endColumnIndex": 6,
                        }
                    ],
                    "booleanRule": {
                        "condition": {
                            "type": "TEXT_EQ",
                            "values": [{"userEnteredValue": "Исправить"}],
                        },
                        "format": {
                            "backgroundColor": {"red": 1.0, "green": 0.92, "blue": 0.70},
                            "textFormat": {"bold": True},
                        },
                    },
                },
                "index": 21,
            }
        }
    )
    # Confidence high >= 0.7 green on I
    requests.append(
        {
            "addConditionalFormatRule": {
                "rule": {
                    "ranges": [
                        {
                            "sheetId": sheet_id,
                            "startRowIndex": 1,
                            "endRowIndex": last,
                            "startColumnIndex": 8,
                            "endColumnIndex": 9,
                        }
                    ],
                    "booleanRule": {
                        "condition": {
                            "type": "NUMBER_GREATER_THAN_EQ",
                            "values": [{"userEnteredValue": "0.7"}],
                        },
                        "format": {
                            "backgroundColor": {"red": 0.75, "green": 0.90, "blue": 0.75},
                        },
                    },
                },
                "index": 22,
            }
        }
    )

    sheets.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id, body={"requests": requests}
    ).execute()


def publish(
    classifications_path: Path,
    title: str | None = None,
    spreadsheet_id: str | None = None,
) -> dict[str, Any]:
    sheets, _drive = services()
    state = load_state()
    sid = spreadsheet_id or state.get("spreadsheet_id")
    batch = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    sheet_title = title or f"Abbott — апрув направлений ({datetime.now().strftime('%Y-%m-%d')})"

    if not sid:
        sid = create_spreadsheet(sheets, sheet_title)

    ids = ensure_tabs(sheets, sid)
    rows = load_classifications(classifications_path)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
    n_prop = sum(1 for r in rows if r.get("direction"))
    n_no = len(rows) - n_prop
    by_dir = Counter(r.get("direction") or "— нет —" for r in rows).most_common()

    values = [HEADERS]
    for i, r in enumerate(rows, 1):
        prop_dir = r.get("direction") or ""
        prop_mat = r.get("material_type") or ""
        page_status = r.get("page_status") or "active"
        title = r.get("title") or ""
        slug = r.get("slug") or ""
        url = r.get("url") or ""
        match_key = "|".join(x for x in [title, slug, url] if x)
        values.append(
            [
                str(i),
                title,
                url,
                slug,
                match_key,
                prop_mat,  # final type prefilled
                prop_mat,  # type proposal
                "Архив" if page_status == "Архив" else "",  # override hint
                prop_dir,  # final direction
                prop_dir,  # direction proposal
                page_status,
                str(r.get("http_status") or ""),
                str(r.get("confidence") or 0),
                r.get("rule") or "",
                r.get("access") or "",
                r.get("notes") or "",
                batch,
                now,
            ]
        )

    # Write proposals
    sheets.spreadsheets().values().clear(
        spreadsheetId=sid, range=TAB_PROPOSALS
    ).execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=sid,
        range=f"{TAB_PROPOSALS}!A1",
        valueInputOption="USER_ENTERED",
        body={"values": values},
    ).execute()

    format_proposals_sheet(sheets, sid, ids[TAB_PROPOSALS], len(rows))

    # Summary
    summary = [
        ["Сводка", ""],
        ["Batch", batch],
        ["Всего", len(rows)],
        ["С предложением", n_prop],
        ["Без предложения", n_no],
        ["Решение batch", f"см. вкладку «{TAB_BATCH}» → ячейка B10"],
        [""],
        ["Направление", "Кол-во"],
    ] + [[k, v] for k, v in by_dir]
    sheets.spreadsheets().values().clear(spreadsheetId=sid, range=TAB_SUMMARY).execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=sid,
        range=f"{TAB_SUMMARY}!A1",
        valueInputOption="RAW",
        body={"values": summary},
    ).execute()

    write_batch_tab(
        sheets,
        sid,
        ids[TAB_BATCH],
        batch,
        len(rows),
        n_prop,
        n_no,
        by_dir,
    )
    write_reference_and_help(sheets, sid, batch, len(rows), n_prop)

    url = f"https://docs.google.com/spreadsheets/d/{sid}/edit"
    state.update(
        {
            "spreadsheet_id": sid,
            "spreadsheet_url": url,
            "last_publish_batch": batch,
            "last_publish_count": len(rows),
            "last_publish_with_proposal": n_prop,
            "approval_mode": "batch",
            "batch_decision_cell": f"{TAB_BATCH}!B10",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    save_state(state)
    return {
        "spreadsheet_id": sid,
        "url": url,
        "rows": len(rows),
        "with_proposal": n_prop,
        "batch": batch,
        "batch_accept_label": batch_accept_label(batch),
        "batch_tab": TAB_BATCH,
    }


def _cell(row: list[str], idx: dict[str, int], name: str) -> str:
    i = idx.get(name)
    if i is None or i >= len(row):
        return ""
    return str(row[i]).strip()


def pull_approved(out_csv: Path, spreadsheet_id: str | None = None) -> dict[str, Any]:
    sheets, _ = services()
    state = load_state()
    sid = spreadsheet_id or state.get("spreadsheet_id")
    if not sid:
        raise SystemExit("No spreadsheet_id. Publish first or pass --spreadsheet-id")

    # Batch decision
    batch_meta = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=sid, range=f"{TAB_BATCH}!A1:B20")
        .execute()
        .get("values")
        or []
    )
    batch_id = ""
    decision = ""
    for row in batch_meta:
        if not row:
            continue
        key = str(row[0]).strip() if len(row) > 0 else ""
        val = str(row[1]).strip() if len(row) > 1 else ""
        if key == "Batch ID":
            batch_id = val
        if key.startswith("РЕШЕНИЕ"):
            decision = val

    if not is_batch_accepted(decision, batch_id):
        raise SystemExit(
            "BATCH_NOT_ACCEPTED: on tab «Апрув batch» set B10 to "
            f"«{batch_accept_label(batch_id or state.get('last_publish_batch', '…'))}». "
            f"Current decision={decision!r}"
        )

    # Proposals table (support legacy name)
    ids = get_sheet_ids(sheets, sid)
    proposals_title = TAB_PROPOSALS if TAB_PROPOSALS in ids else LEGACY_PROPOSALS
    result = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=sid, range=f"{proposals_title}!A1:R")
        .execute()
    )
    values = result.get("values") or []
    if not values:
        raise SystemExit("Proposals sheet empty")

    header = values[0]
    idx = {name: i for i, name in enumerate(header)}

    # Support old header «Статус»
    override_key = "Override (опц.)" if "Override (опц.)" in idx else "Статус"
    direction_key = (
        "Направление (итог)"
        if "Направление (итог)" in idx
        else "Направление (выбери)"
    )
    dir_prop_key = (
        "Направление (предложение)"
        if "Направление (предложение)" in idx
        else "Предложение агента"
    )
    mat_key = (
        "Тип материала (итог)"
        if "Тип материала (итог)" in idx
        else "Тип материала"
    )
    mat_prop_key = "Тип (предложение)" if "Тип (предложение)" in idx else mat_key
    status_key = "Статус страницы" if "Статус страницы" in idx else ""

    approved: list[dict[str, str]] = []
    skipped = 0
    archives = 0
    for row in values[1:]:
        override = _cell(row, idx, override_key).lower()
        if override in {"отклонить", "пропустить", "skip", "reject"}:
            skipped += 1
            continue

        page_status = _cell(row, idx, status_key) if status_key else "active"
        if override in {"архив", "archive"}:
            page_status = "Архив"

        direction = _cell(row, idx, direction_key) or _cell(row, idx, dir_prop_key)
        material = _cell(row, idx, mat_key) or _cell(row, idx, mat_prop_key)
        if page_status == "Архив":
            material = material or "Архив"
            archives += 1
        elif not direction or direction == "Не определено":
            skipped += 1
            continue
        elif not _cell(row, idx, dir_prop_key) and override not in {"исправить", "fix"}:
            if not _cell(row, idx, direction_key):
                skipped += 1
                continue

        approved.append(
            {
                "title": _cell(row, idx, "Название"),
                "url": _cell(row, idx, "URL"),
                "slug": _cell(row, idx, "Символьный код"),
                "match_key": _cell(row, idx, "Match key"),
                "material_type": material,
                "direction": direction if page_status != "Архив" else (direction or "Архив"),
                "page_status": page_status or "active",
                "http_status": _cell(row, idx, "HTTP"),
                "access": _cell(row, idx, "Доступ"),
                "status": f"batch:{decision}",
                "comment": _cell(row, idx, "Комментарий"),
                "confidence": _cell(row, idx, "Уверенность"),
                "rule": _cell(row, idx, "Правило"),
                "batch": batch_id or _cell(row, idx, "Batch"),
            }
        )

    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with out_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "title",
                "slug",
                "match_key",
                "direction",
                "access",
                "material_type",
                "page_status",
                "http_status",
                "url",
                "status",
                "comment",
                "confidence",
                "rule",
                "batch",
            ],
        )
        w.writeheader()
        w.writerows(approved)

    # Stamp acceptance time on batch tab
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    sheets.spreadsheets().values().update(
        spreadsheetId=sid,
        range=f"{TAB_BATCH}!A22",
        valueInputOption="RAW",
        body={
            "values": [
                ["Зафиксировано pull-approved", stamp],
                ["Строк выгружено", len(approved)],
                ["Пропущено / без направления", skipped],
                ["Архив", archives],
            ]
        },
    ).execute()

    state["last_pull_at"] = datetime.now(timezone.utc).isoformat()
    state["last_pull_count"] = len(approved)
    state["last_pull_batch"] = batch_id
    state["last_pull_decision"] = decision
    save_state(state)

    # Lock accepted directions in stable registry (older locks never flip)
    registry_result: dict[str, Any] = {"locked": 0, "conflicts": 0, "errors": []}
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from registry import DirectionRegistry

        reg = DirectionRegistry()
        for r in approved:
            res_list = reg.lock_entity(
                direction=r["direction"],
                url=r.get("url") or "",
                slug=r.get("slug") or "",
                title=r.get("title") or "",
                material_type=r.get("material_type") or None,
                access=r.get("access") or None,
                source="batch_approve",
                batch=batch_id or r.get("batch") or "",
                notes=f"pull-approved page_status={r.get('page_status')}",
            )
            for res in res_list:
                if res.get("status") == "ok":
                    registry_result["locked"] += 1
                elif res.get("status") == "conflict":
                    registry_result["conflicts"] += 1
        registry_result["stats"] = reg.stats()
    except Exception as exc:  # noqa: BLE001
        registry_result["errors"].append(str(exc))

    return {
        "spreadsheet_id": sid,
        "url": state.get("spreadsheet_url")
        or f"https://docs.google.com/spreadsheets/d/{sid}/edit",
        "batch": batch_id,
        "decision": decision,
        "approved_count": len(approved),
        "skipped": skipped,
        "archives": archives,
        "out_csv": str(out_csv),
        "registry": registry_result,
    }


def share_with_user(
    email: str, spreadsheet_id: str | None = None, role: str = "writer"
) -> dict[str, Any]:
    _, drive = services()
    state = load_state()
    sid = spreadsheet_id or state.get("spreadsheet_id")
    if not sid:
        raise SystemExit("No spreadsheet_id")
    body = {"type": "user", "role": role, "emailAddress": email}
    drive.permissions().create(
        fileId=sid,
        body=body,
        sendNotificationEmail=True,
        emailMessage=(
            "Abbott: апрув направлений. Открой вкладку «Апрув batch» и выбери "
            "«Принять batch …» — не каждую строку."
        ),
    ).execute()
    return {"shared_with": email, "role": role, "spreadsheet_id": sid}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Abbott approval Google Sheet sync (batch mode)")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_pub = sub.add_parser("publish", help="Create/update Google Sheet with candidates")
    p_pub.add_argument(
        "--classifications",
        type=Path,
        default=Path(__file__).resolve().parent
        / "out"
        / "approve_pack"
        / "classifications.jsonl",
    )
    p_pub.add_argument("--title", default=None)
    p_pub.add_argument("--spreadsheet-id", default=None)
    p_pub.add_argument("--share", default=None, help="Email to share writer access with")

    p_pull = sub.add_parser(
        "pull-approved",
        help="Pull all proposals if batch accepted on «Апрув batch»",
    )
    p_pull.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent / "out" / "approved_from_sheets.csv",
    )
    p_pull.add_argument("--spreadsheet-id", default=None)

    p_share = sub.add_parser("share", help="Share existing sheet with email")
    p_share.add_argument("--email", required=True)
    p_share.add_argument("--spreadsheet-id", default=None)

    p_state = sub.add_parser("state", help="Show current sheet state")

    args = p.parse_args(argv)

    if args.cmd == "publish":
        info = publish(
            args.classifications, title=args.title, spreadsheet_id=args.spreadsheet_id
        )
        if args.share:
            try:
                info["share"] = share_with_user(
                    args.share, spreadsheet_id=info["spreadsheet_id"]
                )
            except Exception as e:  # noqa: BLE001
                info["share_error"] = str(e)
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return 0

    if args.cmd == "pull-approved":
        info = pull_approved(args.out, spreadsheet_id=args.spreadsheet_id)
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return 0

    if args.cmd == "share":
        info = share_with_user(args.email, spreadsheet_id=args.spreadsheet_id)
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return 0

    if args.cmd == "state":
        print(json.dumps(load_state(), ensure_ascii=False, indent=2))
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
