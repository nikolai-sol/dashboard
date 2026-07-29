import csv
import gzip
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

import probe_yandex_webmaster_query_page as probe
from probe_yandex_webmaster_query_page import (
    build_query_page_probe_body,
    compare_query_page_rows,
    fetch_query_analytics_rows,
    load_enhanced_export_rows,
    normalize_query_analytics_query_rows,
    run_probe,
)


class QueryPageProbeTest(unittest.TestCase):
    def test_body_requests_queries_for_one_exact_url(self):
        body = build_query_page_probe_body("/article/", "2026-07-22", 0)

        self.assertEqual(body["text_indicator"], "QUERY")
        self.assertEqual(body["sort_by_date"]["date"], "2026-07-22")
        self.assertEqual(
            body["filters"]["text_filters"],
            [
                {
                    "text_indicator": "URL",
                    "operation": "TEXT_MATCH",
                    "value": "/article/",
                }
            ],
        )
        self.assertEqual(body["limit"], 500)

    def test_normalizer_uses_primary_query_and_requested_page(self):
        payload = {
            "text_indicator_to_statistics": [
                {
                    "text_indicator": {"type": "QUERY", "value": " Рак  груди "},
                    "popular_complementary_indicator": {
                        "type": "URL",
                        "value": "/wrong/",
                    },
                    "statistics": [
                        {
                            "date": "2026-07-22",
                            "field": "IMPRESSIONS",
                            "value": 9,
                        },
                        {"date": "2026-07-22", "field": "CLICKS", "value": 2},
                    ],
                }
            ]
        }

        self.assertEqual(
            normalize_query_analytics_query_rows(
                payload,
                "2026-07-22",
                "/article/",
            ),
            [
                {
                    "query": "рак груди",
                    "page": "/article/",
                    "clicks": 2,
                    "impressions": 9,
                }
            ],
        )

    def test_normalizer_drops_rows_without_selected_day_metrics(self):
        payload = {
            "text_indicator_to_statistics": [
                {
                    "text_indicator": {"type": "QUERY", "value": "старый запрос"},
                    "statistics": [
                        {
                            "date": "2026-07-22",
                            "field": "IMPRESSIONS",
                            "value": 0,
                        },
                        {"date": "2026-07-22", "field": "CLICKS", "value": 0},
                    ],
                }
            ]
        }

        self.assertEqual(
            normalize_query_analytics_query_rows(
                payload,
                "2026-07-22",
                "/article/",
            ),
            [],
        )

    def test_gate_requires_exact_query_metrics_and_totals(self):
        standard = [
            {
                "query": "рак груди",
                "page": "/article/",
                "clicks": 2,
                "impressions": 9,
            }
        ]
        export = [
            {
                "query": "рак груди",
                "page": "/article/",
                "clicks": 2,
                "impressions": 9,
            }
        ]

        self.assertEqual(compare_query_page_rows(standard, export)["gate"], "pass")
        export[0]["impressions"] = 10
        self.assertEqual(compare_query_page_rows(standard, export)["gate"], "fail")

    def test_enhanced_export_loader_reads_gzip_and_keeps_region_rows(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "export.csv.gz"
            with gzip.open(target, "wt", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(
                    handle,
                    fieldnames=[
                        "date",
                        "host",
                        "path",
                        "query",
                        "region",
                        "clicks",
                        "impressions",
                        "position",
                    ],
                )
                writer.writeheader()
                writer.writerow(
                    {
                        "date": "2026-07-22",
                        "host": "zaruku.ru",
                        "path": "/article/",
                        "query": "Рак груди",
                        "region": "213",
                        "clicks": "1",
                        "impressions": "4",
                        "position": "3.5",
                    }
                )
                writer.writerow(
                    {
                        "date": "2026-07-22",
                        "host": "zaruku.ru",
                        "path": "/article/",
                        "query": "рак  груди",
                        "region": "2",
                        "clicks": "1",
                        "impressions": "5",
                        "position": "4.0",
                    }
                )

            rows = load_enhanced_export_rows(
                target,
                report_date="2026-07-22",
                page_url="/article/",
            )

        self.assertEqual(len(rows), 2)
        self.assertEqual(compare_query_page_rows(rows, rows)["export_impressions"], 9)

    def test_standard_fetch_paginates_to_reported_count(self):
        calls = []
        first_page = [
            {
                "text_indicator": {"type": "QUERY", "value": f"query {index}"},
                "statistics": [
                    {
                        "date": "2026-07-22",
                        "field": "IMPRESSIONS",
                        "value": 1,
                    }
                ],
            }
            for index in range(500)
        ]
        second_page = [
            {
                "text_indicator": {"type": "QUERY", "value": "query 500"},
                "statistics": [
                    {
                        "date": "2026-07-22",
                        "field": "IMPRESSIONS",
                        "value": 1,
                    }
                ],
            }
        ]

        def fake_request(access_token, path_part, **kwargs):
            calls.append((access_token, path_part, kwargs))
            rows = first_page if len(calls) == 1 else second_page
            return {"count": 501, "text_indicator_to_statistics": rows}

        rows, response_hash = fetch_query_analytics_rows(
            "secret-token",
            "42",
            "https:zaruku.ru:443",
            "/article/",
            "2026-07-22",
            request_fn=fake_request,
        )

        self.assertEqual(len(rows), 501)
        self.assertEqual(calls[0][2]["body"]["offset"], 0)
        self.assertEqual(calls[1][2]["body"]["offset"], 500)
        self.assertEqual(len(response_hash), 64)
        self.assertNotIn("secret-token", response_hash)

    def test_standard_fetch_checks_pagination_against_raw_rows(self):
        payload = {
            "count": 2,
            "text_indicator_to_statistics": [
                {
                    "text_indicator": {"type": "QUERY", "value": "active"},
                    "statistics": [
                        {
                            "date": "2026-07-22",
                            "field": "IMPRESSIONS",
                            "value": 1,
                        }
                    ],
                },
                {
                    "text_indicator": {"type": "QUERY", "value": "inactive"},
                    "statistics": [
                        {
                            "date": "2026-07-22",
                            "field": "IMPRESSIONS",
                            "value": 0,
                        }
                    ],
                },
            ],
        }

        rows, _ = fetch_query_analytics_rows(
            "secret-token",
            "42",
            "host-id",
            "/article/",
            "2026-07-22",
            request_fn=lambda *args, **kwargs: payload,
        )

        self.assertEqual([row["query"] for row in rows], ["active"])

    def test_run_probe_returns_only_sanitized_comparison_and_hashes(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "export.csv"
            target.write_text(
                "date,path,query,clicks,impressions\n"
                "2026-07-22,/article/,рак груди,2,9\n",
                encoding="utf-8",
            )
            args = Namespace(
                account_id="66624469",
                domain="zaruku.ru",
                host_id="",
                page_url="/article/",
                report_date="2026-07-22",
                enhanced_export_csv=str(target),
            )
            with (
                patch.object(probe, "refresh_access_token", return_value="secret-token"),
                patch.object(probe, "get_user_id", return_value="42"),
                patch.object(probe, "discover_host_id", return_value="host-id"),
                patch.object(
                    probe,
                    "fetch_query_analytics_rows",
                    return_value=(
                        [
                            {
                                "query": "рак груди",
                                "page": "/article/",
                                "clicks": 2,
                                "impressions": 9,
                            }
                        ],
                        "a" * 64,
                    ),
                ),
            ):
                result = run_probe(args)

        self.assertEqual(result["gate"], "pass")
        self.assertEqual(result["standard_response_sha256"], "a" * 64)
        self.assertEqual(len(result["enhanced_export_sha256"]), 64)
        self.assertNotIn("secret-token", str(result))
        self.assertNotIn("query", result)


if __name__ == "__main__":
    unittest.main()
