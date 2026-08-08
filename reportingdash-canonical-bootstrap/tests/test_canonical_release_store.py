import importlib.util
import pathlib
import sys
import types
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "lib" / "canonical_release_store.py"
sys.modules.setdefault(
    "canonical_writer",
    types.SimpleNamespace(get_db_connection=lambda: (_ for _ in ()).throw(AssertionError("database access is not allowed in unit tests"))),
)
SPEC = importlib.util.spec_from_file_location("canonical_release_store", MODULE_PATH)
assert SPEC and SPEC.loader
release_store = importlib.util.module_from_spec(SPEC)
sys.modules["canonical_release_store"] = release_store
SPEC.loader.exec_module(release_store)


def baseline_manifest():
    return {
        "file_snapshots": [
            {
                "source_kind": "abbott_workbook_json",
                "content_sha256": "a" * 64,
                "content_bytes": 100,
                "parser_version": "v1",
            },
            {
                "source_kind": "abbott_workbook_catalog",
                "content_sha256": "b" * 64,
                "content_bytes": 200,
                "parser_version": "v1",
            },
        ]
    }


def source_rows(workbook_manifest=None):
    workbook_manifest = workbook_manifest or {
        "source_kind": "abbott_workbook_json",
        "content_sha256": "a" * 64,
        "content_bytes": 100,
        "parser_version": "v1",
        "rejected_count": 0,
        "direction_count": 1,
        "event_catalog_count": 2,
        "general_material_count": 3,
    }
    return [
        {
            "id": 25,
            "source_kind": "abbott_workbook_json",
            "content_sha256": "a" * 64,
            "content_bytes": 100,
            "parser_version": "v1",
            "import_status": "imported",
            "imported_row_count": 6,
            "rejected_row_count": 0,
            "manifest_json": workbook_manifest,
        },
        {
            "id": 26,
            "source_kind": "abbott_workbook_catalog",
            "content_sha256": "b" * 64,
            "content_bytes": 200,
            "parser_version": "v1",
            "import_status": "imported",
            "imported_row_count": 1,
            "rejected_row_count": 0,
            "manifest_json": {
                "source_kind": "abbott_workbook_catalog",
                "content_sha256": "b" * 64,
                "content_bytes": 200,
                "parser_version": "v1",
                "rejected_count": 0,
            },
        },
    ]


def receipt_rows(ids=(25, 26)):
    return [
        {
            "source_snapshot_id": ids[0],
            "source_kind": "abbott_workbook_json",
            "code_revision": "revision",
            "import_status": "imported",
            "imported_row_count": 6,
            "rejected_row_count": 0,
        },
        {
            "source_snapshot_id": ids[1],
            "source_kind": "abbott_workbook_catalog",
            "code_revision": "revision",
            "import_status": "imported",
            "imported_row_count": 1,
            "rejected_row_count": 0,
        },
    ]


class ImportedSourceValidationTests(unittest.TestCase):
    def validate(self, workbook_manifest=None):
        release_store._validate_imported_sources(
            release={"source_snapshot_ids": [25, 26], "code_revision": "revision"},
            baseline_manifest=baseline_manifest(),
            snapshot_rows=source_rows(workbook_manifest),
            execution_rows=receipt_rows(),
        )

    def test_accepts_workbook_semantic_counts_that_reconcile_to_imported_rows(self):
        self.validate()

    def test_rejects_workbook_manifest_without_semantic_counts(self):
        manifest = source_rows()[0]["manifest_json"].copy()
        manifest.pop("direction_count")
        with self.assertRaises(release_store.ValidationGateError):
            self.validate(manifest)

    def test_rejects_zero_workbook_semantic_count(self):
        manifest = source_rows()[0]["manifest_json"].copy()
        manifest["event_catalog_count"] = 0
        with self.assertRaises(release_store.ValidationGateError):
            self.validate(manifest)

    def test_rejects_workbook_semantic_count_sum_mismatch(self):
        manifest = source_rows()[0]["manifest_json"].copy()
        manifest["general_material_count"] = 2
        with self.assertRaises(release_store.ValidationGateError):
            self.validate(manifest)


class ActivationReceiptAttestationTests(unittest.TestCase):
    def test_accepts_exact_source_snapshot_ids_and_receipt_ids(self):
        release_store._validate_release_source_receipts(
            release={"source_snapshot_ids": [25, 26]},
            execution_rows=receipt_rows((26, 25)),
        )

    def test_rejects_pointer_and_receipt_id_mismatch(self):
        with self.assertRaises(release_store.ValidationGateError):
            release_store._validate_release_source_receipts(
                release={"source_snapshot_ids": [25, 26]},
                execution_rows=receipt_rows((25, 22)),
            )


if __name__ == "__main__":
    unittest.main()
