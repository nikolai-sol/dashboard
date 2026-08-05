"""Stable Abbott content-entity identity resolution contracts."""

from __future__ import annotations

import unittest

from agents.abbott_page_classifier.domain import CanonicalClassification, MaterialCandidate
from agents.abbott_page_classifier.identity import IdentityAlias, IdentityResolver


def candidate(
    *,
    material_id: str | None = None,
    url: str = "",
    title: str = "Candidate title",
    material_type_code: str | None = "articles",
) -> MaterialCandidate:
    return MaterialCandidate(
        source_name="registry1",
        source_row_id="registry1:cardio:2",
        title=title,
        url=url,
        material_id=material_id,
        direction_code="cardiology",
        material_type_code=material_type_code,
        access_code="doctors",
        lifecycle_code="active",
        source_fingerprint="a" * 64,
    )


def entity(
    identifier: int,
    *,
    url: str,
    title: str = "Entity title",
    material_type_code: str | None = "articles",
) -> CanonicalClassification:
    return CanonicalClassification(
        content_entity_id=identifier,
        title=title,
        url=url,
        direction_code="cardiology",
        material_type_code=material_type_code,
        access_code="doctors",
        lifecycle_code="active",
    )


class IdentityResolverTests(unittest.TestCase):
    def setUp(self):
        self.resolver = IdentityResolver()

    def test_exact_material_id_is_the_strongest_match(self):
        result = self.resolver.resolve(
            candidate(material_id="100", url="https://abbottpro.ru/cardio/a/"),
            (entity(41, url="https://abbottpro.ru/cardio/a/"),),
            (IdentityAlias(41, "material_id", "100", "strong"),),
        )

        self.assertEqual(result.status, "matched")
        self.assertEqual(result.content_entity_id, 41)
        self.assertEqual(result.matched_by, "material_id")

    def test_canonical_url_matches_without_alias_row(self):
        result = self.resolver.resolve(
            candidate(url="HTTPS://ABBOTTPRO.RU/cardio/a/?utm_source=registry"),
            (entity(41, url="https://abbottpro.ru/cardio/a/"),),
            (),
        )

        self.assertEqual((result.status, result.content_entity_id, result.matched_by), ("matched", 41, "canonical_url"))

    def test_approved_url_alias_matches(self):
        result = self.resolver.resolve(
            candidate(url="https://abbottpro.ru/old-cardio/a/"),
            (entity(41, url="https://abbottpro.ru/cardio/a/"),),
            (IdentityAlias(41, "url", "https://abbottpro.ru/old-cardio/a/", "strong"),),
        )

        self.assertEqual((result.status, result.content_entity_id, result.matched_by), ("matched", 41, "url"))

    def test_unique_slug_requires_a_compatible_path(self):
        result = self.resolver.resolve(
            candidate(url="https://abbottpro.ru/cardio/shared-slug/"),
            (entity(41, url="https://abbottpro.ru/cardio/existing/"),),
            (IdentityAlias(41, "slug", "shared-slug", "weak"),),
        )
        incompatible = self.resolver.resolve(
            candidate(url="https://abbottpro.ru/dermatology/shared-slug/"),
            (entity(41, url="https://abbottpro.ru/cardio/existing/"),),
            (IdentityAlias(41, "slug", "shared-slug", "weak"),),
        )

        self.assertEqual((result.status, result.content_entity_id, result.matched_by), ("matched", 41, "slug"))
        self.assertEqual((incompatible.status, incompatible.matched_by), ("new_candidate", "none"))

    def test_unique_normalized_title_and_type_matches(self):
        result = self.resolver.resolve(
            candidate(title="  ТЕМА\u00a0материала  "),
            (entity(41, url="https://abbottpro.ru/cardio/a/", title="тема материала"),),
            (IdentityAlias(41, "title", "Тема материала", "weak"),),
        )

        self.assertEqual((result.status, result.content_entity_id, result.matched_by), ("matched", 41, "title_type"))

    def test_ambiguous_weak_title_is_a_new_candidate(self):
        result = self.resolver.resolve(
            candidate(title="Same title"),
            (
                entity(41, url="https://abbottpro.ru/cardio/a/", title="Same title"),
                entity(42, url="https://abbottpro.ru/cardio/b/", title="Same title"),
            ),
            (
                IdentityAlias(41, "title", "Same title", "weak"),
                IdentityAlias(42, "title", "Same title", "weak"),
            ),
        )

        self.assertEqual((result.status, result.content_entity_id, result.matched_by), ("new_candidate", None, "none"))

    def test_conflicting_strong_aliases_are_an_identity_collision(self):
        result = self.resolver.resolve(
            candidate(material_id="100", url="https://abbottpro.ru/cardio/b/"),
            (
                entity(41, url="https://abbottpro.ru/cardio/a/"),
                entity(42, url="https://abbottpro.ru/cardio/b/"),
            ),
            (IdentityAlias(41, "material_id", "100", "strong"),),
        )

        self.assertEqual((result.status, result.content_entity_id, result.matched_by), ("collision", None, "none"))
        self.assertEqual(result.conflict_code, "IDENTITY_COLLISION")
        self.assertTrue(all(len(value) == 64 for value in result.evidence_hashes))


if __name__ == "__main__":
    unittest.main()
