"""Fixed read-only MySQL CLI bridge; credentials live in an anonymous sealed FD."""
import fcntl
import hashlib
import json
import os
import re
import selectors
import stat
import subprocess
import sys
import time

ERROR = 'Zaruku MySQL check failed'
MAX_OUTPUT = 65536
PROBE = 'UPDATE `report_bd`.`canonical_fact_site_analytics_daily` SET `visits` = `visits` WHERE 1 = 0'

class System:
    def admin_defaults(self):
        info = os.lstat('/root/.my.cnf')
        if not stat.S_ISREG(info.st_mode) or info.st_uid or info.st_gid or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) not in (0o400, 0o600):
            raise ValueError()
        return ['--defaults-file=/root/.my.cnf', '--protocol=socket', '--user=root']

    def binary(self):
        for path in ['/', '/usr', '/usr/bin']:
            info = os.lstat(path)
            if not stat.S_ISDIR(info.st_mode) or info.st_uid or info.st_gid or info.st_mode & 0o022:
                raise ValueError()
        fd = os.open('/usr/bin/mysql', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode) or before.st_uid or before.st_gid or before.st_nlink != 1 or before.st_mode & 0o022 or not before.st_mode & 0o111 or before.st_size > 100 * 1024 * 1024:
                raise ValueError()
            digest = hashlib.sha256()
            while True:
                data = os.read(fd, 1024 * 1024)
                if not data: break
                digest.update(data)
            after = os.fstat(fd)
            identity = lambda value: (value.st_dev,value.st_ino,value.st_uid,value.st_gid,value.st_mode,value.st_nlink,value.st_size,value.st_mtime_ns,value.st_ctime_ns)
            if identity(before) != identity(after) or identity(after) != identity(os.stat('/usr/bin/mysql', follow_symlinks=False)):
                raise ValueError()
            return fd, {'dev':str(after.st_dev), 'ino':str(after.st_ino), 'sha256':digest.hexdigest()}
        except Exception:
            os.close(fd)
            raise

    def memfd(self, data):
        fd = os.memfd_create('zaruku-mysql-defaults', os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)
        try:
            os.fchmod(fd, 0o600)
            if os.write(fd, data) != len(data): raise ValueError()
            os.lseek(fd, 0, os.SEEK_SET)
            fcntl.fcntl(fd, fcntl.F_ADD_SEALS, fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL)
            return fd
        except Exception:
            os.close(fd)
            raise

    def close(self, fd):
        os.close(fd)

    def run(self, argv, executable, sql, fds):
        child = subprocess.Popen(argv, executable=executable, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, pass_fds=fds, close_fds=True, env={})
        output, errors = bytearray(), bytearray()
        try:
            with selectors.DefaultSelector() as poll:
                for stream in [child.stdin, child.stdout, child.stderr]:
                    os.set_blocking(stream.fileno(), False)
                    poll.register(stream, selectors.EVENT_WRITE if stream is child.stdin else selectors.EVENT_READ)
                remaining = memoryview(sql)
                deadline = time.monotonic() + 5
                while poll.get_map():
                    if time.monotonic() >= deadline: raise TimeoutError()
                    for key, _ in poll.select(min(0.1, max(0, deadline-time.monotonic()))):
                        if key.fileobj is child.stdin:
                            remaining = remaining[os.write(key.fd, remaining):]
                            if not remaining:
                                poll.unregister(key.fileobj); key.fileobj.close()
                        else:
                            chunk = os.read(key.fd, 4096)
                            if not chunk:
                                poll.unregister(key.fileobj); key.fileobj.close()
                            else:
                                target = output if key.fileobj is child.stdout else errors
                                target.extend(chunk)
                                if len(output)+len(errors) > MAX_OUTPUT: raise ValueError()
                return child.wait(timeout=max(0.01,deadline-time.monotonic())), bytes(output), bytes(errors)
        finally:
            if child.poll() is None: child.kill()
            child.wait()
            for stream in [child.stdin,child.stdout,child.stderr]:
                if not stream.closed: stream.close()

def execute(request, system=None):
    system = system or System()
    descriptors = []
    try:
        if set(request) != {'mode','password','sql','toolIdentity'} or request['mode'] not in ('admin','reader'):
            raise ValueError()
        sql = request['sql']
        if not isinstance(sql,str) or len(sql)>64000 or any(c in sql for c in [';', '\0', '\n', '\r']) or re.search(r'\b(?:INTO|OUTFILE|DUMPFILE|SLEEP|BENCHMARK|GET_LOCK|LOAD_FILE|FOR\s+UPDATE)\b',sql,re.I):
            raise ValueError()
        if not (sql.startswith('SELECT ') or sql == "SHOW GRANTS FOR 'dashboard_zaruku_reader'@'127.0.0.1'" or sql == PROBE):
            raise ValueError()
        if sql == PROBE and request['mode'] != 'reader': raise ValueError()
        password = request['password']
        if request['mode'] == 'reader' and (not isinstance(password,str) or not 1 <= len(password) <= 4096 or any(c in password for c in ['\0','\n','\r'])):
            raise ValueError()
        if request['mode'] == 'admin' and password is not None: raise ValueError()
        binary, identity = system.binary(); descriptors.append(binary)
        if identity != request['toolIdentity']: raise ValueError()
        argv = ['/usr/bin/mysql']
        if request['mode'] == 'reader':
            escaped = password.replace('\\','\\\\').replace('"','\\"').replace('\t','\\t')
            defaults = system.memfd(('[client]\nuser=dashboard_zaruku_reader\nhost=127.0.0.1\nport=3306\nprotocol=TCP\ndatabase=report_bd\npassword="'+escaped+'"\n').encode('utf-8'))
            descriptors.append(defaults)
            argv.append('--defaults-file=/proc/self/fd/'+str(defaults))
        else:
            argv.extend(system.admin_defaults())
        argv.extend(['--batch','--raw','--connect-timeout=3','--default-character-set=utf8mb4','--skip-auto-rehash','--binary-mode'])
        query = ('START TRANSACTION;\n'+sql+';\nROLLBACK;\n') if sql == PROBE else sql+';\n'
        status, stdout, stderr = system.run(argv, '/proc/self/fd/'+str(binary), query.encode('utf-8'), tuple(descriptors))
        if len(stdout)+len(stderr)>MAX_OUTPUT: raise ValueError()
        if status:
            denial = re.match(rb'^ERROR (1044|1045|1142)\b',stderr)
            if denial: return {'errno':int(denial.group(1))}
            raise ValueError()
        if stderr: raise ValueError()
        lines = stdout.decode('utf-8',errors='strict').splitlines()
        if not lines: return {'rows':[]}
        headers = lines[0].split('\t')
        if len(headers)>8 or len(set(headers))!=len(headers) or any(not re.fullmatch(r'[A-Za-z][A-Za-z0-9_ @().-]{0,127}',key) for key in headers): raise ValueError()
        rows = []
        for line in lines[1:]:
            values = line.split('\t')
            if len(values)!=len(headers) or any(len(value)>2048 or any(ord(c)<32 for c in value) for value in values): raise ValueError()
            rows.append(dict(zip(headers,values)))
            if len(rows)>1024: raise ValueError()
        return {'rows':rows}
    except Exception:
        raise ValueError(ERROR) from None
    finally:
        for fd in reversed(descriptors): system.close(fd)

if __name__ == '__main__':
    try:
        if len(sys.argv)!=1 or sys.platform!='linux' or os.getuid()!=0 or os.geteuid()!=0: raise ValueError()
        data = sys.stdin.buffer.read(131073)
        if len(data)>131072: raise ValueError()
        result = json.dumps(execute(json.loads(data)),separators=(',',':'))
        if len(result)>131072: raise ValueError()
        sys.stdout.write(result+'\n')
    except Exception:
        sys.stderr.write(ERROR+'\n')
        sys.exit(1)
