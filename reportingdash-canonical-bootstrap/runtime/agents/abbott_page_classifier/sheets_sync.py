#!/usr/bin/env python3
"""Database-backed Google Sheets review projection for Abbott content.

``persist_and_publish_batch`` persists the canonical batch and every item before
the first gateway write. ``read_accepted_projection`` validates and hashes the
complete mutable decision snapshot; only ``ready`` rows are approval-eligible.
The direct legacy CLI is permanently fail-closed: ``workflow.py
publish-projection`` is the only operator Sheet-writing command.

Google authentication remains operator-only at ``~/.hermes/google_token.json``.
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass, replace
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from enum import Enum
from hashlib import sha256
from pathlib import Path
from typing import Any, Mapping, Protocol, Sequence

# Preserve the documented direct-script operator entrypoint.  Authentication and
# all Google service creation remain below in the existing operator-only path.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from agents.abbott_page_classifier.batch_service import (
    BuiltApprovalBatch,
    PersistedApprovalBatch,
    compute_accepted_decision_hash,
    compute_batch_hash,
    persist_batch,
)
from agents.abbott_page_classifier.domain import (
    AcceptedBatchSnapshot,
    ApprovalBatch,
    ApprovalItem,
)

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
TAB_CONFLICTS = "Конфликты"
TAB_UNRESOLVED = "Не определено"
TAB_HISTORY = "История"
TAB_REF = "Справочники"
TAB_SUMMARY = "Сводка"
TAB_HELP = "Как это работает"

APPROVAL_TAB_TITLES = (
    TAB_BATCH,
    TAB_PROPOSALS,
    TAB_CONFLICTS,
    TAB_UNRESOLVED,
    TAB_HISTORY,
    TAB_REF,
    TAB_SUMMARY,
    TAB_HELP,
)

# Keep old tab name as alias when reading
LEGACY_PROPOSALS = "На апрув"


def load_creds() -> Any:
    # Google dependencies and credentials are operator-only.  Keeping these imports
    # inside the live adapter lets fake-gateway tests run without an SDK or network.
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

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
    from googleapiclient.discovery import build

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
            {
                "properties": {
                    "title": tab_title,
                    "gridProperties": {
                        "frozenRowCount": 1 if tab_title == TAB_PROPOSALS else 0
                    },
                }
            }
            for tab_title in APPROVAL_TAB_TITLES
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

    needed = list(APPROVAL_TAB_TITLES)
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
        range=a1_range(TAB_REF, "A1"),
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
    sheets.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id, range=a1_range(TAB_HELP, "A:ZZZ")
    ).execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=a1_range(TAB_HELP, "A1"),
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
        .get(spreadsheetId=spreadsheet_id, range=a1_range(TAB_BATCH, "B10"))
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

    sheets.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id, range=a1_range(TAB_BATCH, "A:ZZZ")
    ).execute()
    clear_conditional_formats(sheets, spreadsheet_id, sheet_id)
    sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=a1_range(TAB_BATCH, "A1"),
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


# ---------------------------------------------------------------------------
# Canonical database-backed projection API (Task 6)
# ---------------------------------------------------------------------------


class SheetsGateway(Protocol):
    """Injected Google Sheets boundary; unit tests use an in-memory fake."""

    spreadsheet_id: str

    def ensure_tabs(
        self, spreadsheet_id: str, titles: Sequence[str]
    ) -> Mapping[str, int]: ...

    def replace_values(
        self,
        spreadsheet_id: str,
        range_name: str,
        values: Sequence[Sequence[object]],
    ) -> None: ...

    def read_values(self, spreadsheet_id: str, range_name: str) -> list[list[str]]: ...

    def batch_update(
        self, spreadsheet_id: str, requests: Sequence[dict[str, object]]
    ) -> None: ...


class GoogleApiSheetsGateway:
    """Operator-only adapter around the existing authenticated Sheets service."""

    def __init__(self, sheets_service: Any, spreadsheet_id: str):
        self._sheets = sheets_service
        self.spreadsheet_id = spreadsheet_id

    def ensure_tabs(
        self, spreadsheet_id: str, titles: Sequence[str]
    ) -> Mapping[str, int]:
        metadata = self._sheets.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            fields="sheets.properties(sheetId,title,index)",
        ).execute()
        existing = {
            str(sheet["properties"]["title"]): int(sheet["properties"]["sheetId"])
            for sheet in metadata.get("sheets", ())
        }
        requests: list[dict[str, object]] = []
        for title in titles:
            if title not in existing:
                requests.append({"addSheet": {"properties": {"title": title}}})
        if requests:
            self.batch_update(spreadsheet_id, requests)
            metadata = self._sheets.spreadsheets().get(
                spreadsheetId=spreadsheet_id,
                fields="sheets.properties(sheetId,title,index)",
            ).execute()
            existing = {
                str(sheet["properties"]["title"]): int(sheet["properties"]["sheetId"])
                for sheet in metadata.get("sheets", ())
            }
        reorder = [
            {
                "updateSheetProperties": {
                    "properties": {"sheetId": existing[title], "index": index},
                    "fields": "index",
                }
            }
            for index, title in enumerate(titles)
        ]
        if reorder:
            self.batch_update(spreadsheet_id, reorder)
        return {title: existing[title] for title in titles}

    def replace_values(
        self,
        spreadsheet_id: str,
        range_name: str,
        values: Sequence[Sequence[object]],
    ) -> None:
        title = range_name.split("!", 1)[0]
        self._sheets.spreadsheets().values().clear(
            spreadsheetId=spreadsheet_id,
            range=title,
        ).execute()
        self._sheets.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption="RAW",
            body={"values": [list(row) for row in values]},
        ).execute()

    def read_values(self, spreadsheet_id: str, range_name: str) -> list[list[str]]:
        result = self._sheets.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueRenderOption="FORMULA",
        ).execute()
        return [list(row) for row in result.get("values", ())]

    def batch_update(
        self, spreadsheet_id: str, requests: Sequence[dict[str, object]]
    ) -> None:
        if requests:
            self._sheets.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": list(requests)},
            ).execute()


@dataclass(frozen=True)
class PublishedProjection:
    spreadsheet_id: str
    batch_key: str
    published_input_hash: str
    total_count: int
    ready_count: int
    conflict_count: int
    unresolved_count: int
    rejected_count: int
    no_change_count: int
    database_batch_id: int | None = None


class ProjectionValidationError(RuntimeError):
    """Sanitized projection failure with a stable machine-readable code."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


ITEM_HEADERS = (
    "content_entity_id",
    "title",
    "url",
    "current_direction_code",
    "current_material_type_code",
    "current_access_code",
    "current_lifecycle_code",
    "registry1_values",
    "registry2_values",
    "deterministic_result",
    "terra_result",
    "sol_result",
    "readiness_state",
    "conflict_codes",
    "concise_evidence",
    "final_direction_code",
    "final_material_type_code",
    "final_access_code",
    "final_lifecycle_code",
    "decision_reason",
    "input_hash",
    "row_hash",
)
HISTORY_HEADERS = (
    "batch_key",
    "published_input_hash",
    "accepted_decision_hash",
    "approver",
    "accepted_at",
    "ready_count",
    "conflict_count",
    "unresolved_count",
    "rejected_count",
    "no_change_count",
    "accepted_count",
    "skipped_count",
    "spreadsheet_file_id",
    "spreadsheet_projection_hash",
    "import_outcome",
    "candidate_release_id",
    "activation_status",
)

_FINAL_COLUMNS = {
    "direction": ITEM_HEADERS.index("final_direction_code"),
    "material_type": ITEM_HEADERS.index("final_material_type_code"),
    "access": ITEM_HEADERS.index("final_access_code"),
    "lifecycle": ITEM_HEADERS.index("final_lifecycle_code"),
}
_REASON_COLUMN = ITEM_HEADERS.index("decision_reason")
_HASH_COLUMN = ITEM_HEADERS.index("input_hash")
_STATE_TABS = {
    "ready": TAB_PROPOSALS,
    "conflict": TAB_CONFLICTS,
    "unresolved": TAB_UNRESOLVED,
    "rejected": TAB_UNRESOLVED,
    "no_change": TAB_UNRESOLVED,
}


def _projection_plain(value: object) -> object:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Mapping):
        return {str(key): _projection_plain(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_projection_plain(item) for item in value]
    if isinstance(value, str):
        return value.replace("\r\n", "\n").replace("\r", "\n")
    if value is None or isinstance(value, (bool, int, float)):
        return value
    raise TypeError("PROJECTION_VALUE_NOT_SERIALIZABLE")


def _json_cell(value: object | None) -> str:
    if value is None:
        return ""
    return json.dumps(
        _projection_plain(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _safe_display(value: object | None) -> object:
    if value is None:
        return ""
    if not isinstance(value, str):
        return value
    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    stripped = normalized.lstrip()
    if stripped.startswith(("=", "+", "-", "@")):
        return "'" + normalized
    return normalized


def _batch_and_database_id(
    value: ApprovalBatch | PersistedApprovalBatch,
) -> tuple[ApprovalBatch, int | None]:
    if isinstance(value, PersistedApprovalBatch):
        return value.batch, value.database_batch_id
    return value, None


def _gateway_spreadsheet_id(gateway: SheetsGateway) -> str:
    spreadsheet_id = getattr(gateway, "spreadsheet_id", "")
    if not isinstance(spreadsheet_id, str) or not spreadsheet_id.strip():
        raise ProjectionValidationError("SPREADSHEET_ID_REQUIRED")
    return spreadsheet_id


def a1_range(tab_title: str, cells: str) -> str:
    """Return an A1 range with a safely quoted Sheet title."""

    if not isinstance(tab_title, str) or not tab_title:
        raise ProjectionValidationError("SHEET_TAB_NAME_REQUIRED")
    escaped = tab_title.replace("'", "''")
    return f"'{escaped}'!{cells}"


def _counts(batch: ApprovalBatch) -> dict[str, int]:
    result = {state: 0 for state in _STATE_TABS}
    for item in batch.items:
        if item.readiness_state not in result:
            raise ProjectionValidationError("READINESS_STATE_INVALID")
        result[item.readiness_state] += 1
    return result


def _validate_published_batch_hash(batch: ApprovalBatch) -> None:
    if compute_batch_hash(batch.items) != batch.published_input_hash:
        raise ProjectionValidationError("BATCH_HASH_MISMATCH")


def _item_extra(item: ApprovalItem, name: str) -> object | None:
    return getattr(item, name, None)


def _current_code(item: ApprovalItem, name: str) -> object | None:
    current = _item_extra(item, "current_canonical")
    if isinstance(current, Mapping):
        return current.get(name)
    return None


def _item_row(item: ApprovalItem) -> list[object]:
    return [
        "" if item.content_entity_id is None else item.content_entity_id,
        _safe_display(item.title),
        _safe_display(item.url),
        _current_code(item, "direction_code") or "",
        _current_code(item, "material_type_code") or "",
        _current_code(item, "access_code") or "",
        _current_code(item, "lifecycle_code") or "",
        _json_cell(_item_extra(item, "registry1_values")),
        _json_cell(_item_extra(item, "registry2_values")),
        _json_cell(_item_extra(item, "deterministic_result")),
        _json_cell(_item_extra(item, "terra_result")),
        _json_cell(_item_extra(item, "sol_result")),
        item.readiness_state,
        _json_cell(
            tuple(code.value if isinstance(code, Enum) else str(code) for code in item.conflict_codes)
        ),
        _json_cell(_item_extra(item, "concise_evidence") or ()),
        item.final_direction_code or "",
        item.final_material_type_code or "",
        item.final_access_code or "",
        item.final_lifecycle_code or "",
        _safe_display(item.decision_reason),
        item.input_hash,
        item.row_hash,
    ]


def _taxonomy_terms(batch: ApprovalBatch) -> Mapping[str, tuple[str, ...]]:
    if not isinstance(batch, BuiltApprovalBatch):
        raise ProjectionValidationError("TAXONOMY_CONTRACT_MISSING")
    required = ("direction", "material_type", "access", "lifecycle")
    if set(batch.taxonomy_terms) != set(required) or any(
        not batch.taxonomy_terms[kind] for kind in required
    ):
        raise ProjectionValidationError("TAXONOMY_CONTRACT_MISSING")
    return batch.taxonomy_terms


def _reference_rows(batch: ApprovalBatch) -> list[list[object]]:
    terms = _taxonomy_terms(batch)
    kinds = ("direction", "material_type", "access", "lifecycle")
    height = max(len(terms[kind]) for kind in kinds)
    rows: list[list[object]] = [list(kinds)]
    for index in range(height):
        rows.append(
            [terms[kind][index] if index < len(terms[kind]) else "" for kind in kinds]
        )
    return rows


def _metadata_rows(batch: ApprovalBatch, counts: Mapping[str, int]) -> list[list[object]]:
    return [
        ["Batch ID", batch.batch_key],
        ["Published hash", batch.published_input_hash],
        ["Taxonomy version", batch.taxonomy_version],
        ["Taxonomy digest", getattr(batch, "taxonomy_digest", "")],
        ["Prompt version", batch.prompt_version],
        ["Model routing version", getattr(batch, "model_routing_version", "")],
        ["Source snapshot IDs", _json_cell(getattr(batch, "source_snapshot_ids", ()))],
        ["Source snapshot digests", _json_cell(getattr(batch, "source_snapshot_digests", ()))],
        ["ready", counts["ready"]],
        ["conflict", counts["conflict"]],
        ["unresolved", counts["unresolved"]],
        ["rejected", counts["rejected"]],
        ["no_change", counts["no_change"]],
        ["Всего", len(batch.items)],
        ["Решение", "Ожидает"],
        ["Принял", ""],
        ["Принято UTC", ""],
        ["Accepted decision hash", ""],
    ]


def _accepted_metadata_rows(
    batch: ApprovalBatch, snapshot: AcceptedBatchSnapshot
) -> list[list[object]]:
    rows = _metadata_rows(batch, _counts(batch))
    updates = {
        "Решение": "Принять",
        "Принял": snapshot.accepted_by,
        "Принято UTC": snapshot.accepted_at,
        "Accepted decision hash": snapshot.accepted_decision_hash,
    }
    for row in rows:
        if row[0] in updates:
            row[1] = updates[row[0]]
    return rows


def _summary_rows(batch: ApprovalBatch, counts: Mapping[str, int]) -> list[list[object]]:
    return [
        ["Published hash", batch.published_input_hash],
        ["ready", counts["ready"]],
        ["conflict", counts["conflict"]],
        ["unresolved", counts["unresolved"]],
        ["rejected", counts["rejected"]],
        ["no_change", counts["no_change"]],
        ["Всего", len(batch.items)],
    ]


def _history_value(record: object, name: str) -> object | None:
    if isinstance(record, Mapping):
        value = record.get(name)
    else:
        value = getattr(record, name, None)
    if isinstance(value, datetime):
        normalized = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
        return normalized.isoformat().replace("+00:00", "Z")
    return value


def _history_rows(record: object) -> list[list[object]]:
    return [
        list(HISTORY_HEADERS),
        [
            _history_value(record, "batch_key") or "",
            _history_value(record, "published_input_hash") or "",
            _history_value(record, "accepted_decision_hash") or "",
            _history_value(record, "approver") or "",
            _history_value(record, "accepted_at") or "",
            _history_value(record, "ready_count") or 0,
            _history_value(record, "conflict_count") or 0,
            _history_value(record, "unresolved_count") or 0,
            _history_value(record, "rejected_count") or 0,
            _history_value(record, "no_change_count") or 0,
            _history_value(record, "accepted_count") or 0,
            _history_value(record, "skipped_count") or 0,
            _history_value(record, "spreadsheet_file_id") or "",
            _history_value(record, "spreadsheet_projection_hash") or "",
            _history_value(record, "batch_status") or "",
            _history_value(record, "candidate_release_id") or "",
            _history_value(record, "activation_status") or "not_started",
        ],
    ]


def _projection_requests(
    sheet_ids: Mapping[str, int], batch: ApprovalBatch
) -> list[dict[str, object]]:
    terms = _taxonomy_terms(batch)
    requests: list[dict[str, object]] = []
    decision_row_index = next(
        index
        for index, row in enumerate(_metadata_rows(batch, _counts(batch)))
        if row[0] == "Решение"
    )
    requests.append(
        {
            "setDataValidation": {
                "range": {
                    "sheetId": sheet_ids[TAB_BATCH],
                    "startRowIndex": decision_row_index,
                    "endRowIndex": decision_row_index + 1,
                    "startColumnIndex": 1,
                    "endColumnIndex": 2,
                },
                "rule": {
                    "condition": {
                        "type": "ONE_OF_LIST",
                        "values": [
                            {"userEnteredValue": "Ожидает"},
                            {"userEnteredValue": "Принять"},
                            {"userEnteredValue": "Отклонить"},
                        ],
                    },
                    "showCustomUi": True,
                    "strict": True,
                },
            }
        }
    )
    editable_tabs = (TAB_PROPOSALS, TAB_CONFLICTS, TAB_UNRESOLVED)
    for title in editable_tabs:
        sheet_id = sheet_ids[title]
        row_count = 1 + sum(
            1 for item in batch.items if _STATE_TABS[item.readiness_state] == title
        )
        requests.extend(
            [
                {
                    "addProtectedRange": {
                        "protectedRange": {
                            "range": {
                                "sheetId": sheet_id,
                                "startRowIndex": 0,
                                "endRowIndex": row_count,
                                "startColumnIndex": 0,
                                "endColumnIndex": min(_FINAL_COLUMNS.values()),
                            },
                            "description": "identity-and-proposals-read-only",
                            "warningOnly": False,
                        }
                    }
                },
                {
                    "addProtectedRange": {
                        "protectedRange": {
                            "range": {
                                "sheetId": sheet_id,
                                "startRowIndex": 0,
                                "endRowIndex": row_count,
                                "startColumnIndex": _HASH_COLUMN,
                                "endColumnIndex": len(ITEM_HEADERS),
                            },
                            "description": "input-and-row-hashes-read-only",
                            "warningOnly": False,
                        }
                    }
                },
            ]
        )
        for reference_index, (kind, column_index) in enumerate(_FINAL_COLUMNS.items()):
            end_row = len(terms[kind]) + 1
            reference_column = chr(ord("A") + reference_index)
            requests.append(
                {
                    "setDataValidation": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": 1,
                            "endRowIndex": max(row_count, 2),
                            "startColumnIndex": column_index,
                            "endColumnIndex": column_index + 1,
                        },
                        "rule": {
                            "condition": {
                                "type": "ONE_OF_RANGE",
                                "values": [
                                    {
                                        "userEnteredValue": (
                                            f"={a1_range(TAB_REF, f'${reference_column}$2:')}"
                                            f"${reference_column}${end_row}"
                                        )
                                    }
                                ],
                            },
                            "showCustomUi": True,
                            "strict": True,
                        },
                    }
                }
            )
    conflict_rows = 1 + sum(
        1 for item in batch.items if item.readiness_state == "conflict"
    )
    requests.append(
        {
            "setDataValidation": {
                "range": {
                    "sheetId": sheet_ids[TAB_CONFLICTS],
                    "startRowIndex": 1,
                    "endRowIndex": max(conflict_rows, 2),
                    "startColumnIndex": _REASON_COLUMN,
                    "endColumnIndex": _REASON_COLUMN + 1,
                },
                "rule": {
                    "condition": {
                        "type": "CUSTOM_FORMULA",
                        "values": [{"userEnteredValue": "=LEN(TRIM($T2))>0"}],
                    },
                    "inputMessage": "decision_reason is mandatory for an edited conflict",
                    "strict": True,
                },
            }
        }
    )
    requests.append(
        {
            "addProtectedRange": {
                "protectedRange": {
                    "range": {"sheetId": sheet_ids[TAB_HISTORY]},
                    "description": "history-read-only",
                    "warningOnly": False,
                }
            }
        }
    )
    return requests


def publish_batch_projection(
    batch: PersistedApprovalBatch,
    sheets_gateway: SheetsGateway,
    repository: Any,
) -> PublishedProjection:
    """Publish a review-only projection of an already canonical batch."""

    if not isinstance(batch, PersistedApprovalBatch):
        raise ProjectionValidationError("BATCH_NOT_PERSISTED")
    approval_batch = batch.batch
    database_batch_id = batch.database_batch_id
    _validate_published_batch_hash(approval_batch)
    repository.attest_batch_for_publication(database_batch_id, approval_batch)
    spreadsheet_id = _gateway_spreadsheet_id(sheets_gateway)
    counts = _counts(approval_batch)
    history = repository.load_batch_history(database_batch_id)

    rows_by_tab: dict[str, list[list[object]]] = {
        title: [list(ITEM_HEADERS)]
        for title in (TAB_PROPOSALS, TAB_CONFLICTS, TAB_UNRESOLVED)
    }
    for item in approval_batch.items:
        rows_by_tab[_STATE_TABS[item.readiness_state]].append(_item_row(item))

    values_by_tab: Mapping[str, Sequence[Sequence[object]]] = {
        TAB_BATCH: _metadata_rows(approval_batch, counts),
        **rows_by_tab,
        TAB_HISTORY: _history_rows(history),
        TAB_REF: _reference_rows(approval_batch),
        TAB_SUMMARY: _summary_rows(approval_batch, counts),
        TAB_HELP: [
            ["Google Sheets — только проекция для ревью."],
            ["Канонический batch и все строки сначала сохраняются в MySQL."],
            ["Принятие batch применяет только строки ready; остальные остаются открытыми."],
        ],
    }
    projection_hash = sha256(
        json.dumps(
            _projection_plain(
                {
                    title: values_by_tab[title]
                    for title in APPROVAL_TAB_TITLES
                    if title != TAB_HISTORY
                }
            ),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    try:
        sheet_ids = sheets_gateway.ensure_tabs(spreadsheet_id, APPROVAL_TAB_TITLES)
        if any(title not in sheet_ids for title in APPROVAL_TAB_TITLES):
            raise ProjectionValidationError("SHEET_TAB_MISSING")
        for title in APPROVAL_TAB_TITLES:
            sheets_gateway.replace_values(
                spreadsheet_id,
                a1_range(title, "A1"),
                values_by_tab[title],
            )
        sheets_gateway.batch_update(
            spreadsheet_id,
            _projection_requests(sheet_ids, approval_batch),
        )
        repository.mark_batch_published(
            database_batch_id,
            spreadsheet_id,
            projection_hash,
        )
        current_history = repository.load_batch_history(database_batch_id)
        sheets_gateway.replace_values(
            spreadsheet_id,
            a1_range(TAB_HISTORY, "A1"),
            _history_rows(current_history),
        )
    except Exception:
        try:
            repository.mark_batch_projection_failed(
                database_batch_id,
                "SHEET_PROJECTION_FAILED",
            )
        except Exception:
            pass
        raise
    return PublishedProjection(
        spreadsheet_id=spreadsheet_id,
        batch_key=approval_batch.batch_key,
        published_input_hash=approval_batch.published_input_hash,
        total_count=len(approval_batch.items),
        ready_count=counts["ready"],
        conflict_count=counts["conflict"],
        unresolved_count=counts["unresolved"],
        rejected_count=counts["rejected"],
        no_change_count=counts["no_change"],
        database_batch_id=database_batch_id,
    )


def persist_and_publish_batch(
    batch: ApprovalBatch,
    repository: Any,
    sheets_gateway: SheetsGateway,
) -> PublishedProjection:
    """Enforce canonical persistence before the first projection gateway call."""

    persisted = persist_batch(batch, repository)
    return publish_batch_projection(persisted, sheets_gateway, repository)


def _metadata(values: Sequence[Sequence[object]]) -> dict[str, object]:
    return {
        str(row[0]): row[1]
        for row in values
        if len(row) >= 2 and str(row[0]).strip()
    }


def _required_metadata(meta: Mapping[str, object], name: str) -> str:
    value = str(meta.get(name, "")).strip()
    if not value:
        raise ProjectionValidationError("SHEET_ACCEPTANCE_METADATA_MISSING")
    return value


def _as_count(meta: Mapping[str, object], name: str) -> int:
    try:
        value = meta[name]
        if isinstance(value, bool):
            raise ValueError
        number = int(value)
        if str(value).strip() not in {str(number), f"{number}.0"} or number < 0:
            raise ValueError
        return number
    except (KeyError, TypeError, ValueError):
        raise ProjectionValidationError("SHEET_COUNT_MISMATCH") from None


def _accepted_decision(value: object) -> bool:
    return value == "Принять"


def _table_rows(
    gateway: SheetsGateway, spreadsheet_id: str, title: str
) -> list[list[object]]:
    values = gateway.read_values(spreadsheet_id, a1_range(title, "A:V"))
    if not values or tuple(str(value) for value in values[0]) != ITEM_HEADERS:
        raise ProjectionValidationError("SHEET_HEADER_MISMATCH")
    rows: list[list[object]] = []
    for source in values[1:]:
        row = list(source)
        row.extend([""] * (len(ITEM_HEADERS) - len(row)))
        if any(str(value).strip() for value in row):
            rows.append(row[: len(ITEM_HEADERS)])
    return rows


def _optional_cell(value: object) -> str | None:
    normalized = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if normalized.startswith(("=", "+", "-", "@")):
        raise ProjectionValidationError("SHEET_FORMULA_NOT_ALLOWED")
    return normalized or None


def _validate_taxonomy(
    item: ApprovalItem,
    terms: Mapping[str, tuple[str, ...]],
) -> None:
    values = {
        "direction": item.final_direction_code,
        "material_type": item.final_material_type_code,
        "access": item.final_access_code,
        "lifecycle": item.final_lifecycle_code,
    }
    if any(value is not None and value not in terms[kind] for kind, value in values.items()):
        raise ProjectionValidationError("TAXONOMY_CODE_INVALID")
    if item.readiness_state == "ready" and (
        not item.final_direction_code or not item.final_material_type_code
    ):
        raise ProjectionValidationError("READY_CLASSIFICATION_INCOMPLETE")


def read_accepted_projection(
    batch: ApprovalBatch | PersistedApprovalBatch,
    sheets_gateway: SheetsGateway,
) -> AcceptedBatchSnapshot:
    """Read and strictly validate the complete decision projection."""

    approval_batch, _database_batch_id = _batch_and_database_id(batch)
    _validate_published_batch_hash(approval_batch)
    spreadsheet_id = _gateway_spreadsheet_id(sheets_gateway)
    batch_meta = _metadata(
        sheets_gateway.read_values(spreadsheet_id, a1_range(TAB_BATCH, "A:B"))
    )
    summary_meta = _metadata(
        sheets_gateway.read_values(spreadsheet_id, a1_range(TAB_SUMMARY, "A:B"))
    )
    if not _accepted_decision(batch_meta.get("Решение")):
        raise ProjectionValidationError("BATCH_NOT_ACCEPTED")
    if (
        str(batch_meta.get("Batch ID", "")) != approval_batch.batch_key
        or str(batch_meta.get("Published hash", ""))
        != approval_batch.published_input_hash
        or str(summary_meta.get("Published hash", ""))
        != approval_batch.published_input_hash
        or str(batch_meta.get("Taxonomy version", ""))
        != approval_batch.taxonomy_version
        or str(batch_meta.get("Prompt version", "")) != approval_batch.prompt_version
    ):
        raise ProjectionValidationError("SHEET_BATCH_MISMATCH")

    counts = _counts(approval_batch)
    for name, expected in (*counts.items(), ("Всего", len(approval_batch.items))):
        if _as_count(batch_meta, name) != expected or _as_count(summary_meta, name) != expected:
            raise ProjectionValidationError("SHEET_COUNT_MISMATCH")

    expected_by_hash = {item.row_hash: item for item in approval_batch.items}
    rows_by_tab = {
        title: _table_rows(sheets_gateway, spreadsheet_id, title)
        for title in (TAB_PROPOSALS, TAB_CONFLICTS, TAB_UNRESOLVED)
    }
    rows = [row for tab_rows in rows_by_tab.values() for row in tab_rows]
    row_hash_index = ITEM_HEADERS.index("row_hash")
    row_hashes = [str(row[row_hash_index]).strip() for row in rows]
    if len(row_hashes) != len(set(row_hashes)):
        raise ProjectionValidationError("DUPLICATE_ROW_HASH")
    if len(rows) != len(approval_batch.items):
        raise ProjectionValidationError("SHEET_ROW_COUNT_MISMATCH")
    for title, tab_rows in rows_by_tab.items():
        for row in tab_rows:
            expected_item = expected_by_hash.get(str(row[row_hash_index]).strip())
            if expected_item is not None and _STATE_TABS[expected_item.readiness_state] != title:
                raise ProjectionValidationError("SHEET_TAB_STATE_MISMATCH")
    for title, tab_rows in rows_by_tab.items():
        expected_count = sum(
            1
            for item in approval_batch.items
            if _STATE_TABS[item.readiness_state] == title
        )
        if len(tab_rows) != expected_count:
            raise ProjectionValidationError("SHEET_TAB_COUNT_MISMATCH")

    if set(row_hashes) != set(expected_by_hash):
        raise ProjectionValidationError("SHEET_IDENTITY_MISMATCH")
    immutable_indexes = tuple(range(0, min(_FINAL_COLUMNS.values()))) + tuple(
        range(_HASH_COLUMN, len(ITEM_HEADERS))
    )
    terms = _taxonomy_terms(approval_batch)
    accepted_items: list[ApprovalItem] = []
    seen_identities: set[tuple[int | None, str]] = set()
    for row in rows:
        expected = expected_by_hash[str(row[row_hash_index]).strip()]
        expected_row = _item_row(expected)
        if any(str(row[index]) != str(expected_row[index]) for index in immutable_indexes):
            raise ProjectionValidationError("SHEET_IDENTITY_MISMATCH")
        identity = (expected.content_entity_id, expected.input_hash)
        if identity in seen_identities:
            raise ProjectionValidationError("DUPLICATE_ROW_IDENTITY")
        seen_identities.add(identity)

        accepted = replace(
            expected,
            final_direction_code=_optional_cell(row[_FINAL_COLUMNS["direction"]]),
            final_material_type_code=_optional_cell(row[_FINAL_COLUMNS["material_type"]]),
            final_access_code=_optional_cell(row[_FINAL_COLUMNS["access"]]),
            final_lifecycle_code=_optional_cell(row[_FINAL_COLUMNS["lifecycle"]]),
            decision_reason=_optional_cell(row[_REASON_COLUMN]),
        )
        _validate_taxonomy(accepted, terms)
        if accepted.readiness_state == "conflict":
            old_values = (
                expected.final_direction_code,
                expected.final_material_type_code,
                expected.final_access_code,
                expected.final_lifecycle_code,
            )
            new_values = (
                accepted.final_direction_code,
                accepted.final_material_type_code,
                accepted.final_access_code,
                accepted.final_lifecycle_code,
            )
            if old_values != new_values and not accepted.decision_reason:
                raise ProjectionValidationError("CONFLICT_REASON_REQUIRED")
        accepted_items.append(accepted)

    accepted_items.sort(
        key=lambda item: (
            0 if item.content_entity_id is None else 1,
            item.content_entity_id or 0,
            item.input_hash,
        )
    )
    accepted_hash = compute_accepted_decision_hash(accepted_items)
    displayed_hash = str(batch_meta.get("Accepted decision hash", "")).strip()
    if displayed_hash and displayed_hash != accepted_hash:
        raise ProjectionValidationError("ACCEPTED_HASH_MISMATCH")
    return AcceptedBatchSnapshot(
        batch_key=approval_batch.batch_key,
        published_input_hash=approval_batch.published_input_hash,
        accepted_decision_hash=accepted_hash,
        items=tuple(accepted_items),
        accepted_by=_required_metadata(batch_meta, "Принял"),
        accepted_at=_required_metadata(batch_meta, "Принято UTC"),
        accepted_count=counts["ready"],
        skipped_count=len(approval_batch.items) - counts["ready"],
    )


def persist_accepted_projection(
    batch: PersistedApprovalBatch,
    sheets_gateway: SheetsGateway,
    repository: Any,
) -> AcceptedBatchSnapshot:
    """Explicitly persist acceptance, then refresh read-only DB-backed history."""

    if not isinstance(batch, PersistedApprovalBatch):
        raise ProjectionValidationError("BATCH_NOT_PERSISTED")
    repository.attest_batch_for_acceptance(batch.database_batch_id, batch.batch)
    snapshot = read_accepted_projection(batch, sheets_gateway)
    spreadsheet_id = _gateway_spreadsheet_id(sheets_gateway)
    repository.record_batch_acceptance(
        batch.database_batch_id,
        snapshot,
        spreadsheet_id,
    )
    history = repository.load_batch_history(batch.database_batch_id)
    sheets_gateway.replace_values(
        spreadsheet_id,
        a1_range(TAB_BATCH, "A1"),
        _accepted_metadata_rows(batch.batch, snapshot),
    )
    sheets_gateway.replace_values(
        spreadsheet_id,
        a1_range(TAB_HISTORY, "A1"),
        _history_rows(history),
    )
    return snapshot


def publish(
    classifications_path: Path,
    title: str | None = None,
    spreadsheet_id: str | None = None,
) -> dict[str, Any]:
    # Retained only so older invocations fail with a stable migration boundary.
    # Task 9's workflow CLI will compose persist_and_publish_batch with real DB
    # configuration; this legacy file-to-Sheet path must never write canonical data.
    raise SystemExit("CANONICAL_DB_BATCH_REQUIRED")

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
        spreadsheetId=sid, range=a1_range(TAB_PROPOSALS, "A:ZZZ")
    ).execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=sid,
        range=a1_range(TAB_PROPOSALS, "A1"),
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
    sheets.spreadsheets().values().clear(
        spreadsheetId=sid, range=a1_range(TAB_SUMMARY, "A:ZZZ")
    ).execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=sid,
        range=a1_range(TAB_SUMMARY, "A1"),
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
            "batch_decision_cell": a1_range(TAB_BATCH, "B10"),
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
    # Directionless/conflict rows cannot be represented by the legacy CSV/local
    # lock path.  Fail closed until the Task 9 DB-backed workflow composes the
    # accepted snapshot and repository ingestion stages.
    raise SystemExit("CANONICAL_DB_BATCH_REQUIRED")

    sheets, _ = services()
    state = load_state()
    sid = spreadsheet_id or state.get("spreadsheet_id")
    if not sid:
        raise SystemExit("No spreadsheet_id. Publish first or pass --spreadsheet-id")

    # Batch decision
    batch_meta = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=sid, range=a1_range(TAB_BATCH, "A1:B20"))
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
        .get(spreadsheetId=sid, range=a1_range(proposals_title, "A1:R"))
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
        range=a1_range(TAB_BATCH, "A22"),
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

    p_pub = sub.add_parser(
        "publish", help="Disabled legacy command; use the canonical workflow CLI"
    )
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
        help="Disabled legacy command; use the canonical workflow CLI",
    )
    p_pull.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent / "out" / "approved_from_sheets.csv",
    )
    p_pull.add_argument("--spreadsheet-id", default=None)

    p_share = sub.add_parser("share", help="Share existing sheet with email")
    p_share.add_argument("--email", default=None)
    p_share.add_argument("--spreadsheet-id", default=None)

    p_state = sub.add_parser("state", help="Show current sheet state")

    args = p.parse_args(argv)

    if args.cmd in {"publish", "pull-approved", "share"}:
        raise SystemExit("LEGACY_SHEETS_CLI_DISABLED")

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
