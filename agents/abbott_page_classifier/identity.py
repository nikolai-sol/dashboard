"""Ordered, hash-only diagnostics for Abbott content identity reconciliation."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Iterable, Literal, Mapping, Sequence

from .domain import CanonicalClassification, ConflictCode, MaterialCandidate
from .normalization import normalize_title, normalize_url, sha256_text


@dataclass(frozen=True)
class IdentityAlias:
    content_entity_id: int
    alias_type: Literal["material_id", "canonical_url", "url", "slug", "title"]
    alias_value: str
    uniqueness_scope: Literal["strong", "weak"]
    alias_status: Literal["active", "retired"] = "active"


@dataclass(frozen=True)
class IdentityResolution:
    status: Literal["matched", "new_candidate", "collision"]
    content_entity_id: int | None
    matched_by: Literal["material_id", "canonical_url", "url", "slug", "title_type", "none"]
    conflict_code: str | None
    evidence_hashes: tuple[str, ...]


def _candidate(value: MaterialCandidate | object) -> MaterialCandidate:
    nested = getattr(value, "candidate", value)
    if not isinstance(nested, MaterialCandidate):
        raise TypeError("IDENTITY_CANDIDATE_INVALID")
    return nested


def _normalized_alias_value(alias_type: str, value: object) -> str:
    raw = str(value or "")
    if alias_type in {"canonical_url", "url"}:
        return normalize_url(raw).value
    if alias_type == "slug":
        return raw.strip(" /").casefold()
    if alias_type == "title":
        return normalize_title(raw).casefold().replace("ё", "е")
    return normalize_title(raw).casefold()


def _slug(url: str) -> str:
    path = normalize_url(url).path
    return PurePosixPath(path).name.casefold() if path else ""


def _path_root(url: str) -> str:
    parts = [part for part in normalize_url(url).path.split("/") if part]
    return parts[0].casefold() if parts else ""


def _coerce_alias(value: IdentityAlias | Mapping[str, object] | object) -> IdentityAlias:
    if isinstance(value, IdentityAlias):
        return value
    if isinstance(value, Mapping):
        getter = value.get
    else:
        getter = lambda name, default=None: getattr(value, name, default)
    return IdentityAlias(
        content_entity_id=int(getter("content_entity_id")),
        alias_type=str(getter("alias_type")),  # type: ignore[arg-type]
        alias_value=str(getter("alias_value")),
        uniqueness_scope=str(getter("uniqueness_scope", getter("scope", ""))),  # type: ignore[arg-type]
        alias_status=str(getter("alias_status", "active")),  # type: ignore[arg-type]
    )


class IdentityResolver:
    """Resolve strong aliases first, then uniquely compatible weak aliases."""

    def resolve(
        self,
        candidate: MaterialCandidate | object,
        entities: Sequence[CanonicalClassification],
        aliases: Iterable[IdentityAlias | Mapping[str, object] | object],
    ) -> IdentityResolution:
        item = _candidate(candidate)
        entities_by_id = {entity.content_entity_id: entity for entity in entities}
        active_aliases = tuple(
            alias
            for alias in (_coerce_alias(value) for value in aliases)
            if alias.alias_status == "active" and alias.content_entity_id in entities_by_id
        )
        evidence: set[str] = set()

        def hashed(alias_type: str, value: str) -> None:
            if value:
                evidence.add(sha256_text(f"{alias_type}:{value}"))

        material_id = _normalized_alias_value("material_id", item.material_id or "")
        url = _normalized_alias_value("url", item.url)
        strong_matches: dict[str, set[int]] = {"material_id": set(), "canonical_url": set(), "url": set()}
        if material_id:
            hashed("material_id", material_id)
            for alias in active_aliases:
                if (
                    alias.alias_type == "material_id"
                    and alias.uniqueness_scope == "strong"
                    and _normalized_alias_value(alias.alias_type, alias.alias_value) == material_id
                ):
                    strong_matches["material_id"].add(alias.content_entity_id)
            for entity in entities:
                if _normalized_alias_value("material_id", getattr(entity, "material_id", "")) == material_id:
                    strong_matches["material_id"].add(entity.content_entity_id)
        if url:
            hashed("url", url)
            for entity in entities:
                if normalize_url(entity.url).value == url:
                    strong_matches["canonical_url"].add(entity.content_entity_id)
            for alias in active_aliases:
                if alias.uniqueness_scope != "strong":
                    continue
                if alias.alias_type not in {"canonical_url", "url"}:
                    continue
                if _normalized_alias_value(alias.alias_type, alias.alias_value) == url:
                    strong_matches[alias.alias_type].add(alias.content_entity_id)

        strong_entities = set().union(*strong_matches.values())
        if len(strong_entities) > 1:
            for alias_type, identifiers in strong_matches.items():
                for identifier in identifiers:
                    hashed(alias_type, str(identifier))
            return IdentityResolution(
                status="collision",
                content_entity_id=None,
                matched_by="none",
                conflict_code=ConflictCode.IDENTITY_COLLISION.value,
                evidence_hashes=tuple(sorted(evidence)),
            )
        if len(strong_entities) == 1:
            identifier = next(iter(strong_entities))
            matched_by = next(
                alias_type
                for alias_type in ("material_id", "canonical_url", "url")
                if identifier in strong_matches[alias_type]
            )
            return IdentityResolution(
                status="matched",
                content_entity_id=identifier,
                matched_by=matched_by,  # type: ignore[arg-type]
                conflict_code=None,
                evidence_hashes=tuple(sorted(evidence)),
            )

        slug = _slug(item.url)
        if slug:
            hashed("slug", slug)
            slug_matches = {
                alias.content_entity_id
                for alias in active_aliases
                if alias.alias_type == "slug"
                and alias.uniqueness_scope == "weak"
                and _normalized_alias_value("slug", alias.alias_value) == slug
                and _path_root(item.url) == _path_root(entities_by_id[alias.content_entity_id].url)
            }
            if len(slug_matches) == 1:
                return IdentityResolution(
                    status="matched",
                    content_entity_id=next(iter(slug_matches)),
                    matched_by="slug",
                    conflict_code=None,
                    evidence_hashes=tuple(sorted(evidence)),
                )

        title = _normalized_alias_value("title", item.title)
        if title and item.material_type_code:
            hashed("title", title)
            title_matches = {
                alias.content_entity_id
                for alias in active_aliases
                if alias.alias_type == "title"
                and alias.uniqueness_scope == "weak"
                and _normalized_alias_value("title", alias.alias_value) == title
                and entities_by_id[alias.content_entity_id].material_type_code == item.material_type_code
            }
            title_matches.update(
                entity.content_entity_id
                for entity in entities
                if _normalized_alias_value("title", entity.title) == title
                and entity.material_type_code == item.material_type_code
            )
            if len(title_matches) == 1:
                return IdentityResolution(
                    status="matched",
                    content_entity_id=next(iter(title_matches)),
                    matched_by="title_type",
                    conflict_code=None,
                    evidence_hashes=tuple(sorted(evidence)),
                )

        return IdentityResolution(
            status="new_candidate",
            content_entity_id=None,
            matched_by="none",
            conflict_code=None,
            evidence_hashes=tuple(sorted(evidence)),
        )
