import unittest

from metrika_pagination import collect_all_pages, collect_all_rows


class MetrikaPaginationTests(unittest.TestCase):
    def test_collect_all_pages_reconciles_a_stable_reported_total(self):
        calls = []

        def fetch_page(offset):
            calls.append(offset)
            if offset == 1:
                return {"total_rows": 3, "data": [{"id": 1}, {"id": 2}]}
            return {"total_rows": 3, "data": [{"id": 3}]}

        result = collect_all_pages(fetch_page, limit=2)

        self.assertEqual(tuple(row["id"] for row in result.rows), (1, 2, 3))
        self.assertEqual(result.total_rows, 3)
        self.assertEqual(result.pages_fetched, 2)
        self.assertTrue(result.pagination_complete)
        self.assertFalse(result.sampled)
        self.assertIsNone(result.sample_share)
        self.assertEqual(calls, [1, 3])

    def test_collect_all_pages_preserves_sampling_metadata(self):
        result = collect_all_pages(
            lambda _offset: {
                "total_rows": 1,
                "sampled": True,
                "sample_share": 0.25,
                "data": [{"id": 1}],
            },
            limit=2,
        )

        self.assertTrue(result.pagination_complete)
        self.assertTrue(result.sampled)
        self.assertEqual(result.sample_share, 0.25)

    def test_collect_all_pages_marks_changed_totals_incomplete(self):
        def fetch_page(offset):
            if offset == 1:
                return {"total_rows": 4, "data": [{"id": 1}, {"id": 2}]}
            return {"total_rows": 3, "data": [{"id": 3}]}

        result = collect_all_pages(fetch_page, limit=2)

        self.assertFalse(result.pagination_complete)
        self.assertEqual(result.total_rows, 4)
        self.assertEqual(result.pages_fetched, 2)

    def test_collect_all_pages_marks_changed_sampling_evidence_incomplete(self):
        def fetch_page(offset):
            if offset == 1:
                return {
                    "total_rows": 3,
                    "sampled": True,
                    "sample_share": 0.5,
                    "data": [{"id": 1}, {"id": 2}],
                }
            return {
                "total_rows": 3,
                "sampled": True,
                "sample_share": 0.75,
                "data": [{"id": 3}],
            }

        result = collect_all_pages(fetch_page, limit=2)

        self.assertFalse(result.pagination_complete)
        self.assertTrue(result.sampled)
        self.assertEqual(result.sample_share, 0.5)

    def test_collect_all_pages_marks_short_page_before_total_incomplete(self):
        result = collect_all_pages(
            lambda _offset: {
                "total_rows": 4,
                "data": [{"id": 1}],
            },
            limit=2,
        )

        self.assertEqual(len(result.rows), 1)
        self.assertEqual(result.total_rows, 4)
        self.assertFalse(result.pagination_complete)

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

    def test_collect_all_rows_remains_a_list_returning_compatibility_wrapper(self):
        rows = collect_all_rows(
            lambda _offset: {"total_rows": 1, "data": [{"id": 1}]},
            limit=2,
        )

        self.assertIsInstance(rows, list)
        self.assertEqual(rows, [{"id": 1}])


if __name__ == "__main__":
    unittest.main()
