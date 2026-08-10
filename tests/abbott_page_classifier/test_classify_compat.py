"""Compatibility tests for the legacy classifier surface."""

import subprocess
import sys
import unittest
from pathlib import Path

from agents.abbott_page_classifier import classify


class ClassifierCompatibilityTests(unittest.TestCase):
    def test_direct_script_execution_keeps_cli_available(self):
        repository_root = Path(__file__).resolve().parents[2]
        result = subprocess.run(
            [sys.executable, "agents/abbott_page_classifier/classify.py", "--help"],
            cwd=repository_root,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Abbott page direction classifier", result.stdout)

    def test_normalize_url_wrapper_keeps_string_surface_and_semantic_direction(self):
        value = classify.normalize_url(
            "HTTPS://ABBOTTPRO.RU/cardio/?utm_source=x&DIRECTION=262338#top"
        )
        self.assertIsInstance(value, str)
        self.assertEqual(value, "https://abbottpro.ru/cardio?direction=262338")

    def test_legacy_uppercase_section_id_query_inferrs_cardiology(self):
        result = classify.classify_one(
            url="https://abbottpro.ru/articles/example?SECTION_ID=262338",
            index=classify.WorkbookIndex(),
        )
        self.assertEqual(result.direction, "Кардиология [262338]")
        self.assertEqual(result.rule, "section_id:262338")

    def test_http_archive_is_a_lifecycle_candidate_not_a_material_type(self):
        result = classify.apply_http_status(classify.Classification(), 404)
        self.assertEqual(result.page_status, "Архив")
        self.assertEqual(result.lifecycle_code, "archive_candidate")
        self.assertIsNone(result.material_type)

    def test_http_archive_preserves_classified_article_material_provenance(self):
        for status in (404, 410):
            with self.subTest(status=status):
                result = classify.Classification(
                    material_type="Статьи",
                    material_type_rule="material_prefix:articles",
                    rule="section_id:262338",
                )

                result = classify.apply_http_status(result, status)

                self.assertEqual(result.material_type, "Статьи")
                self.assertEqual(result.material_type_rule, "material_prefix:articles")
                self.assertEqual(result.lifecycle_code, "archive_candidate")
                self.assertEqual(result.lifecycle_rule, f"http_{status}")
                self.assertIn(f"http={status} → Архив", result.notes)
                self.assertEqual(result.rule, "section_id:262338")

    def test_legacy_material_dictionary_excludes_archive(self):
        self.assertNotIn("Архив", classify.MATERIAL_TYPES)
        self.assertEqual(
            classify.DIRECTION_BY_QUERY_ID["624635"], "Дерматология"
        )
