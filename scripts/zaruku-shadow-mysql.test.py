import importlib.util
import io
import os
import pathlib
import stat
import types
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('mysql_helper', pathlib.Path(__file__).with_name('zaruku-shadow-mysql.py'))
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)
SESSION_SPEC = importlib.util.spec_from_file_location('mysql_session', pathlib.Path(__file__).with_name('zaruku-shadow-mysql-session.py'))
SESSION = importlib.util.module_from_spec(SESSION_SPEC)
SESSION_SPEC.loader.exec_module(SESSION)
IDENTITY = {'dev': '1', 'ino': '2', 'sha256': 'a' * 64}

class System(MOD.System):
    def __init__(self):
        self.calls, self.closed, self.defaults = [], [], None
        self.identity = IDENTITY.copy()
        self.output = (0, b'currentUser\ndashboard_zaruku_reader@127.0.0.1\n', b'')
    def binary(self):
        return 7, self.identity
    def memfd(self, data):
        self.defaults = data
        return 8
    def run(self, argv, executable, sql, fds):
        self.calls.append((argv, executable, sql, fds))
        return self.output
    def close(self, fd):
        self.closed.append(fd)

def request():
    return {'mode':'reader', 'password':'PRIVATE_PASSWORD_SENTINEL', 'sql':'SELECT CURRENT_USER() AS currentUser', 'toolIdentity':IDENTITY}

class MysqlBoundary(unittest.TestCase):
    def test_both_admin_clients_require_private_metadata_and_defaults_first(self):
        for mode in [0o400, 0o600]:
            info = os.stat_result((stat.S_IFREG | mode, 1, 1, 1, 0, 0, 0, 0, 0, 0))
            with mock.patch.object(MOD.os, 'lstat', return_value=info) as inspected:
                with self.subTest(mode=mode, client='read-only'):
                    system = System()
                    MOD.execute({**request(), 'mode': 'admin', 'password': None}, system)
                    self.assertEqual(system.calls[0][0][1:4], ['--defaults-file=/root/.my.cnf', '--protocol=socket', '--user=root'])
                    self.assertIsNone(system.defaults)
                    inspected.assert_called_with('/root/.my.cnf')
                with self.subTest(mode=mode, client='session'):
                    child = types.SimpleNamespace(poll=lambda: 0, wait=lambda: 0, stdin=io.BytesIO(), stdout=io.BytesIO())
                    with mock.patch.object(SESSION.subprocess, 'Popen', return_value=child) as popen, mock.patch.object(SESSION.Session, 'query'):
                        connection = SESSION.Session(System(), 'admin', None)
                        try:
                            self.assertEqual(popen.call_args.args[0][1:4], ['--defaults-file=/root/.my.cnf', '--protocol=socket', '--user=root'])
                            self.assertEqual(popen.call_args.kwargs['env'], {})
                        finally:
                            connection.close()

    def test_both_admin_clients_reject_unsafe_defaults_before_query_or_child(self):
        values = [None, (stat.S_IFLNK | 0o600, 1, 0, 0), (stat.S_IFDIR | 0o600, 1, 0, 0),
                  (stat.S_IFREG | 0o600, 1, 1, 0), (stat.S_IFREG | 0o600, 1, 0, 1),
                  (stat.S_IFREG | 0o600, 2, 0, 0)]
        values += [(stat.S_IFREG | mode, 1, 0, 0) for mode in [0, 0o444, 0o640, 0o700, 0o4600]]
        for value in values:
            kwargs = {'side_effect': FileNotFoundError()} if value is None else {'return_value': os.stat_result((value[0], 1, 1, value[1], value[2], value[3], 0, 0, 0, 0))}
            with mock.patch.object(MOD.os, 'lstat', **kwargs):
                with self.subTest(value=value, client='read-only'):
                    system = System()
                    with self.assertRaisesRegex(ValueError, '^Zaruku MySQL check failed$'):
                        MOD.execute({**request(), 'mode': 'admin', 'password': None}, system)
                    self.assertEqual(system.calls, [])
                    self.assertIsNone(system.defaults)
                with self.subTest(value=value, client='session'), mock.patch.object(SESSION.subprocess, 'Popen') as popen, mock.patch.object(SESSION.Session, 'query'):
                    with self.assertRaises((ValueError, FileNotFoundError)):
                        SESSION.Session(System(), 'admin', None)
                    popen.assert_not_called()

    def test_credentials_use_only_sealed_defaults_descriptor_and_sql_pipe(self):
        system = System()
        result = MOD.execute(request(), system)
        self.assertEqual(result, {'rows':[{'currentUser':'dashboard_zaruku_reader@127.0.0.1'}]})
        self.assertIn(b'PRIVATE_PASSWORD_SENTINEL', system.defaults)
        self.assertNotIn('PRIVATE_PASSWORD_SENTINEL', repr(system.calls))
        argv, executable, sql, fds = system.calls[0]
        self.assertEqual(executable, '/proc/self/fd/7')
        self.assertEqual(fds, (7, 8))
        self.assertIn('--defaults-file=/proc/self/fd/8', argv)
        self.assertNotIn('-e', argv)
        self.assertEqual(set(system.closed), {7,8})
        self.assertIn(b'SELECT CURRENT_USER()', sql)

    def test_binary_substitution_and_unsafe_identity_fail_before_credentials_or_query(self):
        for field in ['dev','ino','sha256']:
            system = System(); system.identity[field] = 'changed'
            with self.assertRaisesRegex(ValueError, '^Zaruku MySQL check failed$'):
                MOD.execute(request(), system)
            self.assertIsNone(system.defaults)
            self.assertEqual(system.calls, [])
            self.assertEqual(system.closed, [7])

    def test_denials_are_only_safe_errno_and_other_diagnostics_never_escape(self):
        for stderr in [b'ERROR 1142 (42000): PRIVATE_PASSWORD_SENTINEL', b'PRIVATE_PASSWORD_SENTINEL', b'ERROR 9999 PRIVATE_PASSWORD_SENTINEL']:
            system = System(); system.output = (1, b'PRIVATE_ROW_SENTINEL', stderr)
            if stderr.startswith(b'ERROR 1142'):
                self.assertEqual(MOD.execute(request(), system), {'errno':1142})
            else:
                with self.assertRaisesRegex(ValueError, '^Zaruku MySQL check failed$'):
                    MOD.execute(request(), system)
            self.assertEqual(set(system.closed), {7,8})

    def test_write_sql_extra_inputs_oversize_and_timeout_are_fail_closed(self):
        for sql in ['DROP TABLE x', 'SELECT 1; DELETE FROM x', 'SELECT 1 INTO OUTFILE "/tmp/x"', 'SELECT SLEEP(20)', 'UPDATE x SET y=1']:
            data = request(); data['sql'] = sql
            with self.assertRaisesRegex(ValueError, '^Zaruku MySQL check failed$'):
                MOD.execute(data, System())
        for output in [(0,b'x\n' + b'x'*65536,b''), (0,b'x\n1\n',b'PRIVATE_SENTINEL')]:
            system=System(); system.output=output
            with self.assertRaisesRegex(ValueError, '^Zaruku MySQL check failed$'):
                MOD.execute(request(),system)
        system=System()
        def timeout(*_): raise TimeoutError('PRIVATE_SENTINEL')
        system.run=timeout
        with self.assertRaisesRegex(ValueError, '^Zaruku MySQL check failed$'):
            MOD.execute(request(),system)
        self.assertEqual(set(system.closed),{7,8})

    def test_zero_row_write_probe_is_wrapped_in_a_single_rollback_only_connection(self):
        data=request();data['sql']='UPDATE `report_bd`.`canonical_fact_site_analytics_daily` SET `visits` = `visits` WHERE 1 = 0'
        system=System();system.output=(1,b'',b'ERROR 1142 (42000): denied')
        self.assertEqual(MOD.execute(data,system),{'errno':1142})
        self.assertEqual(system.calls[0][2], ('START TRANSACTION;\n'+data['sql']+';\nROLLBACK;\n').encode())

if __name__ == '__main__':
    unittest.main()
