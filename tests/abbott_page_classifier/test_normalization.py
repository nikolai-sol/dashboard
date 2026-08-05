"""Normalization contract tests."""

import unittest

from agents.abbott_page_classifier.normalization import (
    normalize_taxonomy_label,
    normalize_title,
    normalize_url,
    sha256_text,
)
from agents.abbott_page_classifier import classify


class NormalizationTests(unittest.TestCase):
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

    def test_url_normalization_preserves_semantic_query_and_drops_tracking(self):
        result = normalize_url(
            "HTTPS://ABBOTTPRO.RU/cardio/?utm_source=x&DIRECTION=262338#top"
        )
        self.assertEqual(
            result.value, "https://abbottpro.ru/cardio?direction=262338"
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
