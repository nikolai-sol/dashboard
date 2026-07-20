from __future__ import annotations

import unittest
from unittest.mock import patch


class AbbottReleaseOperatorTest(unittest.TestCase):
    def test_validate_passes_expected_runtime_revision_to_store(self):
        import abbott_release_operator as operator

        args = operator.build_parser().parse_args(
            [
                "validate",
                "--release-id", "41",
                "--date-from", "2026-01-01",
                "--date-to", "2026-01-02",
                "--code-revision", "abcdef123456",
            ]
        )
        with patch.object(operator.release_store, "validate_release") as validate:
            result = operator.run(args)

        validate.assert_called_once_with(
            41,
            date_from="2026-01-01",
            date_to="2026-01-02",
            expected_code_revision="abcdef123456",
        )
        self.assertEqual(result, "release_id=41 status=validated")

    def test_create_names_baseline_as_snapshot_not_validation_run(self):
        import abbott_release_operator as operator

        args = operator.build_parser().parse_args(
            [
                "create",
                "--predecessor-release-id", "12",
                "--baseline-snapshot-id", "33",
                "--code-revision", "abcdef123456",
            ]
        )
        with patch.object(
            operator.release_store, "create_candidate_release", return_value=41
        ) as create:
            result = operator.run(args)

        create.assert_called_once_with(
            portal_key="abbott",
            predecessor_release_id=12,
            baseline_validation_run_id=33,
            code_revision="abcdef123456",
        )
        self.assertEqual(result, "release_id=41 status=staging")

    def test_operator_db_does_not_fall_back_to_collector_credentials(self):
        import abbott_release_operator as operator

        with patch.dict(
            operator.os.environ,
            {"MYSQL_HOST": "collector", "MYSQL_USER": "collector"},
            clear=True,
        ):
            with self.assertRaises(operator.OperatorConfigurationError):
                operator.get_operator_db_connection()


if __name__ == "__main__":
    unittest.main()
