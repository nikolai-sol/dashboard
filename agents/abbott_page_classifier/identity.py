"""Fail-closed identity resolution for Abbott content candidates."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal

from .domain import CanonicalClassification, MaterialCandidate
from .normalization import normalize_title, normalize_url, sha256_text


IdentityStatus = Literal["matched", "new_candidate", "collision"]
MatchKind = Literal["material_id", "canonical_url", "url", "slug", "title_type", "none"]
AliasStrength = Literal["strong", "weak"]


@dataclass(frozen=True)
class IdentityAlias:
    content_entity_id: int
    alias_kind: Literal["material_id", "url", "slug", "title"]
    alias_value: str
    strength: AliasStrength


@dataclass(frozen=True)
class IdentityResolution:
    status: IdentityStatus
    content_entity_id: int | None
    matched_by: MatchKind
    conflict_code: str | None
    evidence_hashes: tuple[str, ...]


def _normalized_alias_value(alias_kind: str, value: str) -> str:
    if alias_kind == "url":
        return normalize_url(value).value
    if alias_kind == "title":
        return normalize_title(value).casefold()
    return (value or "").strip().casefold()


def _path_segment(url: str) -> str:
    path = normalize_url(url).path.strip("/")
    return path.split("/", 1)[0].casefold() if path else ""


def _evidence_hashes(evidence: Iterable[tuple[str, str]]) -> tuple[str, ...]:
    return tuple(
        sorted({sha256_text(f"{kind}:{value}") for kind, value in evidence})
    )


class IdentityResolver:
    """Resolve only unambiguous canonical identities from supplied snapshots."""

    def resolve(
        self,
        candidate: MaterialCandidate,
        entities: Iterable[CanonicalClassification],
        aliases: Iterable[IdentityAlias],
    ) -> IdentityResolution:
        canonical_entities = tuple(entities)
        entity_by_id = {entity.content_entity_id: entity for entity in canonical_entities}
        usable_aliases = tuple(
            alias for alias in aliases if alias.content_entity_id in entity_by_id
        )
        candidate_url = normalize_url(candidate.url).value
        material_id = (candidate.material_id or "").strip()

        strong_evidence: list[tuple[str, int, str]] = []
        if material_id:
            for alias in usable_aliases:
                if (
                    alias.strength == "strong"
                    and alias.alias_kind == "material_id"
                    and _normalized_alias_value(alias.alias_kind, alias.alias_value)
                    == _normalized_alias_value("material_id", material_id)
                ):
                    strong_evidence.append(("material_id", alias.content_entity_id, material_id))

        if candidate_url:
            for entity in canonical_entities:
                if normalize_url(entity.url).value == candidate_url:
                    strong_evidence.append(("canonical_url", entity.content_entity_id, candidate_url))
            for alias in usable_aliases:
                if (
                    alias.strength == "strong"
                    and alias.alias_kind == "url"
                    and _normalized_alias_value(alias.alias_kind, alias.alias_value) == candidate_url
                ):
                    strong_evidence.append(("url", alias.content_entity_id, candidate_url))

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

        slug = candidate_url.rstrip("/").rsplit("/", 1)[-1].casefold() if candidate_url else ""
        candidate_segment = _path_segment(candidate.url)
        slug_matches = {
            alias.content_entity_id
            for alias in usable_aliases
            if (
                alias.strength == "weak"
                and alias.alias_kind == "slug"
                and _normalized_alias_value("slug", alias.alias_value) == slug
                and _path_segment(entity_by_id[alias.content_entity_id].url) == candidate_segment
            )
        }
        if len(slug_matches) == 1:
            entity_id = next(iter(slug_matches))
            return IdentityResolution(
                "matched",
                entity_id,
                "slug",
                None,
                _evidence_hashes((("slug", slug),)),
            )

        title = normalize_title(candidate.title).casefold()
        title_matches = {
            alias.content_entity_id
            for alias in usable_aliases
            if (
                alias.strength == "weak"
                and alias.alias_kind == "title"
                and _normalized_alias_value("title", alias.alias_value) == title
                and entity_by_id[alias.content_entity_id].material_type_code
                == candidate.material_type_code
            )
        }
        if len(title_matches) == 1:
            entity_id = next(iter(title_matches))
            return IdentityResolution(
                "matched",
                entity_id,
                "title_type",
                None,
                _evidence_hashes((("title", title), ("material_type", candidate.material_type_code or ""))),
            )

        return IdentityResolution("new_candidate", None, "none", None, ())
