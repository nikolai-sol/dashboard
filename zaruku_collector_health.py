#!/usr/bin/env python3
"""Read-only Zaruku collector health and failed-lineage completeness model."""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Mapping, Optional


ZARUKU_ACCOUNT_ID = "66624469"
ZARUKU_DATA_LAG_DAYS: int = 3

ZARUKU_SOURCES: Dict[str, Dict[str, Any]] = {
    "yandex_webmaster": {
        "label": "Яндекс Вебмастер",
        "collector": "fetch_yandex_webmaster_canonical.py",
        "expected_frequency_hours": 24,
    },
    "yandex_metrika": {
        "label": "Яндекс Метрика",
        "collector": "fetch_yandex_metrika_canonical.py",
        "expected_frequency_hours": 24,
    },
    "yandex_metrika_returning": {
        "label": "Яндекс Метрика · возвратный контент",
        "collector": "fetch_yandex_metrika_returning_canonical.py",
        "expected_frequency_hours": 24,
    },
    "google_search_console": {
        "label": "Google Search Console",
        "collector": "fetch_gsc_canonical.py",
        "expected_frequency_hours": 24,
    },
}

_FACT_LAYERS: List[Dict[str, Any]] = [
    {
        "source_key": "yandex_metrika",
        "layer": "metrika_site_analytics",
        "table": "canonical_fact_site_analytics_daily",
        "account_column": "analytics_account_id",
        "string_run_id": False,
    },
    {
        "source_key": "yandex_metrika_returning",
        "layer": "metrika_returning_pages",
        "table": "canonical_fact_metrika_returning_pages_daily",
        "account_column": "counter_id",
        "string_run_id": False,
    },
    {
        "source_key": "google_search_console",
        "layer": "gsc_queries",
        "table": "canonical_fact_gsc_queries_daily",
        "account_column": "analytics_account_id",
        "string_run_id": True,
    },
    {
        "source_key": "yandex_webmaster",
        "layer": "webmaster_queries",
        "table": "canonical_fact_webmaster_queries_daily",
        "account_column": "analytics_account_id",
        "string_run_id": False,
    },
    {
        "source_key": "yandex_webmaster",
        "layer": "webmaster_summary",
        "table": "canonical_fact_webmaster_summary_daily",
        "account_column": "analytics_account_id",
        "string_run_id": False,
    },
    {
        "source_key": "yandex_webmaster",
        "layer": "webmaster_pages",
        "table": "canonical_fact_webmaster_pages_daily",
        "account_column": "analytics_account_id",
        "string_run_id": False,
    },
]


def _partial_branch(layer: Mapping[str, Any]) -> str:
    run_join = "CAST(f.ingestion_run_id AS UNSIGNED)" if layer["string_run_id"] else "f.ingestion_run_id"
    numeric_guard = (
        "\n  AND f.ingestion_run_id REGEXP '^[0-9]+$'"
        if layer["string_run_id"]
        else ""
    )
    return """
SELECT
  '{source_key}' AS source_key,
  '{layer_name}' AS layer,
  f.report_date,
  f.ingestion_run_id,
  r.run_type,
  r.status AS run_status,
  COUNT(*) AS row_count
FROM {table} AS f
JOIN canonical_collector_runs AS r
  ON r.id = {run_join}
WHERE f.{account_column} = '{account_id}'{numeric_guard}
  AND r.status = 'failed'
GROUP BY f.report_date, f.ingestion_run_id, r.run_type, r.status
""".format(
        source_key=layer["source_key"],
        layer_name=layer["layer"],
        table=layer["table"],
        run_join=run_join,
        account_column=layer["account_column"],
        account_id=ZARUKU_ACCOUNT_ID,
        numeric_guard=numeric_guard,
    ).strip()


PARTIAL_FACT_DATES_SQL = "\nUNION ALL\n".join(_partial_branch(layer) for layer in _FACT_LAYERS) + "\nORDER BY report_date, source_key, layer, ingestion_run_id"


def _lineage_branches(layer: Mapping[str, Any]) -> List[str]:
    common = {
        "source_key": layer["source_key"],
        "layer_name": layer["layer"],
        "table": layer["table"],
        "account_column": layer["account_column"],
        "account_id": ZARUKU_ACCOUNT_ID,
    }
    branches = [
        """
SELECT '{source_key}' AS source_key, '{layer_name}' AS layer,
       'missing_run_reference' AS defect_type, COUNT(*) AS row_count
FROM {table} AS f
WHERE f.{account_column} = '{account_id}'
  AND f.ingestion_run_id IS NULL
""".format(**common).strip()
    ]
    if layer["string_run_id"]:
        branches.append(
            """
SELECT '{source_key}' AS source_key, '{layer_name}' AS layer,
       'non_castable_run_id' AS defect_type, COUNT(*) AS row_count
FROM {table} AS f
WHERE f.{account_column} = '{account_id}'
  AND f.ingestion_run_id IS NOT NULL
  AND f.ingestion_run_id NOT REGEXP '^[0-9]+$'
""".format(**common).strip()
        )
        join_value = "CAST(f.ingestion_run_id AS UNSIGNED)"
        guard = "\n  AND f.ingestion_run_id REGEXP '^[0-9]+$'"
    else:
        join_value = "f.ingestion_run_id"
        guard = ""
    branches.append(
        """
SELECT '{source_key}' AS source_key, '{layer_name}' AS layer,
       'orphan_run_id' AS defect_type, COUNT(*) AS row_count
FROM {table} AS f
LEFT JOIN canonical_collector_runs AS r
  ON r.id = {join_value}
WHERE f.{account_column} = '{account_id}'
  AND f.ingestion_run_id IS NOT NULL{guard}
  AND r.id IS NULL
""".format(join_value=join_value, guard=guard, **common).strip()
    )
    return branches


LINEAGE_DEFECTS_SQL = "\nUNION ALL\n".join(
    branch for layer in _FACT_LAYERS for branch in _lineage_branches(layer)
) + "\nORDER BY source_key, layer, defect_type"


_LATEST_RUNS_SQL = """
SELECT r.source_key, r.id AS run_id, r.status AS run_status, r.run_type,
       r.started_at AS run_started_at, r.finished_at AS run_finished_at,
       r.rows_read, r.rows_written, r.error_count, r.error_summary
FROM canonical_collector_runs AS r
JOIN (
  SELECT source_key, MAX(id) AS max_id
  FROM canonical_collector_runs
  WHERE source_key IN ({})
  GROUP BY source_key
) AS latest ON latest.max_id = r.id
ORDER BY FIELD(r.source_key, {})
""".format(
    ", ".join(["%s"] * len(ZARUKU_SOURCES)),
    ", ".join(["%s"] * len(ZARUKU_SOURCES)),
)

_MAX_DATE_SQL = {
    "yandex_metrika": """
        SELECT MAX(report_date) AS max_data_date
        FROM canonical_fact_site_analytics_daily
        WHERE analytics_account_id = %s
    """,
    "yandex_metrika_returning": """
        SELECT MAX(report_date) AS max_data_date
        FROM canonical_fact_metrika_returning_pages_daily
        WHERE counter_id = %s
    """,
    "google_search_console": """
        SELECT MAX(report_date) AS max_data_date
        FROM canonical_fact_gsc_queries_daily
        WHERE analytics_account_id = %s
    """,
    "yandex_webmaster": """
        SELECT
          (SELECT MAX(report_date) FROM canonical_fact_webmaster_queries_daily
           WHERE analytics_account_id = %s) AS query_max_date,
          (SELECT MAX(report_date) FROM canonical_fact_webmaster_pages_daily
           WHERE analytics_account_id = %s) AS page_max_date
    """,
}


def _as_dict(row: Any, columns: Optional[List[str]] = None) -> Dict[str, Any]:
    if isinstance(row, Mapping):
        return dict(row)
    if columns is None:
        raise TypeError("Zaruku health cursor must return dictionary rows")
    return dict(zip(columns, row))


def _as_date(value: Any) -> Optional[date]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def _as_utc_datetime(value: Any) -> Optional[datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _calendar_age(value: Any, now_utc: datetime) -> Optional[int]:
    parsed = _as_date(value)
    if parsed is None:
        return None
    return (now_utc.astimezone(timezone.utc).date() - parsed).days


def load_zaruku_health(cursor: Any, now_utc: datetime) -> List[Dict[str, Any]]:
    """Load latest run and fact-date health without creating a DB connection."""
    source_keys = list(ZARUKU_SOURCES)
    cursor.execute(_LATEST_RUNS_SQL, tuple(source_keys + source_keys))
    runs = {_as_dict(row)["source_key"]: _as_dict(row) for row in cursor.fetchall()}
    health: List[Dict[str, Any]] = []
    for source_key, config in ZARUKU_SOURCES.items():
        params = (ZARUKU_ACCOUNT_ID, ZARUKU_ACCOUNT_ID) if source_key == "yandex_webmaster" else (ZARUKU_ACCOUNT_ID,)
        cursor.execute(_MAX_DATE_SQL[source_key], params)
        fact_row = _as_dict(cursor.fetchone() or {})
        query_max_date = _as_date(fact_row.get("query_max_date"))
        page_max_date = _as_date(fact_row.get("page_max_date"))
        if source_key == "yandex_webmaster":
            available_dates = [item for item in (query_max_date, page_max_date) if item is not None]
            max_data_date = min(available_dates) if len(available_dates) == 2 else None
        else:
            max_data_date = _as_date(fact_row.get("max_data_date"))
        run = runs.get(source_key, {})
        health.append(
            {
                "source_key": source_key,
                "label": config["label"],
                "collector": config["collector"],
                "expected_frequency_hours": config["expected_frequency_hours"],
                "run_id": run.get("run_id"),
                "run_status": run.get("run_status"),
                "run_type": run.get("run_type"),
                "run_started_at": _as_utc_datetime(run.get("run_started_at")),
                "run_finished_at": _as_utc_datetime(run.get("run_finished_at")),
                "rows_read": int(run.get("rows_read") or 0),
                "rows_written": int(run.get("rows_written") or 0),
                "error_count": int(run.get("error_count") or 0),
                "max_data_date": max_data_date,
                "data_lag_days": _calendar_age(max_data_date, now_utc),
                "query_max_date": query_max_date,
                "page_max_date": page_max_date,
            }
        )
    return health


def load_partial_fact_dates(cursor: Any) -> List[Dict[str, Any]]:
    cursor.execute(PARTIAL_FACT_DATES_SQL)
    return [_as_dict(row) for row in cursor.fetchall()]


def load_lineage_defects(cursor: Any) -> List[Dict[str, Any]]:
    cursor.execute(LINEAGE_DEFECTS_SQL)
    return [_as_dict(row) for row in cursor.fetchall()]


def _date_text(value: Any) -> str:
    parsed = _as_date(value)
    if parsed is None:
        return ""
    return parsed.isoformat()


def build_partial_date_scope(rows: List[Mapping[str, Any]]) -> Dict[str, Any]:
    normalized_rows: List[Dict[str, Any]] = []
    layers: Dict[str, Dict[str, Any]] = {}
    sources: Dict[str, Dict[str, Any]] = {}
    all_dates = set()
    total_rows = 0
    for raw in rows:
        report_date = _date_text(raw.get("report_date"))
        if not report_date:
            continue
        row_count = int(raw.get("row_count") or 0)
        source_key = str(raw.get("source_key") or "unknown")
        layer = str(raw.get("layer") or "unknown")
        normalized = dict(raw)
        normalized["report_date"] = report_date
        normalized["row_count"] = row_count
        normalized_rows.append(normalized)
        total_rows += row_count
        all_dates.add(report_date)
        layer_scope = layers.setdefault(layer, {"source_key": source_key, "dates": set(), "row_count": 0})
        layer_scope["dates"].add(report_date)
        layer_scope["row_count"] += row_count
        source_scope = sources.setdefault(source_key, {"dates": set(), "row_count": 0, "layers": set()})
        source_scope["dates"].add(report_date)
        source_scope["row_count"] += row_count
        source_scope["layers"].add(layer)

    rendered_layers: Dict[str, Dict[str, Any]] = {}
    for layer, value in sorted(layers.items()):
        dates = sorted(value["dates"])
        rendered_layers[layer] = {
            "source_key": value["source_key"],
            "dates": dates,
            "distinct_date_count": len(dates),
            "row_count": value["row_count"],
        }
    rendered_sources: Dict[str, Dict[str, Any]] = {}
    for source_key, value in sorted(sources.items()):
        dates = sorted(value["dates"])
        rendered_sources[source_key] = {
            "dates": dates,
            "distinct_date_count": len(dates),
            "row_count": value["row_count"],
            "layers": sorted(value["layers"]),
        }
    return {
        "dates": sorted(all_dates),
        "distinct_date_count": len(all_dates),
        "row_count": total_rows,
        "layer_count": len(rendered_layers),
        "layers": rendered_layers,
        "sources": rendered_sources,
        "rows": sorted(
            normalized_rows,
            key=lambda item: (
                item["report_date"],
                str(item.get("source_key") or ""),
                str(item.get("layer") or ""),
                str(item.get("ingestion_run_id") or ""),
            ),
        ),
    }


def build_lineage_defect_scope(rows: List[Mapping[str, Any]]) -> Dict[str, Any]:
    by_type: Dict[str, int] = {}
    by_layer: Dict[str, int] = {}
    normalized_rows: List[Dict[str, Any]] = []
    total = 0
    for raw in rows:
        count = int(raw.get("row_count") or 0)
        if count <= 0:
            continue
        defect_type = str(raw.get("defect_type") or "unknown")
        layer = str(raw.get("layer") or "unknown")
        item = dict(raw)
        item["row_count"] = count
        normalized_rows.append(item)
        total += count
        by_type[defect_type] = by_type.get(defect_type, 0) + count
        by_layer[layer] = by_layer.get(layer, 0) + count
    return {
        "row_count": total,
        "by_type": dict(sorted(by_type.items())),
        "by_layer": dict(sorted(by_layer.items())),
        "rows": sorted(normalized_rows, key=lambda item: (str(item.get("source_key")), str(item.get("layer")), str(item.get("defect_type")))),
    }


def _incident_key(day: str, source_key: str, incident_type: str, details: Mapping[str, Any]) -> str:
    fingerprint = hashlib.sha256(
        json.dumps(details, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()[:16]
    return "zaruku|{}|{}|{}|{}".format(day, source_key, incident_type, fingerprint)


def _incident(day: str, source_key: str, label: str, incident_type: str, details: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "incident_key": _incident_key(day, source_key, incident_type, details),
        "source_key": source_key,
        "label": label,
        "incident_type": incident_type,
        "details": details,
    }


def build_zaruku_incidents(
    health: List[Mapping[str, Any]],
    partial_scope: Mapping[str, Any],
    now_utc: datetime,
) -> List[Dict[str, Any]]:
    now = _as_utc_datetime(now_utc) or now_utc.replace(tzinfo=timezone.utc)
    day = now.date().isoformat()
    incidents: List[Dict[str, Any]] = []
    for row in health:
        source_key = str(row.get("source_key") or "unknown")
        label = str(row.get("label") or ZARUKU_SOURCES.get(source_key, {}).get("label") or source_key)
        run_status = str(row.get("run_status") or "missing")
        if run_status == "failed":
            details = {"run_id": row.get("run_id"), "run_status": run_status, "run_type": row.get("run_type")}
            incidents.append(_incident(day, source_key, label, "run_failed", details))

        max_data_date = _as_date(row.get("max_data_date"))
        lag_days = _calendar_age(max_data_date, now)
        if max_data_date is None:
            incidents.append(_incident(day, source_key, label, "data_missing", {"max_data_date": None}))
        elif lag_days is not None and lag_days > ZARUKU_DATA_LAG_DAYS:
            incidents.append(
                _incident(
                    day,
                    source_key,
                    label,
                    "data_lag",
                    {"max_data_date": max_data_date.isoformat(), "lag_days": lag_days, "threshold_days": ZARUKU_DATA_LAG_DAYS},
                )
            )

        last_run_at = _as_utc_datetime(row.get("run_finished_at") or row.get("run_started_at"))
        expected_hours = int(row.get("expected_frequency_hours") or 0)
        if run_status != "failed" and expected_hours > 0:
            age_hours = None if last_run_at is None else (now - last_run_at).total_seconds() / 3600
            if age_hours is None or age_hours > expected_hours:
                incidents.append(
                    _incident(
                        day,
                        source_key,
                        label,
                        "heartbeat",
                        {
                            "last_run_at": last_run_at.isoformat() if last_run_at else None,
                            "age_hours": None if age_hours is None else round(age_hours, 2),
                            "expected_frequency_hours": expected_hours,
                        },
                    )
                )

        query_date = _as_date(row.get("query_max_date"))
        page_date = _as_date(row.get("page_max_date"))
        if query_date is not None and page_date is not None:
            difference_days = abs((query_date - page_date).days)
            if difference_days > 1:
                incidents.append(
                    _incident(
                        day,
                        source_key,
                        label,
                        "layer_divergence",
                        {
                            "query_max_date": query_date.isoformat(),
                            "page_max_date": page_date.isoformat(),
                            "difference_days": difference_days,
                        },
                    )
                )

    sources = partial_scope.get("sources") or {}
    for source_key in sorted(sources):
        value = sources[source_key]
        details = {
            "dates": list(value.get("dates") or []),
            "distinct_date_count": int(value.get("distinct_date_count") or 0),
            "row_count": int(value.get("row_count") or 0),
            "layers": list(value.get("layers") or []),
        }
        label = str(ZARUKU_SOURCES.get(source_key, {}).get("label") or source_key)
        incidents.append(_incident(day, source_key, label, "partial_dates", details))
    return incidents


__all__ = [
    "LINEAGE_DEFECTS_SQL",
    "PARTIAL_FACT_DATES_SQL",
    "ZARUKU_DATA_LAG_DAYS",
    "ZARUKU_SOURCES",
    "build_lineage_defect_scope",
    "build_partial_date_scope",
    "build_zaruku_incidents",
    "load_lineage_defects",
    "load_partial_fact_dates",
    "load_zaruku_health",
]
