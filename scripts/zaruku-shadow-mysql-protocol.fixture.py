#!/usr/bin/python3
"""Disposable protocol fixture only; never a DB client or a real credential."""
import fcntl
import json
import os
import pathlib
import re
import sys

if not pathlib.Path('/.dockerenv').exists() or os.getuid() != 0 or not pathlib.Path('/src/deploy/zaruku/mysql-read-tables.json').exists():
    raise RuntimeError('Disposable locked fixture required')
assert '--skip-reconnect' in sys.argv and '--unbuffered' in sys.argv and '--force' in sys.argv
assert not any('password' in arg.lower() for arg in sys.argv)
assert set(os.environ) <= {'LC_CTYPE'}
reader = any(arg.startswith('--defaults-file=') for arg in sys.argv)
if reader:
    filename = next(arg.split('=',1)[1] for arg in sys.argv if arg.startswith('--defaults-file='))
    assert filename.startswith('/proc/self/fd/') and 'memfd:zaruku-mysql-defaults' in os.readlink(filename)
    fd=os.open(filename,os.O_RDONLY)
    assert os.fstat(fd).st_mode & 0o777 == 0o600
    assert fcntl.fcntl(fd,fcntl.F_GET_SEALS) == fcntl.F_SEAL_WRITE|fcntl.F_SEAL_GROW|fcntl.F_SEAL_SHRINK|fcntl.F_SEAL_SEAL
    assert re.search(rb'password="[a-f0-9]{96}"\n',os.read(fd,4096))
    os.close(fd)
tables=json.loads(pathlib.Path('/src/deploy/zaruku/mysql-read-tables.json').read_text())['tables']
account="'dashboard_zaruku_reader'@'127.0.0.1'"
connection='43' if reader else '42';created=False;grants=[];locked=False
def rows(headers,values):
    print('\t'.join(headers))
    for value in values: print('\t'.join(str(item) for item in value))
def denied():print('ERROR 1142 (42000): fixture access denied')
for line in sys.stdin:
    sql=line.strip().removesuffix(';')
    marker=re.fullmatch(r"SELECT '([a-f0-9]{48})' AS zarukuFence, CONNECTION_ID\(\) AS connectionId",sql)
    fault=pathlib.Path('/tmp/zaruku-session-fault')
    if marker and fault.exists():
        if fault.read_text()=='fixture_connection_change':connection='99'
        else:sys.exit(1)
    if not marker:
        label=next((label for label in ['GET_LOCK','CREATE USER','GRANT SELECT','CURRENT_USER','mysql.user','USER_PRIVILEGES','SCHEMA_PRIVILEGES','TABLE_PRIVILEGES','information_schema.TABLES','SHOW GRANTS','COUNT(*)','START TRANSACTION','UPDATE','ROLLBACK','DROP USER','RELEASE_LOCK'] if label in sql),'other')
        with open('/tmp/zaruku-protocol-events','a') as events:events.write(('reader:' if reader else 'admin:')+label+'\n')
    if marker:rows(['zarukuFence','connectionId'],[[marker[1],connection]])
    elif sql=='SELECT CONNECTION_ID() AS connectionId':rows(['connectionId'],[[connection]])
    elif sql=='SELECT CURRENT_USER() AS currentUser':rows(['currentUser'],[['dashboard_zaruku_reader@127.0.0.1' if reader else 'root@localhost']])
    elif sql.startswith('SELECT GET_LOCK('):locked=True;rows(['acquired'],[[1]])
    elif sql.startswith('SELECT RELEASE_LOCK('):assert locked;locked=False;rows(['released'],[[1]])
    elif sql.startswith('CREATE USER '):
        assert locked and not created and re.fullmatch("CREATE USER "+re.escape(account)+" IDENTIFIED BY '[a-f0-9]{96}'",sql)
        created=True
    elif sql.startswith('GRANT SELECT '):
        assert locked and created
        table=re.fullmatch(r'GRANT SELECT ON `report_bd`\.`([a-z0-9_]+)` TO '+re.escape(account),sql)[1]
        assert table in tables and table not in grants;grants.append(table)
    elif sql.startswith('DROP USER IF EXISTS '):assert locked and created;created=False
    elif 'FROM mysql.user' in sql:rows(['user','host'],[['dashboard_zaruku_reader','127.0.0.1']] if created else [])
    elif 'FROM information_schema.USER_PRIVILEGES' in sql:rows(['privilegeType'],[])
    elif 'FROM information_schema.SCHEMA_PRIVILEGES' in sql:rows(['tableSchema','privilegeType'],[])
    elif 'FROM information_schema.TABLE_PRIVILEGES' in sql:rows(['tableSchema','tableName','privilegeType','isGrantable'],[['report_bd',table,'SELECT','NO'] for table in grants])
    elif 'FROM information_schema.TABLES' in sql:rows(['tableName','tableType'],[[table,'BASE TABLE'] for table in tables])
    elif sql.startswith('SHOW GRANTS FOR '):rows(['grant'],[['GRANT USAGE ON *.* TO '+account]]+[['GRANT SELECT ON `report_bd`.`'+table+'` TO '+account] for table in grants])
    elif sql in ['START TRANSACTION','ROLLBACK']:pass
    elif sql.startswith('UPDATE ') or 'report_bd_private' in sql or 'canonical_fact_ads_daily' in sql:denied()
    elif sql.startswith('SELECT COUNT(*) AS rowCount FROM '):rows(['rowCount'],[[0]])
    else:raise RuntimeError('Unsupported fixture query')
    sys.stdout.flush()
