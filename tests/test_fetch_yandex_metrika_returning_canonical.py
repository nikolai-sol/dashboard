import unittest


class YandexMetrikaReturningCanonicalTests(unittest.TestCase):
    def test_returning_upsert_uses_canonical_table_and_business_key(self):
        from fetch_yandex_metrika_returning_canonical import RETURNING_PAGE_UPSERT_SQL

        self.assertIn("canonical_fact_metrika_returning_pages_daily", RETURNING_PAGE_UPSERT_SQL)
        self.assertIn("ON DUPLICATE KEY UPDATE", RETURNING_PAGE_UPSERT_SQL)
        self.assertIn("page_hash", RETURNING_PAGE_UPSERT_SQL)
        self.assertNotIn("yandex_metrika_returned", RETURNING_PAGE_UPSERT_SQL)

    def test_normalize_returning_rows_converts_cumulative_recency_to_exclusive_buckets(self):
        from fetch_yandex_metrika_returning_canonical import normalize_returning_rows

        rows = normalize_returning_rows(
            {
                "data": [
                    {
                        "dimensions": [{"name": "https://zaruku.ru/content/sample/"}],
                        "metrics": [100, 10, 25, 40],
                    }
                ]
            },
            analytics_account_id="66624469",
            report_date="2026-07-15",
            run_id=123,
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["visits"], 100)
        self.assertEqual(rows[0]["returning_1_day_users"], 10)
        self.assertEqual(rows[0]["returning_2_7_days_users"], 15)
        self.assertEqual(rows[0]["returning_8_31_days_users"], 15)
        self.assertEqual(rows[0]["analytics_account_id"], "66624469")
        self.assertEqual(rows[0]["report_date"], "2026-07-15")
        self.assertEqual(rows[0]["ingestion_run_id"], 123)


if __name__ == "__main__":
    unittest.main()
