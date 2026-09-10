import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXPECTED_AUTHORITY = Object.freeze({
  scope: 'zaruku',
  reviewedAppSha: '0630a94c2ea493ba76e4c5932f6b83a351fbd810',
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
