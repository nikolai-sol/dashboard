"""Stable Abbott content-entity identity resolution contracts."""

from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from openpyxl import Workbook

from agents.abbott_page_classifier.domain import CanonicalClassification, MaterialCandidate
from agents.abbott_page_classifier.identity import IdentityAlias, IdentityResolver
from agents.abbott_page_classifier.sources import read_registry1


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


def aggregated_candidate(occurrences: tuple[tuple[str, str], ...]):
    with tempfile.TemporaryDirectory() as temporary_directory:
        fixture = Path(temporary_directory) / "registry1.xlsx"
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "кардио"
        sheet.append(("ID", "Название", "ссылка", "Тип контента"))
        for title, url in occurrences:
            sheet.append((100, title, url, "Статьи"))
        workbook.save(fixture)
        return read_registry1(fixture).candidates_by_key["material:100"]


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

    def test_slug_uses_normalized_path_when_url_has_semantic_query(self):
        result = self.resolver.resolve(
            candidate(url="https://abbottpro.ru/cardio/shared-slug?view=full"),
            (entity(41, url="https://abbottpro.ru/cardio/existing/"),),
            (IdentityAlias(41, "slug", "SHARED-SLUG", "weak"),),
        )

        self.assertEqual((result.status, result.content_entity_id, result.matched_by), ("matched", 41, "slug"))

    def test_slug_decodes_normalized_path_like_approved_alias(self):
        result = self.resolver.resolve(
            candidate(url="https://abbottpro.ru/cardio/%D0%A2%D0%B5%D0%BC%D0%B0"),
            (entity(41, url="https://abbottpro.ru/cardio/existing/"),),
            (IdentityAlias(41, "slug", "тема", "weak"),),
        )

        self.assertEqual((result.status, result.content_entity_id, result.matched_by), ("matched", 41, "slug"))

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

    def test_conflicting_material_and_approved_url_aliases_fail_closed(self):
        result = self.resolver.resolve(
            candidate(material_id="100", url="https://abbottpro.ru/legacy-cardio/b/"),
            (
                entity(41, url="https://abbottpro.ru/cardio/a/"),
                entity(42, url="https://abbottpro.ru/cardio/b/"),
            ),
            (
                IdentityAlias(41, "material_id", "100", "strong"),
                IdentityAlias(42, "url", "https://abbottpro.ru/legacy-cardio/b/", "strong"),
            ),
        )

        self.assertEqual((result.status, result.content_entity_id, result.matched_by), ("collision", None, "none"))
        self.assertEqual(result.conflict_code, "IDENTITY_COLLISION")

    def test_duplicate_occurrence_urls_are_all_strong_evidence_independent_of_row_order(self):
        entities = (
            entity(41, url="https://abbottpro.ru/cardio/a/"),
            entity(42, url="https://abbottpro.ru/cardio/b/"),
        )

        resolutions = []
        for urls in (
            ("https://abbottpro.ru/cardio/a/", "https://abbottpro.ru/cardio/b/"),
            ("https://abbottpro.ru/cardio/b/", "https://abbottpro.ru/cardio/a/"),
        ):
            with tempfile.TemporaryDirectory() as temporary_directory:
                fixture = Path(temporary_directory) / "registry1.xlsx"
                workbook = Workbook()
                sheet = workbook.active
                sheet.title = "кардио"
                sheet.append(("ID", "Название", "ссылка", "Тип контента"))
                for ordinal, url in enumerate(urls, start=1):
                    sheet.append((100, f"Occurrence {ordinal}", url, "Статьи"))
                workbook.save(fixture)
                aggregated = read_registry1(fixture).candidates_by_key["material:100"]

            resolutions.append(self.resolver.resolve(aggregated, entities, ()))

        for result in resolutions:
            self.assertEqual((result.status, result.content_entity_id, result.matched_by), ("collision", None, "none"))
            self.assertEqual(result.conflict_code, "IDENTITY_COLLISION")
        self.assertEqual(resolutions[0].evidence_hashes, resolutions[1].evidence_hashes)

    def test_conflicting_weak_slugs_across_occurrences_never_depend_on_row_order(self):
        entities = (
            entity(41, url="https://abbottpro.ru/cardio/existing-a/"),
            entity(42, url="https://abbottpro.ru/cardio/existing-b/"),
        )
        aliases = (
            IdentityAlias(41, "slug", "first-slug", "weak"),
            IdentityAlias(42, "slug", "second-slug", "weak"),
        )

        for occurrences in (
            (("Same title", "https://abbottpro.ru/cardio/first-slug"),
             ("Same title", "https://abbottpro.ru/cardio/second-slug")),
            (("Same title", "https://abbottpro.ru/cardio/second-slug"),
             ("Same title", "https://abbottpro.ru/cardio/first-slug")),
        ):
            result = self.resolver.resolve(aggregated_candidate(occurrences), entities, aliases)

            self.assertEqual((result.status, result.content_entity_id, result.matched_by), ("new_candidate", None, "none"))

    def test_conflicting_weak_titles_across_occurrences_never_depend_on_row_order(self):
        entities = (
            entity(41, url="https://abbottpro.ru/cardio/existing-a/"),
            entity(42, url="https://abbottpro.ru/cardio/existing-b/"),
        )
        aliases = (
            IdentityAlias(41, "title", "First title", "weak"),
            IdentityAlias(42, "title", "Second title", "weak"),
        )

        for occurrences in (
            (("First title", ""), ("Second title", "")),
            (("Second title", ""), ("First title", "")),
        ):
            result = self.resolver.resolve(aggregated_candidate(occurrences), entities, aliases)

            self.assertEqual((result.status, result.content_entity_id, result.matched_by), ("new_candidate", None, "none"))

    def test_conflicting_canonical_url_alias_and_material_alias_fail_closed(self):
        result = self.resolver.resolve(
            candidate(material_id="100", url="HTTPS://ABBOTTPRO.RU/legacy/b/?utm_source=sheet"),
            (
                entity(41, url="https://abbottpro.ru/cardio/a/"),
                entity(42, url="https://abbottpro.ru/cardio/b/"),
            ),
            (
                IdentityAlias(41, "material_id", "100", "strong"),
                IdentityAlias(42, "canonical_url", "https://abbottpro.ru/legacy/b/", "strong"),
            ),
        )

        self.assertEqual((result.status, result.content_entity_id, result.matched_by), ("collision", None, "none"))
        self.assertEqual(result.conflict_code, "IDENTITY_COLLISION")

    def test_unique_slug_rejects_same_path_context_on_another_host(self):
        result = self.resolver.resolve(
            candidate(url="https://example.org/cardio/shared-slug/"),
            (entity(41, url="https://abbottpro.ru/cardio/existing/"),),
            (IdentityAlias(41, "slug", "shared-slug", "weak"),),
        )

        self.assertEqual((result.status, result.content_entity_id, result.matched_by), ("new_candidate", None, "none"))

    def test_blank_title_never_weakly_matches(self):
        result = self.resolver.resolve(
            candidate(title=" \u00a0 "),
            (entity(41, url="https://abbottpro.ru/cardio/a/", title=""),),
            (IdentityAlias(41, "title", "", "weak"),),
        )

        self.assertEqual((result.status, result.content_entity_id, result.matched_by), ("new_candidate", None, "none"))

    def test_unknown_material_types_never_weakly_match_by_title(self):
        result = self.resolver.resolve(
            candidate(title="Same title", material_type_code=None),
            (entity(41, url="https://abbottpro.ru/cardio/a/", title="Same title", material_type_code=None),),
            (IdentityAlias(41, "title", "Same title", "weak"),),
        )

        self.assertEqual((result.status, result.content_entity_id, result.matched_by), ("new_candidate", None, "none"))

    def test_ambiguous_weak_slug_aliases_never_auto_select(self):
        result = self.resolver.resolve(
            candidate(url="https://abbottpro.ru/cardio/shared-slug/"),
            (
                entity(41, url="https://abbottpro.ru/cardio/a/"),
                entity(42, url="https://abbottpro.ru/cardio/b/"),
            ),
            (
                IdentityAlias(41, "slug", "shared-slug", "weak"),
                IdentityAlias(42, "slug", "shared-slug", "weak"),
            ),
        )

        self.assertEqual((result.status, result.content_entity_id, result.matched_by), ("new_candidate", None, "none"))


if __name__ == "__main__":
    unittest.main()
