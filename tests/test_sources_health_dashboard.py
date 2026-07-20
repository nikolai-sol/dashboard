import unittest
from datetime import date

import sources_health_dashboard as health


class RecordingCursor:
    def __init__(self):
        self.sql = []

    def execute(self, sql, params=()):
        self.sql.append((sql, params))

    def fetchone(self):
        sql = self.sql[-1][0]
        if "MAX(report_date)" in sql:
            return {"max_report_date": date(2026, 7, 15)}
        return None

    def fetchall(self):
        return [
            {
                "source_key": "yandex_metrika",
                "fact_scope": "traffic",
                "native_grain": "analytics_slice",
                "row_count": 4,
                "min_date": date(2026, 7, 15),
                "max_date": date(2026, 7, 15),
            }
        ]


class SourceHealthTests(unittest.TestCase):
    def test_metrika_uses_site_analytics_and_is_non_blocking(self):
        cur = RecordingCursor()
        snapshot = health.build_source_fact_snapshot(
            cur, "yandex_metrika", date(2026, 7, 10)
        )

        rendered = "\n".join(sql for sql, _ in cur.sql)
        self.assertIn("canonical_fact_site_analytics_daily", rendered)
        self.assertNotIn("canonical_fact_ads_daily", rendered)
        self.assertEqual(snapshot["latest_data"]["max_report_date"], date(2026, 7, 15))
        self.assertFalse(health.default_blocking("yandex_metrika", None))

    def test_metrika_configuration_is_analytics_traffic(self):
        self.assertEqual(
            health.source_config("yandex_metrika"),
            {
                "gate_note": "canonical analytics freshness on traffic scope",
                "source_kind": "analytics",
                "gate_scope": "traffic",
                "is_blocking_default": False,
            },
        )

    def test_critical_non_blocking_metrika_does_not_change_exit_code(self):
        item = {
            "source_key": "yandex_metrika",
            "status": "CRITICAL",
            "governance": {"blocking": False},
        }
        self.assertEqual(health.compute_exit_code([item]), 0)

    def test_policy_cannot_make_generic_metrika_blocking(self):
        policy = {"is_blocking": True}
        self.assertFalse(health.default_blocking("yandex_metrika", policy))


if __name__ == "__main__":
    unittest.main()
