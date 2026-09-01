"""Deterministic normalization for Abbott content-registry inputs."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from urllib.parse import parse_qsl, quote, urlsplit, urlunsplit

from .domain import (
    ACCESS_LABELS,
    DIRECTION_LABELS,
    LIFECYCLE_LABELS,
    MATERIAL_TYPE_LABELS,
    NormalizedUrl,
    TaxonomyKind,
)


_WHITESPACE = re.compile(r"\s+")
_HEX_DIGITS = frozenset("0123456789abcdefABCDEF")
_PATH_SAFE = "/:@!$&'()*+,;=-._~"
_RESERVED_PATH_CHARACTERS = frozenset(":/?#[]@!$&'()*+,;=%")
_TRACKING_QUERY_KEYS = frozenset(
    {
        "access_code",
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
        "332987": "undetermined",
        "Гастроэнтерология [262340] / Здоровье дыхательной системы [263746]": "undetermined",
        "Гастроэнтерология [262340] / Женское здоровье [262337] / Кардиология [262338] / Неврология и психиатрия [262339]": "undetermined",
    },
)
_MATERIAL_TYPE_ALIASES = _aliases(
    MATERIAL_TYPE_LABELS,
    {
        "КР": "clinical_guidelines",
        "КС": "clinical_cases",
        "Брошюры": "educational_brochures",
        "Научно-брошюры": "educational_brochures",
        "Алгоритмы": "pharmacy_consulting_algorithms",
    },
)
_ACCESS_ALIASES = _aliases(
    ACCESS_LABELS,
    {
        "фарм": "pharmacists",
        "для фармацевтов": "pharmacists",
        "для врачей": "doctors",
        "Доступно всем": "all",
        "Гастроэнтерология [262340]": "unspecified",
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
    """Canonicalize escapes without turning encoded delimiters into structure."""

    value = path or "/"
    normalized: list[str] = []
    index = 0
    while index < len(value):
        if value[index] != "%":
            normalized.append(quote(value[index], safe=_PATH_SAFE))
            index += 1
            continue

        encoded = bytearray()
        while (
            index + 2 < len(value)
            and value[index] == "%"
            and value[index + 1] in _HEX_DIGITS
            and value[index + 2] in _HEX_DIGITS
        ):
            encoded.append(int(value[index + 1 : index + 3], 16))
            index += 3

        if not encoded:
            normalized.append("%25")
            index += 1
            continue

        try:
            decoded = bytes(encoded).decode("utf-8")
        except UnicodeDecodeError:
            normalized.extend(f"%{byte:02X}" for byte in encoded)
            continue

        for character in decoded:
            if character in _RESERVED_PATH_CHARACTERS:
                normalized.extend(f"%{byte:02X}" for byte in character.encode("utf-8"))
            else:
                normalized.append(quote(character, safe=_PATH_SAFE))

    parts: list[str] = []
    for segment in re.sub(r"/{2,}", "/", "".join(normalized)).split("/"):
        if not segment or segment == ".":
            continue
        if segment == "..":
            if parts:
                parts.pop()
            continue
        parts.append(segment)
    return "/" + "/".join(parts) if parts else "/"


def _quote_query_component(value: str) -> str:
    """Serialize query data like URLSearchParams after its stable sort."""

    return "".join(
        character
        if (
            "a" <= character <= "z"
            or "A" <= character <= "Z"
            or "0" <= character <= "9"
            or character in "*-._"
        )
        else "+"
        if character == " "
        else "".join(f"%{byte:02X}" for byte in character.encode("utf-8"))
        for character in value
    )


def _empty_normalized_url() -> NormalizedUrl:
    return NormalizedUrl("", "", sha256_text(""), sha256_text(""))


def normalize_url(raw: str) -> NormalizedUrl:
    """Normalize a URL while retaining semantic query parameters deterministically."""

    value = (raw or "").replace("&amp;", "&").strip()
    if not value or value.startswith("//"):
        return _empty_normalized_url()
    is_absolute = "://" in value
    if not is_absolute:
        value = f"https://abbottpro.ru{value if value.startswith('/') else '/' + value}"

    try:
        parts = urlsplit(value)
        scheme = (parts.scheme or "https").casefold()
        if scheme not in {"http", "https"}:
            return _empty_normalized_url()
        if is_absolute and (not parts.netloc or not parts.hostname):
            return _empty_normalized_url()
        if parts.username is not None or parts.password is not None:
            return _empty_normalized_url()
        source_host = parts.hostname or "abbottpro.ru"
        if "%" in source_host:
            return _empty_normalized_url()
        host = source_host.casefold().encode("idna").decode("ascii")
        if host == "www.abbottpro.ru":
            host = "abbottpro.ru"
        if host != "abbottpro.ru":
            return _empty_normalized_url()
        if host == "abbottpro.ru":
            scheme = "https"
        port = parts.port
        source_default_port = 443 if parts.scheme.casefold() == "https" else 80
        final_default_port = 443 if scheme == "https" else 80
        if port and port not in {source_default_port, final_default_port}:
            host = f"{host}:{port}"
        path = _normalize_path(parts.path)
        query_pairs = [
            (key, value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if not _is_tracking_query_key(key)
        ]
        query_pairs.sort(key=lambda pair: pair[0].encode("utf-16-be"))
        query = "&".join(
            f"{_quote_query_component(key)}={_quote_query_component(value)}"
            for key, value in query_pairs
        )
        normalized = urlunsplit((scheme, host, path, query, ""))
    except (TypeError, ValueError):
        return _empty_normalized_url()

    return NormalizedUrl(
        value=normalized,
        path=path,
        sha256=sha256_text(normalized),
        path_sha256=sha256_text(path),
    )


def normalize_observed_page_grouping_url(raw: str) -> NormalizedUrl:
    """Return the query-free page identity used only for observations.

    Registry and alias identity continues to use :func:`normalize_url`, which
    deliberately retains semantic query parameters. Metrika page analytics is
    displayed and resolved by page path, so query variants must not become
    separate review rows or be copied into review projections.
    """

    normalized = normalize_url(raw)
    if not normalized.value:
        return normalized
    path_lower = normalized.path.casefold()
    if (
        re.search(r"(^|/)blob:", path_lower)
        or re.search(r"(^|/)[a-z][a-z0-9+.-]*:/{1,2}", path_lower)
        or "…" in normalized.path
        or "%e2%80%a6" in path_lower
    ):
        return _empty_normalized_url()
    parts = urlsplit(normalized.value)
    value = urlunsplit((parts.scheme, parts.netloc, normalized.path, "", ""))
    return NormalizedUrl(
        value=value,
        path=normalized.path,
        sha256=sha256_text(value),
        path_sha256=normalized.path_sha256,
    )
