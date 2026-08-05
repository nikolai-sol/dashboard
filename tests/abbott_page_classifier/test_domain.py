"""Canonical taxonomy contract tests."""

import unittest

from agents.abbott_page_classifier.domain import (
    ACCESS_CODES,
    DIRECTION_CODES,
    LIFECYCLE_CODES,
    MATERIAL_TYPE_CODES,
    DIRECTION_LABELS,
    TaxonomyVersion,
)


class TaxonomyContractTests(unittest.TestCase):
    def test_archive_is_not_a_material_type(self):
        self.assertNotIn("archive", MATERIAL_TYPE_CODES)
        self.assertIn("archive_candidate", LIFECYCLE_CODES)

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
