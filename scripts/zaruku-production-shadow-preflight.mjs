import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const FIXED = Object.freeze({
  combinedName: 'dashboard-next',
  combinedPort: 3001,
  isolatedPort: 3002,
  serviceAccount: 'dashboard-zaruku',
  mysqlAccount: 'dashboard_zaruku_reader@127.0.0.1',
  mysqlDatabase: 'report_bd',
});

const RESOURCE_RULES = Object.freeze(new Map([
  ['/var/www/dashboard-zaruku-releases', { type: 'directory', owner: 'root', group: 'root', mode: '0700' }],
  ['/var/www/dashboard-zaruku-backups', { type: 'directory', owner: 'root', group: 'root', mode: '0700' }],
  ['/var/www/.dashboard-zaruku-control', { type: 'directory', owner: 'root', group: 'root', mode: '0700' }],
  ['/var/www/.dashboard-zaruku-secrets', { type: 'directory', owner: 'root', group: 'root', mode: '0700' }],
  ['/var/www/.dashboard-zaruku-secrets/runtime.env', { type: 'file', owner: 'root', group: 'root', mode: '0600', links: 1 }],
  ['/var/www/.dashboard-zaruku-shadow', { type: 'directory', owner: 'root', group: 'root', mode: '0700' }],
  ['/var/www/.dashboard-zaruku-shadow/auth.json', { type: 'file', owner: 'root', group: 'root', mode: '0600', links: 1 }],
  ['/var/www/.dashboard-zaruku-shadow/other-runtime-shas.tsv', { type: 'file', owner: 'root', group: 'root', mode: '0600', links: 1 }],
  ['/var/www/.dashboard-zaruku-shadow/evidence', { type: 'directory', owner: 'root', group: 'root', mode: '0700' }],
]));

const SAFE_ENV = Object.freeze({ PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' });
const fail = message => { throw new Error(message); };

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sanitizeIdentity(value) {
  if (!value || value.exists !== true) return { exists: false };
  return {
    exists: true,
    name: typeof value.name === 'string' ? value.name : null,
    uid: safeInteger(value.uid),
    gid: safeInteger(value.gid),
    group: typeof value.group === 'string' ? value.group : null,
    shell: typeof value.shell === 'string' ? value.shell : null,
    home: typeof value.home === 'string' ? value.home : null,
    supplementaryGroups: Array.isArray(value.supplementaryGroups)
      ? value.supplementaryGroups.filter(group => typeof group === 'string')
      : [],
  };
}

function sanitizeResource(value) {
  const filename = typeof value?.path === 'string' ? value.path : null;
  if (value?.exists !== true) return { path: filename, exists: false };
  return {
    path: filename,
    exists: true,
    type: value.type === 'directory' ? 'directory' : value.type === 'file' ? 'file' : 'other',
    owner: typeof value.owner === 'string' ? value.owner : null,
    group: typeof value.group === 'string' ? value.group : null,
    mode: typeof value.mode === 'string' ? value.mode.padStart(4, '0') : null,
    links: safeInteger(value.links),
  };
}

export async function inspectShadowPrerequisites(adapter) {
  const requiredMethods = [
    'currentIdentity', 'combinedProcess', 'readNginx', 'listeners', 'tools',
    'mysql', 'serviceIdentity', 'mysqlIdentity', 'resources',
  ];
  if (!adapter || requiredMethods.some(name => typeof adapter[name] !== 'function')) fail('Incomplete read-only preflight adapter');

  const [current, combined, nginx, listeners, tools, mysql, serviceIdentity, mysqlIdentity, resources] = await Promise.all([
    adapter.currentIdentity(), adapter.combinedProcess(), adapter.readNginx(), adapter.listeners(), adapter.tools(),
    adapter.mysql(), adapter.serviceIdentity(), adapter.mysqlIdentity(), adapter.resources(),
  ]);
  const safeListeners = Array.isArray(listeners) ? listeners.map(listener => ({
    host: typeof listener?.host === 'string' ? listener.host : null,
    port: safeInteger(listener?.port),
    process: typeof listener?.process === 'string' ? listener.process : null,
    pid: safeInteger(listener?.pid),
  })) : [];
  const isolatedListeners = safeListeners.filter(listener => listener.port === FIXED.isolatedPort);
  const combinedListeners = safeListeners.filter(listener => listener.port === FIXED.combinedPort);
  const nginxText = typeof nginx?.text === 'string' ? nginx.text : '';

  return deepFreeze({
    currentIdentity: { uid: safeInteger(current?.uid), user: typeof current?.user === 'string' ? current.user : null },
    combined: {
      name: typeof combined?.name === 'string' ? combined.name : null,
      port: safeInteger(combined?.port),
      status: typeof combined?.status === 'string' ? combined.status : null,
      pid: safeInteger(combined?.pid),
      listenerPids: combinedListeners.map(listener => listener.pid).filter(pid => pid !== null),
      loopbackOnly: combinedListeners.length > 0 && combinedListeners.every(listener => listener.host === '127.0.0.1'),
    },
    isolatedPort: {
      port: FIXED.isolatedPort,
      free: isolatedListeners.length === 0,
      processIds: isolatedListeners.map(listener => listener.pid).filter(pid => pid !== null),
      processNames: isolatedListeners.map(listener => listener.process).filter(Boolean),
    },
    nginx: {
      referencesCombinedPort: /(^|[^0-9])3001([^0-9]|$)/.test(nginxText),
      referencesIsolatedPort: /(^|[^0-9])3002([^0-9]|$)/.test(nginxText),
      sha256: typeof nginx?.sha256 === 'string' && /^[a-f0-9]{64}$/.test(nginx.sha256) ? nginx.sha256 : null,
    },
    tools: {
      setpriv: typeof tools?.setpriv === 'string' ? tools.setpriv : null,
      python3: typeof tools?.python3 === 'string' ? tools.python3 : null,
    },
    mysql: {
      rootSocketAdmin: mysql?.rootSocketAdmin === true,
      currentUser: typeof mysql?.currentUser === 'string' ? mysql.currentUser : null,
      database: typeof mysql?.database === 'string' ? mysql.database : null,
    },
    serviceIdentity: sanitizeIdentity(serviceIdentity),
    mysqlIdentity: mysqlIdentity?.exists === true
      ? { exists: true, account: typeof mysqlIdentity.account === 'string' ? mysqlIdentity.account : null }
      : { exists: false },
    resources: Array.isArray(resources) ? resources.map(sanitizeResource) : [],
  });
}

export function assertShadowPrerequisites(evidence) {
  if (!evidence || typeof evidence !== 'object') fail('Missing preflight evidence');
  if (evidence.currentIdentity?.uid !== 0 || evidence.currentIdentity?.user !== 'root') fail('Preflight requires the root identity');
  if (evidence.combined?.name !== FIXED.combinedName || evidence.combined?.port !== FIXED.combinedPort ||
      evidence.combined?.status !== 'online' || !Number.isSafeInteger(evidence.combined?.pid) || evidence.combined.pid <= 0 ||
      evidence.combined?.loopbackOnly !== true || !evidence.combined?.listenerPids?.includes(evidence.combined.pid)) {
    fail('Combined runtime is not the fixed online authority');
  }
  if (evidence.nginx?.referencesCombinedPort !== true || evidence.nginx?.referencesIsolatedPort !== false ||
      !/^[a-f0-9]{64}$/.test(evidence.nginx?.sha256 ?? '')) {
    fail('Nginx public routing mentions the isolated port or lacks an attested hash');
  }
  if (evidence.isolatedPort?.port !== FIXED.isolatedPort || evidence.isolatedPort?.free !== true ||
      evidence.isolatedPort?.processIds?.length || evidence.isolatedPort?.processNames?.length) {
    fail('Shadow port 3002 is owned by another process');
  }
  if (evidence.tools?.setpriv !== '/usr/bin/setpriv' || evidence.tools?.python3 !== '/usr/bin/python3') fail('Required fixed tool paths are unavailable');
  if (evidence.mysql?.rootSocketAdmin !== true || evidence.mysql?.currentUser !== 'root@localhost' || evidence.mysql?.database !== FIXED.mysqlDatabase) {
    fail('MySQL root socket authority or schema metadata is invalid');
  }

  const service = evidence.serviceIdentity;
  if (service?.exists && (service.name !== FIXED.serviceAccount || service.group !== FIXED.serviceAccount ||
      service.shell !== '/usr/sbin/nologin' || service.home !== '/nonexistent' ||
      service.uid === null || service.gid === null || service.supplementaryGroups.length !== 0)) {
    fail('Existing Zaruku service identity is foreign or partial');
  }
  if (evidence.mysqlIdentity?.exists && evidence.mysqlIdentity.account !== FIXED.mysqlAccount) fail('Existing Zaruku MySQL identity is foreign');

  if (!Array.isArray(evidence.resources) || evidence.resources.length !== RESOURCE_RULES.size) fail('Zaruku resource inspection is incomplete');
  const byPath = new Map(evidence.resources.map(resource => [resource.path, resource]));
  if (byPath.size !== RESOURCE_RULES.size) fail('Zaruku resource inspection is incomplete');
  for (const [filename, rule] of RESOURCE_RULES) {
    const resource = byPath.get(filename);
    if (!resource) fail('Zaruku resource inspection is incomplete');
    if (resource.exists && (resource.type !== rule.type || resource.owner !== rule.owner || resource.group !== rule.group ||
        resource.mode !== rule.mode || (rule.links !== undefined && resource.links !== rule.links))) {
      fail('Existing Zaruku resource is unsafe or foreign');
    }
  }
  for (const [child, parent] of [
    ['/var/www/.dashboard-zaruku-secrets/runtime.env', '/var/www/.dashboard-zaruku-secrets'],
    ['/var/www/.dashboard-zaruku-shadow/auth.json', '/var/www/.dashboard-zaruku-shadow'],
    ['/var/www/.dashboard-zaruku-shadow/other-runtime-shas.tsv', '/var/www/.dashboard-zaruku-shadow'],
    ['/var/www/.dashboard-zaruku-shadow/evidence', '/var/www/.dashboard-zaruku-shadow'],
  ]) {
    if (byPath.get(child).exists && !byPath.get(parent).exists) fail('Existing Zaruku resource state is partial');
  }
}

function execute(filename, args, options = {}) {
  try {
    return execFileSync(filename, args, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: SAFE_ENV,
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
  } catch {
    if (options.allowFailure) return null;
    fail(`Read-only preflight command failed: ${path.basename(filename)}`);
  }
}

function locate(name) {
  if (!['mysql', 'pm2', 'python3', 'setpriv'].includes(name)) fail('Unapproved preflight tool lookup');
  return execute('/bin/sh', ['-c', 'command -v -- "$1"', 'preflight', name], { allowFailure: true });
}

function listNginxFiles(root = '/etc/nginx') {
  const files = [];
  function visit(filename) {
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink()) {
      const target = fs.realpathSync(filename);
      if (fs.statSync(target).isFile()) files.push(target);
      return;
    }
    if (stat.isFile()) {
      const relative = path.relative(root, filename);
      if (relative === 'nginx.conf' || /^(conf\.d|sites-enabled|snippets|modules-enabled)\//.test(relative)) files.push(filename);
      return;
    }
    if (stat.isDirectory()) for (const name of fs.readdirSync(filename).sort()) visit(path.join(filename, name));
  }
  visit(root);
  return [...new Set(files)].sort();
}

function parsePm2Status(output) {
  const rows = output.split(/\r?\n/).filter(line => line.includes('│')).map(line => line.split('│').slice(1, -1).map(cell => cell.trim()));
  const header = rows.find(row => row.includes('name') && row.includes('status'));
  const nameIndex = header?.indexOf('name') ?? -1;
  const statusIndex = header?.indexOf('status') ?? -1;
  const pidIndex = header?.indexOf('pid') ?? -1;
  const row = rows.find(candidate => nameIndex >= 0 && candidate[nameIndex] === FIXED.combinedName);
  return {
    name: row?.[nameIndex] ?? FIXED.combinedName,
    port: FIXED.combinedPort,
    status: row?.[statusIndex] ?? null,
    pid: row && /^\d+$/.test(row[pidIndex] ?? '') ? Number(row[pidIndex]) : null,
  };
}

function parseListeners(output) {
  const listeners = [];
  for (const line of output.split(/\r?\n/)) {
    const local = line.match(/\s((?:\[[^\]]+\]|[^\s:]+)):(\d+)\s/);
    if (!local) continue;
    const port = Number(local[2]);
    if (![FIXED.combinedPort, FIXED.isolatedPort].includes(port)) continue;
    const process = line.match(/users:\(\(\"([^\"]+)\"/i)?.[1] ?? null;
    const pid = line.match(/pid=(\d+)/)?.[1];
    listeners.push({ host: local[1].replace(/^\[|\]$/g, ''), port, process, pid: pid ? Number(pid) : null });
  }
  return listeners;
}

function statResource(filename) {
  const output = execute('/usr/bin/stat', ['--format=%F\t%U\t%G\t%a\t%h', '--', filename], { allowFailure: true });
  if (output === null) return { path: filename, exists: false };
  const [rawType, owner, group, rawMode, rawLinks] = output.split('\t');
  return {
    path: filename, exists: true,
    type: rawType === 'directory' ? 'directory' : rawType === 'regular file' ? 'file' : 'other',
    owner, group, mode: rawMode.padStart(4, '0'), links: Number(rawLinks),
  };
}

export function createReadOnlyPreflightAdapter() {
  let mysqlMetadata;
  const inspectMysql = () => {
    if (mysqlMetadata) return mysqlMetadata;
    const mysql = locate('mysql');
    if (!mysql) return (mysqlMetadata = { rootSocketAdmin: false, currentUser: null, database: null, accountExists: false });
    const sql = "SELECT CURRENT_USER(); SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='report_bd'; SELECT CONCAT(User,'@',Host) FROM mysql.user WHERE User='dashboard_zaruku_reader' AND Host='127.0.0.1';";
    const lines = execute(mysql, ['--protocol=socket', '--batch', '--skip-column-names', '-e', sql], { allowFailure: true })?.split(/\r?\n/).filter(Boolean) ?? [];
    const currentUser = lines[0] ?? null;
    return (mysqlMetadata = {
      rootSocketAdmin: currentUser === 'root@localhost', currentUser,
      database: lines.includes(FIXED.mysqlDatabase) ? FIXED.mysqlDatabase : null,
      accountExists: lines.includes(FIXED.mysqlAccount),
    });
  };

  return Object.freeze({
    currentIdentity() {
      return { uid: Number(execute('/usr/bin/id', ['-u'])), user: execute('/usr/bin/id', ['-un']) };
    },
    combinedProcess() {
      const pm2 = locate('pm2');
      return pm2 ? parsePm2Status(execute(pm2, ['status', FIXED.combinedName, '--no-color'])) : { name: FIXED.combinedName, port: FIXED.combinedPort, status: null, pid: null };
    },
    readNginx() {
      const files = listNginxFiles();
      let text = '';
      const digest = createHash('sha256');
      for (const filename of files) {
        const contents = fs.readFileSync(filename, 'utf8');
        if (Buffer.byteLength(text) + Buffer.byteLength(contents) > 4 * 1024 * 1024) fail('Read-only Nginx input is oversized');
        text += `${contents}\n`;
        const line = execute('/usr/bin/sha256sum', ['--', filename]);
        digest.update(`${filename}\0${line.split(/\s+/)[0]}\n`);
      }
      return { text, sha256: digest.digest('hex') };
    },
    listeners() { return parseListeners(execute('/usr/bin/ss', ['-ltnp'])); },
    tools() { return { setpriv: locate('setpriv'), python3: locate('python3') }; },
    mysql() {
      const metadata = inspectMysql();
      return { rootSocketAdmin: metadata.rootSocketAdmin, currentUser: metadata.currentUser, database: metadata.database };
    },
    serviceIdentity() {
      const passwd = execute('/usr/bin/getent', ['passwd', FIXED.serviceAccount], { allowFailure: true });
      if (!passwd) return { exists: false };
      const fields = passwd.split(':');
      const group = execute('/usr/bin/getent', ['group', fields[3]], { allowFailure: true })?.split(':')[0] ?? null;
      const groups = execute('/usr/bin/id', ['-Gn', FIXED.serviceAccount], { allowFailure: true })?.split(/\s+/).filter(Boolean) ?? [];
      return {
        exists: true, name: fields[0], uid: Number(fields[2]), gid: Number(fields[3]), group,
        home: fields[5], shell: fields[6], supplementaryGroups: groups.filter(name => name !== group),
      };
    },
    mysqlIdentity() {
      const metadata = inspectMysql();
      return metadata.accountExists ? { exists: true, account: FIXED.mysqlAccount } : { exists: false };
    },
    resources() { return [...RESOURCE_RULES.keys()].map(statResource); },
  });
}
