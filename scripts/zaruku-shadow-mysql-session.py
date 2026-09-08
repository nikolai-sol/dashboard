"""Fixed staged session/link boundary. No reconnect and no named credential temp file."""
import ctypes
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import selectors
import signal
import stat
import subprocess
import sys
import time

ERROR = 'Zaruku private MySQL session failed'
EXPECTED = ['deploy/zaruku/mysql-read-tables.json', 'deploy/zaruku/production-shadow.json', 'deploy/zaruku/release.json',
    'scripts/install-zaruku-shadow-auth.mjs', 'scripts/install-zaruku-shadow-inventory.mjs', 'scripts/runtime-release-remote.mjs', 'scripts/verify-zaruku-shadow.sh',
    'scripts/zaruku-production-shadow-authority.mjs', 'scripts/zaruku-production-shadow-preflight.mjs', 'scripts/zaruku-production-shadow-worker.mjs',
    'scripts/zaruku-shadow-auth-implementation.mjs', 'scripts/zaruku-shadow-coverage.mjs', 'scripts/zaruku-shadow-db.mjs', 'scripts/zaruku-shadow-dispatch.mjs', 'scripts/zaruku-shadow-evidence-lock.py', 'scripts/zaruku-shadow-host-implementation.mjs', 'scripts/zaruku-shadow-host.mjs',
    'scripts/zaruku-shadow-mysql-session.mjs', 'scripts/zaruku-shadow-mysql-session.py', 'scripts/zaruku-shadow-mysql.py', 'scripts/zaruku-shadow-provision.mjs', 'scripts/zaruku-xlsx-semantic.py']

def attest():
    root = pathlib.Path(__file__).parent.parent
    # Python's C-locale coercion inserts exactly this value even after env -i.
    if os.environ.get('LC_CTYPE') == 'C.UTF-8': del os.environ['LC_CTYPE']
    if sys.platform != 'linux' or os.getuid() or os.geteuid() or os.environ or not re.fullmatch(r'/var/www/\.dashboard-zaruku-shadow/control/[a-f0-9]{40}', str(root)):
        raise ValueError()
    for directory in [root, *root.parents]:
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid or info.st_gid or info.st_mode & 0o022: raise ValueError()
    def read(name):
        filename = root / name
        fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode) or before.st_uid or before.st_gid or before.st_nlink != 1 or stat.S_IMODE(before.st_mode) != 0o400 or before.st_size > 1048576: raise ValueError()
            data = os.read(fd, 1048577)
            identity = lambda s: (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
            if identity(before) != identity(os.fstat(fd)) or identity(before) != identity(filename.lstat()) or len(data) != before.st_size: raise ValueError()
            return data, {'dev':str(before.st_dev),'ino':str(before.st_ino),'uid':0,'gid':0,'mode':0o400,'links':1}
        finally: os.close(fd)
    manifest, _ = read('.manifest.json'); pins = json.loads(read('.inodes.json')[0]); manifest = json.loads(manifest)
    if manifest['sourceSha'] != root.name or [row['path'] for row in manifest['files']] != EXPECTED or set(pins) != set(EXPECTED + ['.manifest.json', '.inodes.json', 'directories']): raise ValueError()
    for name in EXPECTED + ['.manifest.json', '.inodes.json']:
        data, identity = read(name)
        if identity != pins[name]: raise ValueError()
        if name in EXPECTED:
            record = manifest['files'][EXPECTED.index(name)]
            if record != {'path':name,'mode':0o400,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}: raise ValueError()
    directories = {'shadow':root.parent.parent, 'control':root.parent, **{'bundle/'+name:root/name for name in ['', 'deploy', 'deploy/zaruku', 'scripts']}}
    if set(pins['directories']) != set(directories): raise ValueError()
    for name, directory in directories.items():
        s = directory.lstat(); mode = 0o700 if name in ['shadow','control'] else 0o500
        if not stat.S_ISDIR(s.st_mode) or s.st_uid or s.st_gid or stat.S_IMODE(s.st_mode) != mode or pins['directories'][name] != {'dev':str(s.st_dev),'ino':str(s.st_ino),'uid':0,'gid':0,'mode':mode}: raise ValueError()
        if name.startswith('bundle/'):
            relative = name[7:]
            names = ['.manifest.json','.inodes.json','deploy','scripts'] if relative == '' else ['zaruku'] if relative == 'deploy' else [pathlib.Path(p).name for p in EXPECTED if str(pathlib.Path(p).parent) == relative]
            if sorted(os.listdir(directory)) != sorted(names): raise ValueError()
    return root

class Session:
    def __init__(self, system, mode, password):
        self.system = system; self.fds = []; self.child = None; self.connection = None; self.buffer = b''; self.mode = mode
        self.locked = False; self.owned = False; self.absent = False
        tables = json.loads(pathlib.Path(__file__).parent.parent.joinpath('deploy/zaruku/mysql-read-tables.json').read_text())['tables']
        convert = lambda value: "CONVERT(X'"+value.encode().hex()+"' USING utf8mb4)"
        account = "'dashboard_zaruku_reader'@'127.0.0.1'"; lock = convert('reportingdash:zaruku-reader-boundary:v1')
        self.acquire = 'SELECT GET_LOCK('+lock+', 30) AS acquired'; self.release = 'SELECT RELEASE_LOCK('+lock+') AS released'
        self.lookup = 'SELECT User AS user, Host AS host FROM mysql.user WHERE User = '+convert('dashboard_zaruku_reader')
        self.drop = 'DROP USER IF EXISTS '+account
        self.allowed = {'SELECT CONNECTION_ID() AS connectionId','SELECT CURRENT_USER() AS currentUser'}
        self.grants = {'GRANT SELECT ON `report_bd`.`'+table+'` TO '+account for table in tables}
        if mode == 'admin':
            self.allowed |= {self.acquire,self.release,self.lookup,self.drop,'SHOW GRANTS FOR '+account,*self.grants,
                "SELECT PRIVILEGE_TYPE AS privilegeType FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = "+convert(account)+" AND PRIVILEGE_TYPE <> 'USAGE'",
                'SELECT TABLE_SCHEMA AS tableSchema, PRIVILEGE_TYPE AS privilegeType FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = '+convert(account),
                'SELECT TABLE_SCHEMA AS tableSchema, TABLE_NAME AS tableName, PRIVILEGE_TYPE AS privilegeType, IS_GRANTABLE AS isGrantable FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = '+convert(account),
                'SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType FROM information_schema.TABLES WHERE TABLE_SCHEMA = '+convert('report_bd')+' AND TABLE_NAME IN ('+', '.join(convert(table) for table in tables)+')'}
        else:
            self.allowed |= {'START TRANSACTION','ROLLBACK','UPDATE `report_bd`.`canonical_fact_site_analytics_daily` SET `visits` = `visits` WHERE 1 = 0',
                'SELECT COUNT(*) AS rowCount FROM `report_bd_private`.`canonical_fact_metrika_visits` WHERE 1 = 0',
                'SELECT COUNT(*) AS rowCount FROM `report_bd`.`canonical_fact_ads_daily` WHERE 1 = 0',
                *{'SELECT COUNT(*) AS rowCount FROM `report_bd`.`'+table+'` WHERE 1 = 0' for table in tables}}
        try:
            binary, _ = system.binary(); self.fds.append(binary)
            argv = ['/usr/bin/mysql']
            if mode == 'reader':
                if not isinstance(password, str) or not re.fullmatch('[a-f0-9]{96}', password): raise ValueError()
                defaults = system.memfd(('[client]\nuser=dashboard_zaruku_reader\nhost=127.0.0.1\nport=3306\nprotocol=TCP\ndatabase=report_bd\npassword="'+password+'"\n').encode())
                self.fds.append(defaults); argv.append('--defaults-file=/proc/self/fd/'+str(defaults))
            elif mode == 'admin' and password is None: argv += ['--no-defaults','--protocol=socket','--user=root']
            else: raise ValueError()
            argv += ['--batch','--raw','--unbuffered','--force','--skip-reconnect','--binary-mode','--skip-auto-rehash','--connect-timeout=3','--default-character-set=utf8mb4']
            self.child = subprocess.Popen(argv, executable='/proc/self/fd/'+str(binary), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env={}, pass_fds=tuple(self.fds), close_fds=True)
            self.query('SELECT CONNECTION_ID() AS connectionId')
        except Exception:
            self.close(); raise

    def query(self, sql):
        if not isinstance(sql,str) or len(sql)>64000 or any(c in sql for c in [';', '\n', '\r', '\0', '\\']): raise ValueError()
        create = self.mode == 'admin' and re.fullmatch(r"CREATE USER 'dashboard_zaruku_reader'@'127\.0\.0\.1' IDENTIFIED BY '[a-f0-9]{96}'",sql)
        if sql not in self.allowed and not create:raise ValueError()
        if create and (not self.locked or not self.absent or self.owned):raise ValueError()
        if (sql in self.grants or sql == self.drop) and (not self.locked or not self.owned):raise ValueError()
        token = os.urandom(24).hex(); marker = ('zarukuFence\tconnectionId\n'+token+'\t').encode()
        self.child.stdin.write((sql+";\nSELECT '"+token+"' AS zarukuFence, CONNECTION_ID() AS connectionId;\n").encode()); self.child.stdin.flush()
        deadline = time.monotonic()+35
        with selectors.DefaultSelector() as selector:
            selector.register(self.child.stdout, selectors.EVENT_READ)
            while True:
                offset = self.buffer.find(marker)
                if offset >= 0 and b'\n' in self.buffer[offset+len(marker):]: break
                if time.monotonic() >= deadline: raise TimeoutError()
                if not selector.select(0.1): continue
                data = os.read(self.child.stdout.fileno(),4096)
                if not data: raise ValueError()
                self.buffer += data
                if len(self.buffer)>65536: raise ValueError()
        prefix=self.buffer[:offset]; rest=self.buffer[offset+len(marker):]; connection,tail=rest.split(b'\n',1); self.buffer=tail
        if tail or not re.fullmatch(rb'[1-9][0-9]*',connection): raise ValueError()
        connection=connection.decode()
        if self.connection is not None and connection != self.connection: raise ValueError()
        self.connection=connection
        if prefix.startswith(b'ERROR '):
            error=re.match(rb'^ERROR (1044|1045|1142)\b[^\n]*\n$',prefix)
            if not error: raise ValueError()
            return {'errno':int(error.group(1))}
        lines=prefix.decode('utf-8',errors='strict').splitlines()
        if not lines:
            if create:self.owned=True
            if sql==self.drop:self.owned=False
            if sql==self.lookup:self.absent=True
            return {'rows':[]}
        headers=lines[0].split('\t')
        if len(headers)>8 or len(set(headers))!=len(headers) or any(not re.fullmatch(r'[A-Za-z][A-Za-z0-9_ @().-]{0,127}',key) for key in headers): raise ValueError()
        rows=[]
        for line in lines[1:]:
            values=line.split('\t')
            if len(values)!=len(headers) or any(len(v)>2048 or any(ord(c)<32 for c in v) for v in values):raise ValueError()
            rows.append(dict(zip(headers,values)))
            if len(rows)>1024:raise ValueError()
        if sql==self.acquire:self.locked=rows==[{'acquired':'1'}]
        if sql==self.release:
            if rows!=[{'released':'1'}]:raise ValueError()
            self.locked=False
        if sql==self.lookup:self.absent=not rows
        return {'rows':rows}

    def close(self):
        if self.child:
            if self.child.poll() is None:self.child.kill()
            self.child.wait()
            self.child.stdin.close();self.child.stdout.close()
        for fd in self.fds:self.system.close(fd)
        self.fds=[]

def publish_secret():
    filename='/var/www/.dashboard-zaruku-secrets'
    parent=os.fstat(4);secret=os.fstat(3)
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid or parent.st_gid or stat.S_IMODE(parent.st_mode)!=0o700 or os.readlink('/proc/self/fd/4')!=filename or (parent.st_dev,parent.st_ino)!=(os.lstat(filename).st_dev,os.lstat(filename).st_ino):raise ValueError()
    if not stat.S_ISREG(secret.st_mode) or secret.st_uid or secret.st_gid or stat.S_IMODE(secret.st_mode)!=0o600 or secret.st_nlink!=0 or not 1<=secret.st_size<=65536:raise ValueError()
    libc=ctypes.CDLL(None,use_errno=True)
    # Fixed inherited descriptor via procfs avoids requiring CAP_DAC_READ_SEARCH
    # for AT_EMPTY_PATH, while still publishing exactly this anonymous inode.
    if libc.linkat(-100,ctypes.c_char_p(b'/proc/self/fd/3'),4,ctypes.c_char_p(b'runtime.env'),0x400)!=0:raise OSError(ctypes.get_errno())
    os.fsync(3);os.fsync(4)

def serve(system):
    connection=None
    try:
        init=json.loads(sys.stdin.buffer.readline(131073))
        if set(init)!={'mode','password'}:raise ValueError()
        connection=Session(system,init['mode'],init['password']);init.clear()
        print(json.dumps({'sessionId':connection.connection}),flush=True)
        while True:
            line=sys.stdin.buffer.readline(131073)
            if not line:break
            if len(line)>131072:raise ValueError()
            request=json.loads(line)
            if set(request)!={'sql'}:raise ValueError()
            print(json.dumps(connection.query(request['sql']),separators=(',',':')),flush=True)
    finally:
        if connection:connection.close()

if __name__=='__main__':
    try:
        signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(InterruptedError()))
        root=attest()
        if sys.argv[1:]==['publish-secret']:publish_secret()
        elif sys.argv[1:]==['session']:
            spec=importlib.util.spec_from_file_location('fixed_mysql',root/'scripts/zaruku-shadow-mysql.py')
            mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
            serve(mod.System())
        else:raise ValueError()
    except Exception:
        sys.stderr.write(ERROR+'\n');sys.exit(1)
