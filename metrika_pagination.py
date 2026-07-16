from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class PaginationResult:
    rows: tuple[dict, ...]
    total_rows: int | None
    pages_fetched: int
    pagination_complete: bool
    sampled: bool
    sample_share: float | None


def _reported_total(response: dict[str, Any]) -> tuple[int | None, bool]:
    if "total_rows" not in response:
        return None, False
    try:
        value = int(response["total_rows"])
    except (TypeError, ValueError):
        return None, False
    return (value, True) if value >= 0 else (None, False)


def _sampling_metadata(response: dict[str, Any]) -> tuple[bool, float | None, bool]:
    sampled = bool(response.get("sampled", False))
    raw_share = response.get("sample_share")
    if raw_share is None:
        return sampled, None, True
    try:
        return sampled, float(raw_share), True
    except (TypeError, ValueError):
        return sampled, None, False


def collect_all_pages(
    fetch_page: Callable[[int], dict[str, Any]],
    *,
    limit: int = 10_000,
) -> PaginationResult:
    if limit <= 0:
        raise ValueError("Metrika page limit must be positive")

    rows: list[dict] = []
    offset = 1
    pages_fetched = 0
    expected_total: int | None = None
    expected_sampling: tuple[bool, float | None] | None = None
    evidence_consistent = True
    total_evidence_present = True

    while True:
        raw_response = fetch_page(offset)
        response = raw_response if isinstance(raw_response, dict) else {}
        pages_fetched += 1

        page_rows = response.get("data")
        if not isinstance(page_rows, list):
            page_rows = []

        reported_total, total_valid = _reported_total(response)
        total_evidence_present = total_evidence_present and total_valid
        sampled, sample_share, sampling_valid = _sampling_metadata(response)
        if pages_fetched == 1:
            expected_total = reported_total
            expected_sampling = (sampled, sample_share)
        else:
            if reported_total != expected_total:
                evidence_consistent = False
            if (sampled, sample_share) != expected_sampling:
                evidence_consistent = False
        evidence_consistent = evidence_consistent and total_valid and sampling_valid
        rows.extend(page_rows)

        if not evidence_consistent:
            break
        if expected_total is not None and len(rows) >= expected_total:
            break
        if len(page_rows) < limit:
            break

        next_offset = offset + len(page_rows)
        if next_offset <= offset:
            evidence_consistent = False
            break
        offset = next_offset

    total_rows = expected_total if total_evidence_present else None
    complete = (
        evidence_consistent
        and total_rows is not None
        and len(rows) == total_rows
    )
    result_sampled, result_sample_share = expected_sampling or (False, None)
    return PaginationResult(
        rows=tuple(rows),
        total_rows=total_rows,
        pages_fetched=pages_fetched,
        pagination_complete=complete,
        sampled=result_sampled,
        sample_share=result_sample_share,
    )


def collect_all_rows(
    fetch_page: Callable[[int], dict[str, Any]],
    *,
    limit: int = 10_000,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 1

    while True:
        response = fetch_page(offset)
        page_rows = response.get("data") if isinstance(response, dict) else []
        if not isinstance(page_rows, list):
            page_rows = []
        rows.extend(page_rows)

        total_rows = response.get("total_rows") if isinstance(response, dict) else None
        try:
            total_rows_value = int(total_rows) if total_rows is not None else None
        except (TypeError, ValueError):
            total_rows_value = None

        if not page_rows or len(page_rows) < limit or (
            total_rows_value is not None and len(rows) >= total_rows_value
        ):
            return rows

        next_offset = offset + len(page_rows)
        if next_offset <= offset:
            raise RuntimeError("Metrika pagination did not advance")
        offset = next_offset
