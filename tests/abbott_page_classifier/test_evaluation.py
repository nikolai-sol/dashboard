"""Golden evaluation contracts for the Abbott content classifier."""

from __future__ import annotations

import unittest
from pathlib import Path
import json

from agents.abbott_page_classifier.evaluation import evaluate_golden_set, load_fixture


class FixtureClassifier:
    def classify(self, record):
        return record["fixture_prediction"]


class EvaluationTests(unittest.TestCase):
    def test_versioned_fixture_is_large_nonprivate_and_covers_review_edges(self):
        fixture = Path("agents/abbott_page_classifier/evals/golden.v1.jsonl")
        records = load_fixture(fixture)
        metadata = json.loads(fixture.read_text(encoding="utf-8").splitlines()[0])

        self.assertGreaterEqual(len(records), 80)
        self.assertEqual(set(metadata["source_coverage"]["direction_codes"]), {"cardiology", "gastroenterology", "neurology_psychiatry", "womens_health", "respiratory_health", "diabetes_management", "pharmacists"})
        self.assertEqual(set(metadata["source_coverage"]["absent_direction_codes"]), {"dermatology", "not_applicable"})
        self.assertTrue(set(metadata["source_coverage"]["canonical_material_type_codes"]).issubset({row["expected_material_type_code"] for row in records}))
        self.assertEqual(len(metadata["source_coverage"]["canonical_material_type_codes"]), 17)
        self.assertTrue(any(row.get("generic_academy_path") for row in records))
        self.assertTrue(any(row.get("duplicate_group") for row in records))
        self.assertTrue(any(row.get("restricted") for row in records))
        self.assertTrue(any(row.get("archive_candidate") for row in records))
        self.assertTrue(any(row.get("insufficient_evidence") for row in records))
        self.assertTrue(any(row.get("locked_direction_code") for row in records))
    def test_calculates_exact_metrics_and_accepts_a_complete_fixture(self):
        records = (
            {
                "title": "Cardio article",
                "url": "https://abbottpro.ru/cardio/article",
                "expected_direction_code": "cardiology",
                "expected_material_type_code": "articles",
                "fixture_prediction": {
                    "direction_code": "cardiology",
                    "material_type_code": "articles",
                },
            },
            {
                "title": "Locked page",
                "url": "https://abbottpro.ru/gastro/locked",
                "expected_direction_code": "gastroenterology",
                "expected_material_type_code": "video",
                "locked_direction_code": "gastroenterology",
                "fixture_prediction": {
                    "direction_code": "gastroenterology",
                    "material_type_code": "video",
                },
            },
        )

        report = evaluate_golden_set(records, FixtureClassifier())

        self.assertEqual(report.record_count, 2)
        self.assertEqual(report.direction_correct, 2)
        self.assertEqual(report.material_type_correct, 2)
        self.assertEqual(report.anti_flip_detected, 1)
        self.assertEqual(report.taxonomy_valid, 2)
        self.assertEqual(report.schema_compliant, 2)
        self.assertEqual(report.disagreement_count, 0)
        self.assertEqual(report.unresolved_count, 0)
        self.assertEqual(report.direction_accuracy, 1.0)
        self.assertEqual(report.material_type_accuracy, 1.0)
        self.assertTrue(report.gate_passed)

    def test_gate_rejects_bad_accuracy_or_any_hard_metric_failure(self):
        records = (
            {
                "title": "A",
                "url": "https://abbottpro.ru/cardio/a",
                "expected_direction_code": "cardiology",
                "expected_material_type_code": "articles",
                "fixture_prediction": {
                    "direction_code": "gastroenterology",
                    "material_type_code": "video",
                },
            },
            {
                "title": "B",
                "url": "https://abbottpro.ru/cardio/b",
                "expected_direction_code": "cardiology",
                "expected_material_type_code": "articles",
                "locked_direction_code": "cardiology",
                "fixture_prediction": {
                    "direction_code": "gastroenterology",
                    "material_type_code": "articles",
                },
            },
        )

        report = evaluate_golden_set(records, FixtureClassifier())

        self.assertEqual(report.direction_correct, 0)
        self.assertEqual(report.material_type_correct, 1)
        self.assertEqual(report.anti_flip_detected, 0)
        self.assertEqual(report.disagreement_count, 3)
        self.assertFalse(report.gate_passed)

    def test_invalid_fixture_schema_is_a_hard_failure_without_classifier_call(self):
        class NeverCalled:
            def classify(self, record):  # pragma: no cover - assertion proves this
                raise AssertionError("classifier must not receive an invalid record")

        report = evaluate_golden_set(({"title": "missing fields"},), NeverCalled())

        self.assertEqual(report.schema_compliant, 0)
        self.assertEqual(report.taxonomy_valid, 0)
        self.assertEqual(report.unresolved_count, 1)
        self.assertFalse(report.gate_passed)

    def test_privacy_validator_rejects_case_and_separator_variants_in_nested_data(self):
        class NeverCalled:
            def classify(self, record):  # pragma: no cover - assertion proves this
                raise AssertionError("private records must not reach a classifier")

        report = evaluate_golden_set(({
            "title": "Safe content title",
            "url": "https://abbottpro.ru/cardio/safe",
            "expected_direction_code": "cardiology",
            "expected_material_type_code": "articles",
            "source_provenance": {"Client-ID": "forbidden"},
        },), NeverCalled())

        self.assertEqual(report.schema_compliant, 0)
        self.assertEqual(report.taxonomy_valid, 0)
        self.assertFalse(report.gate_passed)
