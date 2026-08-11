"""Canonical taxonomy contract tests."""

import unittest
from typing import get_type_hints

from agents.abbott_page_classifier.domain import (
    ACCESS_CODES,
    DIRECTION_CODES,
    LIFECYCLE_CODES,
    MATERIAL_TYPE_CODES,
    MATERIAL_TYPE_LABELS,
    DIRECTION_LABELS,
    ApprovalItem,
    ConflictCode,
    TaxonomyVersion,
)


class TaxonomyContractTests(unittest.TestCase):
    def test_approval_items_expose_only_stable_conflict_codes(self):
        self.assertEqual(
            get_type_hints(ApprovalItem)["conflict_codes"],
            tuple[ConflictCode, ...],
        )

    def test_archive_is_not_a_material_type(self):
        self.assertNotIn("archive", MATERIAL_TYPE_CODES)
        self.assertIn("archive_candidate", LIFECYCLE_CODES)

    def test_service_page_is_a_canonical_material_type(self):
        self.assertEqual(MATERIAL_TYPE_LABELS["service_page"], "Служебная страница")
        self.assertIn("service_page", MATERIAL_TYPE_CODES)

    def test_approved_taxonomy_keeps_dermatology_section_id_in_label(self):
        self.assertEqual(DIRECTION_LABELS["dermatology"], "Дерматология [624635]")
        self.assertIn("pharmacists", ACCESS_CODES)
        self.assertIn("not_applicable", DIRECTION_CODES)

    def test_taxonomy_version_terms_are_immutable(self):
        version = TaxonomyVersion(
            version="abbott.v1", terms={"direction": ("cardiology",)}
        )
        with self.assertRaises(TypeError):
            version.terms["direction"] = ("gastroenterology",)
