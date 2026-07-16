from __future__ import annotations

from collections.abc import Callable
from typing import Any


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
