"""Fail-closed identity resolution for Abbott content candidates."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal
from urllib.parse import urlsplit

from .domain import CanonicalClassification, MaterialCandidate
from .normalization import (
    _RESERVED_PATH_CHARACTERS,
    normalize_title,
    normalize_url,
    sha256_text,
)
from .sources import SourceCandidate


IdentityStatus = Literal["matched", "new_candidate", "collision"]
MatchKind = Literal["material_id", "canonical_url", "url", "slug", "title_type", "none"]
AliasStrength = Literal["strong", "weak"]


@dataclass(frozen=True)
class IdentityAlias:
    content_entity_id: int
    alias_kind: Literal["material_id", "canonical_url", "url", "slug", "title"]
    alias_value: str
    strength: AliasStrength


@dataclass(frozen=True)
class IdentityResolution:
    status: IdentityStatus
    content_entity_id: int | None
    matched_by: MatchKind
    conflict_code: str | None
    evidence_hashes: tuple[str, ...]


def _normalize_slug(value: str) -> str:
    normalized = normalize_title(value or "").strip("/")
    if not normalized:
        return ""
    canonical_path = normalize_url(f"/{normalized}").path.strip("/")
    decoded: list[str] = []
    index = 0
    while index < len(canonical_path):
        if (
            canonical_path[index] != "%"
            or index + 2 >= len(canonical_path)
            or any(character not in "0123456789abcdefABCDEF" for character in canonical_path[index + 1 : index + 3])
        ):
            decoded.append(canonical_path[index])
            index += 1
            continue

        byte_value = int(canonical_path[index + 1 : index + 3], 16)
        if chr(byte_value) in _RESERVED_PATH_CHARACTERS:
            decoded.append(canonical_path[index : index + 3])
            index += 3
            continue

        encoded_bytes = bytearray()
        encoded_text: list[str] = []
        while (
            index + 2 < len(canonical_path)
            and canonical_path[index] == "%"
            and all(character in "0123456789abcdefABCDEF" for character in canonical_path[index + 1 : index + 3])
        ):
            byte_value = int(canonical_path[index + 1 : index + 3], 16)
            if chr(byte_value) in _RESERVED_PATH_CHARACTERS:
                break
            encoded_bytes.append(byte_value)
            encoded_text.append(canonical_path[index : index + 3])
            index += 3
        try:
            decoded.append(bytes(encoded_bytes).decode("utf-8"))
        except UnicodeDecodeError:
            decoded.extend(encoded_text)

    return normalize_title("".join(decoded)).casefold()


def _normalized_alias_value(alias_kind: str, value: str) -> str:
    if alias_kind in {"canonical_url", "url"}:
        return normalize_url(value).value
    if alias_kind == "title":
        return normalize_title(value).casefold()
    if alias_kind == "slug":
        return _normalize_slug(value)
    return (value or "").strip().casefold()


def _slug_from_url(url: str) -> str:
    path = normalize_url(url).path.strip("/")
    return _normalize_slug(path.rsplit("/", 1)[-1]) if path else ""


def _url_context(url: str) -> tuple[str, str]:
    normalized = normalize_url(url)
    if not normalized.value:
        return "", ""
    host = urlsplit(normalized.value).netloc.casefold()
    path_parts = normalized.path.strip("/").split("/")
    parent_path = "/".join(_normalize_slug(part) for part in path_parts[:-1])
    return host, parent_path


def _evidence_hashes(evidence: Iterable[tuple[str, str]]) -> tuple[str, ...]:
    return tuple(
        sorted({sha256_text(f"{kind}:{value}") for kind, value in evidence})
    )


class _PreparedIdentityResolver:
    """Resolve candidates against immutable indexes built once per snapshot."""

    def __init__(
        self,
        entities: Iterable[CanonicalClassification],
        aliases: Iterable[IdentityAlias],
    ) -> None:
        self.canonical_entities = tuple(entities)
        self.entity_by_id = {
            entity.content_entity_id: entity for entity in self.canonical_entities
        }
        usable_aliases = tuple(
            alias for alias in aliases if alias.content_entity_id in self.entity_by_id
        )
        material_targets: dict[str, set[int]] = {}
        url_targets: dict[str, set[tuple[str, int]]] = {}
        slug_targets: dict[tuple[str, tuple[str, str]], set[int]] = {}
        title_targets: dict[tuple[str, str], set[int]] = {}

        for entity in self.canonical_entities:
            normalized_url = normalize_url(entity.url).value
            if normalized_url:
                url_targets.setdefault(normalized_url, set()).add(
                    ("canonical_url", entity.content_entity_id)
                )
        for alias in usable_aliases:
            entity = self.entity_by_id[alias.content_entity_id]
            if alias.strength == "strong" and alias.alias_kind == "material_id":
                normalized = _normalized_alias_value("material_id", alias.alias_value)
                if normalized:
                    material_targets.setdefault(normalized, set()).add(
                        alias.content_entity_id
                    )
            elif alias.strength == "strong" and alias.alias_kind in {
                "canonical_url", "url"
            }:
                normalized = _normalized_alias_value(
                    alias.alias_kind, alias.alias_value
                )
                if normalized:
                    url_targets.setdefault(normalized, set()).add(
                        (alias.alias_kind, alias.content_entity_id)
                    )
            elif alias.strength == "weak" and alias.alias_kind == "slug":
                normalized = _normalized_alias_value("slug", alias.alias_value)
                if normalized:
                    slug_targets.setdefault(
                        (normalized, _url_context(entity.url)), set()
                    ).add(alias.content_entity_id)
            elif (
                alias.strength == "weak"
                and alias.alias_kind == "title"
                and entity.material_type_code is not None
            ):
                normalized = _normalized_alias_value("title", alias.alias_value)
                if normalized:
                    title_targets.setdefault(
                        (normalized, entity.material_type_code), set()
                    ).add(alias.content_entity_id)

        self.material_targets = {
            key: frozenset(value) for key, value in material_targets.items()
        }
        self.url_targets = {
            key: frozenset(value) for key, value in url_targets.items()
        }
        self.slug_targets = {
            key: frozenset(value) for key, value in slug_targets.items()
        }
        self.title_targets = {
            key: frozenset(value) for key, value in title_targets.items()
        }

    def resolve(
        self,
        candidate: MaterialCandidate | SourceCandidate,
    ) -> IdentityResolution:
        representative = candidate.candidate if isinstance(candidate, SourceCandidate) else candidate
        candidate_url = normalize_url(representative.url).value
        if isinstance(candidate, SourceCandidate):
            material_ids = {
                (variant.material_id or "").strip()
                for variant in candidate.identity_variants
                if (variant.material_id or "").strip()
            }
            candidate_urls = {
                normalize_url(variant.normalized_url).value
                for variant in candidate.identity_variants
                if variant.normalized_url
            }
            weak_variants = tuple(
                (
                    variant.normalized_url,
                    variant.normalized_title,
                    variant.material_type_code,
                )
                for variant in candidate.identity_variants
            )
        else:
            material_ids = (
                {(candidate.material_id or "").strip()}
                if (candidate.material_id or "").strip()
                else set()
            )
            candidate_urls = {candidate_url} if candidate_url else set()
            weak_variants = ((candidate_url, normalize_title(candidate.title), candidate.material_type_code),)

        strong_evidence: list[tuple[str, int, str]] = []
        for material_id in material_ids:
            normalized_material_id = _normalized_alias_value("material_id", material_id)
            strong_evidence.extend(
                ("material_id", entity_id, material_id)
                for entity_id in self.material_targets.get(
                    normalized_material_id, ()
                )
            )

        for occurrence_url in candidate_urls:
            strong_evidence.extend(
                (kind, entity_id, occurrence_url)
                for kind, entity_id in self.url_targets.get(occurrence_url, ())
            )

        strong_targets = {entity_id for _, entity_id, _ in strong_evidence}
        if len(strong_targets) > 1:
            return IdentityResolution(
                "collision",
                None,
                "none",
                "IDENTITY_COLLISION",
                _evidence_hashes((kind, value) for kind, _, value in strong_evidence),
            )
        if strong_targets:
            matched_by = next(
                kind
                for kind in ("material_id", "canonical_url", "url")
                if any(item[0] == kind for item in strong_evidence)
            )
            entity_id = next(iter(strong_targets))
            return IdentityResolution(
                "matched",
                entity_id,
                matched_by,  # type: ignore[arg-type]
                None,
                _evidence_hashes((kind, value) for kind, _, value in strong_evidence),
            )

        weak_targets: set[int] = set()
        weak_evidence: list[tuple[str, str]] = []
        matched_by_slug = False
        for variant_url, variant_title, material_type in weak_variants:
            slug = _slug_from_url(variant_url)
            candidate_context = _url_context(variant_url)
            slug_matches = self.slug_targets.get((slug, candidate_context), ()) if slug else ()
            if len(slug_matches) > 1:
                return IdentityResolution("new_candidate", None, "none", None, ())
            if slug_matches:
                weak_targets.update(slug_matches)
                weak_evidence.append(("slug", slug))
                matched_by_slug = True

            title = normalize_title(variant_title).casefold()
            title_matches = (
                self.title_targets.get((title, material_type), ())
                if title and material_type is not None
                else ()
            )
            if len(title_matches) > 1:
                return IdentityResolution("new_candidate", None, "none", None, ())
            if title_matches:
                weak_targets.update(title_matches)
                weak_evidence.extend((("title", title), ("material_type", material_type)))

        if len(weak_targets) == 1:
            entity_id = next(iter(weak_targets))
            return IdentityResolution(
                "matched",
                entity_id,
                "slug" if matched_by_slug else "title_type",
                None,
                _evidence_hashes(weak_evidence),
            )

        return IdentityResolution("new_candidate", None, "none", None, ())


class IdentityResolver:
    """Resolve only unambiguous canonical identities from supplied snapshots."""

    @staticmethod
    def prepare(
        entities: Iterable[CanonicalClassification],
        aliases: Iterable[IdentityAlias],
    ) -> _PreparedIdentityResolver:
        return _PreparedIdentityResolver(entities, aliases)

    def resolve(
        self,
        candidate: MaterialCandidate | SourceCandidate,
        entities: Iterable[CanonicalClassification],
        aliases: Iterable[IdentityAlias],
    ) -> IdentityResolution:
        return self.prepare(entities, aliases).resolve(candidate)
