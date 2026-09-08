import importlib.util
import pathlib
import subprocess
import sys
import unittest
from unittest.mock import patch

HELPER = pathlib.Path(__file__).with_name('zaruku-shadow-evidence-lock.py')
SPEC = importlib.util.spec_from_file_location('evidence_fence', HELPER)
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


class EvidenceFence(unittest.TestCase):
    def test_lock_is_retained_on_inherited_description_and_path_is_reattested(self):
        with patch.object(MOD, 'attest') as attest, patch.object(MOD.fcntl, 'flock') as flock, patch.object(MOD.os, 'set_inheritable') as inherit:
            MOD.acquire({})
        self.assertEqual(attest.call_count, 2)
        flock.assert_called_once_with(5, MOD.fcntl.LOCK_EX | MOD.fcntl.LOCK_NB)
        inherit.assert_called_once_with(5, True)

    def test_lock_deadline_is_bounded_below_the_240_second_transport(self):
        with patch.object(MOD, 'attest'), patch.object(MOD.fcntl, 'flock', side_effect=BlockingIOError()), patch.object(MOD.time, 'monotonic', side_effect=[0, 210]), patch.object(MOD.time, 'sleep') as sleep:
            with self.assertRaises(ValueError):
                MOD.acquire({})
        sleep.assert_not_called()

    def test_waited_lock_cannot_accept_a_replaced_or_finalized_directory(self):
        with patch.object(MOD, 'attest', side_effect=[None, ValueError()]), patch.object(MOD.fcntl, 'flock'), patch.object(MOD.os, 'set_inheritable') as inherit:
            with self.assertRaises(ValueError):
                MOD.acquire({})
        inherit.assert_not_called()

    def test_cli_rejects_modes_private_input_and_pid_recovery_with_sanitized_error(self):
        for args, data in [(['PRIVATE_HEADER'], b'PRIVATE_SECRET'), (['acquire'], b'{"pid":1,"startTime":"PRIVATE_BODY"}'), (['verify'], b'x' * 4097)]:
            result = subprocess.run([sys.executable, '-I', '-B', str(HELPER), *args], input=data, capture_output=True, env={}, timeout=5)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, b'')
            self.assertEqual(result.stderr, b'Zaruku evidence fence failed\n')


if __name__ == '__main__':
    unittest.main()
