import importlib.util
import pathlib
import sys
import types
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "lib" / "canonical_release_store.py"
ORIGINAL_CANONICAL_WRITER = sys.modules.get("canonical_writer")
ORIGINAL_RELEASE_STORE = sys.modules.get("canonical_release_store")


def load_release_store_for_test():
    database_stub = types.SimpleNamespace(
        get_db_connection=lambda: (_ for _ in ()).throw(
            AssertionError("database access is not allowed in unit tests")
        ),
    )
    previous_writer = sys.modules.get("canonical_writer")
    previous_store = sys.modules.get("canonical_release_store")
    try:
        sys.modules["canonical_writer"] = database_stub
        spec = importlib.util.spec_from_file_location("canonical_release_store", MODULE_PATH)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        sys.modules["canonical_release_store"] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if previous_writer is None:
            sys.modules.pop("canonical_writer", None)
        else:
            sys.modules["canonical_writer"] = previous_writer
        if previous_store is None:
            sys.modules.pop("canonical_release_store", None)
        else:
            sys.modules["canonical_release_store"] = previous_store


release_store = load_release_store_for_test()


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


class FakeActivationCursor:
    def __init__(self, *, one_rows, all_rows):
        self.one_rows = list(one_rows)
        self.all_rows = list(all_rows)
        self.executions = []
        self.rowcount = 1

    def execute(self, statement, params=None):
        self.executions.append((statement, params))
        self.rowcount = 1

    def fetchone(self):
        return self.one_rows.pop(0)

    def fetchall(self):
        return self.all_rows.pop(0)

    def close(self):
        pass


class FakeActivationConnection:
    def __init__(self, cursor):
        self.cursor_instance = cursor
        self.started = False
        self.committed = False
        self.rolled_back = False

    def cursor(self, **_kwargs):
        return self.cursor_instance

    def start_transaction(self):
        self.started = True

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        pass


class ActivationSnapshotAttestationTests(unittest.TestCase):
    def build_activation(self, *, snapshot_rows=None):
        cursor = FakeActivationCursor(
            one_rows=[
                {"canonical_release_id": 8},
                {
                    "source_snapshot_ids": [25, 26],
                    "code_revision": "revision",
                    "baseline_validation_run_id": 50,
                    "rollback_from_release_id": 8,
                },
                {"manifest_json": baseline_manifest()},
            ],
            all_rows=[receipt_rows(), snapshot_rows if snapshot_rows is not None else source_rows()],
        )
        connection = FakeActivationConnection(cursor)
        return connection, cursor

    def invoke_activation(self, connection):
        original_connection_factory = release_store.get_db_connection
        release_store.get_db_connection = lambda: connection
        try:
            release_store.activate_release(9, expected_active_release_id=8)
        finally:
            release_store.get_db_connection = original_connection_factory

    def test_locks_exact_source_snapshots_before_release_or_pointer_updates(self):
        connection, cursor = self.build_activation()
        self.invoke_activation(connection)
        snapshot_index, (snapshot_statement, snapshot_params) = next(
            (index, execution)
            for index, execution in enumerate(cursor.executions)
            if "portal_dataset_snapshots" in execution[0] and "id IN" in execution[0]
        )
        self.assertIn("manifest_json", snapshot_statement)
        self.assertIn("content_sha256", snapshot_statement)
        self.assertIn("content_bytes", snapshot_statement)
        self.assertIn("parser_version", snapshot_statement)
        self.assertIn("imported_row_count", snapshot_statement)
        self.assertIn("FOR UPDATE", snapshot_statement)
        self.assertEqual(snapshot_params, (release_store.ABBOTT_DATASET_KEY, 25, 26))
        first_update_index = next(
            index
            for index, (statement, _params) in enumerate(cursor.executions)
            if statement.lstrip().startswith("UPDATE")
        )
        self.assertLess(snapshot_index, first_update_index)
        self.assertTrue(connection.committed)
        self.assertFalse(connection.rolled_back)

    def test_rejects_missing_zero_or_mismatched_workbook_counts_before_updates(self):
        valid_manifest = source_rows()[0]["manifest_json"]
        invalid_manifests = []
        for count_name in (
            "direction_count",
            "event_catalog_count",
            "general_material_count",
        ):
            missing = valid_manifest.copy()
            missing.pop(count_name)
            invalid_manifests.append((f"missing {count_name}", missing))
            zero = valid_manifest.copy()
            zero[count_name] = 0
            invalid_manifests.append((f"zero {count_name}", zero))
        mismatched = valid_manifest.copy()
        mismatched["general_material_count"] = 2
        invalid_manifests.append(("mismatched sum", mismatched))

        for description, manifest in invalid_manifests:
            with self.subTest(description=description):
                connection, cursor = self.build_activation(snapshot_rows=source_rows(manifest))
                with self.assertRaises(release_store.ValidationGateError):
                    self.invoke_activation(connection)
                self.assertTrue(connection.rolled_back)
                self.assertFalse(connection.committed)
                self.assertFalse(
                    any(
                        statement.lstrip().startswith("UPDATE")
                        for statement, _params in cursor.executions
                    )
                )

    def test_rejects_post_validation_manifest_fingerprint_or_rejection_drift(self):
        valid_manifest = source_rows()[0]["manifest_json"]
        fingerprint_drift = valid_manifest.copy()
        fingerprint_drift["content_sha256"] = "c" * 64
        rejection_drift = valid_manifest.copy()
        rejection_drift["rejected_count"] = 1

        for description, manifest in (
            ("fingerprint", fingerprint_drift),
            ("rejected count", rejection_drift),
        ):
            with self.subTest(description=description):
                connection, cursor = self.build_activation(snapshot_rows=source_rows(manifest))
                with self.assertRaises(release_store.ValidationGateError):
                    self.invoke_activation(connection)
                self.assertTrue(connection.rolled_back)
                self.assertFalse(connection.committed)
                self.assertFalse(
                    any(
                        statement.lstrip().startswith("UPDATE")
                        for statement, _params in cursor.executions
                    )
                )


class ImportIsolationTests(unittest.TestCase):
    def test_test_import_does_not_replace_global_modules(self):
        self.assertIs(sys.modules.get("canonical_writer"), ORIGINAL_CANONICAL_WRITER)
        self.assertIs(sys.modules.get("canonical_release_store"), ORIGINAL_RELEASE_STORE)


if __name__ == "__main__":
    unittest.main()
