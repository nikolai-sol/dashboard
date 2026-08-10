"""Normalization contract tests."""

import json
from pathlib import Path
import unittest

from agents.abbott_page_classifier.normalization import (
    normalize_taxonomy_label,
    normalize_title,
    normalize_url,
    sha256_text,
)
from agents.abbott_page_classifier import classify


class NormalizationTests(unittest.TestCase):
    def test_url_identity_matches_shared_parity_fixtures(self):
        fixture_path = Path(__file__).parents[1] / "fixtures/abbott_url_identity_cases.json"
        cases = json.loads(fixture_path.read_text(encoding="utf-8"))

        for case in cases:
            with self.subTest(raw=case["raw"]):
                result = normalize_url(case["raw"])
                self.assertEqual(result.value, case["value"])
                self.assertEqual(result.path, case["path"])

    def test_archive_is_rejected_as_a_material_type(self):
        self.assertIsNone(normalize_taxonomy_label("material_type", "Архив"))

    def test_known_variants_normalize_to_codes(self):
        self.assertEqual(
            normalize_taxonomy_label("material_type", "КР"), "clinical_guidelines"
        )
        self.assertEqual(
            normalize_taxonomy_label("material_type", "Научно-брошюры"),
            "educational_brochures",
        )
        self.assertEqual(
            normalize_taxonomy_label("direction", "Дерматология"), "dermatology"
        )
        self.assertEqual(normalize_taxonomy_label("access", "фарм"), "pharmacists")
        self.assertEqual(
            normalize_taxonomy_label("material_type", "Алгоритмы"),
            "pharmacy_consulting_algorithms",
        )
        self.assertEqual(normalize_taxonomy_label("access", "Доступно всем"), "all")

    def test_known_legacy_ambiguous_values_fail_closed_to_reviewable_codes(self):
        for value in (
            "332987",
            "Гастроэнтерология [262340] / Здоровье дыхательной системы [263746]",
            "Гастроэнтерология [262340] / Женское здоровье [262337] / Кардиология [262338] / Неврология и психиатрия [262339]",
        ):
            with self.subTest(value=value):
                self.assertEqual(
                    normalize_taxonomy_label("direction", value), "undetermined"
                )
        self.assertEqual(
            normalize_taxonomy_label("access", "Гастроэнтерология [262340]"),
            "unspecified",
        )

    def test_url_normalization_preserves_semantic_query_and_drops_tracking(self):
        result = normalize_url(
            "HTTPS://ABBOTTPRO.RU/cardio/?utm_source=x&DIRECTION=262338#top"
        )
        self.assertEqual(
            result.value, "https://abbottpro.ru/cardio?DIRECTION=262338"
        )
        self.assertEqual(len(result.sha256), 64)

    def test_url_normalization_normalizes_percent_encoding_and_query_order(self):
        result = normalize_url(
            "https://abbottpro.ru/%D0%BA%D0%B0%D1%80%D0%B4%D0%B8%D0%BE/?b=2&direction=262338&a=1"
        )
        self.assertEqual(
            result.value,
            "https://abbottpro.ru/%D0%BA%D0%B0%D1%80%D0%B4%D0%B8%D0%BE?a=1&b=2&direction=262338",
        )
        self.assertEqual(result.path, "/%D0%BA%D0%B0%D1%80%D0%B4%D0%B8%D0%BE")
        self.assertEqual(result.path_sha256, sha256_text(result.path))

    def test_url_normalization_escapes_a_literal_percent_sign(self):
        result = normalize_url("https://abbottpro.ru/cardio/100%")
        self.assertEqual(result.value, "https://abbottpro.ru/cardio/100%25")

    def test_url_normalization_preserves_encoded_reserved_path_delimiters(self):
        result = normalize_url("https://abbottpro.ru/articles/foo%2fbar/")
        self.assertEqual(result.path, "/articles/foo%2Fbar")
        self.assertEqual(classify.extract_slug(result.value), "foo/bar")

    def test_title_and_hash_normalization_are_stable(self):
        self.assertEqual(normalize_title("  Тема\u00a0\u00a0материала  "), "Тема материала")
        self.assertEqual(
            sha256_text("Abbott"),
            "88a78b3d3bd39f9b9fa4e7c442f6624dcc9778e635faf6fe5d4f41261b24d414",
        )
