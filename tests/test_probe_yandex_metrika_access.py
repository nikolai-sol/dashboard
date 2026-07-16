from __future__ import annotations

import unittest
from unittest.mock import Mock, patch


class ProbeYandexMetrikaAccessTest(unittest.TestCase):
    def test_probe_is_read_only_and_counter_specific(self):
        import probe_yandex_metrika_access as probe

        response = Mock()
        response.json.return_value = {"counter": {"id": 90602537}}
        with patch.object(probe.requests, "get", return_value=response) as get:
            probe.probe_counter_access("protected-token")

        get.assert_called_once_with(
            "https://api-metrika.yandex.net/management/v1/counter/90602537",
            headers={"Authorization": "OAuth protected-token"},
            timeout=20,
        )
        response.raise_for_status.assert_called_once_with()

    def test_probe_rejects_a_different_counter(self):
        import probe_yandex_metrika_access as probe

        response = Mock()
        response.json.return_value = {"counter": {"id": 1}}
        with patch.object(probe.requests, "get", return_value=response):
            with self.assertRaises(probe.MetrikaAccessProbeError):
                probe.probe_counter_access("protected-token")


if __name__ == "__main__":
    unittest.main()
