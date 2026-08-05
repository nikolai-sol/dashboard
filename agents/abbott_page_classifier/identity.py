"""Fail-closed identity resolution for Abbott content candidates."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal
from urllib.parse import urlsplit

from .domain import CanonicalClassification, MaterialCandidate
from .normalization import normalize_title, normalize_url, sha256_text
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


def _normalized_alias_value(alias_kind: str, value: str) -> str:
    if alias_kind in {"canonical_url", "url"}:
        return normalize_url(value).value
    if alias_kind == "title":
        return normalize_title(value).casefold()
    return (value or "").strip().casefold()


def _url_context(url: str) -> tuple[str, str]:
    normalized = normalize_url(url)
    if not normalized.value:
        return "", ""
    host = urlsplit(normalized.value).netloc.casefold()
    path_parts = normalized.path.strip("/").casefold().split("/")
    parent_path = "/".join(path_parts[:-1])
    return host, parent_path


def _evidence_hashes(evidence: Iterable[tuple[str, str]]) -> tuple[str, ...]:
    return tuple(
        sorted({sha256_text(f"{kind}:{value}") for kind, value in evidence})
    )


class IdentityResolver:
    """Resolve only unambiguous canonical identities from supplied snapshots."""

    def resolve(
        self,
        candidate: MaterialCandidate | SourceCandidate,
        entities: Iterable[CanonicalClassification],
        aliases: Iterable[IdentityAlias],
    ) -> IdentityResolution:
        representative = candidate.candidate if isinstance(candidate, SourceCandidate) else candidate
        canonical_entities = tuple(entities)
        entity_by_id = {entity.content_entity_id: entity for entity in canonical_entities}
        usable_aliases = tuple(
            alias for alias in aliases if alias.content_entity_id in entity_by_id
        )
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
        else:
            material_ids = (
                {(candidate.material_id or "").strip()}
                if (candidate.material_id or "").strip()
                else set()
            )
            candidate_urls = {candidate_url} if candidate_url else set()

        strong_evidence: list[tuple[str, int, str]] = []
        for material_id in material_ids:
            for alias in usable_aliases:
                if (
                    alias.strength == "strong"
                    and alias.alias_kind == "material_id"
                    and _normalized_alias_value(alias.alias_kind, alias.alias_value)
                    == _normalized_alias_value("material_id", material_id)
                ):
                    strong_evidence.append(("material_id", alias.content_entity_id, material_id))

        for occurrence_url in candidate_urls:
            for entity in canonical_entities:
                if normalize_url(entity.url).value == occurrence_url:
                    strong_evidence.append(("canonical_url", entity.content_entity_id, occurrence_url))
            for alias in usable_aliases:
                if (
                    alias.strength == "strong"
                    and alias.alias_kind in {"canonical_url", "url"}
                    and _normalized_alias_value(alias.alias_kind, alias.alias_value) == occurrence_url
                ):
                    strong_evidence.append((alias.alias_kind, alias.content_entity_id, occurrence_url))

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
        candidate_context = _url_context(representative.url)
        slug_matches = {
            alias.content_entity_id
            for alias in usable_aliases
            if (
                alias.strength == "weak"
                and alias.alias_kind == "slug"
                and bool(slug)
                and _normalized_alias_value("slug", alias.alias_value) == slug
                and _url_context(entity_by_id[alias.content_entity_id].url) == candidate_context
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

        title = normalize_title(representative.title).casefold()
        material_type = representative.material_type_code
        title_matches = {
            alias.content_entity_id
            for alias in usable_aliases
            if (
                alias.strength == "weak"
                and alias.alias_kind == "title"
                and bool(title)
                and material_type is not None
                and _normalized_alias_value("title", alias.alias_value) == title
                and entity_by_id[alias.content_entity_id].material_type_code is not None
                and entity_by_id[alias.content_entity_id].material_type_code == material_type
            )
        }
        if len(title_matches) == 1:
            entity_id = next(iter(title_matches))
            return IdentityResolution(
                "matched",
                entity_id,
                "title_type",
                None,
                _evidence_hashes((("title", title), ("material_type", material_type))),
            )

        return IdentityResolution("new_candidate", None, "none", None, ())
