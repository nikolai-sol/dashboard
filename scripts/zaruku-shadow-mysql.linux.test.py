"""Real anonymous-FD/process bounds in the disposable, network-none fixture."""
import fcntl
import importlib.util
import os
import pathlib
import shutil
import sys
import unittest

if sys.platform != 'linux' or os.getuid() != 0 or not pathlib.Path('/.dockerenv').exists():
    raise RuntimeError('Disposable Linux fixture required')
spec=importlib.util.spec_from_file_location('mysql_helper',pathlib.Path(__file__).with_name('zaruku-shadow-mysql.py'))
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class Descriptors(unittest.TestCase):
    def test_admin_defaults_reject_unsafe_real_metadata_without_reading_profile(self):
        filename = '/root/.my.cnf'
        link = '/root/.my.cnf-fixture-link'
        self.assertFalse(os.path.lexists(filename))
        self.assertFalse(os.path.lexists(link))
        self.assertFalse(os.path.lexists('/root/.mylogin.cnf'))
        system = mod.System()
        with self.assertRaises(ValueError): system.admin_defaults()
        os.symlink('/root/absent-fixture-target', filename)
        try:
            with self.assertRaises(ValueError): system.admin_defaults()
        finally: os.unlink(filename)
        fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
        try: os.write(fd, b'[client]\n# Disposable dummy; no credential.\n')
        finally: os.close(fd)
        try:
            for mode in [0o400, 0o600]:
                os.chmod(filename, mode)
                profile = system.admin_defaults()
                try:
                    self.assertEqual(profile['argv'], ['--defaults-file=/proc/self/fd/'+str(profile['fd']), '--protocol=socket', '--user=root'])
                    system.verify_admin_defaults(profile)
                finally:
                    os.close(profile['fd']); os.close(profile['parent'])
            for mode in [0, 0o444, 0o640, 0o700, 0o4600]:
                os.chmod(filename, mode)
                with self.assertRaises(ValueError): system.admin_defaults()
            os.chmod(filename, 0o600)
            for uid, gid in [(1, 0), (0, 1)]:
                os.chown(filename, uid, gid)
                with self.assertRaises(ValueError): system.admin_defaults()
            os.chown(filename, 0, 0)
            os.link(filename, link)
            with self.assertRaises(ValueError): system.admin_defaults()
            os.unlink(link)
            os.chmod('/root', 0o755)
            try:
                with self.assertRaises(ValueError): system.admin_defaults()
            finally: os.chmod('/root', 0o700)
            profile = system.admin_defaults()
            try:
                original = os.fstat(profile['fd'])
                os.rename(filename, link)
                replacement = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
                os.close(replacement)
                self.assertEqual(os.fstat(profile['fd']).st_ino, original.st_ino)
                self.assertNotEqual(os.stat(filename).st_ino, original.st_ino)
                argv = ['/usr/bin/python3', '-I', '-c', 'import os,sys;assert os.fstat(int(sys.argv[1])).st_ino == int(sys.argv[2])', str(profile['fd']), str(original.st_ino)]
                self.assertEqual(system.run(argv, '/usr/bin/python3', b'', (profile['fd'],)), (0, b'', b''))
                with self.assertRaises(ValueError): system.verify_admin_defaults(profile)
            finally:
                os.close(profile['fd']); os.close(profile['parent'])
            with self.assertRaises(OSError): os.fstat(profile['fd'])
        finally:
            if os.path.lexists(link): os.unlink(link)
            os.unlink(filename)

    def test_real_memfd_is_private_sealed_and_has_no_disk_path(self):
        system=mod.System();fd=system.memfd(b'PRIVATE_DESCRIPTOR_SENTINEL')
        try:
            self.assertEqual(os.fstat(fd).st_mode&0o777,0o600)
            self.assertIn('memfd:zaruku-mysql-defaults',os.readlink('/proc/self/fd/'+str(fd)))
            self.assertEqual(os.read(fd,4096),b'PRIVATE_DESCRIPTOR_SENTINEL')
            self.assertEqual(fcntl.fcntl(fd,fcntl.F_GET_SEALS),fcntl.F_SEAL_WRITE|fcntl.F_SEAL_SHRINK|fcntl.F_SEAL_GROW|fcntl.F_SEAL_SEAL)
            with self.assertRaises(OSError):os.write(fd,b'x')
        finally:system.close(fd)

    def test_binary_identity_reads_ignore_access_time_but_reject_links(self):
        self.assertFalse(pathlib.Path('/usr/bin/mysql').exists())
        shutil.copyfile('/usr/bin/true','/usr/bin/mysql');os.chmod('/usr/bin/mysql',0o755)
        os.utime('/usr/bin/mysql',(1,2))
        try:
            system=mod.System();fd,identity=system.binary();system.close(fd)
            self.assertEqual(set(identity),{'dev','ino','sha256'})
            os.unlink('/usr/bin/mysql');os.symlink('/usr/bin/true','/usr/bin/mysql')
            with self.assertRaises(OSError):system.binary()
        finally:os.unlink('/usr/bin/mysql')

    def test_real_subprocess_has_bounded_output_and_timeout(self):
        system=mod.System()
        for binary,args,sql,expected in [('/usr/bin/cat',['cat'],b'probe',b'probe'),('/usr/bin/yes',['yes'],b'',None),('/usr/bin/sleep',['sleep','10'],b'',None)]:
            fd=os.open(binary,os.O_RDONLY|os.O_CLOEXEC)
            try:
                if expected is None:
                    with self.assertRaises((ValueError,TimeoutError)):system.run(args,'/proc/self/fd/'+str(fd),sql,(fd,))
                else:self.assertEqual(system.run(args,'/proc/self/fd/'+str(fd),sql,(fd,)),(0,expected,b''))
            finally:os.close(fd)

if __name__=='__main__':unittest.main()
