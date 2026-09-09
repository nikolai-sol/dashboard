import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
  ['/var/www/dashboard-zaruku-releases', { type: 'directory', owner: 'root', group: 'root', mode: '0711' }],
  ['/var/www/dashboard-zaruku-backups', { type: 'directory', owner: 'root', group: 'root', mode: '0711' }],
  ['/var/www/.dashboard-zaruku-control', { type: 'directory', owner: 'root', group: 'root', mode: '0700' }],
  ['/var/www/.dashboard-zaruku-secrets', { type: 'directory', owner: 'root', group: 'root', mode: '0700' }],
  ['/var/www/.dashboard-zaruku-secrets/runtime.env', { type: 'file', owner: 'root', group: 'root', mode: '0600', links: 1 }],
  ['/var/www/.dashboard-zaruku-shadow', { type: 'directory', owner: 'root', group: 'root', mode: '0700' }],
  ['/var/www/.dashboard-zaruku-shadow/auth.json', { type: 'file', owner: 'root', group: 'root', mode: '0600', links: 1 }],
  ['/var/www/.dashboard-zaruku-shadow/other-runtime-shas.tsv', { type: 'file', owner: 'root', group: 'root', mode: '0600', links: 1 }],
  ['/var/www/.dashboard-zaruku-shadow/evidence', { type: 'directory', owner: 'root', group: 'root', mode: '0700' }],
]));

const SAFE_ENV = Object.freeze({ PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C', HOME: '/root', PM2_HOME: '/root/.pm2' });
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
  if (!value || typeof value.exists !== 'boolean') return { inspected: false, exists: false };
  if (!value.exists) return { inspected: true, exists: false };
  return {
    inspected: true,
    exists: true,
    name: typeof value.name === 'string' ? value.name : null,
    uid: safeInteger(value.uid),
    gid: safeInteger(value.gid),
    group: typeof value.group === 'string' ? value.group : null,
    shell: typeof value.shell === 'string' ? value.shell : null,
    home: typeof value.home === 'string' ? value.home : null,
    supplementaryGroups: Array.isArray(value.supplementaryGroups) && value.supplementaryGroups.every(group => typeof group === 'string')
      ? [...value.supplementaryGroups]
      : null,
  };
}

function sanitizeGroupIdentity(value) {
  if (!value || typeof value.exists !== 'boolean') return { inspected: false, exists: false };
  if (!value.exists) return { inspected: true, exists: false };
  return {
    inspected: true,
    exists: true,
    name: typeof value.name === 'string' ? value.name : null,
    gid: safeInteger(value.gid),
    members: Array.isArray(value.members) && value.members.every(member => typeof member === 'string') ? [...value.members] : null,
  };
}

function sanitizeResource(value) {
  const filename = typeof value?.path === 'string' ? value.path : null;
  if (!value || typeof value.exists !== 'boolean') return { path: filename, inspected: false, exists: false };
  if (!value.exists) return { path: filename, inspected: true, exists: false };
  return {
    path: filename,
    inspected: true,
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
    'mysql', 'serviceIdentity', 'serviceGroupIdentity', 'mysqlIdentity', 'resources',
  ];
  if (!adapter || requiredMethods.some(name => typeof adapter[name] !== 'function')) fail('Incomplete read-only preflight adapter');

  const [current, combined, nginx, listeners, tools, mysql, serviceIdentity, serviceGroupIdentity, mysqlIdentity, resources] = await Promise.all([
    adapter.currentIdentity(), adapter.combinedProcess(), adapter.readNginx(), adapter.listeners(), adapter.tools(),
    adapter.mysql(), adapter.serviceIdentity(), adapter.serviceGroupIdentity(), adapter.mysqlIdentity(), adapter.resources(),
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
    serviceGroupIdentity: sanitizeGroupIdentity(serviceGroupIdentity),
    mysqlIdentity: typeof mysqlIdentity?.exists !== 'boolean'
      ? { inspected: false, exists: false }
      : mysqlIdentity.exists
        ? { inspected: true, exists: true, account: typeof mysqlIdentity.account === 'string' ? mysqlIdentity.account : null }
        : { inspected: true, exists: false },
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
  const serviceGroup = evidence.serviceGroupIdentity;
  if (service?.inspected !== true || serviceGroup?.inspected !== true) fail('Zaruku identity inspection is incomplete');
  if (service.exists !== serviceGroup.exists) fail('Existing Zaruku identity state is partial');
  if (service.exists && (service.name !== FIXED.serviceAccount || service.group !== FIXED.serviceAccount ||
      service.shell !== '/usr/sbin/nologin' || service.home !== '/nonexistent' ||
      !Number.isSafeInteger(service.uid) || service.uid <= 0 || !Number.isSafeInteger(service.gid) || service.gid <= 0 ||
      !Array.isArray(service.supplementaryGroups) || service.supplementaryGroups.length !== 0)) {
    fail('Existing Zaruku service identity is privileged, foreign, or partial');
  }
  if (serviceGroup.exists && (serviceGroup.name !== FIXED.serviceAccount || !Number.isSafeInteger(serviceGroup.gid) ||
      serviceGroup.gid <= 0 || serviceGroup.gid !== service.gid || !Array.isArray(serviceGroup.members) || serviceGroup.members.length !== 0)) {
    fail('Existing Zaruku service group is privileged, foreign, or partial');
  }
  if (evidence.mysqlIdentity?.inspected !== true) fail('Zaruku MySQL identity inspection is incomplete');
  if (evidence.mysqlIdentity.exists && evidence.mysqlIdentity.account !== FIXED.mysqlAccount) fail('Existing Zaruku MySQL identity is foreign');

  if (!Array.isArray(evidence.resources) || evidence.resources.length !== RESOURCE_RULES.size) fail('Zaruku resource inspection is incomplete');
  const byPath = new Map(evidence.resources.map(resource => [resource.path, resource]));
  if (byPath.size !== RESOURCE_RULES.size) fail('Zaruku resource inspection is incomplete');
  for (const [filename, rule] of RESOURCE_RULES) {
    const resource = byPath.get(filename);
    if (!resource || resource.inspected !== true) fail('Zaruku resource inspection is incomplete');
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

function execute(filename, args, options = {}, commandRunner = spawnSync) {
  const result = commandRunner(filename, args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe', ...(options.adminFd === undefined ? [] : [options.adminFd])], env: SAFE_ENV,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (!result.error && result.signal === null && result.status === 0) return { found: true, output: result.stdout.trim() };
  const confirmedAbsent = options.absentStatus === result.status &&
    (!options.absentStderr || options.absentStderr.test(result.stderr ?? ''));
  if (!result.error && result.signal === null && confirmedAbsent) return { found: false, output: '' };
  fail(`Read-only preflight command failed: ${path.basename(filename)}`);
}

function locate(name, commandRunner = spawnSync) {
  if (!['mysql', 'pm2', 'python3', 'setpriv'].includes(name)) fail('Unapproved preflight tool lookup');
  const result = execute('/bin/sh', ['-c', 'command -v -- "$1"', 'preflight', name], { absentStatus: 1 }, commandRunner);
  return result.found ? result.output : null;
}

function stripNginxComments(source) {
  let output = '', quote = null, escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) { output += character; escaped = false; continue; }
    if (character === '\\' && quote) { output += character; escaped = true; continue; }
    if ((character === '"' || character === "'") && (!quote || quote === character)) { quote = quote ? null : character; output += character; continue; }
    if (character === '#' && !quote) {
      while (index < source.length && source[index] !== '\n') index += 1;
      output += '\n';
      continue;
    }
    output += character;
  }
  return output;
}

function globRegex(pattern) {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') expression += '[^/]*';
    else if (character === '?') expression += '[^/]';
    else expression += character.replace(/[\\^$+?.()|{}]/g, '\\$&');
  }
  return new RegExp(`${expression}$`);
}

function resolveInclude(pattern, io) {
  if (pattern.includes('[') || pattern.includes(']')) fail('Unsupported Nginx include bracket pattern');
  if (!/[?*]/.test(pattern)) {
    try { io.lstat(pattern); return [pattern]; }
    catch { fail('Unresolved Nginx include'); }
  }
  const firstMagic = pattern.search(/[?*]/);
  const slash = pattern.lastIndexOf(path.sep, firstMagic);
  const base = slash > 0 ? pattern.slice(0, slash) : path.parse(pattern).root;
  const matcher = globRegex(pattern);
  const matches = [];
  let visited = 0;
  function walk(directory, ancestors = new Set()) {
    let canonical, directoryStat, names;
    try {
      canonical = io.realpath(directory);
      directoryStat = io.stat(canonical);
      if (!directoryStat.isDirectory()) fail('Invalid Nginx include directory');
      if (ancestors.has(canonical)) fail('Nginx include directory cycle');
      names = io.readdir(directory);
    } catch (error) {
      if (/Nginx include/.test(error?.message ?? '')) throw error;
      fail('Unresolved Nginx include');
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(canonical);
    for (const name of names.sort()) {
      if (++visited > 10000) fail('Nginx include graph is too large');
      const filename = path.join(directory, name);
      let stat;
      try { stat = io.lstat(filename); }
      catch { fail('Unresolved Nginx include'); }
      if (stat.isDirectory()) { walk(filename, nextAncestors); continue; }
      if (stat.isSymbolicLink()) {
        let target, targetStat;
        try { target = io.realpath(filename); targetStat = io.stat(target); }
        catch { fail('Unresolved Nginx include symlink'); }
        if (targetStat.isDirectory()) { walk(filename, nextAncestors); continue; }
        if (!targetStat.isFile()) fail('Invalid Nginx include symlink');
      }
      if (matcher.test(filename)) matches.push(filename);
    }
  }
  walk(base);
  return matches;
}

export function readNginxIncludeGraph(entryFile, options = {}) {
  const prefix = path.resolve(options.prefix ?? path.dirname(entryFile));
  const io = {
    lstat: options.lstat ?? (filename => fs.lstatSync(filename)),
    stat: options.stat ?? (filename => fs.statSync(filename)),
    realpath: options.realpath ?? (filename => fs.realpathSync(filename)),
    readdir: options.readdir ?? (filename => fs.readdirSync(filename)),
    readFile: options.readFile ?? (filename => fs.readFileSync(filename, 'utf8')),
  };
  const pending = [path.resolve(entryFile)];
  const visited = new Set();
  const records = [];
  let totalBytes = 0;

  while (pending.length) {
    const requested = pending.shift();
    let canonical, stat, source;
    try {
      canonical = io.realpath(requested);
      stat = io.stat(canonical);
      if (!stat.isFile()) fail('Invalid Nginx include target');
      if (visited.has(canonical)) continue;
      source = io.readFile(canonical);
    } catch (error) {
      if (/Nginx include/.test(error?.message ?? '')) throw error;
      fail('Unresolved Nginx include');
    }
    if (typeof source !== 'string') fail('Invalid Nginx include contents');
    visited.add(canonical);
    totalBytes += Buffer.byteLength(source);
    if (visited.size > 1000 || totalBytes > 4 * 1024 * 1024) fail('Nginx include graph is too large');
    records.push({ canonical, source });

    const cleaned = stripNginxComments(source);
    for (const match of cleaned.matchAll(/\binclude\s+((?:"[^"]*"|'[^']*'|[^;])+);/g)) {
      let include = match[1].trim();
      if ((include.startsWith('"') && include.endsWith('"')) || (include.startsWith("'") && include.endsWith("'"))) include = include.slice(1, -1);
      if (!include || include.includes('$') || include.includes('\0')) fail('Invalid Nginx include path');
      const absolute = path.isAbsolute(include) ? path.normalize(include) : path.resolve(prefix, include);
      pending.push(...resolveInclude(absolute, io));
    }
  }

  records.sort((left, right) => left.canonical.localeCompare(right.canonical));
  const digest = createHash('sha256');
  for (const record of records) digest.update(`${record.canonical}\0${createHash('sha256').update(record.source).digest('hex')}\n`);
  return { text: records.map(record => record.source).join('\n'), sha256: digest.digest('hex'), fileCount: records.length };
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

function statResource(filename, commandRunner = spawnSync) {
  const result = execute('/usr/bin/stat', ['--format=%F\t%U\t%G\t%a\t%h', '--', filename], {
    absentStatus: 1, absentStderr: /No such file or directory/,
  }, commandRunner);
  if (!result.found) return { path: filename, exists: false };
  const [rawType, owner, group, rawMode, rawLinks] = result.output.split('\t');
  return {
    path: filename, exists: true,
    type: rawType === 'directory' ? 'directory' : rawType === 'regular file' ? 'file' : 'other',
    owner, group, mode: rawMode.padStart(4, '0'), links: Number(rawLinks),
  };
}

function withAdminDefaults(io, action) {
  let parent, credential;
  const identity = info => JSON.stringify([info.dev, info.ino, info.uid, info.gid, info.mode, info.nlink, info.size, info.mtimeMs, info.ctimeMs]);
  const parentIdentity = info => JSON.stringify([info.dev, info.ino, info.uid, info.gid, info.mode]);
  try {
    parent = io.openSync('/root', fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    const root = io.fstatSync(parent);
    if (!root.isDirectory() || root.uid !== 0 || root.gid !== 0 || (root.mode & 0o7777) !== 0o700) fail('Unsafe MySQL admin defaults parent');
    const rootPin = parentIdentity(root);
    const checkParent = () => {
      const current = io.lstatSync('/root');
      if (current.isSymbolicLink() || parentIdentity(current) !== rootPin || parentIdentity(io.fstatSync(parent)) !== rootPin) fail('Unsafe MySQL admin defaults parent');
      // MySQL 8 can load .mylogin.cnf even with --defaults-file. Only ENOENT is safe.
      try { io.lstatSync(`/proc/self/fd/${parent}/.mylogin.cnf`); }
      catch (error) { if (error?.code === 'ENOENT') return; throw error; }
      fail('Unsafe MySQL admin defaults login channel');
    };
    checkParent();
    credential = io.openSync(`/proc/self/fd/${parent}/.my.cnf`, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const info = io.fstatSync(credential);
    if (!info.isFile() || info.uid !== 0 || info.gid !== 0 || info.nlink !== 1 || ![0o400, 0o600].includes(info.mode & 0o7777)) fail('Unsafe MySQL admin defaults metadata');
    const pin = identity(info);
    const verify = () => { checkParent(); if (identity(io.fstatSync(credential)) !== pin) fail('Unsafe MySQL admin defaults identity'); };
    verify();
    const result = action(credential);
    verify();
    return result;
  } catch (error) {
    if (/^Read-only preflight command failed: [a-z0-9]+$/.test(error?.message ?? '')) throw error;
    fail('Unsafe MySQL admin defaults');
  } finally {
    try { if (credential !== undefined) io.closeSync(credential); }
    finally { if (parent !== undefined) io.closeSync(parent); }
  }
}

export function createReadOnlyPreflightAdapter(options = {}) {
  if (Object.keys(options).some(key => !['commandRunner', 'adminFs'].includes(key)) ||
      (options.commandRunner !== undefined && typeof options.commandRunner !== 'function')) {
    fail('Invalid read-only preflight adapter options');
  }
  const commandRunner = options.commandRunner ?? spawnSync;
  let mysqlMetadata;
  const inspectMysql = () => {
    if (mysqlMetadata) return mysqlMetadata;
    const mysql = locate('mysql', commandRunner);
    if (!mysql) return (mysqlMetadata = { rootSocketAdmin: false, currentUser: null, database: null, accountExists: false });
    const sql = "SELECT CURRENT_USER(); SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='report_bd'; SELECT CONCAT(User,'@',Host) FROM mysql.user WHERE User='dashboard_zaruku_reader' AND Host='127.0.0.1';";
    const lines = withAdminDefaults(options.adminFs ?? fs, fd => execute(mysql, ['--defaults-file=/proc/self/fd/3', '--protocol=socket', '--user=root', '--batch', '--skip-column-names', '-e', sql], { adminFd: fd }, commandRunner)).output.split(/\r?\n/).filter(Boolean);
    const currentUser = lines[0] ?? null;
    return (mysqlMetadata = {
      rootSocketAdmin: currentUser === 'root@localhost', currentUser,
      database: lines.includes(FIXED.mysqlDatabase) ? FIXED.mysqlDatabase : null,
      accountExists: lines.includes(FIXED.mysqlAccount),
    });
  };

  return Object.freeze({
    currentIdentity() {
      return {
        uid: Number(execute('/usr/bin/id', ['-u'], {}, commandRunner).output),
        user: execute('/usr/bin/id', ['-un'], {}, commandRunner).output,
      };
    },
    combinedProcess() {
      const pm2 = locate('pm2', commandRunner);
      return pm2 ? parsePm2Status(execute(pm2, ['status', FIXED.combinedName, '--no-color'], {}, commandRunner).output) : { name: FIXED.combinedName, port: FIXED.combinedPort, status: null, pid: null };
    },
    readNginx() {
      return readNginxIncludeGraph('/etc/nginx/nginx.conf', { prefix: '/etc/nginx' });
    },
    listeners() { return parseListeners(execute('/usr/bin/ss', ['-ltnp'], {}, commandRunner).output); },
    tools() { return { setpriv: locate('setpriv', commandRunner), python3: locate('python3', commandRunner) }; },
    mysql() {
      const metadata = inspectMysql();
      return { rootSocketAdmin: metadata.rootSocketAdmin, currentUser: metadata.currentUser, database: metadata.database };
    },
    serviceIdentity() {
      const passwd = execute('/usr/bin/getent', ['passwd', FIXED.serviceAccount], { absentStatus: 2 }, commandRunner);
      if (!passwd.found) return { exists: false };
      const fields = passwd.output.split(':');
      if (fields.length !== 7) fail('Read-only preflight returned incomplete passwd metadata');
      const primaryGroup = execute('/usr/bin/getent', ['group', fields[3]], { absentStatus: 2 }, commandRunner);
      if (!primaryGroup.found) fail('Read-only preflight returned incomplete group metadata');
      const group = primaryGroup.output.split(':')[0];
      const groups = execute('/usr/bin/id', ['-Gn', FIXED.serviceAccount], {}, commandRunner).output.split(/\s+/).filter(Boolean);
      return {
        exists: true, name: fields[0], uid: Number(fields[2]), gid: Number(fields[3]), group,
        home: fields[5], shell: fields[6], supplementaryGroups: groups.filter(name => name !== group),
      };
    },
    serviceGroupIdentity() {
      const group = execute('/usr/bin/getent', ['group', FIXED.serviceAccount], { absentStatus: 2 }, commandRunner);
      if (!group.found) return { exists: false };
      const fields = group.output.split(':');
      if (fields.length !== 4 || !/^\d+$/.test(fields[2])) fail('Read-only preflight returned incomplete group metadata');
      return { exists: true, name: fields[0], gid: Number(fields[2]), members: fields[3] ? fields[3].split(',') : [] };
    },
    mysqlIdentity() {
      const metadata = inspectMysql();
      return metadata.accountExists ? { exists: true, account: FIXED.mysqlAccount } : { exists: false };
    },
    resources() { return [...RESOURCE_RULES.keys()].map(filename => statResource(filename, commandRunner)); },
  });
}
