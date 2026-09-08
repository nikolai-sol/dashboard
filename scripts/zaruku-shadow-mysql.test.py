import importlib.util
import pathlib
import unittest

SPEC = importlib.util.spec_from_file_location('mysql_helper', pathlib.Path(__file__).with_name('zaruku-shadow-mysql.py'))
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)
IDENTITY = {'dev': '1', 'ino': '2', 'sha256': 'a' * 64}

class System:
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
