import json
import os
import stat
import tempfile
import unittest
from pathlib import Path

from build_abbott_bitrix_analytics import build_bitrix_analytics, write_private_json
from build_abbott_bitrix_session_journeys import build_session_journeys


def sql_tuple(values):
    encoded = []
    for value in values:
        if value is None:
            encoded.append("NULL")
        else:
            encoded.append("'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'")
    return "(" + ",".join(encoded) + ")"


class AbbottPrivateBuildersTask7Test(unittest.TestCase):
    def make_dump(self, root: Path) -> Path:
        session = [""] * 18
        session[0] = "0000000000009007199254740993"
        session[1] = "guest-0001"
        session[3] = "000123"
        session[4] = "Y"
        session[6] = "3"
        session[9] = "/entry?private=1"
        session[11] = "/exit#private"
        session[15] = "2026-05-20 10:00:00"
        session[16] = "2026-05-21 10:02:00"

        def hit(hit_id, at, url):
            row = [""] * 18
            row[0] = hit_id
            row[1] = "0000000000009007199254740993"
            row[2] = at
            row[3] = "guest-0001"
            row[5] = "000123"
            row[7] = url
            row[8] = "N"
            row[11] = "GET"
            row[13] = "Mozilla/5.0"
            row[14] = "0"
            return row

        dump = root / "input.sql"
        dump.write_text(
            "INSERT INTO `b_stat_session` VALUES " + sql_tuple(session) + ";\n"
            "INSERT INTO `b_stat_hit` VALUES "
            + ",".join(
                [
                    sql_tuple(hit("hit-0001", "2026-05-20 10:00:00", "/article/a?token=secret")),
                    sql_tuple(hit("hit-0002", "2026-05-20 10:01:00", "/article/b#private")),
                    sql_tuple(hit("hit-0003", "2026-05-21 10:02:00", "/article/a?other=secret")),
                ]
            )
            + ";\n",
            encoding="utf-8",
        )
        return dump

    def test_page_builder_emits_complete_daily_rows_without_silent_limit(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload = build_bitrix_analytics(self.make_dump(Path(tmp)))

        self.assertEqual(payload["grain"], "normalized_path x report_date")
        self.assertEqual(payload["manifest"], {"complete": True, "truncated": False})
        self.assertEqual(len(payload["rows"]), 3)
        self.assertEqual(
            [(row["report_date"], row["normalized_path"]) for row in payload["rows"]],
            [
                ("2026-05-20", "/article/a"),
                ("2026-05-20", "/article/b"),
                ("2026-05-21", "/article/a"),
            ],
        )

    def test_journey_builder_emits_lossless_ordered_events(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload = build_session_journeys(self.make_dump(Path(tmp)))

        self.assertEqual(payload["schema"]["grain"], "protected_visit_id x event_sequence")
        self.assertTrue(payload["schema"]["ordered_events"])
        self.assertEqual(payload["manifest"], {"complete": True, "truncated": False})
        self.assertEqual([row["event_sequence"] for row in payload["rows"]], [0, 1, 0])
        self.assertEqual(payload["rows"][0]["protected_visit_id"], "0000000000009007199254740993")
        self.assertEqual(payload["rows"][0]["raw_user_id"], "000123")
        self.assertEqual(payload["rows"][0]["source_event_id"], "hit-0001")
        self.assertEqual(payload["rows"][0]["normalized_path"], "/article/a")

    def test_private_writer_rejects_public_and_sets_0600(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaisesRegex(ValueError, "public"):
                write_private_json(root / "public" / "abbott.json", {"rows": []})

            output = root / "private" / "abbott.json"
            write_private_json(output, {"rows": []})
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), {"rows": []})


if __name__ == "__main__":
    unittest.main()
