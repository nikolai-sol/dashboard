import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { releaseAuthorityGitEnvironment } from './freeze-zaruku-shadow-release.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXPECTED_AUTHORITY = Object.freeze({
  scope: 'zaruku',
  reviewedAppSha: '1a9de096ed7a0cbefe8e4df6bbcf8e0bc311f8d8',
  combinedPort: 3001,
  isolatedPort: 3002,
  targetFile: '/etc/nginx/conf.d/dashboard-next.conf',
  expectedPredecessorSha256: '1c0363a55ae130e0e96be984fcaafe32384f2cf3c73d21e8d319dd96e940566b',
  assetPrefix: '/_next-zaruku',
  dashboardSlug: 'zaruku',
  numericAlias: '28',
});
const AUTHORITY_KEYS = Object.freeze(Object.keys(EXPECTED_AUTHORITY).sort());

export const CUTOVER_START = '    # BEGIN REPORTINGDASH ZARUKU EXACT-PATH CUTOVER';
export const CUTOVER_END = '    # END REPORTINGDASH ZARUKU EXACT-PATH CUTOVER';
const DASHBOARD_ANCHOR = '    location ^~ /dashboard/ {';
const failAuthority = () => { throw new Error('Zaruku cutover authority refused'); };
const failPredecessor = () => { throw new Error('Zaruku cutover predecessor refused'); };
const failCandidate = () => { throw new Error('Zaruku cutover candidate refused'); };
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const exactKeys = value => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(AUTHORITY_KEYS);

// Compare established facts, not entire version-dependent UI/export payloads.
export function compareHistoricalMetrics(left, right) {
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'
    ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value;
  for(const key of ['counters','domain','period','kpis','traffic_channels','organic_trend','top_pages','geo_countries','devices','returning_pages']){
    if(left?.zaruku_seo?.[key]===undefined||right?.zaruku_seo?.[key]===undefined
      ||JSON.stringify(stable(left.zaruku_seo[key]))!==JSON.stringify(stable(right.zaruku_seo[key]))) throw new Error(`Zaruku historical mismatch: ${key}`);
  }
  return true;
}

export function isolatedShellAsset(html) {
  const asset=html.match(/\/_next-zaruku\/[^"'<> ]+/)?.[0];
  if(!asset)throw new Error('Zaruku isolated shell missing');
  return asset;
}

function readJsonRegular(filename) {
  let descriptor;
  try {
    descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 2 || stat.size > 4096) failAuthority();
    return JSON.parse(fs.readFileSync(descriptor, 'utf8'));
  } catch {
    failAuthority();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertCommittedContracts(authority, filename) {
  if (path.resolve(filename) !== path.join(ROOT, 'deploy/zaruku/nginx-cutover.json')) return;
  try {
    const release = JSON.parse(fs.readFileSync(path.join(ROOT, 'deploy/zaruku/release.json'), 'utf8'));
    const shadow = JSON.parse(fs.readFileSync(path.join(ROOT, 'deploy/zaruku/production-shadow.json'), 'utf8'));
    if (release.scope !== authority.scope || release.port !== authority.isolatedPort
      || release.assetPrefix !== authority.assetPrefix || release.releaseBranch !== 'release/zaruku'
      || shadow.scope !== authority.scope || shadow.combinedUrl !== `http://127.0.0.1:${authority.combinedPort}`
      || shadow.isolatedUrl !== `http://127.0.0.1:${authority.isolatedPort}` || shadow.publicCutover !== false) failAuthority();
  } catch {
    failAuthority();
  }
}

export function loadCutoverAuthority(filename) {
  const parsed = readJsonRegular(filename);
  if (!exactKeys(parsed)) failAuthority();
  for (const key of AUTHORITY_KEYS) {
    if (parsed[key] !== EXPECTED_AUTHORITY[key]) failAuthority();
  }
  assertCommittedContracts(parsed, filename);
  return Object.freeze({ ...parsed });
}

function proxyLines(port, dashboardHeaders) {
  return [
    ...(dashboardHeaders ? [
      '        add_header Content-Security-Policy "frame-ancestors \'self\' https://www.bayesly.digital https://bayesly.digital" always;',
      '        add_header Strict-Transport-Security "max-age=31536000" always;',
    ] : []),
    `        proxy_pass http://127.0.0.1:${port};`,
    '        proxy_http_version 1.1;',
    '        proxy_set_header Upgrade $http_upgrade;',
    '        proxy_set_header Connection "upgrade";',
    '        proxy_set_header Host $host;',
    '        proxy_set_header X-Real-IP $remote_addr;',
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '        proxy_set_header X-Forwarded-Proto $scheme;',
    '        proxy_cache_bypass $http_upgrade;',
    '        proxy_read_timeout 30s;',
  ];
}

function exactProxy(location, port, dashboardHeaders = false) {
  return [`    location = ${location} {`, ...proxyLines(port, dashboardHeaders), '    }'];
}

function alias(location, target) {
  return [
    `    location = ${location} {`,
    `        rewrite ^ ${target} last;`,
    '    }',
  ];
}

export function renderCutoverBlock(authority) {
  const slug = authority.dashboardSlug;
  const aliasId = authority.numericAlias;
  const lines = [CUTOVER_START];
  lines.push(...exactProxy(`/dashboard/${slug}`, authority.isolatedPort, true), '');
  lines.push(...exactProxy(`/dashboard/${slug}/`, authority.isolatedPort, true), '');
  for (const suffix of ['', '/pdf', '/excel']) {
    lines.push(...exactProxy(`/api/dashboard/${slug}${suffix}`, authority.isolatedPort), '');
  }
  lines.push(
    `    location ^~ ${authority.assetPrefix}/ {`,
    ...proxyLines(authority.isolatedPort),
    '    }',
    '',
    ...alias(`/dashboard/${aliasId}`, `/dashboard/${slug}`),
    '',
    ...alias(`/dashboard/${aliasId}/`, `/dashboard/${slug}/`),
    '',
  );
  for (const suffix of ['', '/pdf', '/excel']) {
    lines.push(...alias(`/api/dashboard/${aliasId}${suffix}`, `/api/dashboard/${slug}${suffix}`), '');
  }
  lines.push(CUTOVER_END);
  return lines.join('\n');
}

export function assertPredecessorConfig(text, authority) {
  if (typeof text !== 'string' || sha256(text) !== authority.expectedPredecessorSha256) failPredecessor();
  if (text.includes(CUTOVER_START) || text.includes(CUTOVER_END) || text.includes(authority.assetPrefix)
    || text.includes(`127.0.0.1:${authority.isolatedPort}`)) failPredecessor();
  if (text.split(DASHBOARD_ANCHOR).length !== 2) failPredecessor();
  if (text.split(`proxy_pass http://127.0.0.1:${authority.combinedPort};`).length < 3) failPredecessor();
  if (!text.includes('    location / {')) failPredecessor();
}

export function renderCutoverConfig(predecessorText, authority) {
  assertPredecessorConfig(predecessorText, authority);
  return predecessorText.replace(DASHBOARD_ANCHOR, `${renderCutoverBlock(authority)}\n\n${DASHBOARD_ANCHOR}`);
}

export function assertCandidateConfig(candidate, predecessorText, authority) {
  try {
    assertPredecessorConfig(predecessorText, authority);
    const expected = renderCutoverConfig(predecessorText, authority);
    if (candidate !== expected || candidate.split(CUTOVER_START).length !== 2 || candidate.split(CUTOVER_END).length !== 2) failCandidate();
    if (candidate.split(`127.0.0.1:${authority.isolatedPort}`).length !== 7) failCandidate();
    if (candidate.split(DASHBOARD_ANCHOR).length !== 2) failCandidate();
  } catch (error) {
    if (error?.message === 'Zaruku cutover candidate refused') throw error;
    failCandidate();
  }
}

export function routeCutoverRequest(request, authority) {
  if (typeof request !== 'string' || !request.startsWith('/')) failCandidate();
  const index = request.indexOf('?');
  const pathname = index === -1 ? request : request.slice(0, index);
  const query = index === -1 ? '' : request.slice(index);
  const slug = authority.dashboardSlug;
  const aliasId = authority.numericAlias;
  const direct = new Set([
    `/dashboard/${slug}`, `/dashboard/${slug}/`, `/api/dashboard/${slug}`,
    `/api/dashboard/${slug}/pdf`, `/api/dashboard/${slug}/excel`,
  ]);
  if (direct.has(pathname) || pathname.startsWith(`${authority.assetPrefix}/`)) {
    return { port: authority.isolatedPort, upstreamPath: request };
  }
  const aliases = new Map([
    [`/dashboard/${aliasId}`, `/dashboard/${slug}`],
    [`/dashboard/${aliasId}/`, `/dashboard/${slug}/`],
    [`/api/dashboard/${aliasId}`, `/api/dashboard/${slug}`],
    [`/api/dashboard/${aliasId}/pdf`, `/api/dashboard/${slug}/pdf`],
    [`/api/dashboard/${aliasId}/excel`, `/api/dashboard/${slug}/excel`],
  ]);
  if (aliases.has(pathname)) return { port: authority.isolatedPort, upstreamPath: `${aliases.get(pathname)}${query}` };
  return { port: authority.combinedPort, upstreamPath: request };
}

class CutoverFailure extends Error {
  constructor(label) {
    super('Zaruku exact-path cutover failed');
    this.label = label;
  }
}

const failCutover = label => { throw new CutoverFailure(label); };
const call = async (adapter, method, label, ...args) => {
  try {
    return await adapter[method](...args);
  } catch {
    failCutover(label);
  }
};

function assertBaseline(value, authority, expectedTargetSha256 = authority.expectedPredecessorSha256) {
  const combined = value?.combined;
  const isolated = value?.isolated;
  if (!Number.isSafeInteger(combined?.pid) || combined.pid <= 0 || combined.cwd !== '/var/www/dashboard'
    || combined.port !== authority.combinedPort || !/^[a-f0-9]{40}$/.test(combined.sourceSha)
    || !Number.isSafeInteger(isolated?.pid) || isolated.pid <= 0
    || isolated.cwd !== '/var/www/dashboard-zaruku/apps/zaruku'
    || isolated.port !== authority.isolatedPort || isolated.loopbackOnly !== true
    || isolated.sourceSha !== authority.reviewedAppSha
    || value.targetSha256 !== expectedTargetSha256
    || !/^[a-f0-9]{64}$/.test(value.loadedNginxSha256)
    || value.managerAuth !== true || value.publicPortsClosed !== true) failCutover('baseline');
  return value;
}

function assertForeignStable(before, after) {
  if (!isDeepStrictEqual(before.combined, after.combined)
    || !isDeepStrictEqual(before.isolated, after.isolated)
    || !isDeepStrictEqual(before.publicChecks, after.publicChecks)
    || before.managerAuth !== after.managerAuth || before.publicPortsClosed !== after.publicPortsClosed) failCutover('baseline');
}

function sanitizedDecision(decision, authority, candidateSha256, backupPath, failure = null) {
  if (!['CUTOVER', 'ROLLED-BACK'].includes(decision) || !/^[a-f0-9]{64}$/.test(candidateSha256)
    || typeof backupPath !== 'string' || !backupPath.startsWith('/etc/nginx/conf.d/')) failCutover('decision');
  return Object.freeze({
    decision,
    reviewedAppSha: authority.reviewedAppSha,
    candidateSha256,
    backupPath,
    failure,
  });
}

/** The adapter owns OS boundaries; this function owns the only mutation order. */
export async function runCutover(adapter) {
  let installed = false;
  let authority;
  let backup;
  let candidateSha256;
  let failure;
  try {
    authority = await call(adapter, 'authority', 'authority');
    const source = await call(adapter, 'source', 'source');
    if (source?.clean !== true || typeof source.branch !== 'string' || !source.branch
      || source.appSha !== authority.reviewedAppSha) failCutover('source');
    const shadow = await call(adapter, 'shadow', 'shadow');
    if (shadow?.decision !== 'GO' || shadow.sourceSha !== authority.reviewedAppSha
      || shadow.stableCanonicalComparison !== true) failCutover('shadow');
    const before = assertBaseline(await call(adapter, 'baseline', 'baseline'), authority);
    const predecessorText = await call(adapter, 'readPredecessor', 'readPredecessor');
    const candidate = await call(adapter, 'render', 'render', predecessorText, authority);
    await call(adapter, 'validate', 'validate', candidate, predecessorText, authority);
    candidateSha256 = sha256(candidate);
    const immediate = assertBaseline(await call(adapter, 'baseline', 'baseline'), authority);
    if (!isDeepStrictEqual(immediate, before)) failCutover('baseline');
    backup = await call(adapter, 'backup', 'backup', predecessorText, authority.expectedPredecessorSha256);
    if (backup?.passed !== true || backup.sha256 !== authority.expectedPredecessorSha256
      || typeof backup.path !== 'string' || !backup.path.startsWith('/etc/nginx/conf.d/')) failCutover('backup');
    const staged = await call(adapter, 'stageCandidate', 'stageCandidate', candidate, candidateSha256);
    if (staged?.passed !== true || staged.sha256 !== candidateSha256) failCutover('stageCandidate');
    installed = true;
    if ((await call(adapter, 'install', 'install'))?.passed !== true) failCutover('install');
    if ((await call(adapter, 'nginxTest', 'nginxTest', 'candidate'))?.passed !== true) failCutover('nginxTest');
    if ((await call(adapter, 'reload', 'reload', 'candidate'))?.passed !== true) failCutover('reload');
    const verified = await call(adapter, 'verify', 'verify');
    if (verified?.passed !== true || verified.publicRouteOwner !== authority.isolatedPort
      || verified.restoredViews !== true || verified.foreignRoutesUnchanged !== true) failCutover('verify');
    const after = assertBaseline(await call(adapter, 'baseline', 'baseline'), authority, candidateSha256);
    assertForeignStable(before, after);
    const result = sanitizedDecision('CUTOVER', authority, candidateSha256, backup.path);
    await call(adapter, 'report', 'report', result);
    return result;
  } catch (error) {
    failure = error instanceof CutoverFailure ? error.label : 'operation';
    if (!installed) throw new CutoverFailure(failure);
  }

  try {
    if ((await call(adapter, 'restore', 'restore'))?.passed !== true) failCutover('restore');
    if ((await call(adapter, 'nginxTest', 'rollback', 'rollback'))?.passed !== true) failCutover('nginxTest');
    if ((await call(adapter, 'reload', 'rollback', 'rollback'))?.passed !== true) failCutover('reload');
    const restored = await call(adapter, 'verifyRollback', 'verifyRollback');
    if (restored?.passed !== true || restored.publicRouteOwner !== authority.combinedPort) failCutover('verifyRollback');
  } catch {
    throw new CutoverFailure('rollback');
  }
  const result = sanitizedDecision('ROLLED-BACK', authority, candidateSha256, backup.path, failure);
  try { await adapter.report(result); } catch { /* Preserve the verified rollback result. */ }
  return result;
}

const REMOTE_ACTIONS = Object.freeze(['shadow', 'baseline', 'read-predecessor', 'install', 'verify', 'restore', 'verify-rollback']);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

async function remoteWorker(action) {
  const fs = await import('node:fs');
  const crypto = await import('node:crypto');
  const child = await import('node:child_process');
  const TARGET = '/etc/nginx/conf.d/dashboard-next.conf';
  const AUTH = '/var/www/.dashboard-zaruku-shadow/auth.json';
  const APP_SHA = '1a9de096ed7a0cbefe8e4df6bbcf8e0bc311f8d8';
  const PREDECESSOR_SHA = '1c0363a55ae130e0e96be984fcaafe32384f2cf3c73d21e8d319dd96e940566b';
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const refuse = () => { throw new Error(); };
  const run = (bin, args) => {
    const result = child.spawnSync(bin, args, { env: { PATH: '/usr/sbin:/usr/bin:/bin', HOME: '/root', PM2_HOME: '/root/.pm2' }, encoding: null, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 1048576 });
    if (result.error || result.signal || result.status !== 0) refuse();
    return result;
  };
  const text = (bin, args) => run(bin, args).stdout.toString().trim();
  const regular = (filename, expectedMode) => {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== 0 || stat.gid !== 0
      || (expectedMode !== undefined && (stat.mode & 0o7777) !== expectedMode)) refuse();
    return stat;
  };
  const read = (filename, expectedMode, limit = 262144) => {
    const stat = regular(filename, expectedMode);
    if (stat.size < 1 || stat.size > limit) refuse();
    const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const current = fs.fstatSync(descriptor);
      if (current.dev !== stat.dev || current.ino !== stat.ino) refuse();
      return fs.readFileSync(descriptor);
    } finally { fs.closeSync(descriptor); }
  };
  const authCookie = () => {
    const value = JSON.parse(read(AUTH, 0o600, 65536).toString('utf8'));
    if (JSON.stringify(Object.keys(value).sort()) !== '["headers"]'
      || JSON.stringify(Object.keys(value.headers ?? {}).sort()) !== '["cookie"]'
      || typeof value.headers.cookie !== 'string' || value.headers.cookie.length < 1
      || value.headers.cookie.length > 4096 || /[\u0000-\u001f\u007f]/.test(value.headers.cookie)) refuse();
    return value.headers.cookie;
  };
  const pid = name => {
    const value = text('/usr/bin/pm2', ['pid', name]);
    if (!/^\d+$/.test(value) || Number(value) <= 0) refuse();
    return Number(value);
  };
  const processState = (name, cwd, releaseFile, port) => {
    const processId = pid(name);
    if (fs.realpathSync(`/proc/${processId}/cwd`) !== cwd) refuse();
    const sourceSha = read(releaseFile, port === 3001 ? 0o644 : 0o600, 128).toString().trim();
    if (!/^[a-f0-9]{40}$/.test(sourceSha)) refuse();
    const listeners = text('/usr/bin/ss', ['-ltnpH']);
    const rows = listeners.split(/\r?\n/).filter(row => row.includes(`:${port}`));
    if (rows.length !== 1 || !rows[0].includes(`127.0.0.1:${port}`) || !rows[0].includes(`pid=${processId},`)) refuse();
    return { pid: processId, cwd, sourceSha, port, ...(port === 3002 ? { loopbackOnly: true } : {}) };
  };
  const loadedNginxSha = () => {
    const result = run('/usr/sbin/nginx', ['-T']);
    return sha(Buffer.concat([result.stdout, result.stderr]));
  };
  const publicChecks = async cookie => {
    const paths = ['/dashboard/gidrofuril', '/dashboard/abbott', '/api/health', '/api/dashboard-auth/session', '/admin/dashboards', '/dashboard/280', '/api/dashboard/280'];
    const rows = [];
    for (const pathname of paths) {
      const response = await fetch(`https://dashboards.adreports.ru${pathname}`, { headers: { cookie }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
      const type = response.headers.get('content-type') ?? '';
      const body = type.includes('text/html') ? await response.text() : '';
      rows.push({ pathname, status: response.status, sharedAssets: body ? body.includes('/_next/') && !body.includes('/_next-zaruku/') : null });
    }
    return rows;
  };
  const baseline = async () => {
    const target = read(TARGET, 0o644);
    const cookie = authCookie();
    const isolated=processState('dashboard-zaruku', '/var/www/dashboard-zaruku/apps/zaruku', '/var/www/dashboard-zaruku/.release-source-sha', 3002);
    const auth=await fetch('http://127.0.0.1:3002/api/dashboard/zaruku?from=2026-08-01&to=2026-08-31',{headers:{cookie},signal:AbortSignal.timeout(30000)});
    return {
      combined: processState('dashboard-next', '/var/www/dashboard', '/var/www/dashboard/.release-source-sha', 3001),
      isolated,
      targetSha256: sha(target), loadedNginxSha256: loadedNginxSha(), managerAuth: auth.status===200,
      publicPortsClosed: isolated.loopbackOnly, publicChecks: await publicChecks(cookie),
    };
  };
  const syncDirectory = filename => {
    const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  };
  const installBytes = (bytes, temporary, mode) => {
    const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, mode);
    try { fs.writeFileSync(descriptor, bytes); fs.fchmodSync(descriptor, mode); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
  };
  const nginxTest = () => { run('/usr/sbin/nginx', ['-t']); };
  const nginxReload = () => { run('/usr/sbin/nginx', ['-s', 'reload']); };
  const restoreBackup = (backupPath, expectedSha) => {
    const bytes = read(backupPath, 0o600);
    if (sha(bytes) !== expectedSha) refuse();
    const temporary = `${TARGET}.rollback-${process.pid}`;
    try {
      installBytes(bytes, temporary, 0o644);
      fs.renameSync(temporary, TARGET);
      syncDirectory('/etc/nginx/conf.d');
      nginxTest();
      nginxReload();
    } finally { try { fs.unlinkSync(temporary); } catch {} }
    if (sha(read(TARGET, 0o644)) !== expectedSha) refuse();
  };
  const input = async () => {
    let size = 0; const chunks = [];
    for await (const chunk of process.stdin) { size += chunk.length; if (size > 196608) refuse(); chunks.push(chunk); }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) refuse();
    return value;
  };

  if (process.getuid() !== 0 || process.geteuid() !== 0) refuse();
  if (action === 'shadow') {
    const cookie=authCookie();
    const isolated=processState('dashboard-zaruku','/var/www/dashboard-zaruku/apps/zaruku','/var/www/dashboard-zaruku/.release-source-sha',3002);
    if(isolated.sourceSha!==APP_SHA)refuse();
    let latest;
    for(let month=1;month<=8;month++){
      const mm=String(month).padStart(2,'0');const last=new Date(Date.UTC(2026,month,0)).getUTCDate();
      const url=`/api/dashboard/zaruku?from=2026-${mm}-01&to=2026-${mm}-${last}`;
      const pair=await Promise.all([3001,3002].map(async port=>{const r=await fetch(`http://127.0.0.1:${port}${url}`,{headers:{cookie},signal:AbortSignal.timeout(30000)});if(r.status!==200)refuse();return r.json();}));
      compareHistoricalMetrics(pair[0],pair[1]);latest=pair[1];
    }
    const seo=latest?.zaruku_seo;
    if(!seo?.wordstat||seo.wordstat.status==='unavailable'||!seo.alice_visibility?.snapshots?.length)refuse();
    const sql="SELECT JSON_OBJECT('id',CAST(s.id AS CHAR),'month',DATE_FORMAT(s.period_month,'%Y-%m'),'sov',s.official_sov_pct,'queries',(SELECT COUNT(*) FROM canonical_alice_visibility_queries q WHERE q.snapshot_id=s.id),'featured',(SELECT COUNT(*) FROM canonical_alice_visibility_featured_sites f WHERE f.snapshot_id=s.id)) FROM canonical_alice_visibility_snapshots s WHERE s.analytics_account_id='66624469' AND s.publication_status='published' ORDER BY s.period_month";
    const facts=text('/usr/bin/mysql',['--defaults-extra-file=/root/.my.cnf','--batch','--raw','--skip-column-names','report_bd','--execute',sql]).split('\n').filter(Boolean).map(row=>JSON.parse(row));
    if(!facts.some(row=>row.month==='2026-07')||!facts.some(row=>row.month==='2026-08'))refuse();
    for(const fact of facts){const snapshot=seo.alice_visibility.snapshots.find(row=>row.id===fact.id);if(!snapshot||snapshot.month!==fact.month||snapshot.officialSovPct!==Number(fact.sov)||snapshot.queries.length!==fact.queries||snapshot.featuredSites.length!==fact.featured)refuse();}
    if(seo.alice_visibility.snapshots.length!==facts.length)refuse();
    for(const suffix of ['','/pdf','/excel']){const r=await fetch(`http://127.0.0.1:3002/api/dashboard/zaruku${suffix}`);if(r.status!==401)refuse();}
    for(const [suffix,type,magic]of [['/pdf','application/pdf','%PDF-'],['/excel','spreadsheetml','PK']]){const r=await fetch(`http://127.0.0.1:3002/api/dashboard/zaruku${suffix}?from=2026-07-01&to=2026-08-31`,{headers:{cookie},signal:AbortSignal.timeout(60000)});const bytes=Buffer.from(await r.arrayBuffer());if(r.status!==200||!(r.headers.get('content-type')??'').includes(type)||!bytes.subarray(0,magic.length).equals(Buffer.from(magic)))refuse();}
    return {decision:'GO',sourceSha:APP_SHA,stableCanonicalComparison:true,monthsChecked:8,aliceSnapshotsChecked:facts.length};
  }
  if (action === 'baseline') return baseline();
  if (action === 'read-predecessor') return { text: read(TARGET, 0o644).toString('utf8') };
  if (action === 'install') {
    const value = await input();
    const keys = Object.keys(value).sort().join(',');
    if (keys !== 'backupPath,candidate,candidateSha256,expectedPredecessorSha256'
      || value.expectedPredecessorSha256 !== PREDECESSOR_SHA || sha(Buffer.from(value.candidate)) !== value.candidateSha256
      || value.backupPath !== `${TARGET}.pre-zaruku-${PREDECESSOR_SHA.slice(0, 12)}`) refuse();
    const before = read(TARGET, 0o644);
    if (sha(before) !== PREDECESSOR_SHA || fs.existsSync(value.backupPath)) refuse();
    const candidateTemporary = `${TARGET}.candidate-${value.candidateSha256}`;
    let renamed = false;
    try {
      installBytes(before, value.backupPath, 0o600);
      installBytes(Buffer.from(value.candidate), candidateTemporary, 0o644);
      if (sha(read(candidateTemporary, 0o644)) !== value.candidateSha256) refuse();
      fs.renameSync(candidateTemporary, TARGET); renamed = true;
      syncDirectory('/etc/nginx/conf.d');
      nginxTest(); nginxReload();
      if (sha(read(TARGET, 0o644)) !== value.candidateSha256) refuse();
      return { passed: true, nginxTest: true, reloaded: true, backupPath: value.backupPath };
    } catch {
      if (renamed) { try { restoreBackup(value.backupPath, PREDECESSOR_SHA); } catch {} }
      throw new Error();
    } finally { try { fs.unlinkSync(candidateTemporary); } catch {} }
  }
  if (action === 'restore') {
    const value = await input();
    if (Object.keys(value).sort().join(',') !== 'backupPath,expectedPredecessorSha256'
      || value.expectedPredecessorSha256 !== PREDECESSOR_SHA
      || value.backupPath !== `${TARGET}.pre-zaruku-${PREDECESSOR_SHA.slice(0, 12)}`) refuse();
    restoreBackup(value.backupPath, PREDECESSOR_SHA);
    return { passed: true, nginxTest: true, reloaded: true };
  }
  if (action === 'verify' || action === 'verify-rollback') {
    const cookie = authCookie();
    const response = await fetch('https://dashboards.adreports.ru/dashboard/zaruku', { headers: { cookie }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const html = await response.text();
    if (response.status !== 200) refuse();
    if (action === 'verify-rollback') return { passed: html.includes('/_next/') && !html.includes('/_next-zaruku/'), publicRouteOwner: 3001 };
    const asset = isolatedShellAsset(html);
    const assetResponse = await fetch(`https://dashboards.adreports.ru${asset}`, { signal: AbortSignal.timeout(15000) });
    const apiResponse = await fetch('https://dashboards.adreports.ru/api/dashboard/zaruku?from=2026-07-01&to=2026-08-31', { headers: { cookie }, signal: AbortSignal.timeout(30000) });
    const api = await apiResponse.json();
    const aliasResponse = await fetch('https://dashboards.adreports.ru/api/dashboard/28?from=2026-07-01&to=2026-08-31', { headers: { cookie }, signal: AbortSignal.timeout(30000) });
    const alias = await aliasResponse.json();
    const pdf = await fetch('https://dashboards.adreports.ru/api/dashboard/zaruku/pdf?from=2026-07-01&to=2026-08-31', { headers: { cookie }, signal: AbortSignal.timeout(60000) });
    const xlsx = await fetch('https://dashboards.adreports.ru/api/dashboard/zaruku/excel?from=2026-07-01&to=2026-08-31', { headers: { cookie }, signal: AbortSignal.timeout(60000) });
    const numericPage = await fetch('https://dashboards.adreports.ru/dashboard/28', { headers: { cookie }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const numericHtml = await numericPage.text();
    const wordstat = api?.zaruku_seo?.wordstat;
    const alice = api?.zaruku_seo?.alice_visibility;
    const months = Array.isArray(alice?.snapshots) ? alice.snapshots.map(row => row.month) : [];
    const competitors = Array.isArray(alice?.snapshots) && alice.snapshots.some(row => Array.isArray(row.competitors) && row.competitors.length > 0);
    const passed = assetResponse.status === 200 && apiResponse.status === 200 && aliasResponse.status === 200
      && api?.dashboard?.type === 'zaruku_bi' && alias?.dashboard?.type === 'zaruku_bi'
      && wordstat && wordstat.status !== 'unavailable' && months.includes('2026-07') && months.includes('2026-08') && competitors
      && pdf.status === 200 && (pdf.headers.get('content-type') ?? '').includes('application/pdf')
      && xlsx.status === 200 && (xlsx.headers.get('content-type') ?? '').includes('spreadsheetml')
      && numericPage.status === 200 && numericHtml.includes('/_next-zaruku/');
    return { passed, publicRouteOwner: passed ? 3002 : null, restoredViews: passed, publicChecks: await publicChecks(cookie) };
  }
  refuse();
}

function remoteCode(action) {
  return `const isolatedShellAsset=${isolatedShellAsset.toString()};const compareHistoricalMetrics=${compareHistoricalMetrics.toString()};const worker=${remoteWorker.toString()};try{const result=await worker(${JSON.stringify(action)});process.stdout.write(JSON.stringify(result)+'\\n');}catch{process.stderr.write('Zaruku cutover remote operation refused\\n');process.exitCode=1;}`;
}

export function cutoverSshArguments(action) {
  if (!REMOTE_ACTIONS.includes(action)) throw new Error('Zaruku cutover adapter refused');
  return [
    '-F', '/dev/null', '-o', 'HostName=5.35.85.218', '-o', 'User=root', '-o', 'Port=22',
    '-o', 'IdentityFile=/Users/nafanya/.ssh/beget_ed25519', '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=/Users/nafanya/.ssh/known_hosts',
    '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ClearAllForwardings=yes', '-o', 'ForwardAgent=no',
    '-o', 'ForwardX11=no', '-o', 'PermitLocalCommand=no', '-o', 'RemoteCommand=none',
    '--', 'beget', `/usr/bin/env -i /usr/bin/node --input-type=module -e ${quote(remoteCode(action))}`,
  ];
}

function productionRemote(action, payload) {
  const input = payload === undefined ? '' : JSON.stringify(payload);
  const result = spawnSync('/usr/bin/ssh', cutoverSshArguments(action), {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 1048576,
    env: { PATH: '/usr/bin:/bin' },
  });
  if (result.error || result.signal || result.status !== 0 || result.stderr) throw new Error('Zaruku cutover adapter refused');
  try { return JSON.parse(result.stdout); } catch { throw new Error('Zaruku cutover adapter refused'); }
}

function localGit(args) {
  const result = spawnSync('/usr/bin/git', ['-C', ROOT, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 1048576,
    env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, GIT_PAGER: '/bin/cat' },
  });
  if (result.error || result.signal || result.status !== 0 || result.stderr) throw new Error('Zaruku cutover adapter refused');
  return result.stdout.trim();
}

export function createProductionCutoverAdapter(options) {
  if (options !== undefined) throw new Error('Zaruku cutover adapter refused');
  let candidate;
  let candidateSha256;
  let backupPath;
  let transaction;
  let baselineState;
  const authorityPath = path.join(ROOT, 'deploy/zaruku/nginx-cutover.json');
  return {
    async authority() { return loadCutoverAuthority(authorityPath); },
    async source() {
      const authority = loadCutoverAuthority(authorityPath);
      const clean = localGit(['status', '--porcelain', '--untracked-files=normal']) === '';
      const branch = localGit(['branch', '--show-current']);
      const head = localGit(['rev-parse', 'HEAD']);
      if (!clean || branch !== 'codex/zaruku-exact-path-cutover'
        || !/^[a-f0-9]{40}$/.test(head)) throw new Error('Zaruku cutover adapter refused');
      localGit(['merge-base', '--is-ancestor', authority.reviewedAppSha, head]);
      const release = spawnSync('/usr/bin/git', ['ls-remote', '--exit-code', '--refs', '--', 'git@github.com:nikolai-sol/dashboard.git', 'refs/heads/release/zaruku'], {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 65536,
        env: releaseAuthorityGitEnvironment('ssh'),
      });
      if (release.error || release.signal || release.status !== 0 || release.stderr) throw new Error('Zaruku cutover adapter refused');
      if (release.stdout !== `${authority.reviewedAppSha}\trefs/heads/release/zaruku\n`) throw new Error('Zaruku cutover adapter refused');
      return { clean: true, branch, appSha: authority.reviewedAppSha };
    },
    async shadow() { return productionRemote('shadow'); },
    async baseline() {
      const value = productionRemote('baseline');
      baselineState ??= value;
      return value;
    },
    async readPredecessor() { return productionRemote('read-predecessor').text; },
    async render(predecessorText, authority) { return renderCutoverConfig(predecessorText, authority); },
    async validate(value, predecessorText, authority) { assertCandidateConfig(value, predecessorText, authority); return { passed: true }; },
    async backup(_predecessorText, expectedSha) {
      backupPath = `/etc/nginx/conf.d/dashboard-next.conf.pre-zaruku-${expectedSha.slice(0, 12)}`;
      return { passed: true, path: backupPath, sha256: expectedSha };
    },
    async stageCandidate(value, digest) { candidate = value; candidateSha256 = digest; return { passed: true, sha256: digest }; },
    async install() {
      transaction = productionRemote('install', { backupPath, candidate, candidateSha256, expectedPredecessorSha256: EXPECTED_AUTHORITY.expectedPredecessorSha256 });
      if (transaction?.passed !== true || transaction.backupPath !== backupPath) throw new Error('Zaruku cutover adapter refused');
      return transaction;
    },
    async nginxTest(phase) { return { passed: phase === 'candidate' ? transaction?.nginxTest === true : true }; },
    async reload(phase) { return { passed: phase === 'candidate' ? transaction?.reloaded === true : true }; },
    async verify() {
      const value = productionRemote('verify');
      return { ...value, foreignRoutesUnchanged: isDeepStrictEqual(value.publicChecks, baselineState?.publicChecks) };
    },
    async restore() { return productionRemote('restore', { backupPath, expectedPredecessorSha256: EXPECTED_AUTHORITY.expectedPredecessorSha256 }); },
    async verifyRollback() { return productionRemote('verify-rollback'); },
    async report() { return { passed: true }; },
  };
}

export async function runCutoverCheck(adapter) {
  const authority = await adapter.authority();
  const source = await adapter.source();
  if (source?.clean !== true || source.appSha !== authority.reviewedAppSha) failCutover('source');
  const shadow = await adapter.shadow();
  if (shadow?.decision !== 'GO' || shadow.sourceSha !== authority.reviewedAppSha || shadow.stableCanonicalComparison !== true) failCutover('shadow');
  assertBaseline(await adapter.baseline(), authority);
  const predecessorText = await adapter.readPredecessor();
  const candidate = await adapter.render(predecessorText, authority);
  await adapter.validate(candidate, predecessorText, authority);
  return Object.freeze({ decision: 'READY', reviewedAppSha: authority.reviewedAppSha, candidateSha256: sha256(candidate) });
}

export async function cutoverMain(args = process.argv.slice(2), factory = createProductionCutoverAdapter) {
  if (!Array.isArray(args) || args.length !== 1 || !['check', 'apply'].includes(args[0])) throw new Error('Zaruku cutover invocation refused');
  const adapter = factory();
  const result = args[0] === 'check' ? await runCutoverCheck(adapter) : await runCutover(adapter);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await cutoverMain(); }
  catch { process.stderr.write('Zaruku exact-path cutover failed\n'); process.exitCode = 1; }
}
