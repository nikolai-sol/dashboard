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

test('historical comparison preserves facts while allowing new dashboard sections',async()=>{
  const {compareHistoricalMetrics}=await import(modulePath);
  const fields=['counters','domain','period','kpis','traffic_channels','organic_trend','top_pages','geo_countries','devices','returning_pages'];
  const legacy={zaruku_seo:Object.fromEntries(fields.map(name=>[name,[{value:42}]]))};
  const next=structuredClone(legacy);next.zaruku_seo.alice_visibility={snapshots:[{month:'2026-08'}]};next.zaruku_seo.wordstat={status:'ready'};
  assert.equal(compareHistoricalMetrics(legacy,next),true);
  for(const name of fields){const bad=structuredClone(next);bad.zaruku_seo[name]=[{value:41}];assert.throws(()=>compareHistoricalMetrics(legacy,bad),/historical/);}
  const missing=structuredClone(next);delete missing.zaruku_seo.organic_trend;assert.throws(()=>compareHistoricalMetrics(legacy,missing),/historical/);
  assert.throws(()=>compareHistoricalMetrics({},{}),/historical/);
});

test('client-rendered Zaruku shell is verified by its isolated asset, not absent SSR tab labels',async()=>{
  const {isolatedShellAsset}=await import(modulePath);
  assert.equal(isolatedShellAsset('<script src="/_next-zaruku/static/chunks/app.js"></script><div>Loading</div>'),'/_next-zaruku/static/chunks/app.js');
  assert.throws(()=>isolatedShellAsset('<script src="/_next/static/app.js"></script>'),/shell/);
});

test('cutover inspects the existing root PM2 daemon, not a new default daemon',async()=>{
  const {cutoverSshArguments}=await import(modulePath);
  const worker=cutoverSshArguments('baseline').at(-1);
  assert.match(worker,/HOME:.*?\/root/);assert.match(worker,/PM2_HOME:.*?\/root\/\.pm2/);
  assert.match(worker,/read\(releaseFile, 0o644, 128\)/);
});

test('Wordstat no-data state is accepted only when canonical tables are empty and reads did not fail',async()=>{
  const {verifyWordstatState}=await import(modulePath);
  const empty={status:'unavailable',messages:[],historical:{rows:[]},current:{queries:[],regions:[]}};
  assert.equal(verifyWordstatState(empty,true),'not-collected');
  assert.throws(()=>verifyWordstatState(empty,false));
  assert.throws(()=>verifyWordstatState({...empty,messages:['Часть канонических таблиц Wordstat сейчас недоступна.']},true));
  assert.throws(()=>verifyWordstatState({...empty,current:{queries:[{}],regions:[]}},true));
  assert.equal(verifyWordstatState({...empty,status:'available'},false),'available');
});

function fixtureAuthority(overrides = {}) {
  return Object.freeze({
    scope: 'zaruku',
    reviewedAppSha: '1a9de096ed7a0cbefe8e4df6bbcf8e0bc311f8d8',
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
    reviewedAppSha: '1a9de096ed7a0cbefe8e4df6bbcf8e0bc311f8d8',
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

function cutoverAdapter({ failAt, falseAt, baselineDrift = false } = {}) {
  const calls = [];
  const authority = fixtureAuthority();
  const candidate = predecessor.replace(
    '    location ^~ /dashboard/ {',
    '__candidate-generated-by-state-machine__\n    location ^~ /dashboard/ {',
  );
  const pass = (name, value = { passed: true }) => async (...args) => {
    calls.push(args.length && ['nginxTest', 'reload'].includes(name) ? `${name}:${args[0]}` : name);
    if (failAt === name || failAt === `${name}:${args[0]}`) throw new Error(`private ${name} failure`);
    if (falseAt === name || falseAt === `${name}:${args[0]}`) return { passed: false };
    return value;
  };
  let baselineCount = 0;
  const baseline = {
    combined: { pid: 4101, cwd: '/var/www/dashboard', sourceSha: '96f16c5df88da796813e701d565191b84dac278b', port: 3001 },
    isolated: { pid: 4202, cwd: '/var/www/dashboard-zaruku/apps/zaruku', sourceSha: authority.reviewedAppSha, port: 3002, loopbackOnly: true },
    targetSha256: authority.expectedPredecessorSha256,
    loadedNginxSha256: 'b'.repeat(64),
    managerAuth: true,
    publicPortsClosed: true,
  };
  return {
    calls,
    authority: pass('authority', authority),
    source: pass('source', { clean: true, branch: 'codex/zaruku-exact-path-cutover', appSha: authority.reviewedAppSha }),
    shadow: pass('shadow', { decision: 'GO', sourceSha: authority.reviewedAppSha, stableCanonicalComparison: true }),
    baseline: async () => {
      calls.push('baseline');
      baselineCount += 1;
      if (failAt === 'baseline') throw new Error('private baseline failure');
      if (baselineDrift && baselineCount > 1) return { ...baseline, combined: { ...baseline.combined, pid: 9999 } };
      return baselineCount > 2 ? { ...baseline, targetSha256: sha256(candidate), loadedNginxSha256: 'c'.repeat(64) } : baseline;
    },
    readPredecessor: pass('readPredecessor', predecessor),
    render: pass('render', candidate),
    validate: pass('validate'),
    backup: pass('backup', { passed: true, path: '/etc/nginx/conf.d/.dashboard-next.conf.pre-zaruku-1c0363a5', sha256: authority.expectedPredecessorSha256 }),
    stageCandidate: pass('stageCandidate', { passed: true, sha256: sha256(candidate) }),
    install: pass('install'),
    nginxTest: pass('nginxTest'),
    reload: pass('reload'),
    verify: pass('verify', { passed: true, publicRouteOwner: 3002, restoredViews: true, foreignRoutesUnchanged: true }),
    restore: pass('restore'),
    verifyRollback: pass('verifyRollback', { passed: true, publicRouteOwner: 3001 }),
    report: pass('report'),
  };
}

test('cutover state machine follows the fixed successful order', async () => {
  const { runCutover } = await import(modulePath);
  const adapter = cutoverAdapter();
  const result = await runCutover(adapter);
  assert.equal(result.decision, 'CUTOVER');
  assert.match(result.candidateSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.backupPath, '/etc/nginx/conf.d/.dashboard-next.conf.pre-zaruku-1c0363a5');
  assert.deepEqual(adapter.calls, [
    'authority', 'source', 'shadow', 'baseline', 'readPredecessor', 'render', 'validate',
    'baseline', 'backup', 'stageCandidate', 'install', 'nginxTest:candidate', 'reload:candidate',
    'verify', 'baseline', 'report',
  ]);
});

test('pre-install failures never restore or reload nginx', async () => {
  const { runCutover } = await import(modulePath);
  for (const failAt of ['source', 'shadow', 'baseline', 'readPredecessor', 'render', 'validate', 'backup', 'stageCandidate']) {
    const adapter = cutoverAdapter({ failAt });
    await assert.rejects(() => runCutover(adapter), /Zaruku exact-path cutover failed/);
    assert.equal(adapter.calls.some(call => call.startsWith('restore')), false, failAt);
    assert.equal(adapter.calls.some(call => call.startsWith('reload')), false, failAt);
  }
});

test('every post-install failure performs one complete verified rollback', async () => {
  const { runCutover } = await import(modulePath);
  for (const failAt of ['install', 'nginxTest:candidate', 'reload:candidate', 'verify']) {
    const adapter = cutoverAdapter({ failAt });
    const result = await runCutover(adapter);
    assert.equal(result.decision, 'ROLLED-BACK', failAt);
    assert.equal(result.failure, failAt === 'install' ? 'install' : failAt.split(':')[0], failAt);
    assert.deepEqual(
      adapter.calls.filter(call => ['restore', 'nginxTest:rollback', 'reload:rollback', 'verifyRollback'].includes(call)),
      ['restore', 'nginxTest:rollback', 'reload:rollback', 'verifyRollback'],
      failAt,
    );
  }
});

test('false mutation acknowledgements trigger rollback exactly like transport failures', async () => {
  const { runCutover } = await import(modulePath);
  for (const falseAt of ['install', 'nginxTest:candidate', 'reload:candidate']) {
    const adapter = cutoverAdapter({ falseAt });
    const result = await runCutover(adapter);
    assert.equal(result.decision, 'ROLLED-BACK', falseAt);
    assert.deepEqual(
      adapter.calls.filter(call => ['restore', 'nginxTest:rollback', 'reload:rollback', 'verifyRollback'].includes(call)),
      ['restore', 'nginxTest:rollback', 'reload:rollback', 'verifyRollback'],
      falseAt,
    );
  }
});

test('rollback refuses a false restore, syntax-test, or reload acknowledgement', async () => {
  const { runCutover } = await import(modulePath);
  for (const falseAt of ['restore', 'nginxTest:rollback', 'reload:rollback']) {
    const adapter = cutoverAdapter({ failAt: 'verify', falseAt });
    await assert.rejects(() => runCutover(adapter), /Zaruku exact-path cutover failed/);
  }
});

test('combined-runtime drift after candidate staging refuses before install', async () => {
  const { runCutover } = await import(modulePath);
  const adapter = cutoverAdapter({ baselineDrift: true });
  await assert.rejects(() => runCutover(adapter), /Zaruku exact-path cutover failed/);
  assert.equal(adapter.calls.includes('install'), false);
  assert.equal(adapter.calls.includes('restore'), false);
});

test('state-machine decisions contain only sanitized evidence', async () => {
  const { runCutover } = await import(modulePath);
  const adapter = cutoverAdapter({ failAt: 'verify' });
  const result = await runCutover(adapter);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /private|cookie|password|authorization/i);
  assert.deepEqual(Object.keys(result).sort(), [
    'backupPath', 'candidateSha256', 'decision', 'failure', 'reviewedAppSha',
  ]);
});

test('production SSH transport is fixed to beget and carries no candidate bytes in argv', async () => {
  const { cutoverSshArguments } = await import(modulePath);
  const args = cutoverSshArguments('install');
  assert.deepEqual(args.slice(0, 8), [
    '-F', '/dev/null', '-o', 'HostName=5.35.85.218', '-o', 'User=root', '-o', 'Port=22',
  ]);
  assert.equal(args.at(-2), 'beget');
  assert.match(args.at(-1), /^\/usr\/bin\/env -i \/usr\/bin\/node --input-type=module -e /);
  assert.doesNotMatch(args.join(' '), /BEGIN REPORTINGDASH|"candidate"\s*:/i);
});

test('production adapter rejects every authority override', async () => {
  const { createProductionCutoverAdapter } = await import(modulePath);
  assert.throws(() => createProductionCutoverAdapter({ host: 'other' }), /cutover adapter refused/);
  assert.throws(() => createProductionCutoverAdapter({ targetFile: '/tmp/nginx.conf' }), /cutover adapter refused/);
  assert.throws(() => createProductionCutoverAdapter({ isolatedPort: 3999 }), /cutover adapter refused/);
});

test('CLI accepts only check or apply', async () => {
  const { cutoverMain } = await import(modulePath);
  let created = false;
  const factory = () => { created = true; return cutoverAdapter(); };
  await assert.rejects(() => cutoverMain([], factory), /cutover invocation refused/);
  await assert.rejects(() => cutoverMain(['apply', 'again'], factory), /cutover invocation refused/);
  await assert.rejects(() => cutoverMain(['rollback'], factory), /cutover invocation refused/);
  assert.equal(created, false);
});
