from decimal import Decimal
import unittest

from metrika_pagination import PaginationResult


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


if __name__ == "__main__":
    unittest.main()
