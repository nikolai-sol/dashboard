from decimal import Decimal
import unittest
from unittest.mock import patch

from metrika_pagination import PaginationResult


FINGERPRINT_CONTEXT = {
    "code_revision": "test-revision",
    "parser_version": "test-parser-v1",
}


class MetrikaReturningRowsTests(unittest.TestCase):
    @staticmethod
    def response_with_metrics(metrics):
        return PaginationResult(
            rows=(
                {
                    "dimensions": [{"name": "https://example.com/material"}],
                    "metrics": metrics,
                },
            ),
            total_rows=1,
            pages_fetched=1,
            pagination_complete=True,
            sampled=False,
            sample_share=None,
        )

    def test_preserves_raw_url_separately_from_normalized_url(self):
        from fetch_yandex_metrika_canonical import build_returning_rows

        raw_url = "HTTPS://Example.COM/path/?utm=one&amp;source=two#fragment"
        response = PaginationResult(
            rows=(
                {
                    "dimensions": [{"name": raw_url}],
                    "metrics": [10, 12.3456789012, 23.4567890123, 34.5678901234],
                },
            ),
            total_rows=1,
            pages_fetched=1,
            pagination_complete=True,
            sampled=False,
            sample_share=None,
        )

        rows = build_returning_rows("90602537", "2026-01-02", response, 77, 41)

        self.assertEqual({row["raw_page_value"] for row in rows}, {raw_url})
        self.assertEqual(
            {row["normalized_page"] for row in rows}, {"https://example.com/path"}
        )
        self.assertTrue(
            all(row["raw_page_hash"] != row["normalized_page_hash"] for row in rows)
        )

    def test_creates_three_percentage_buckets_without_rounded_counts(self):
        from fetch_yandex_metrika_canonical import RETURN_BUCKETS, build_returning_rows

        response = PaginationResult(
            rows=(
                {
                    "dimensions": [{"name": "https://example.com/material"}],
                    "metrics": [7, 12.3456789012, 23.4567890123, 34.5678901234],
                },
            ),
            total_rows=1,
            pages_fetched=1,
            pagination_complete=True,
            sampled=False,
            sample_share=None,
        )

        rows = build_returning_rows("90602537", "2026-01-02", response, 77, 41)

        self.assertEqual(tuple(row["return_bucket_code"] for row in rows), RETURN_BUCKETS)
        self.assertEqual(
            tuple(row["source_percentage"] for row in rows),
            (
                Decimal("12.3456789012"),
                Decimal("23.4567890123"),
                Decimal("34.5678901234"),
            ),
        )
        self.assertTrue(all(row["source_denominator"] == 7 for row in rows))
        self.assertTrue(all(row["derived_count"] is None for row in rows))
        self.assertTrue(all(row["is_derived"] == 0 for row in rows))

    def test_missing_required_returning_metric_fails_scope(self):
        from fetch_yandex_metrika_canonical import (
            MetrikaCollectionError,
            build_returning_rows,
        )

        with self.assertRaises(MetrikaCollectionError):
            build_returning_rows(
                "90602537",
                "2026-01-02",
                self.response_with_metrics([7, 12.5, 23.5]),
                77,
                41,
            )

    def test_invalid_required_returning_metric_fails_scope(self):
        from fetch_yandex_metrika_canonical import (
            MetrikaCollectionError,
            build_returning_rows,
        )

        invalid_metric_sets = (
            ["invalid", 12.5, 23.5, 34.5],
            [7, 12.5, "invalid", 34.5],
            [7, 12.5, 23.5, None],
        )
        for metrics in invalid_metric_sets:
            with self.subTest(metrics=metrics):
                with self.assertRaises(MetrikaCollectionError):
                    build_returning_rows(
                        "90602537",
                        "2026-01-02",
                        self.response_with_metrics(metrics),
                        77,
                        41,
                    )

    def test_blank_returning_source_row_rejects_day_before_publication(self):
        import fetch_yandex_metrika_canonical as collector

        empty_scope = PaginationResult(
            rows=(),
            total_rows=0,
            pages_fetched=1,
            pagination_complete=True,
            sampled=False,
            sample_share=None,
        )
        blank_rows = (
            {"dimensions": [{"name": ""}], "metrics": [5, 1, 2, 3]},
            {"dimensions": [{"name": None}], "metrics": [5, 1, "invalid", 3]},
        )
        for blank_row in blank_rows:
            with self.subTest(blank_row=blank_row):
                returning = PaginationResult(
                    rows=(
                        {
                            "dimensions": [{"name": "https://example.com/material"}],
                            "metrics": [7, 12.5, 23.5, 34.5],
                        },
                        blank_row,
                    ),
                    total_rows=2,
                    pages_fetched=1,
                    pagination_complete=True,
                    sampled=False,
                    sample_share=None,
                )
                with patch.object(
                    collector,
                    "request_all_pages",
                    side_effect=[empty_scope, empty_scope, empty_scope, empty_scope, returning],
                ), patch.object(collector, "publish_metrika_day_bundle") as publish:
                    summary = collector.run_release_backfill(
                        [{"counter_id": collector.ABBOTT_COUNTER_ID}],
                        "2026-01-02",
                        "2026-01-02",
                        77,
                        41,
                        **FINGERPRINT_CONTEXT,
                    )

                publish.assert_not_called()
                self.assertEqual(summary["published_days"], 0)
                self.assertEqual(summary["failed_days"], ["2026-01-02"])


if __name__ == "__main__":
    unittest.main()
