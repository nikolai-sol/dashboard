#!/usr/bin/env python3
"""Read-only proof of access to the Abbott Yandex Metrika counter."""

from __future__ import annotations

import os

import requests


ABBOTT_COUNTER_ID = "90602537"
COUNTER_URL = f"https://api-metrika.yandex.net/management/v1/counter/{ABBOTT_COUNTER_ID}"


class MetrikaAccessProbeError(RuntimeError):
    """Sanitized access-probe failure."""


def probe_counter_access(token: str) -> None:
    if not token or "\n" in token or "\r" in token:
        raise MetrikaAccessProbeError("Metrika token is unavailable")
    try:
        response = requests.get(
            COUNTER_URL,
            headers={"Authorization": f"OAuth {token}"},
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError):
        raise MetrikaAccessProbeError("Abbott Metrika read access was not confirmed") from None
    counter = payload.get("counter") if isinstance(payload, dict) else None
    if not isinstance(counter, dict) or str(counter.get("id")) != ABBOTT_COUNTER_ID:
        raise MetrikaAccessProbeError("Abbott Metrika counter identity was not confirmed")


def main() -> int:
    probe_counter_access(os.environ.get("METRIKA_TOKEN", ""))
    print(f"counter_id={ABBOTT_COUNTER_ID} access=ok")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except MetrikaAccessProbeError as exc:
        raise SystemExit(str(exc)) from None
