#!/usr/bin/env python3
"""Abbott page direction / material-type classifier.

Sources:
  1) Abbott names.xlsx (workbook: pages, type sheets, id, events, general_materials, url_return)
  2) URL path prefixes + Bitrix section IDs (same rules as dashboard-next/src/lib/abbott-bi.ts)

Discovers candidates (CLI list / CSV / unmatched) and classifies with a priority cascade.
Writes review queue for low-confidence rows and proposed workbook rows.

Usage:
  python classify.py --workbook "/Users/nafanya/ReportingDash/Abbott names.xlsx" \\
      --candidates-csv candidates.csv --out out/

  python classify.py --workbook "..." --self-test
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qs, unquote, urlparse

# The classifier remains executable as the documented standalone script as well
# as importable as a package module.  Direct script execution puts this file's
# directory, rather than the repository root, on ``sys.path``.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from agents.abbott_page_classifier.domain import (
    ACCESS_LABELS,
    DIRECTION_CODE_BY_PREFIX,
    DIRECTION_CODE_BY_SECTION_ID,
    LEGACY_CLASSIFIER_MATERIAL_TYPE_CODES,
    LEGACY_DIRECTION_LABELS,
    MATERIAL_TYPE_CODE_BY_PREFIX,
    MATERIAL_TYPE_LABELS,
)
from agents.abbott_page_classifier.normalization import normalize_url as normalize_canonical_url

try:
    import openpyxl
except ImportError as exc:  # pragma: no cover
    raise SystemExit("openpyxl required: pip install openpyxl") from exc


DIRECTION_BY_PREFIX: dict[str, str] = {
    prefix: LEGACY_DIRECTION_LABELS[code]
    for prefix, code in DIRECTION_CODE_BY_PREFIX.items()
}

DIRECTION_BY_QUERY_ID: dict[str, str] = {
    section_id: LEGACY_DIRECTION_LABELS[code]
    for section_id, code in DIRECTION_CODE_BY_SECTION_ID.items()
}

MATERIAL_TYPE_BY_PREFIX: dict[str, str] = {
    prefix: MATERIAL_TYPE_LABELS[code]
    for prefix, code in MATERIAL_TYPE_CODE_BY_PREFIX.items()
}

# Compatibility rendering for the existing CLI.  "Архив" is a lifecycle
# state and intentionally absent from this material-type list.
MATERIAL_TYPES: list[str] = [
    MATERIAL_TYPE_LABELS[code] for code in LEGACY_CLASSIFIER_MATERIAL_TYPE_CODES
]

# Title keywords → material type (only when path unknown)
KEYWORD_MATERIAL: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bвидео|video|вебинар|лекция\b", re.I), "Видео"),
    (re.compile(r"\bподкаст|podcast\b", re.I), "Подкасты"),
    (re.compile(r"\bкалькулятор|calculator|шкала\b", re.I), "Калькуляторы"),
    (re.compile(r"\bклиническ\w+\s+случа", re.I), "Клинические случаи"),
    (re.compile(r"\bклиническ\w+\s+рекоменд|гайдлайн|guideline\b", re.I), "Клинические рекомендации"),
    (re.compile(r"\bброшюр", re.I), "Научно-образовательные брошюры"),
    (re.compile(r"\bтаблиц|центильн", re.I), "Таблицы"),
    (re.compile(r"\bпрепарат|product\b", re.I), "Препараты и продукты"),
    (re.compile(r"\bприбор|device\b", re.I), "Приборы и устройства"),
    (re.compile(r"\bпроверить знания|тест\b", re.I), "Проверить знания"),
    (re.compile(r"\bалгоритм", re.I), "Алгоритмы фармацевтического консультирования"),
    (re.compile(r"\bдетск\w+\s+питан", re.I), "Детское питание"),
]

PAGE_STATUS_ACTIVE = "active"
PAGE_STATUS_ARCHIVE = "Архив"
HTTP_ARCHIVE_CODES = {404, 410}

# Title/path keyword → direction (fallback only)
KEYWORD_DIRECTION: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"гастро|кишеч|запор|печен|панкреа|диспепс|СРК|гептрал|дюфалак|креон|ганатон", re.I), "Гастроэнтерология [262340]"),
    (re.compile(r"кардио|гипертенз|липид|омакор|триглицер|SCORE2|артериальн", re.I), "Кардиология [262338]"),
    (re.compile(r"невро|психиатр|депресс|антидепресс|когнитив|ОКР|нобен|бетагистин|вестибуляр", re.I), "Неврология и психиатрия [262339]"),
    (re.compile(r"менопауз|МГТ|беремен|гинекол|женск|дюфастон|бесплод|климакс", re.I), "Женское здоровье [262337]"),
    (re.compile(r"тонзилл|фарингит|ОРВИ|бронхит|дыхат|имудон|клацид|аденоид", re.I), "Здоровье дыхательной системы [263746]"),
    (re.compile(r"диабет|глюкоз|Libre|FreeStyle|инсулин", re.I), "Управление сахарным диабетом [620888]"),
    (re.compile(r"фармацевт|аптек|первостольник", re.I), "Фармацевты"),
    (re.compile(r"дермат|кожн|псориаз", re.I), "Дерматология"),
]

ACCESS_DEFAULT_BY_DIR = {
    LEGACY_DIRECTION_LABELS["pharmacists"]: ACCESS_LABELS["pharmacists"],
}

UTILITY_PATHS = {"/auth", "/auth_without_phone"}


@dataclass
class Classification:
    url: str = ""
    title: str = ""
    slug: str = ""
    entity_kind: str = "page"  # page | event | general_material | other
    direction: str | None = None
    material_type: str | None = None
    material_type_rule: str = ""
    access: str | None = None
    confidence: float = 0.0
    rule: str = "unknown"
    needs_review: bool = True
    notes: str = ""
    bitrix_id: str | None = None
    page_status: str = PAGE_STATUS_ACTIVE  # active | Архив
    lifecycle_code: str = PAGE_STATUS_ACTIVE
    http_status: int | None = None


@dataclass
class WorkbookIndex:
    by_title: dict[str, dict[str, Any]] = field(default_factory=dict)
    by_title_type: dict[str, dict[str, Any]] = field(default_factory=dict)
    by_slug: dict[str, dict[str, Any]] = field(default_factory=dict)
    by_url: dict[str, dict[str, Any]] = field(default_factory=dict)
    by_bitrix_id: dict[str, str | None] = field(default_factory=dict)
    events_by_url: dict[str, dict[str, Any]] = field(default_factory=dict)
    general_materials: list[dict[str, str]] = field(default_factory=list)
    known_slugs: set[str] = field(default_factory=set)
    known_titles: set[str] = field(default_factory=set)


def normalize_url(raw: str | None) -> str:
    """Compatibility wrapper returning the normalized URL string."""

    return normalize_canonical_url(raw or "").value


def extract_slug(raw_url: str | None) -> str:
    try:
        path = urlparse(normalize_url(raw_url) or raw_url or "").path
        segments = [s for s in path.split("/") if s]
        if not segments:
            return ""
        last = unquote(segments[-1])
        if re.fullmatch(r"\d+", last):
            return ""
        return last
    except Exception:
        return ""


def cell(row: tuple[Any, ...], idx: int) -> str:
    if idx >= len(row) or row[idx] is None:
        return ""
    return str(row[idx]).strip()


def load_workbook(path: Path) -> WorkbookIndex:
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    idx = WorkbookIndex()

    type_sheets = [
        ("pages", None, "Направление", "Доступ", "Тип материала", "Название", "Символьный код"),
        ("Статьи", "Статьи", "Направление", "Доступ", None, "Название", "Символьный код"),
        ("Видео", "Видео", "Направление", "Доступ", None, "Название", "Символьный код"),
        ("Клинические случаи", "Клинические случаи", "Направление", "Доступ", None, "Название", "Символьный код"),
        ("Научно-образовательные брошюры", "Научно-образовательные брошюры", "Направление", None, None, "Название", None),
        ("Подкасты", "Подкасты", "Направление", None, None, "Название", "Символьный код"),
        ("Калькуляторы", "Калькуляторы", "Направление", "Доступ", None, "Название", "Символьный код"),
        ("Проверить знания", "Проверить знания", "Направление", None, None, "Название", "Символьный код"),
        ("Помощник фармацевта", "Помощник фармацевта", None, None, None, "Название", "Символьный код"),
        ("Алгоритмы фармацевтического кон", "Алгоритмы фармацевтического консультирования", "Направление", None, None, "Название", "Символьный код"),
        ("Клинические рекомендации", "Клинические рекомендации", "Направления", None, None, "Название", "Символьный код"),
        ("Таблицы", "Таблицы", "Направление", "Доступ", None, "Название", None),
        ("Сводная", None, "Направление", "Доступ", "Тип материала", "Название", "Символьный код"),
    ]

    for sheet_name, fixed_type, dir_key, access_key, type_key, title_key, slug_key in type_sheets:
        if sheet_name not in wb.sheetnames:
            continue
        ws = wb[sheet_name]
        rows = ws.iter_rows(values_only=True)
        try:
            header = next(rows)
        except StopIteration:
            continue
        headers = [str(h).strip() if h is not None else "" for h in header]
        col = {h: i for i, h in enumerate(headers) if h}

        def get(row: tuple[Any, ...], key: str | None) -> str:
            if not key or key not in col:
                return ""
            return cell(row, col[key])

        for row in rows:
            if not row or not any(row):
                continue
            title = get(row, title_key)
            slug = get(row, slug_key) if slug_key else ""
            direction = get(row, dir_key) if dir_key else ""
            access = get(row, access_key) if access_key else ""
            material = get(row, type_key) if type_key else (fixed_type or "")
            if not title and not slug:
                continue
            meta = {
                "title": title,
                "slug": slug,
                "direction": direction or None,
                "material_type": material or fixed_type,
                "access": access or None,
                "sheet": sheet_name,
            }
            if title:
                idx.by_title[title] = meta
                idx.known_titles.add(title)
                if material:
                    idx.by_title_type[f"{material}::{title}"] = meta
            if slug:
                idx.by_slug[slug] = meta
                idx.known_slugs.add(slug)

    if "id" in wb.sheetnames:
        ws = wb["id"]
        rows = ws.iter_rows(min_row=2, values_only=True)
        for row in rows:
            if not row or row[0] is None:
                continue
            bid = str(int(row[0])) if isinstance(row[0], float) else str(row[0]).strip()
            direction = str(row[1]).strip() if row[1] else None
            idx.by_bitrix_id[bid] = direction

    if "url_return" in wb.sheetnames:
        ws = wb["url_return"]
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not row or not row[0]:
                continue
            url = normalize_url(str(row[0]))
            direction = str(row[1]).strip() if row[1] else None
            if url:
                idx.by_url[url] = {
                    "direction": direction,
                    "material_type": None,
                    "access": None,
                    "sheet": "url_return",
                    "title": "",
                    "slug": extract_slug(url),
                }

    if "general_materials" in wb.sheetnames:
        ws = wb["general_materials"]
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not row or not row[0]:
                continue
            name = str(row[0]).strip()
            url = normalize_url(str(row[1]) if len(row) > 1 and row[1] else "")
            idx.general_materials.append({"name": name, "url": url})
            if url:
                # Infer direction from section hubs
                dir_guess = None
                for prefix, label in DIRECTION_BY_PREFIX.items():
                    if f"/{prefix}" in url or url.endswith(f"/{prefix}"):
                        dir_guess = label
                        break
                idx.by_url[url] = {
                    "direction": dir_guess,
                    "material_type": "Общие материалы",
                    "access": None,
                    "sheet": "general_materials",
                    "title": name,
                    "slug": extract_slug(url),
                }

    if "events" in wb.sheetnames:
        ws = wb["events"]
        rows = ws.iter_rows(values_only=True)
        header = next(rows, None)
        if header:
            headers = [str(h).strip() if h is not None else "" for h in header]
            col = {h: i for i, h in enumerate(headers) if h}
            for row in rows:
                if not row:
                    continue
                title = cell(row, col["Название"]) if "Название" in col else ""
                direction = cell(row, col["Направление"]) if "Направление" in col else ""
                url = normalize_url(cell(row, col["Ссылка на регистрацию"]) if "Ссылка на регистрацию" in col else "")
                access = cell(row, col["Доступ"]) if "Доступ" in col else ""
                if url:
                    idx.events_by_url[url] = {
                        "title": title,
                        "direction": direction or None,
                        "access": access or None,
                        "material_type": "Мероприятия",
                    }

    wb.close()
    return idx


def path_segments(url: str) -> list[str]:
    try:
        return [s for s in urlparse(url).path.split("/") if s]
    except Exception:
        return []


def find_section_id(url: str) -> str | None:
    # /video/262339 or query ?IBLOCK_SECTION_ID=262340
    for seg in path_segments(url):
        if seg in DIRECTION_BY_QUERY_ID:
            return seg
    try:
        qs = {key.casefold(): values for key, values in parse_qs(urlparse(url).query).items()}
        for key in ("iblock_section_id", "section", "direction"):
            if key in qs and qs[key]:
                val = qs[key][0]
                if val in DIRECTION_BY_QUERY_ID:
                    return val
    except Exception:
        pass
    return None


def infer_direction_from_path(url: str) -> tuple[str | None, str]:
    segs = path_segments(url)
    for seg in segs:
        if seg in DIRECTION_BY_PREFIX:
            return DIRECTION_BY_PREFIX[seg], f"path_prefix:{seg}"
    # compound first segment after host
    if segs:
        first = segs[0]
        for prefix, label in DIRECTION_BY_PREFIX.items():
            if first == prefix or first.startswith(prefix + "-"):
                return label, f"path_prefix:{first}"
    return None, ""


def infer_material_from_path(url: str) -> tuple[str | None, str]:
    segs = path_segments(url)
    for seg in segs:
        if seg in MATERIAL_TYPE_BY_PREFIX:
            return MATERIAL_TYPE_BY_PREFIX[seg], f"material_prefix:{seg}"
    return None, ""


def infer_direction_from_keywords(text: str) -> tuple[str | None, str]:
    if not text:
        return None, ""
    for pattern, label in KEYWORD_DIRECTION:
        if pattern.search(text):
            return label, f"keyword:{pattern.pattern[:40]}"
    return None, ""


def infer_material_from_keywords(text: str) -> tuple[str | None, str]:
    if not text:
        return None, ""
    for pattern, label in KEYWORD_MATERIAL:
        if pattern.search(text):
            return label, f"material_keyword:{pattern.pattern[:40]}"
    return None, ""


def probe_http_status(url: str, timeout: float = 6.0) -> int | None:
    """Return HTTP status for URL. None if unreachable / empty / invalid."""
    if not url or not str(url).startswith("http"):
        return None
    import urllib.error
    import urllib.request

    req = urllib.request.Request(
        url,
        method="HEAD",
        headers={"User-Agent": "ReportingDash-AbbottClassifier/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return int(getattr(resp, "status", None) or resp.getcode() or 0) or None
    except urllib.error.HTTPError as e:
        return int(e.code)
    except Exception:
        # Some servers reject HEAD — try lightweight GET
        try:
            req2 = urllib.request.Request(
                url,
                method="GET",
                headers={"User-Agent": "ReportingDash-AbbottClassifier/1.0", "Range": "bytes=0-0"},
            )
            with urllib.request.urlopen(req2, timeout=timeout) as resp:
                return int(getattr(resp, "status", None) or resp.getcode() or 0) or None
        except urllib.error.HTTPError as e:
            return int(e.code)
        except Exception:
            return None


def probe_http_statuses(urls: list[str], workers: int = 12) -> dict[str, int | None]:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    out: dict[str, int | None] = {}
    uniq = [u for u in dict.fromkeys(urls) if u]
    if not uniq:
        return out
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futs = {pool.submit(probe_http_status, u): u for u in uniq}
        for fut in as_completed(futs):
            u = futs[fut]
            try:
                out[u] = fut.result()
            except Exception:
                out[u] = None
    return out


def apply_http_status(result: Classification, status: int | None) -> Classification:
    result.http_status = status
    if status in HTTP_ARCHIVE_CODES:
        result.page_status = PAGE_STATUS_ARCHIVE
        result.lifecycle_code = "archive_candidate"
        result.material_type_rule = f"http_{status}"
        note = f"http={status} → Архив"
        result.notes = f"{result.notes}; {note}".strip("; ") if result.notes else note
        # still keep proposed direction for history, but flag archive
        result.rule = f"{result.rule}+archive_http_{status}" if result.rule else f"archive_http_{status}"
    return result


def classify_one(
    *,
    url: str,
    title: str = "",
    entity_kind: str = "page",
    index: WorkbookIndex,
    review_threshold: float = 0.75,
    registry: Any = None,
) -> Classification:
    norm = normalize_url(url)
    slug = extract_slug(norm or url)
    result = Classification(
        url=norm or url,
        title=title or "",
        slug=slug,
        entity_kind=entity_kind,
    )

    try:
        path = urlparse(norm).path.rstrip("/") or "/"
        if path in UTILITY_PATHS:
            result.rule = "utility_skip"
            result.confidence = 1.0
            result.needs_review = False
            result.notes = "utility page"
            return result
    except Exception:
        pass

    # 0) STABLE REGISTRY LOCK — older approved direction always wins; never flip
    if registry is not None:
        locked = registry.lookup(url=norm or url, slug=slug, title=title)
        if locked and locked.direction:
            result.direction = locked.direction
            result.material_type = locked.material_type or result.material_type
            result.access = locked.access or result.access
            result.title = result.title or locked.title or ""
            result.confidence = 1.0
            result.rule = f"registry_lock:{locked.source}"
            result.needs_review = False
            result.notes = f"locked_at={locked.approved_at}"
            return result

    # Events by URL
    if norm in index.events_by_url:
        ev = index.events_by_url[norm]
        result.entity_kind = "event"
        result.direction = ev.get("direction")
        result.material_type = ev.get("material_type") or "Мероприятия"
        result.access = ev.get("access")
        result.title = result.title or ev.get("title") or ""
        result.confidence = 0.98
        result.rule = "workbook_events_url"
        result.needs_review = False
        return result

    # Exact URL from workbook
    if norm in index.by_url:
        meta = index.by_url[norm]
        result.direction = meta.get("direction")
        result.material_type = meta.get("material_type")
        result.access = meta.get("access")
        result.title = result.title or meta.get("title") or ""
        result.confidence = 0.97
        result.rule = f"workbook_url:{meta.get('sheet')}"
        result.entity_kind = "general_material" if meta.get("sheet") == "general_materials" else result.entity_kind
        result.needs_review = result.direction is None
        return result

    # Title + inferred material type
    mat_from_path, mat_rule = infer_material_from_path(norm)
    mat_from_kw, mat_kw_rule = infer_material_from_keywords(f"{title} {norm}")
    if mat_from_path:
        result.material_type = result.material_type or mat_from_path
        result.material_type_rule = mat_rule
    elif mat_from_kw:
        result.material_type = result.material_type or mat_from_kw
        result.material_type_rule = mat_kw_rule

    if title and mat_from_path:
        key = f"{mat_from_path}::{title}"
        if key in index.by_title_type:
            meta = index.by_title_type[key]
            result.direction = meta.get("direction")
            result.material_type = meta.get("material_type") or mat_from_path
            result.material_type_rule = result.material_type_rule or "workbook_title_type"
            result.access = meta.get("access")
            if result.direction:
                result.confidence = 0.96
                result.rule = "workbook_title_type"
                result.needs_review = False
                return result
            # keep material/access, continue cascade for direction

    # Title only
    if title and title in index.by_title:
        meta = index.by_title[title]
        result.direction = meta.get("direction")
        result.material_type = result.material_type or meta.get("material_type") or mat_from_path
        result.access = result.access or meta.get("access")
        if result.direction:
            result.confidence = 0.94
            result.rule = "workbook_title"
            result.needs_review = False
            return result

    # Slug
    if slug and slug in index.by_slug:
        meta = index.by_slug[slug]
        result.direction = meta.get("direction")
        result.material_type = result.material_type or meta.get("material_type") or mat_from_path
        result.access = result.access or meta.get("access")
        result.title = result.title or meta.get("title") or ""
        if result.direction:
            result.confidence = 0.93
            result.rule = "workbook_slug"
            result.needs_review = False
            return result

    # Bitrix section id
    section_id = find_section_id(norm or url)
    if section_id:
        result.bitrix_id = section_id
        result.direction = DIRECTION_BY_QUERY_ID.get(section_id)
        result.material_type = result.material_type or mat_from_path
        result.confidence = 0.9
        result.rule = f"section_id:{section_id}"
        result.needs_review = False
        if not result.access and result.direction in ACCESS_DEFAULT_BY_DIR:
            result.access = ACCESS_DEFAULT_BY_DIR[result.direction]
        return result

    # Path prefix direction
    dir_path, dir_rule = infer_direction_from_path(norm)
    if dir_path:
        result.direction = dir_path
        result.material_type = result.material_type or mat_from_path
        result.confidence = 0.8 if result.material_type else 0.78
        result.rule = dir_rule + (f"+{mat_rule}" if mat_rule else "")
        result.needs_review = False
        if result.direction in ACCESS_DEFAULT_BY_DIR:
            result.access = result.access or ACCESS_DEFAULT_BY_DIR[result.direction]
        return result

    # Material type from path / prior workbook material only
    if result.material_type or mat_from_path:
        result.material_type = result.material_type or mat_from_path
        kw_dir, kw_rule = infer_direction_from_keywords(f"{title} {slug} {norm}")
        result.direction = kw_dir
        # With material already known from workbook/path, keyword direction is strong enough to propose
        result.confidence = 0.76 if kw_dir else 0.55
        base_rule = mat_rule or "workbook_material_only"
        result.rule = base_rule + (f"+{kw_rule}" if kw_rule else "")
        result.needs_review = result.confidence < review_threshold
        return result

    # Keywords only
    kw_dir, kw_rule = infer_direction_from_keywords(f"{title} {slug} {norm}")
    if kw_dir:
        result.direction = kw_dir
        result.confidence = 0.6
        result.rule = kw_rule
        result.needs_review = True
        return result

    result.rule = "unknown"
    result.confidence = 0.0
    result.needs_review = True
    result.notes = "no workbook/url/keyword match"
    return result


def load_candidates_csv(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            url = (row.get("url") or row.get("URL") or row.get("Страница") or "").strip()
            title = (row.get("title") or row.get("page_title") or row.get("Название") or "").strip()
            kind = (row.get("entity_kind") or row.get("kind") or "page").strip() or "page"
            if url or title:
                rows.append({"url": url, "title": title, "entity_kind": kind})
    return rows


def write_outputs(out_dir: Path, results: list[Classification]) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    jsonl_path = out_dir / "classifications.jsonl"
    review_path = out_dir / "review_queue.csv"
    proposed_path = out_dir / "proposed_pages_rows.csv"
    summary_path = out_dir / "summary.json"

    with jsonl_path.open("w", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(asdict(r), ensure_ascii=False) + "\n")

    review = [r for r in results if r.needs_review]
    review_fields = [
        "url",
        "title",
        "slug",
        "entity_kind",
        "direction",
        "material_type",
        "material_type_rule",
        "page_status",
        "http_status",
        "access",
        "confidence",
        "rule",
        "needs_review",
        "notes",
        "bitrix_id",
    ]
    with review_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=review_fields, extrasaction="ignore")
        w.writeheader()
        for r in review:
            w.writerow(asdict(r))

    # Rows that look ready to append to pages sheet (high conf + not already unknown)
    with proposed_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "Название",
                "Символьный код",
                "Направление",
                "Доступ",
                "Тип материала",
                "Активность",
                "page_status",
                "url",
                "confidence",
                "rule",
            ]
        )
        for r in results:
            if r.page_status != PAGE_STATUS_ARCHIVE:
                if r.needs_review or not r.direction:
                    continue
            if r.entity_kind not in ("page", "general_material"):
                continue
            activity = "Нет" if r.page_status == PAGE_STATUS_ARCHIVE else "Да"
            w.writerow(
                [
                    r.title or r.slug,
                    r.slug,
                    r.direction or "",
                    r.access or "",
                    r.material_type or "",
                    activity,
                    r.page_status,
                    r.url,
                    r.confidence,
                    r.rule,
                ]
            )

    by_rule = Counter(r.rule for r in results)
    by_dir = Counter(r.direction or "NULL" for r in results)
    by_mat = Counter(r.material_type or "NULL" for r in results)
    by_status = Counter(r.page_status or "NULL" for r in results)
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total": len(results),
        "needs_review": len(review),
        "labeled_direction": sum(1 for r in results if r.direction),
        "archive": sum(1 for r in results if r.page_status == PAGE_STATUS_ARCHIVE),
        "by_rule": dict(by_rule.most_common()),
        "by_direction": dict(by_dir.most_common()),
        "by_material_type": dict(by_mat.most_common()),
        "by_page_status": dict(by_status.most_common()),
        "outputs": {
            "classifications": str(jsonl_path),
            "review_queue": str(review_path),
            "proposed_pages_rows": str(proposed_path),
        },
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary


def self_test(index: WorkbookIndex) -> None:
    cases = [
        ("https://abbottpro.ru/gastro/foo", "", "Гастроэнтерология [262340]"),
        ("https://abbottpro.ru/video/262339", "Some video", "Неврология и психиатрия [262339]"),
        ("https://abbottpro.ru/cardio/articles/bar", "", "Кардиология [262338]"),
        ("https://abbottpro.ru/farmatsevtam/personal/articles/x", "", "Фармацевты"),
        ("https://abbottpro.ru/auth", "", None),
    ]
    ok = 0
    for url, title, expected in cases:
        r = classify_one(url=url, title=title, index=index)
        got = r.direction
        status = "OK" if got == expected else "FAIL"
        if status == "OK":
            ok += 1
        print(f"  [{status}] {url} -> {got} (rule={r.rule}, conf={r.confidence})")
    print(f"self-test {ok}/{len(cases)}")
    if ok != len(cases):
        raise SystemExit(1)


def build_candidates_from_workbook_gaps(index: WorkbookIndex) -> list[dict[str, str]]:
    """Use known titles without direction as synthetic candidates for demo/backfill."""
    out: list[dict[str, str]] = []
    for title, meta in index.by_title.items():
        if meta.get("direction"):
            continue
        slug = meta.get("slug") or ""
        url = f"https://abbottpro.ru/{slug}" if slug else ""
        out.append({"url": url, "title": title, "entity_kind": "page"})
    return out


def load_mysql_env() -> dict[str, str]:
    env: dict[str, str] = {}
    root = Path(__file__).resolve().parents[2]
    for rel in (".env", "dashboard-next/.env"):
        p = root / rel
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            env[k] = v
    return env


def discover_new_pages_from_metrika(
    index: WorkbookIndex,
    registry: Any = None,
    *,
    days: int = 90,
    min_pageviews: int = 1,
    limit: int = 5000,
) -> list[dict[str, str]]:
    """Pages seen in Metrika/canonical that are not yet locked and not fully labeled in workbook.

    Source: report_bd.canonical_fact_site_analytics_daily (analytics_scope=page, counter 90602537).
    """
    try:
        import pymysql
    except ImportError as exc:  # pragma: no cover
        raise SystemExit("pymysql required for --from-metrika-new") from exc

    env = load_mysql_env()
    host = env.get("MYSQL_HOST", "5.35.85.218")
    user = env.get("MYSQL_USER", "report_bd")
    password = env.get("MYSQL_PASSWORD") or env.get("MYSQL_PASS") or env.get("DB_PASSWORD") or ""
    db = env.get("MYSQL_DB", "report_bd")
    if not password:
        raise SystemExit("MYSQL password not found in ReportingDash .env")

    conn = pymysql.connect(
        host=host, user=user, password=password, database=db, connect_timeout=20, charset="utf8mb4"
    )
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
          COALESCE(page_url, '') AS url,
          COALESCE(page_title, '') AS title,
          SUM(COALESCE(pageviews, 0)) AS pv
        FROM canonical_fact_site_analytics_daily
        WHERE source_key = 'yandex_metrika'
          AND analytics_account_id = '90602537'
          AND analytics_scope = 'page'
          AND report_date >= DATE_SUB(CURDATE(), INTERVAL %s DAY)
        GROUP BY COALESCE(page_url, ''), COALESCE(page_title, '')
        HAVING pv >= %s
        ORDER BY pv DESC
        LIMIT %s
        """,
        (days, min_pageviews, limit),
    )
    rows = cur.fetchall()
    conn.close()

    out: list[dict[str, str]] = []
    for url, title, pv in rows:
        url = normalize_url(str(url or ""))
        title = str(title or "").strip()
        if not url and not title:
            continue
        try:
            path = urlparse(url).path.rstrip("/") or "/"
            if path in UTILITY_PATHS:
                continue
        except Exception:
            pass
        slug = extract_slug(url)
        # Skip if already locked
        if registry is not None and registry.is_locked(url=url, slug=slug, title=title):
            continue
        # Skip if workbook already has a direction for title/slug/url
        if url and url in index.by_url and index.by_url[url].get("direction"):
            continue
        if title and title in index.by_title and index.by_title[title].get("direction"):
            continue
        if slug and slug in index.by_slug and index.by_slug[slug].get("direction"):
            continue
        out.append(
            {
                "url": url,
                "title": title,
                "entity_kind": "page",
                "pageviews": str(int(pv or 0)),
            }
        )
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Abbott page direction classifier")
    parser.add_argument(
        "--workbook",
        type=Path,
        default=Path("/Users/nafanya/ReportingDash/Abbott names.xlsx"),
        help="Path to Abbott names.xlsx",
    )
    parser.add_argument("--candidates-csv", type=Path, help="CSV with url,title[,entity_kind]")
    parser.add_argument(
        "--from-workbook-gaps",
        action="store_true",
        help="Classify workbook pages that currently lack direction",
    )
    parser.add_argument(
        "--from-metrika-new",
        action="store_true",
        help="Discover NEW pages from Metrika canonical facts not yet locked/labeled",
    )
    parser.add_argument("--metrika-days", type=int, default=90)
    parser.add_argument("--metrika-min-pv", type=int, default=1)
    parser.add_argument(
        "--registry",
        type=Path,
        default=Path(__file__).resolve().parent / "out" / "direction_registry.jsonl",
        help="Stable direction registry (older locks win)",
    )
    parser.add_argument(
        "--approve-queue-only",
        action="store_true",
        help="Output only rows that still need human batch approve (not registry-locked)",
    )
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "out")
    parser.add_argument("--review-threshold", type=float, default=0.75)
    parser.add_argument(
        "--check-http",
        action="store_true",
        default=True,
        help="Probe URLs; 404/410 → page_status=Архив (default on)",
    )
    parser.add_argument(
        "--no-check-http",
        action="store_true",
        help="Skip HTTP probes (faster offline)",
    )
    parser.add_argument("--http-workers", type=int, default=12)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if not args.workbook.exists():
        print(f"Workbook not found: {args.workbook}", file=sys.stderr)
        return 2

    print(f"Loading workbook: {args.workbook}")
    index = load_workbook(args.workbook)
    print(
        f"Index: titles={len(index.by_title)} slugs={len(index.by_slug)} "
        f"urls={len(index.by_url)} bitrix_ids={len(index.by_bitrix_id)} events={len(index.events_by_url)}"
    )

    registry = None
    try:
        from registry import DirectionRegistry

        registry = DirectionRegistry(args.registry)
        print(f"Registry: {registry.stats()}")
    except Exception as exc:  # noqa: BLE001
        print(f"Registry not loaded ({exc}); continuing without locks")

    if args.self_test:
        self_test(index)
        return 0

    candidates: list[dict[str, str]] = []
    if args.candidates_csv:
        candidates.extend(load_candidates_csv(args.candidates_csv))
    if args.from_metrika_new:
        new_pages = discover_new_pages_from_metrika(
            index,
            registry,
            days=args.metrika_days,
            min_pageviews=args.metrika_min_pv,
        )
        print(f"Metrika new/unlocked pages: {len(new_pages)}")
        candidates.extend(new_pages)
    if args.from_workbook_gaps or not candidates:
        gaps = build_candidates_from_workbook_gaps(index)
        # Drop gaps that are already registry-locked
        if registry is not None:
            gaps = [
                g
                for g in gaps
                if not registry.is_locked(
                    url=g.get("url", ""), title=g.get("title", ""), slug=extract_slug(g.get("url", ""))
                )
            ]
        print(f"Workbook gaps without direction (unlocked): {len(gaps)}")
        if not candidates:
            candidates = gaps
        elif args.from_workbook_gaps:
            candidates.extend(gaps)

    # de-dupe by url+title
    seen: set[str] = set()
    uniq: list[dict[str, str]] = []
    for c in candidates:
        k = f"{normalize_url(c.get('url',''))}\n{c.get('title','')}"
        if k in seen:
            continue
        seen.add(k)
        uniq.append(c)
    candidates = uniq

    results = [
        classify_one(
            url=c.get("url", ""),
            title=c.get("title", ""),
            entity_kind=c.get("entity_kind", "page"),
            index=index,
            review_threshold=args.review_threshold,
            registry=registry,
        )
        for c in candidates
    ]

    if args.approve_queue_only:
        results = [r for r in results if not (r.rule or "").startswith("registry_lock")]

    do_http = args.check_http and not args.no_check_http
    if do_http:
        urls = [r.url for r in results if r.url and str(r.url).startswith("http")]
        print(f"HTTP probe: {len(urls)} urls (workers={args.http_workers})")
        statuses = probe_http_statuses(urls, workers=args.http_workers)
        for r in results:
            if r.url in statuses:
                apply_http_status(r, statuses[r.url])
        archive_n = sum(1 for r in results if r.page_status == PAGE_STATUS_ARCHIVE)
        print(f"HTTP archive (404/410): {archive_n}")

    summary = write_outputs(args.out, results)
    summary["registry"] = str(args.registry)
    summary["candidate_count"] = len(candidates)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
