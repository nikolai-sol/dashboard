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
