import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const modulePath = './zaruku-exact-path-cutover.mjs';

const predecessor = `limit_req_zone $binary_remote_addr zone=coopervision_login:10m rate=5r/m;

server {
    listen 5.35.85.218:443 ssl;
    server_name dashboards.adreports.ru;

    add_header Content-Security-Policy "frame-ancestors 'self'" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=31536000" always;

    location /_next/static/ {
        alias /var/www/dashboard/.next/static/;
        expires 365d;
        access_log off;
        add_header Cache-Control "public, immutable";
    }

    location ^~ /dashboard/ {
        add_header Content-Security-Policy "frame-ancestors 'self' https://www.bayesly.digital https://bayesly.digital" always;
        add_header Strict-Transport-Security "max-age=31536000" always;
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 30s;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 30s;
    }
}
`;

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function fixtureAuthority(overrides = {}) {
  return Object.freeze({
    scope: 'zaruku',
    reviewedAppSha: '0630a94c2ea493ba76e4c5932f6b83a351fbd810',
    combinedPort: 3001,
    isolatedPort: 3002,
    targetFile: '/etc/nginx/conf.d/dashboard-next.conf',
    expectedPredecessorSha256: sha256(predecessor),
    assetPrefix: '/_next-zaruku',
    dashboardSlug: 'zaruku',
    numericAlias: '28',
    ...overrides,
  });
}

function tempJson(value) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-cutover-'));
  const filename = path.join(directory, 'authority.json');
  fs.writeFileSync(filename, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  return { directory, filename };
}

test('committed cutover authority pins the reviewed release and live predecessor', async () => {
  const { loadCutoverAuthority } = await import(modulePath);
  const authority = loadCutoverAuthority(path.join(root, 'deploy/zaruku/nginx-cutover.json'));
  assert.deepEqual(authority, {
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
  assert.equal(Object.isFrozen(authority), true);
});

test('authority loader rejects extra keys and release contract drift', async () => {
  const { loadCutoverAuthority } = await import(modulePath);
  const extra = tempJson({ ...fixtureAuthority(), unexpected: true });
  assert.throws(() => loadCutoverAuthority(extra.filename), /cutover authority refused/);
  fs.rmSync(extra.directory, { recursive: true });

  const drift = tempJson(fixtureAuthority({ reviewedAppSha: 'a'.repeat(40) }));
  assert.throws(() => loadCutoverAuthority(drift.filename), /cutover authority refused/);
  fs.rmSync(drift.directory, { recursive: true });
});

test('candidate owns only exact Zaruku routes and the dedicated asset prefix', async () => {
  const { assertCandidateConfig, renderCutoverConfig, routeCutoverRequest } = await import(modulePath);
  const authority = fixtureAuthority();
  const candidate = renderCutoverConfig(predecessor, authority);
  assert.doesNotThrow(() => assertCandidateConfig(candidate, predecessor, authority));

  const cases = [
    ['/dashboard/zaruku', 3002, '/dashboard/zaruku'],
    ['/dashboard/zaruku/', 3002, '/dashboard/zaruku/'],
    ['/api/dashboard/zaruku', 3002, '/api/dashboard/zaruku'],
    ['/api/dashboard/zaruku/pdf', 3002, '/api/dashboard/zaruku/pdf'],
    ['/api/dashboard/zaruku/excel', 3002, '/api/dashboard/zaruku/excel'],
    ['/_next-zaruku/chunks/app.js', 3002, '/_next-zaruku/chunks/app.js'],
    ['/dashboard/28?month=2026-08', 3002, '/dashboard/zaruku?month=2026-08'],
    ['/api/dashboard/28?month=2026-08', 3002, '/api/dashboard/zaruku?month=2026-08'],
    ['/api/dashboard/28/pdf?month=2026-08', 3002, '/api/dashboard/zaruku/pdf?month=2026-08'],
    ['/api/dashboard/28/excel?month=2026-08', 3002, '/api/dashboard/zaruku/excel?month=2026-08'],
    ['/dashboard/280', 3001, '/dashboard/280'],
    ['/api/dashboard/280', 3001, '/api/dashboard/280'],
    ['/dashboard/abbott', 3001, '/dashboard/abbott'],
    ['/dashboard/gidrofuril', 3001, '/dashboard/gidrofuril'],
    ['/api/health', 3001, '/api/health'],
    ['/api/dashboard-auth/session', 3001, '/api/dashboard-auth/session'],
    ['/admin/dashboards', 3001, '/admin/dashboards'],
    ['/_next/static/chunk.js', 3001, '/_next/static/chunk.js'],
  ];
  for (const [request, port, upstreamPath] of cases) {
    assert.deepEqual(routeCutoverRequest(request, authority), { port, upstreamPath }, request);
  }
});

test('render refuses stale, already-cut-over, and unrecognized predecessors', async () => {
  const { renderCutoverConfig } = await import(modulePath);
  assert.throws(
    () => renderCutoverConfig(predecessor, fixtureAuthority({ expectedPredecessorSha256: 'a'.repeat(64) })),
    /cutover predecessor refused/,
  );
  assert.throws(
    () => renderCutoverConfig(`${predecessor}\n# /_next-zaruku 127.0.0.1:3002\n`, fixtureAuthority({ expectedPredecessorSha256: sha256(`${predecessor}\n# /_next-zaruku 127.0.0.1:3002\n`) })),
    /cutover predecessor refused/,
  );
  const unrecognized = predecessor.replace('location ^~ /dashboard/', 'location /dashboard/');
  assert.throws(
    () => renderCutoverConfig(unrecognized, fixtureAuthority({ expectedPredecessorSha256: sha256(unrecognized) })),
    /cutover predecessor refused/,
  );
});

test('candidate is deterministic and leaves predecessor bytes outside one block unchanged', async () => {
  const { CUTOVER_END, CUTOVER_START, renderCutoverConfig } = await import(modulePath);
  const authority = fixtureAuthority();
  const first = renderCutoverConfig(predecessor, authority);
  const second = renderCutoverConfig(predecessor, authority);
  assert.equal(first, second);
  assert.equal(first.split(CUTOVER_START).length, 2);
  assert.equal(first.split(CUTOVER_END).length, 2);
  const withoutBlock = first.replace(new RegExp(`${CUTOVER_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${CUTOVER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\n`), '');
  assert.equal(withoutBlock, predecessor);
});
