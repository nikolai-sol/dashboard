import unittest

from metrika_pagination import collect_all_rows


class MetrikaPaginationTests(unittest.TestCase):
    def test_collects_all_pages_until_reported_total(self):
        calls = []

        def fetch_page(offset):
            calls.append(offset)
            if offset == 1:
                return {"total_rows": 3, "data": [{"id": 1}, {"id": 2}]}
            return {"total_rows": 3, "data": [{"id": 3}]}

        rows = collect_all_rows(fetch_page, limit=2)

        self.assertEqual([row["id"] for row in rows], [1, 2, 3])
        self.assertEqual(calls, [1, 3])

    def test_stops_when_response_is_shorter_than_limit(self):
        calls = []

        def fetch_page(offset):
            calls.append(offset)
            return {"total_rows": 1, "data": [{"id": 1}]}

        rows = collect_all_rows(fetch_page, limit=2)

        self.assertEqual([row["id"] for row in rows], [1])
        self.assertEqual(calls, [1])


if __name__ == "__main__":
    unittest.main()
