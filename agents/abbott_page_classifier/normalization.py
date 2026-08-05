"""Deterministic normalization for Abbott content-registry inputs."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from urllib.parse import parse_qsl, quote, unquote, urlsplit, urlunsplit

from .domain import (
    ACCESS_LABELS,
    DIRECTION_LABELS,
    LIFECYCLE_LABELS,
    MATERIAL_TYPE_LABELS,
    NormalizedUrl,
    TaxonomyKind,
)


_WHITESPACE = re.compile(r"\s+")
_TRACKING_QUERY_KEYS = frozenset(
    {
        "dclid",
        "fbclid",
        "gclid",
        "mc_cid",
        "mc_eid",
        "ref",
        "_ga",
        "_gl",
        "yclid",
        "ysclid",
    }
)


def sha256_text(value: str) -> str:
    """Return the stable UTF-8 SHA-256 fingerprint for text."""

    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalize_title(raw: str) -> str:
    """Normalize display-title whitespace without changing its language or case."""

    return _WHITESPACE.sub(" ", unicodedata.normalize("NFKC", raw or "")).strip()


def _label_key(raw: str) -> str:
    return normalize_title(raw).casefold().replace("ё", "е")


def _aliases(labels: dict[str, str] | object, extra: dict[str, str]) -> dict[str, str]:
    aliases = {code.casefold(): code for code in labels}  # type: ignore[union-attr]
    aliases.update({_label_key(label): code for code, label in labels.items()})  # type: ignore[union-attr]
    aliases.update({_label_key(label): code for label, code in extra.items()})
    return aliases


_DIRECTION_ALIASES = _aliases(
    DIRECTION_LABELS,
    {
        "Гастроэнтерология": "gastroenterology",
        "Кардиология": "cardiology",
        "Неврология и психиатрия": "neurology_psychiatry",
        "Женское здоровье": "womens_health",
        "Здоровье дыхательной системы": "respiratory_health",
        "Управление сахарным диабетом": "diabetes_management",
        "Дерматология": "dermatology",
    },
)
_MATERIAL_TYPE_ALIASES = _aliases(
    MATERIAL_TYPE_LABELS,
    {
        "КР": "clinical_guidelines",
        "КС": "clinical_cases",
        "Брошюры": "educational_brochures",
        "Научно-брошюры": "educational_brochures",
    },
)
_ACCESS_ALIASES = _aliases(
    ACCESS_LABELS,
    {
        "фарм": "pharmacists",
        "для фармацевтов": "pharmacists",
        "для врачей": "doctors",
    },
)
_LIFECYCLE_ALIASES = _aliases(
    LIFECYCLE_LABELS,
    {
        "Архив": "archive_candidate",
        "Кандидат в архив": "archive_candidate",
        "Архивирован": "archived",
    },
)
_ALIASES: dict[TaxonomyKind, dict[str, str]] = {
    "direction": _DIRECTION_ALIASES,
    "material_type": _MATERIAL_TYPE_ALIASES,
    "access": _ACCESS_ALIASES,
    "lifecycle": _LIFECYCLE_ALIASES,
}


def normalize_taxonomy_label(kind: TaxonomyKind, raw: str) -> str | None:
    """Return an approved taxonomy code for a known label or documented alias."""

    if kind not in _ALIASES:
        return None
    return _ALIASES[kind].get(_label_key(raw))


def _is_tracking_query_key(key: str) -> bool:
    normalized = key.casefold()
    return normalized.startswith("utm_") or normalized in _TRACKING_QUERY_KEYS


def _normalize_path(path: str) -> str:
    decoded = unquote(path or "/")
    normalized = quote(decoded, safe="/%:@!$&'()*+,;=-._~")
    return normalized.rstrip("/") or "/"


def normalize_url(raw: str) -> NormalizedUrl:
    """Normalize a URL while retaining semantic query parameters deterministically."""

    value = (raw or "").replace("&amp;", "&").strip()
    if not value:
        return NormalizedUrl("", "", sha256_text(""), sha256_text(""))
    if "://" not in value:
        value = f"https://abbottpro.ru{value if value.startswith('/') else '/' + value}"

    try:
        parts = urlsplit(value)
        scheme = (parts.scheme or "https").casefold()
        host = (parts.hostname or "abbottpro.ru").casefold()
        port = parts.port
        if port and not ((scheme == "https" and port == 443) or (scheme == "http" and port == 80)):
            host = f"{host}:{port}"
        path = _normalize_path(parts.path)
        query_pairs = [
            (key.casefold(), value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if not _is_tracking_query_key(key)
        ]
        query_pairs.sort(key=lambda pair: (pair[0], pair[1]))
        query = "&".join(
            f"{quote(key, safe='-._~')}={quote(value, safe='-._~')}"
            for key, value in query_pairs
        )
        normalized = urlunsplit((scheme, host, path, query, ""))
    except (TypeError, ValueError):
        normalized = value.split("#", 1)[0].rstrip("/")
        path = ""

    return NormalizedUrl(
        value=normalized,
        path=path,
        sha256=sha256_text(normalized),
        path_sha256=sha256_text(path),
    )
