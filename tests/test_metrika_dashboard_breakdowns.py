import dataclasses
import hashlib
import json
import unittest

from metrika_dashboard_breakdowns import (
    ZARUKU_BREAKDOWN_REPORTS,
    build_breakdown_rows,
    build_coverage_row,
)


EXPECTED_REPORTS = {
    "search_engines": ("ym:s:searchEngine",),
    "search_phrases": ("ym:s:searchPhrase",),
    "organic_landing": ("ym:s:searchEngine", "ym:s:startURL"),
    "section_entrances": ("ym:s:startURL",),
    "map_city_demand": ("ym:s:regionCity", "ym:s:startURL"),
    "devices": ("ym:s:deviceCategory",),
    "browsers": ("ym:s:browser",),
    "operating_systems": ("ym:s:operatingSystem",),
    "age_intervals": ("ym:s:ageInterval",),
    "genders": ("ym:s:gender",),
    "interests": ("ym:s:interest",),
    "source_devices": ("ym:s:lastTrafficSource", "ym:s:deviceCategory"),
}

EXPECTED_METRICS = (
    "ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate,"
    "ym:s:avgVisitDurationSeconds,ym:s:pageDepth"
)


class MetrikaDashboardBreakdownRegistryTests(unittest.TestCase):
    def test_registry_defines_exactly_the_twelve_russia_reports(self):
        actual = {
            report.report_key: report.dimensions
            for report in ZARUKU_BREAKDOWN_REPORTS
        }

        self.assertEqual(actual, EXPECTED_REPORTS)
        self.assertEqual(len(ZARUKU_BREAKDOWN_REPORTS), 12)
        for report in ZARUKU_BREAKDOWN_REPORTS:
            with self.subTest(report=report.report_key):
                self.assertEqual(report.segment_key, "russia")
                self.assertEqual(report.filters, "ym:s:regionCountry=='225'")
                self.assertEqual(report.metrics, EXPECTED_METRICS)
                with self.assertRaises(dataclasses.FrozenInstanceError):
                    report.report_key = "changed"


class MetrikaDashboardBreakdownNormalizationTests(unittest.TestCase):
    @staticmethod
    def report(report_key):
        return next(
            report
            for report in ZARUKU_BREAKDOWN_REPORTS
            if report.report_key == report_key
        )

    @staticmethod
    def expected_hash(*parts):
        payload = json.dumps(
            list(parts),
            ensure_ascii=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def test_builds_one_dimension_detail_and_api_total_rows(self):
        report = self.report("search_engines")
        response = {
            "data": [
                {
                    "dimensions": [{"id": "google", "name": "Google"}],
                    "metrics": [12, 8, 21, 14.25, 83.5, 2.75],
                }
            ],
            "totals": [12, 8, 21, 14.25, 83.5, 2.75],
            "total_rows": 1,
        }

        rows = build_breakdown_rows("66624469", "2026-07-22", report, response, 71)

        self.assertEqual(len(rows), 2)
        detail, total = rows
        self.assertEqual(
            detail,
            {
                "source_key": "yandex_metrika",
                "analytics_account_id": "66624469",
                "report_date": "2026-07-22",
                "report_key": "search_engines",
                "segment_key": "russia",
                "row_kind": "detail",
                "dimension_1_key": "ym:s:searchEngine",
                "dimension_1_id": "google",
                "dimension_1_value": "Google",
                "dimension_2_key": None,
                "dimension_2_id": None,
                "dimension_2_value": None,
                "page_url": None,
                "dimension_hash": self.expected_hash(
                    "66624469",
                    "2026-07-22",
                    "search_engines",
                    "russia",
                    "detail",
                    "ym:s:searchEngine",
                    "google",
                    "Google",
                    None,
                    None,
                    None,
                ),
                "visits": 12,
                "users": 8,
                "new_users": None,
                "pageviews": 21,
                "bounce_rate": 14.25,
                "avg_visit_duration_seconds": 83.5,
                "page_depth": 2.75,
                "ingestion_run_id": 71,
            },
        )
        self.assertEqual(total["row_kind"], "total")
        self.assertEqual(total["dimension_1_key"], "ym:s:searchEngine")
        self.assertIsNone(total["dimension_1_id"])
        self.assertIsNone(total["dimension_1_value"])
        self.assertEqual(total["visits"], 12)
        self.assertEqual(
            total["dimension_hash"],
            self.expected_hash(
                "66624469",
                "2026-07-22",
                "search_engines",
                "russia",
                "total",
                "ym:s:searchEngine",
                None,
                None,
                None,
                None,
                None,
            ),
        )

    def test_builds_two_dimension_identity_and_extracts_start_url(self):
        report = self.report("organic_landing")
        response = {
            "data": [
                {
                    "dimensions": [
                        {"id": "organic", "name": "Organic search"},
                        {"id": "https://zaruku.ru/map/", "name": "https://zaruku.ru/map/"},
                    ],
                    "metrics": [7, 5, 11, 9.5, 112, 3.25],
                }
            ],
            "totals": [7, 5, 11, 9.5, 112, 3.25],
            "total_rows": 1,
        }

        first = build_breakdown_rows("66624469", "2026-07-22", report, response, 72)
        second = build_breakdown_rows("66624469", "2026-07-22", report, response, 72)

        detail = first[0]
        self.assertEqual(detail["dimension_1_key"], "ym:s:searchEngine")
        self.assertEqual(detail["dimension_1_id"], "organic")
        self.assertEqual(detail["dimension_1_value"], "Organic search")
        self.assertEqual(detail["dimension_2_key"], "ym:s:startURL")
        self.assertEqual(detail["dimension_2_id"], "https://zaruku.ru/map/")
        self.assertEqual(detail["dimension_2_value"], "https://zaruku.ru/map/")
        self.assertEqual(detail["page_url"], "https://zaruku.ru/map/")
        self.assertEqual(detail["dimension_hash"], second[0]["dimension_hash"])
        self.assertEqual(detail["visits"], 7)
        self.assertEqual(detail["users"], 5)
        self.assertEqual(detail["pageviews"], 11)
        self.assertEqual(detail["bounce_rate"], 9.5)
        self.assertEqual(detail["avg_visit_duration_seconds"], 112.0)
        self.assertEqual(detail["page_depth"], 3.25)

    def test_dimension_hash_does_not_collide_when_identities_contain_delimiter(self):
        report = self.report("search_engines")
        left_response = {
            "data": [
                {
                    "dimensions": [{"id": "a|b", "name": "c"}],
                    "metrics": [1, 1, 1, 1, 1, 1],
                }
            ],
        }
        right_response = {
            "data": [
                {
                    "dimensions": [{"id": "a", "name": "b|c"}],
                    "metrics": [1, 1, 1, 1, 1, 1],
                }
            ],
        }

        left = build_breakdown_rows(
            "66624469", "2026-07-22", report, left_response, 72
        )[0]
        right = build_breakdown_rows(
            "66624469", "2026-07-22", report, right_response, 72
        )[0]

        self.assertNotEqual(left["dimension_hash"], right["dimension_hash"])
        self.assertEqual(
            left["dimension_hash"],
            self.expected_hash(
                "66624469",
                "2026-07-22",
                "search_engines",
                "russia",
                "detail",
                "ym:s:searchEngine",
                "a|b",
                "c",
                None,
                None,
                None,
            ),
        )

    def test_coverage_marks_http_success_with_no_details_as_empty(self):
        report = self.report("section_entrances")
        response = {
            "data": [],
            "totals": [0, 0, 0, 0, 0, 0],
            "total_rows": 0,
            "pagination_complete": True,
        }
        rows = build_breakdown_rows("66624469", "2026-07-22", report, response, 73)

        coverage = build_coverage_row(
            "66624469", "2026-07-22", report, response, rows, 73
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["row_kind"], "total")
        self.assertEqual(
            coverage,
            {
                "source_key": "yandex_metrika",
                "analytics_account_id": "66624469",
                "report_date": "2026-07-22",
                "report_key": "section_entrances",
                "segment_key": "russia",
                "status": "empty",
                "api_total_rows": 0,
                "persisted_rows": 1,
                "pagination_complete": 1,
                "ingestion_run_id": 73,
            },
        )

    def test_coverage_rejects_missing_api_total_rows(self):
        report = self.report("search_engines")
        response = {
            "data": [
                {
                    "dimensions": [{"id": "google", "name": "Google"}],
                    "metrics": [1, 1, 1, 1, 1, 1],
                }
            ],
            "pagination_complete": True,
        }
        rows = build_breakdown_rows(
            "66624469", "2026-07-22", report, response, 74
        )

        with self.assertRaisesRegex(ValueError, "total_rows"):
            build_coverage_row(
                "66624469", "2026-07-22", report, response, rows, 74
            )

    def test_coverage_rejects_invalid_api_total_rows(self):
        report = self.report("search_engines")
        for invalid_total in (-1, "1", 1.5, True, "invalid"):
            with self.subTest(total_rows=invalid_total):
                response = {
                    "data": [
                        {
                            "dimensions": [{"id": "google", "name": "Google"}],
                            "metrics": [1, 1, 1, 1, 1, 1],
                        }
                    ],
                    "total_rows": invalid_total,
                    "pagination_complete": True,
                }
                rows = build_breakdown_rows(
                    "66624469", "2026-07-22", report, response, 75
                )

                with self.assertRaisesRegex(ValueError, "total_rows"):
                    build_coverage_row(
                        "66624469", "2026-07-22", report, response, rows, 75
                    )

    def test_coverage_rejects_missing_or_false_pagination_completeness(self):
        report = self.report("search_engines")
        for completeness in (None, False):
            with self.subTest(pagination_complete=completeness):
                response = {
                    "data": [
                        {
                            "dimensions": [{"id": "google", "name": "Google"}],
                            "metrics": [1, 1, 1, 1, 1, 1],
                        }
                    ],
                    "total_rows": 1,
                }
                if completeness is not None:
                    response["pagination_complete"] = completeness
                rows = build_breakdown_rows(
                    "66624469", "2026-07-22", report, response, 76
                )

                with self.assertRaisesRegex(ValueError, "pagination_complete"):
                    build_coverage_row(
                        "66624469", "2026-07-22", report, response, rows, 76
                    )

    def test_coverage_rejects_detail_count_mismatch(self):
        report = self.report("search_engines")
        response = {
            "data": [
                {
                    "dimensions": [{"id": "google", "name": "Google"}],
                    "metrics": [1, 1, 1, 1, 1, 1],
                }
            ],
            "total_rows": 2,
            "pagination_complete": True,
        }
        rows = build_breakdown_rows(
            "66624469", "2026-07-22", report, response, 77
        )

        with self.assertRaisesRegex(ValueError, "detail-row count"):
            build_coverage_row(
                "66624469", "2026-07-22", report, response, rows, 77
            )


if __name__ == "__main__":
    unittest.main()
