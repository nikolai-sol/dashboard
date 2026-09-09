import importlib.util
import contextlib
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

class AdminFs:
    def __init__(self):
        self.parent = os.stat_result((stat.S_IFDIR | 0o700, 10, 1, 1, 0, 0, 0, 0, 0, 0))
        self.file = os.stat_result((stat.S_IFREG | 0o400, 11, 1, 1, 0, 0, 10, 0, 0, 0))
        self.login = None
        self.opened, self.closed = [], []
    def open(self, name, flags, *, dir_fd=None):
        assert flags & os.O_NOFOLLOW
        if name == '/root':
            assert flags & os.O_DIRECTORY and dir_fd is None
            fd = 20
        else:
            assert name == '.my.cnf' and dir_fd == 20
            if self.file is None: raise FileNotFoundError(2, 'absent')
            fd = 21
        self.opened.append(fd)
        return fd
    def fstat(self, fd): return self.parent if fd == 20 else self.file
    def stat(self, name, *, dir_fd=None, follow_symlinks=True):
        assert not follow_symlinks
        if name == '/root': return self.parent
        assert name == '.mylogin.cnf' and dir_fd == 20
        if self.login is None: raise FileNotFoundError(2, 'absent')
        if isinstance(self.login, Exception): raise self.login
        return self.login
    @contextlib.contextmanager
    def patch(self):
        with mock.patch.object(MOD.os, 'open', self.open), mock.patch.object(MOD.os, 'fstat', self.fstat), mock.patch.object(MOD.os, 'stat', self.stat), mock.patch.object(MOD.os, 'lstat', return_value=self.file), mock.patch.object(MOD.os, 'close', self.closed.append):
            yield

class MysqlBoundary(unittest.TestCase):
    def test_both_admin_clients_require_private_metadata_and_defaults_first(self):
        for mode in [0o400, 0o600]:
            fixture = AdminFs()
            fixture.file = os.stat_result((stat.S_IFREG | mode, 11, 1, 1, 0, 0, 10, 0, 0, 0))
            with fixture.patch():
                with self.subTest(mode=mode, client='read-only'):
                    system = System()
                    MOD.execute({**request(), 'mode': 'admin', 'password': None}, system)
                    self.assertEqual(system.calls[0][0][1:4], ['--defaults-file=/proc/self/fd/21', '--protocol=socket', '--user=root'])
                    self.assertEqual(system.calls[0][3], (7, 21))
                    self.assertEqual(system.closed, [21, 20, 7])
                    self.assertIsNone(system.defaults)
                with self.subTest(mode=mode, client='session'):
                    child = types.SimpleNamespace(poll=lambda: 0, wait=lambda: 0, stdin=io.BytesIO(), stdout=io.BytesIO())
                    with mock.patch.object(SESSION.subprocess, 'Popen', return_value=child) as popen, mock.patch.object(SESSION.Session, 'query'):
                        connection = SESSION.Session(System(), 'admin', None)
                        try:
                            self.assertEqual(popen.call_args.args[0][1:4], ['--defaults-file=/proc/self/fd/21', '--protocol=socket', '--user=root'])
                            self.assertEqual(popen.call_args.kwargs['pass_fds'], (7, 21))
                            self.assertEqual(popen.call_args.kwargs['env'], {})
                        finally:
                            connection.close()

    def test_unsafe_parent_and_login_file_fail_closed_and_close_descriptors(self):
        parents = [os.stat_result((kind | mode, 10, 1, 1, uid, gid, 0, 0, 0, 0)) for kind, mode, uid, gid in [(stat.S_IFDIR, 0o755, 0, 0), (stat.S_IFDIR, 0o700, 1, 0), (stat.S_IFDIR, 0o700, 0, 1), (stat.S_IFLNK, 0o700, 0, 0)]]
        cases = [('parent', value) for value in parents] + [('login', object()), ('login', os.stat_result((stat.S_IFLNK | 0o777, 12, 1, 1, 0, 0, 0, 0, 0, 0))), ('login', OSError(13, 'PRIVATE_SENTINEL'))]
        for field, value in cases:
            for client in ['read-only', 'session']:
                with self.subTest(field=field, client=client):
                    fixture = AdminFs(); setattr(fixture, field, value)
                    system = System()
                    with fixture.patch(), mock.patch.object(SESSION.subprocess, 'Popen') as popen, mock.patch.object(SESSION.Session, 'query'):
                        with self.assertRaises(ValueError):
                            if client == 'read-only': MOD.execute({**request(), 'mode':'admin', 'password':None}, system)
                            else: SESSION.Session(system, 'admin', None)
                    self.assertEqual(system.calls, [])
                    popen.assert_not_called()
                    self.assertEqual(sorted(fixture.closed + [fd for fd in system.closed if fd != 7]), sorted(fixture.opened))

    def test_both_admin_clients_reject_unsafe_defaults_before_query_or_child(self):
        values = [None, (stat.S_IFLNK | 0o600, 1, 0, 0), (stat.S_IFDIR | 0o600, 1, 0, 0),
                  (stat.S_IFREG | 0o600, 1, 1, 0), (stat.S_IFREG | 0o600, 1, 0, 1),
                  (stat.S_IFREG | 0o600, 2, 0, 0)]
        values += [(stat.S_IFREG | mode, 1, 0, 0) for mode in [0, 0o444, 0o640, 0o700, 0o4600]]
        for target, value in [(target, value) for target in ['file', 'parent'] for value in values]:
            fixture = AdminFs()
            setattr(fixture, target, None if value is None else os.stat_result((value[0], 1, 1, value[1], value[2], value[3], 0, 0, 0, 0)))
            with fixture.patch():
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

    def test_pinned_descriptor_changes_and_query_failures_close_all_fds(self):
        for change in ['inode', 'mode', 'login', 'error']:
            fixture = AdminFs(); system = System()
            def run(*args):
                if change == 'error': raise OSError('PRIVATE_SENTINEL')
                if change == 'login': fixture.login = object()
                else:
                    values = list(fixture.file); values[1 if change == 'inode' else 0] += 1
                    fixture.file = os.stat_result(values)
                return system.output
            system.run = run
            with fixture.patch(), self.assertRaisesRegex(ValueError, '^Zaruku MySQL check failed$'):
                MOD.execute({**request(), 'mode':'admin', 'password':None}, system)
            self.assertEqual(system.closed, [21, 20, 7])

    def test_session_closes_admin_descriptors_after_launch_or_initial_query_failure(self):
        for stage in ['launch', 'query']:
            fixture = AdminFs(); system = System()
            child = types.SimpleNamespace(poll=lambda: 0, wait=lambda: 0, stdin=io.BytesIO(), stdout=io.BytesIO())
            with fixture.patch(), mock.patch.object(SESSION.subprocess, 'Popen', side_effect=OSError() if stage == 'launch' else None, return_value=child), mock.patch.object(SESSION.Session, 'query', side_effect=ValueError()):
                with self.assertRaises((ValueError, OSError)): SESSION.Session(system, 'admin', None)
            self.assertEqual(system.closed, [21, 20, 7])

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
