"""Canonical row normalization for Zaruku's Metrika dashboard breakdowns."""

from dataclasses import dataclass
from datetime import date
import hashlib
import json
from typing import Any, Mapping, Optional, Sequence, Union


SOURCE_KEY = "yandex_metrika"
BREAKDOWN_METRICS = (
    "ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate,"
    "ym:s:avgVisitDurationSeconds,ym:s:pageDepth"
)


@dataclass(frozen=True)
class BreakdownReport:
    report_key: str
    dimensions: tuple[str, ...]
    segment_key: str = "russia"
    filters: str = "ym:s:regionCountry=='Russia'"

    @property
    def metrics(self) -> str:
        return BREAKDOWN_METRICS


ZARUKU_BREAKDOWN_REPORTS: tuple[BreakdownReport, ...] = (
    BreakdownReport("search_engines", ("ym:s:searchEngine",)),
    BreakdownReport("search_phrases", ("ym:s:searchPhrase",)),
    BreakdownReport(
        "organic_landing", ("ym:s:searchEngine", "ym:s:startURL")
    ),
    BreakdownReport("section_entrances", ("ym:s:startURL",)),
    BreakdownReport(
        "map_city_demand", ("ym:s:regionCity", "ym:s:startURL")
    ),
    BreakdownReport("devices", ("ym:s:deviceCategory",)),
    BreakdownReport("browsers", ("ym:s:browser",)),
    BreakdownReport("operating_systems", ("ym:s:operatingSystem",)),
    BreakdownReport("age_intervals", ("ym:s:ageInterval",)),
    BreakdownReport("genders", ("ym:s:gender",)),
    BreakdownReport("interests", ("ym:s:interest",)),
    BreakdownReport(
        "source_devices",
        ("ym:s:lastTrafficSource", "ym:s:deviceCategory"),
    ),
)


def _day_text(day: Union[str, date]) -> str:
    if isinstance(day, date):
        return day.isoformat()
    return str(day)


def _optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _metric(metrics: Sequence[Any], index: int) -> Any:
    if index >= len(metrics):
        return None
    return metrics[index]


def _integer_metric(metrics: Sequence[Any], index: int) -> Optional[int]:
    value = _metric(metrics, index)
    if value is None or value == "":
        return None
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _float_metric(metrics: Sequence[Any], index: int) -> Optional[float]:
    value = _metric(metrics, index)
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _dimension_hash(parts: Sequence[Optional[str]]) -> str:
    payload = json.dumps(
        list(parts),
        ensure_ascii=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _dimension(
    report: BreakdownReport,
    dimensions: Sequence[Any],
    index: int,
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    if index >= len(report.dimensions):
        return None, None, None
    dimension_key = report.dimensions[index]
    item = dimensions[index] if index < len(dimensions) else None
    if not isinstance(item, Mapping):
        return dimension_key, None, None
    return (
        dimension_key,
        _optional_text(item.get("id")),
        _optional_text(item.get("name")),
    )


def _build_row(
    account_id: str,
    day: Union[str, date],
    report: BreakdownReport,
    row_kind: str,
    dimensions: Sequence[Any],
    metrics: Sequence[Any],
    run_id: int,
) -> dict:
    account_text = str(account_id)
    report_date = _day_text(day)
    dimension_1_key, dimension_1_id, dimension_1_value = _dimension(
        report, dimensions, 0
    )
    dimension_2_key, dimension_2_id, dimension_2_value = _dimension(
        report, dimensions, 1
    )
    page_url = None
    if dimension_1_key == "ym:s:startURL":
        page_url = dimension_1_value
    elif dimension_2_key == "ym:s:startURL":
        page_url = dimension_2_value
    dimension_hash = _dimension_hash(
        (
            account_text,
            report_date,
            report.report_key,
            report.segment_key,
            row_kind,
            dimension_1_key,
            dimension_1_id,
            dimension_1_value,
            dimension_2_key,
            dimension_2_id,
            dimension_2_value,
        )
    )
    return {
        "source_key": SOURCE_KEY,
        "analytics_account_id": account_text,
        "report_date": report_date,
        "report_key": report.report_key,
        "segment_key": report.segment_key,
        "row_kind": row_kind,
        "dimension_1_key": dimension_1_key,
        "dimension_1_id": dimension_1_id,
        "dimension_1_value": dimension_1_value,
        "dimension_2_key": dimension_2_key,
        "dimension_2_id": dimension_2_id,
        "dimension_2_value": dimension_2_value,
        "page_url": page_url,
        "dimension_hash": dimension_hash,
        "visits": _integer_metric(metrics, 0),
        "users": _integer_metric(metrics, 1),
        "new_users": None,
        "pageviews": _integer_metric(metrics, 2),
        "bounce_rate": _float_metric(metrics, 3),
        "avg_visit_duration_seconds": _float_metric(metrics, 4),
        "page_depth": _float_metric(metrics, 5),
        "ingestion_run_id": run_id,
    }


def build_breakdown_rows(
    account_id: str,
    day: Union[str, date],
    report: BreakdownReport,
    response: Mapping[str, Any],
    run_id: int,
) -> list[dict]:
    rows: list[dict] = []
    response_rows = response.get("data")
    if isinstance(response_rows, list):
        for item in response_rows:
            if not isinstance(item, Mapping):
                continue
            dimensions = item.get("dimensions")
            metrics = item.get("metrics")
            rows.append(
                _build_row(
                    account_id,
                    day,
                    report,
                    "detail",
                    dimensions if isinstance(dimensions, (list, tuple)) else (),
                    metrics if isinstance(metrics, (list, tuple)) else (),
                    run_id,
                )
            )

    totals = response.get("totals")
    if isinstance(totals, (list, tuple)):
        rows.append(
            _build_row(
                account_id,
                day,
                report,
                "total",
                (),
                totals,
                run_id,
            )
        )
    return rows


def build_coverage_row(
    account_id: str,
    day: Union[str, date],
    report: BreakdownReport,
    response: Mapping[str, Any],
    rows: Sequence[Mapping[str, Any]],
    run_id: int,
) -> dict:
    detail_rows = sum(1 for row in rows if row.get("row_kind") == "detail")
    api_total_rows = response.get("total_rows")
    if (
        isinstance(api_total_rows, bool)
        or not isinstance(api_total_rows, int)
        or api_total_rows < 0
    ):
        raise ValueError("total_rows must be an explicit nonnegative integer")
    if response.get("pagination_complete") is not True:
        raise ValueError("pagination_complete must be explicitly true")
    if api_total_rows != detail_rows:
        raise ValueError(
            "Metrika total_rows does not match normalized detail-row count"
        )
    return {
        "source_key": SOURCE_KEY,
        "analytics_account_id": str(account_id),
        "report_date": _day_text(day),
        "report_key": report.report_key,
        "segment_key": report.segment_key,
        "status": "success" if detail_rows else "empty",
        "api_total_rows": api_total_rows,
        "persisted_rows": len(rows),
        "pagination_complete": 1,
        "ingestion_run_id": run_id,
    }
