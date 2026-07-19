import io
import sys
import types
import unittest

try:
    import dotenv  # noqa: F401
except ModuleNotFoundError:
    dotenv_stub = types.ModuleType("dotenv")
    dotenv_stub.load_dotenv = lambda *_args, **_kwargs: None
    sys.modules["dotenv"] = dotenv_stub

try:
    import mysql.connector  # noqa: F401
except ModuleNotFoundError:
    mysql_stub = types.ModuleType("mysql")
    connector_stub = types.ModuleType("mysql.connector")
    connector_stub.connect = lambda *_args, **_kwargs: None
    mysql_stub.connector = connector_stub
    sys.modules["mysql"] = mysql_stub
    sys.modules["mysql.connector"] = connector_stub

import openpyxl

from fetch_between_email_canonical import deduplicate_report_rows, parse_csv_bytes, parse_xlsx_bytes


class BetweenReportParsingTests(unittest.TestCase):
    def test_between_campaign_export_maps_video_metrics_and_channel(self):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Report"
        ws.append(
            [
                "Date",
                "Campaign Name",
                "Campaign Id",
                "Impressions",
                "Clicks",
                "V Complete",
                "V Thirdq",
                "V MidPoint",
                "V Firstq",
                "Frequency",
                "Net CPV",
                "Net CPC",
                "Net CPM",
            ]
        )
        ws.append(
            [
                "2026-07-15",
                "OLV WL",
                24835,
                9949,
                94,
                8646,
                9000,
                9300,
                9500,
                1.25,
                0.19,
                17.84,
                178.4,
            ]
        )
        out = io.BytesIO()
        wb.save(out)

        rows = parse_xlsx_bytes(out.getvalue(), source_name="between.xlsx")

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["channel"], "WL")
        self.assertEqual(rows[0]["views"], 8646)
        self.assertEqual(rows[0]["video_views_25"], 9500)
        self.assertEqual(rows[0]["video_views_50"], 9300)
        self.assertEqual(rows[0]["video_views_75"], 9000)
        self.assertEqual(rows[0]["video_views_100"], 8646)
        self.assertAlmostEqual(rows[0]["spend"], 1774.9016, places=4)
        self.assertAlmostEqual(rows[0]["cpm"], 178.4, places=4)
        self.assertAlmostEqual(rows[0]["cpc"], 17.84, places=4)
        self.assertAlmostEqual(rows[0]["cpv"], 0.19, places=4)
        self.assertAlmostEqual(rows[0]["reach"], 7959.2, places=4)

    def test_daily_email_csv_maps_between_export_columns(self):
        data = (
            "event_date,campaign_name,campaign_id,imps,clicks,ctr_pct,revenue,"
            "video_start,video_firstquartile,video_midpoint,video_thirdquartile,video_complete\n"
            "2026-07-14,\"OLV WL\",24835,9950,114,1.14,1665.50708,10230,9088,8388,7981,7644\n"
        ).encode()

        rows = parse_csv_bytes(data, source_name="daily-report.csv")

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["report_date"], "2026-07-14")
        self.assertEqual(rows[0]["channel"], "WL")
        self.assertEqual(rows[0]["impressions"], 9950)
        self.assertEqual(rows[0]["clicks"], 114)
        self.assertEqual(rows[0]["views"], 7644)
        self.assertEqual(rows[0]["video_views_25"], 9088)
        self.assertEqual(rows[0]["video_views_50"], 8388)
        self.assertEqual(rows[0]["video_views_75"], 7981)
        self.assertEqual(rows[0]["video_views_100"], 7644)
        self.assertAlmostEqual(rows[0]["spend"], 1665.50708, places=5)
        self.assertAlmostEqual(rows[0]["cpc"], 14.609711, places=5)
        self.assertAlmostEqual(rows[0]["cpm"], 167.387646, places=5)
        self.assertAlmostEqual(rows[0]["cpv"], 0.217884, places=5)

    def test_repeated_daily_reports_are_not_summed(self):
        row = {
            "report_date": "2026-07-14",
            "channel": "WL",
            "impressions": 9950,
            "clicks": 114,
        }

        out = deduplicate_report_rows([row, dict(row)])

        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["impressions"], 9950)


if __name__ == "__main__":
    unittest.main()
