import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import vm from 'node:vm';
import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { RUNTIME_MANIFESTS } from '../packages/runtime-contract/src/manifest.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const modulePath = new URL('./abbott-deploy-runtime.mjs', import.meta.url);

test('Abbott authority is exact and repository ref is pinned', async () => {
  assert.ok(fs.existsSync(path.join(root, 'deploy/abbott/release.json')), 'fixed Abbott manifest is missing');
  assert.deepEqual(JSON.parse(read('deploy/abbott/release.json')), RUNTIME_MANIFESTS.abbott);
  const repository = JSON.parse(read('deploy/abbott/repository.json'));
  assert.deepEqual(repository, { version: 1, url: 'git@github.com:nikolai-sol/dashboard.git', ref: 'refs/heads/release/abbott', base: '8f389a28df1c4b741ec33b7538f0354b74f5a40e' });
  const { validateAuthority } = await import(modulePath);
  assert.deepEqual(validateAuthority(path.join(root, 'deploy/abbott/release.json')), RUNTIME_MANIFESTS.abbott);
  for (const filename of ['deploy/zaruku/release.json', 'deploy/medroche/release.json', '/tmp/release.json']) assert.throws(() => validateAuthority(filename));
});

test('wrappers reject arguments before any deployment and cannot forward overrides', () => {
  for (const name of ['deploy-abbott', 'rollback-abbott']) {
    assert.ok(fs.existsSync(path.join(root, `scripts/${name}.sh`)), 'fixed wrapper is missing');
    const source = read(`scripts/${name}.sh`);
    assert.doesNotMatch(source, /\$\{?(?:APP_NAME|APP_PORT|APP_DIR|RELEASE_BRANCH)/);
    assert.doesNotMatch(source, /\$@/);
    const result = spawnSync('/bin/bash', [path.join(root, `scripts/${name}.sh`), 'dashboard-next'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /arguments/);
  }
});

test('authority overrides are rejected before network or subprocess dispatch', async () => {
  assert.ok(fs.existsSync(modulePath), 'runtime installer is missing');
  const { validateInvocation, FORBIDDEN_ENV } = await import(modulePath);
  const args = [path.join(root, 'deploy/abbott/release.json'), 'deploy'];
  assert.equal(validateInvocation(args, {}).action, 'deploy');
  for (const key of [...FORBIDDEN_ENV, 'GIT_CONFIG_COUNT', 'GIT_DIR', 'GIT_SSH_COMMAND']) assert.throws(() => validateInvocation(args, { [key]: '' }), /override/);
  assert.throws(() => validateInvocation([...args, 'other'], {}));
  assert.throws(() => validateInvocation([args[0], 'stop-all'], {}));
});

function launch(text, inherited = { METRIKA_TOKEN: 'discard', ARBITRARY: 'discard', NODE_OPTIONS: 'discard' }) {
  const loaded = [];
  const environment = { ...inherited };
  vm.runInNewContext(read('deploy/abbott/start.cjs'), {
    process: { env: environment },
    require(name) {
      if (name === 'node:fs') return { readFileSync(filename) { assert.equal(filename, '/var/www/dashboard-abbott/.env'); return text; } };
      loaded.push(name);
    },
  });
  return { loaded, environment };
}
const runtime = { NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3004', DB_HOST: 'localhost', DB_PORT: '3306', DB_USER: 'reader', DB_PASSWORD: 'test-only', DB_NAME: 'report_bd', DASHBOARD_AUTH_SECRET: 'test-only', ABBOTT_DASHBOARD_EMBED_KEY: 'test-only', INTERNAL_BASE_URL: 'http://127.0.0.1:3004', NEXT_PUBLIC_BASE_URL: 'https://dashboards.adreports.ru', PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium' };
for (const prefix of ['ABBOTT_PRIVATE_DB', 'ABBOTT_EMBED_DB']) for (const field of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) runtime[`${prefix}_${field}`] = 'test-only';
const serialize = value => Object.entries(value).map(([key, value]) => `${key}='${value}'\n`).join('');

test('launcher clears inheritance, keeps required runtime keys and requires only Abbott server', () => {
  assert.ok(fs.existsSync(path.join(root, 'deploy/abbott/start.cjs')), 'launcher is missing');
  const result = launch(serialize(runtime));
  assert.deepEqual(result.environment, runtime);
  assert.deepEqual(result.loaded, ['/var/www/dashboard-abbott/apps/abbott/server.js']);
});

test('launcher rejects wrong listener, environment, duplicate keys and source credentials', () => {
  assert.ok(fs.existsSync(path.join(root, 'deploy/abbott/start.cjs')), 'launcher is missing');
  for (const [key, value] of [['PORT','3001'], ['HOSTNAME','0.0.0.0'], ['NODE_ENV','development'], ['METRIKA_TOKEN','x'], ['YANDEX_ACCESS_TOKEN','x'], ['GOOGLE_REFRESH_TOKEN','x'], ['ABBOTT_EMBED_KEY','x'], ['ABBOTT_PRIVATE_DB_UNKNOWN','x'], ['NODE_OPTIONS','x'], ['ARBITRARY','x']]) assert.throws(() => launch(serialize({ ...runtime, [key]: value })), /environment/);
  assert.throws(() => launch(serialize(runtime) + "PORT='3004'\n"));
  assert.throws(() => launch(serialize(runtime).trimEnd()));
});

test('PM2 owns only Abbott with a cleared environment and dedicated account', () => {
  assert.ok(fs.existsSync(path.join(root, 'deploy/abbott/ecosystem.config.cjs')), 'PM2 config is missing');
  const context = { module: { exports: {} } };
  vm.runInNewContext(read('deploy/abbott/ecosystem.config.cjs'), context);
  const apps = JSON.parse(JSON.stringify(context.module.exports.apps));
  assert.equal(apps.length, 1);
  assert.equal(apps[0].name, 'dashboard-abbott');
  assert.equal(apps[0].uid, 'dashboard-abbott');
  assert.equal(apps[0].gid, 'dashboard-abbott');
  assert.equal(apps[0].cwd, '/var/www/dashboard-abbott/apps/abbott');
  assert.equal(apps[0].args[0], '-i');
  assert.equal(apps[0].env.PORT, 3004);
  assert.doesNotMatch(read('deploy/abbott/ecosystem.config.cjs'), /dashboard-(?:next|zaruku|medroche)|300[123]/);
});

test('remote worker validates paths, dedicated secrets and exact process identity without host calls', async () => {
  const worker = new URL('./abbott-runtime-release-remote.mjs', import.meta.url);
  assert.ok(fs.existsSync(worker), 'remote worker is missing');
  const { createRuntimeInstaller } = await import(worker);
  const installer = createRuntimeInstaller(RUNTIME_MANIFESTS.abbott, Object.keys(runtime));
  for (const name of ['../dashboard-next/server.js', '/var/www/dashboard-next', 'a/../../b', 'a\\b', 'a\nb']) assert.throws(() => installer.safeRelative(name));
  assert.equal(installer.safeRelative('apps/abbott/server.js'), 'apps/abbott/server.js');
  const secrets = { ...runtime };
  delete secrets.PORT; delete secrets.NODE_ENV; delete secrets.HOSTNAME; delete secrets.INTERNAL_BASE_URL;
  assert.deepEqual(installer.renderEnvironment(secrets), runtime);
  for (const key of ['METRIKA_TOKEN', 'GOOGLE_REFRESH_TOKEN', 'YANDEX_TOKEN', 'APP_DIR']) assert.throws(() => installer.renderEnvironment({ ...secrets, [key]: 'x' }));
  const status = 'Uid:\t1001\t1001\t1001\t1001\nGid:\t1001\t1001\t1001\t1001\n';
  const account = { uid: 1001, gid: 1001 };
  installer.assertRuntimeProcess([{ name: 'dashboard-abbott', pid: 123 }], account, () => status, () => '/var/www/dashboard-abbott/apps/abbott');
  for (const name of ['dashboard-next', 'dashboard-zaruku', 'dashboard-medroche']) assert.throws(() => installer.assertRuntimeProcess([{ name, pid: 123 }], account, () => status, () => `/var/www/${name}`));
  assert.throws(() => installer.assertRuntimeProcess([{ name: 'dashboard-abbott', pid: 123 }], account, () => status.replaceAll('1001', '0'), () => '/var/www/dashboard-abbott/apps/abbott'));
  assert.throws(() => installer.assertRuntimeProcess([{ name: 'dashboard-abbott', pid: 123 }], account, () => status, () => '/var/www/dashboard-next'));
});

test('source gate accepts a feature branch only at the exact approved release SHA', async () => {
  const { verifySource } = await import(modulePath);
  const repository = JSON.parse(read('deploy/abbott/repository.json'));
  const sha = 'a'.repeat(40);
  const run = (...args) => args[0] === 'status' ? '' : args[0] === 'branch' ? 'codex/abbott-runtime-isolation' : args[0] === 'rev-parse' ? sha : '';
  assert.equal(verifySource(RUNTIME_MANIFESTS.abbott, repository, undefined, sha, run), sha);
  for (const [command, result] of [['status', ' M package.json'], ['rev-parse', 'b'.repeat(40)]]) assert.throws(() => verifySource(RUNTIME_MANIFESTS.abbott, repository, undefined, sha, (...args) => args[0] === command ? result : run(...args)));
  for (const missing of [undefined, null, '']) assert.throws(() => verifySource(RUNTIME_MANIFESTS.abbott, repository, undefined, missing, run), /approved release ref/);
  assert.throws(() => verifySource(RUNTIME_MANIFESTS.abbott, { ...repository, ref: 'refs/heads/release/zaruku' }, undefined, sha, run), /release ref/);
  assert.throws(() => verifySource(RUNTIME_MANIFESTS.abbott, repository, 'c'.repeat(40), sha, (...args) => { if (args[0] === 'merge-base') throw new Error(); return run(...args); }));
});

test('remote Git approval ignores caller-local insteadOf redirects and config injection', () => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'abbott-git-authority-test-')));
  const caller = path.join(temporary, 'caller');
  const bare = path.join(temporary, 'redirect.git');
  const literal = `file://${temporary}/literal-authority-does-not-exist`;
  const environment = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const run = (args, input) => execFileSync('/usr/bin/git', args, { env: environment, input, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim();
  const temporaryCwds = [];
  try {
    run(['init', caller]); run(['init', '--bare', bare]);
    const tree = run(['--git-dir', bare, 'mktree'], '');
    const sha = run(['--git-dir', bare, 'commit-tree', tree], 'fixture\n');
    run(['--git-dir', bare, 'update-ref', 'refs/heads/release/abbott', sha]);
    run(['-C', caller, 'config', `url.file://${bare}.insteadOf`, literal]);
    assert.equal(run(['-C', caller, 'ls-remote', literal, 'refs/heads/release/abbott']).split('\t')[0], sha, 'fixture redirect must be effective');
    const context = { fs, path, os, createHash, randomUUID, isDeepStrictEqual, testRoot: caller,
      process: { getuid: () => process.getuid(), env: { GIT_DIR: path.join(caller, '.git'), GIT_WORK_TREE: caller, GIT_CEILING_DIRECTORIES: '/', GIT_PREFIX: 'ignored/', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'url.private.insteadOf', GIT_CONFIG_VALUE_0: 'private' } },
      execFileSync(bin, args, options) {
        if (options.cwd) {
          temporaryCwds.push(options.cwd);
          assert.notEqual(options.cwd, caller);
          assert.equal(fs.realpathSync(options.cwd), options.cwd);
          for (const key of ['GIT_DIR','GIT_WORK_TREE','GIT_CEILING_DIRECTORIES','GIT_PREFIX','GIT_CONFIG_COUNT','GIT_CONFIG_PARAMETERS','GIT_SSH','GIT_SSH_COMMAND']) assert.ok(!Object.hasOwn(options.env, key));
          assert.equal(options.env.GIT_CONFIG_GLOBAL, '/dev/null');
          assert.equal(options.env.GIT_CONFIG_SYSTEM, '/dev/null');
        }
        return execFileSync(bin, args, options);
      },
    };
    vm.createContext(context);
    const source = read('scripts/abbott-deploy-runtime.mjs').replace(/^import .*;\n/gm, '').replaceAll('export function ', 'function ').replaceAll('export const ', 'const ').replace("const ROOT = path.resolve(import.meta.dirname, '..');", 'const ROOT = testRoot;').split('\nif (process.argv[1]')[0];
    vm.runInContext(source + '\nthis.lookup = approvedSource;', context);
    assert.throws(() => context.lookup({ url: literal, ref: 'refs/heads/release/abbott' }), /Fixed remote release ref unavailable/);
    assert.equal(context.lookup({ url: `file://${bare}`, ref: 'refs/heads/release/abbott' }), sha);
    run(['--git-dir', bare, 'update-ref', '-d', 'refs/heads/release/abbott']);
    assert.throws(() => context.lookup({ url: `file://${bare}`, ref: 'refs/heads/release/abbott' }), /Fixed remote release ref unavailable/);
    assert.ok(temporaryCwds.length >= 2, 'remote discovery and query must use an isolated cwd');
    for (const cwd of temporaryCwds) assert.equal(fs.existsSync(cwd), false, 'temporary Git authority cwd must be cleaned');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('local Git checks bind the expected git-dir and worktree and refuse URL operations', () => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'abbott-local-git-test-')));
  try {
    const caller = path.join(temporary, 'caller');
    const other = path.join(temporary, 'other');
    const environment = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
    for (const directory of [caller, other]) execFileSync('/usr/bin/git', ['init', directory], { env: environment, stdio: 'ignore' });
    const context = { fs, path, os, execFileSync, testRoot: caller };
    vm.createContext(context);
    const source = read('scripts/abbott-deploy-runtime.mjs').replace(/^import .*;\n/gm, '').replaceAll('export function ', 'function ').replaceAll('export const ', 'const ').replace("const ROOT = path.resolve(import.meta.dirname, '..');", 'const ROOT = testRoot;').split('\nif (process.argv[1]')[0];
    vm.runInContext(source + '\nthis.local = git;', context);
    assert.equal(context.local('status', '--porcelain'), '');
    assert.throws(() => context.local('ls-remote', 'unused'), /Invalid local Git operation/);
    execFileSync('/usr/bin/git', ['-C', caller, 'config', 'core.worktree', other], { env: environment, stdio: 'ignore' });
    assert.throws(() => context.local('status', '--porcelain'), /identity mismatch/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

// Execute the real worker against an isolated filesystem adapter. All absolute
// host paths map into this test-owned temporary directory. No child process,
// SSH, PM2, network, or /var/www access is available in the VM.
test('Abbott preflight refusal precedes account lookup, lock, directories and all platform commands',async()=>{
  const f=fixture();try{
    const calls=[];
    for(const name of Object.keys(f.platform))if(typeof f.platform[name]==='function'){const fn=f.platform[name];f.platform[name]=(...args)=>{calls.push(name);return fn(...args);};}
    f.platform.deploymentPreflight=()=>{calls.push('preflight');throw Error('fixed preflight refusal');};
    for(const action of ['inspect','deploy','rollback']){
      calls.length=0;await assert.rejects(f.installer.transact({action},f.platform),/fixed preflight refusal/);
      assert.deepEqual(calls,['preflight']);assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),false);
      assert.deepEqual(fs.readdirSync(f.map('/var/www')),[]);
    }
  }finally{f.cleanup();}
});

test('Abbott read-only inspect never creates a lock or control directory',async()=>{
  const f=fixture();try{
    const methods=['mkdirSync','writeFileSync','chmodSync','renameSync','unlinkSync','rmdirSync'];
    for(const method of methods)f.io[method]=()=>assert.fail('inspection must not write');
    f.platform.account=()=>assert.fail('inspection must not spawn account lookup');
    assert.equal(await f.installer.transact({action:'inspect'},f.platform),null);
  }finally{f.cleanup();}
});

test('non-Abbott inspection retains its prior account and locked-control path without Abbott proof',async()=>{
  const authority={scope:'other',appName:'dashboard-other',appDir:'/var/www/dashboard-other',lockDir:'/var/www/.dashboard-other-deploy.lock',releaseBranch:'release/other',assetPrefix:'/_next-other',port:3010};
  const f=fixture(authority);try{
    let accounts=0;const account=f.platform.account;f.platform.account=()=>{accounts++;return account();};
    f.platform.deploymentPreflight=()=>assert.fail('must not enter Abbott proof');
    assert.equal(await f.installer.transact({action:'inspect'},f.platform),null);
    assert.equal(accounts,1);assert.equal(fs.existsSync(f.map('/var/www/.dashboard-other-control')),true);
  }finally{f.cleanup();}
});

test('perimeter drift immediately before predecessor stop refuses without any stop or delete',async()=>{
  const f=fixture();try{
    const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);
    f.events.length=0;f.platform.assertDeploymentPerimeter=()=>{throw Error('private neighbor drift');};
    await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform));
    assert.equal(f.events.some(e=>['stop','delete','fresh'].includes(e[0])),false);
    assert.equal(f.installer.inspectActiveRuntime().sourceSha,old.sourceSha);
  }finally{f.cleanup();}
});

test('perimeter drift after candidate health prevents pointer promotion and attests compensation',async()=>{
  const f=fixture();try{
    const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);let checks=0,promotions=0,candidateHealth=false;
    const health=f.platform.health;f.platform.health=async(proof)=>{if(proof.sourceSha==='b'.repeat(40))candidateHealth=true;return health(proof);};
    f.platform.assertDeploymentPerimeter=()=>{if(++checks===3){assert.equal(candidateHealth,true);throw Error('private nginx drift');}};
    const rename=f.io.renameSync;f.io.renameSync=(from,to)=>{if(to==='/var/www/.dashboard-abbott-control/current.json')promotions++;return rename(from,to);};
    await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform),/attested predecessor restored/);
    assert.equal(promotions,0);assert.equal(checks,5);assert.equal(f.installer.inspectActiveRuntime().sourceSha,old.sourceSha);
  }finally{f.cleanup();}
});

test('perimeter drift during compensation leaves owned Abbott stopped and retains review lock',async()=>{
  const f=fixture();try{
    const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);let checks=0;
    f.platform.assertDeploymentPerimeter=()=>{if(++checks>2)throw Error('private drift');};f.nextStartup('fail');
    await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform),/ownership requires review/);
    assert.equal(f.platform.registration(),null);assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),true);
  }finally{f.cleanup();}
});

test('late compensation perimeter drift also stops the restored registration before review',async()=>{
  const f=fixture();try{
    const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);let checks=0;
    f.platform.assertDeploymentPerimeter=()=>{if(++checks===4)throw Error('private late drift');};f.nextStartup('fail');
    await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform),/ownership requires review/);
    assert.equal(f.platform.registration(),null);assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),true);
  }finally{f.cleanup();}
});

test('exact disappearance after final predecessor health refuses before activation even when candidate health would fail',async()=>{
  const f=fixture();try{
    const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);
    let healthChecks=0,armed=false,disappeared=false,renames=0,journalWrites=0;
    const health=f.platform.health,registration=f.platform.registration,rename=f.io.renameSync,write=f.io.writeFileSync;
    f.io.writeFileSync=(file,...args)=>{if(typeof file==='string'&&file.includes('/activation-'))journalWrites++;return write(file,...args);};
    f.platform.health=async(...args)=>{await health(...args);if(++healthChecks===2)armed=true;};
    f.platform.registration=(...args)=>{if(armed&&!disappeared){disappeared=true;f.exitProcess();}return registration(...args);};
    f.io.renameSync=(from,to)=>{if(from==='/var/www/dashboard-abbott'||to==='/var/www/dashboard-abbott')renames++;return rename(from,to);};
    f.events.length=0;f.nextStartup('fail');
    await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform));
    assert.equal(disappeared,true);assert.equal(renames,0);assert.equal(f.events.some(e=>['stop','delete','fresh'].includes(e[0])),false);
    assert.equal(journalWrites,0);
    assert.equal(fs.readFileSync(f.map('/var/www/dashboard-abbott/.release-source-sha'),'utf8').trim(),old.sourceSha);
    assert.equal(f.installer.inspectActiveRuntime().sourceSha,old.sourceSha);assert.equal(f.platform.registration(),null);
  }finally{f.cleanup();}
});

test('disappearance after prepared journal enters compensation and preserves review lock if restart health fails',async()=>{
  const f=fixture();try{
    const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),rename=f.io.renameSync;
    let disappeared=false;
    f.io.renameSync=(from,to)=>{const result=rename(from,to);if(!disappeared&&to.includes('/activation-')&&!to.endsWith('.next')){const j=JSON.parse(fs.readFileSync(f.map(to),'utf8'));if(j.predecessor?.id===old.id&&j.state==='prepared'){disappeared=true;f.exitProcess();}}return result;};
    f.nextStartup('fail');const result=await f.installer.transactAcknowledged({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},new AbortController().signal,f.platform);
    assert.equal(disappeared,true);assert.equal(result.status,'REVIEW_REQUIRED');assert.equal(f.platform.registration(),null);
    assert.equal(fs.readFileSync(f.map('/var/www/dashboard-abbott/.release-source-sha'),'utf8').trim(),old.sourceSha);
    assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),true);
    const journals=fs.readdirSync(f.map('/var/www/.dashboard-abbott-control')).filter(n=>n.startsWith('activation-')&&!n.endsWith('.next')).map(n=>JSON.parse(fs.readFileSync(f.map('/var/www/.dashboard-abbott-control/'+n),'utf8')));
    assert.ok(journals.some(j=>j.predecessor?.id===old.id&&j.state==='review_required'));
  }finally{f.cleanup();}
});

for(const drift of ['pid','release','stopped'])test(`predecessor ${drift} drift before first activation write refuses without activation mutation`,async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);
  const health=f.platform.health,registration=f.platform.registration,write=f.io.writeFileSync;let healthChecks=0,armed=false,changed=false,writes=0;
  f.platform.health=async(...args)=>{await health(...args);if(++healthChecks===2)armed=true;};
  f.platform.registration=(...args)=>{if(armed&&!changed){changed=true;f.mutateRow(r=>{if(drift==='pid')r.pid+=100;else if(drift==='release')r.pm2_env.RUNTIME_RELEASE_ID='d'.repeat(32);else{r.pid=0;r.pm2_env.status='stopped';}});}return registration(...args);};
  f.io.writeFileSync=(file,...args)=>{if(typeof file==='string'&&file.includes('/activation-'))writes++;return write(file,...args);};
  f.events.length=0;await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform));
  assert.equal(changed,true);assert.equal(writes,0);assert.equal(f.events.some(e=>['stop','delete','fresh'].includes(e[0])),false);assert.equal(f.installer.inspectActiveRuntime().sourceSha,old.sourceSha);
 }finally{f.cleanup();}
});

test('first prepared-journal write failure is marked and cannot bypass compensation',async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),write=f.io.writeFileSync;let failed=false;
  f.io.writeFileSync=(file,...args)=>{if(!failed&&typeof file==='string'&&file.includes('/activation-')){failed=true;throw Error('synthetic write interruption');}return write(file,...args);};
  const result=await f.installer.transactAcknowledged({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},new AbortController().signal,f.platform);
  assert.equal(failed,true);assert.equal(result.status,'RESTORED');assert.equal(f.installer.inspectActiveRuntime().sourceSha,old.sourceSha);
  assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),false);
 }finally{f.cleanup();}
});

function fixture(authority=RUNTIME_MANIFESTS.abbott) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'abbott-release-test-'));
  const map = filename => path.join(directory, filename);
  const io = {};
  for (const method of ['existsSync','mkdirSync','chmodSync','readdirSync','unlinkSync','rmdirSync','chownSync']) io[method] = (filename, ...args) => fs[method](map(filename), ...args);
  for (const method of ['readFileSync','writeFileSync','openSync']) io[method] = (filename, ...args) => fs[method](typeof filename === 'number' ? filename : map(filename), ...args);
  for (const method of ['closeSync','fsyncSync']) io[method] = (...args) => fs[method](...args);
  for (const method of ['lstatSync','statSync','fstatSync']) io[method] = (filename, ...args) => {
    const stat = fs[method](typeof filename === 'number' ? filename : map(filename), ...args);
    if (stat) { stat.uid = typeof stat.uid === 'bigint' ? 0n : 0; const gid=typeof filename==='string'&&filename.endsWith('.env')?1001:0;stat.gid = typeof stat.gid === 'bigint' ? BigInt(gid) : gid; }
    return stat;
  };
  io.realpathSync = filename => '/' + path.relative(directory, fs.realpathSync(map(filename)));
  io.renameSync = (from, to) => fs.renameSync(map(from), map(to));
  io.constants = fs.constants;
  for (const filename of ['/var', '/var/www']) fs.mkdirSync(map(filename), { recursive: true, mode: 0o755 });
  const noHost = () => { throw new Error('Forbidden real host operation in fixture'); };
  const context = { fs: io, path, os, createHash, randomUUID, execFileSync: noHost, spawn: noHost, createServer: noHost, fetch: noHost, isDeepStrictEqual, Buffer, TextDecoder, setTimeout, clearTimeout, process: { getuid: () => 0 }, authority, environmentKeys: Object.keys(runtime) };
  vm.createContext(context);
  const source = read('scripts/abbott-runtime-release-remote.mjs').replace(/^import .*;\n/gm, '').replaceAll('export function ', 'function ');
  vm.runInContext(source + '\nthis.installer = createRuntimeInstaller(authority, environmentKeys);', context);
  let processRow = null, serial = 10, healthFailure = false,lastDeletedRegistration=null;
  let nextStartup = 'ready', startup = 'ready', listening = false;
  const events = [];
  const processText = filename => {
    if (filename.endsWith('/status')) return 'Uid:\t1001\t1001\t1001\t1001\nGid:\t1001\t1001\t1001\t1001\n';
    if (filename.endsWith('/stat')) return `${serial} (node) ${['S', ...Array(18).fill('0'), String(serial)].join(' ')}`;
    if (filename.endsWith('/boot_id')) return 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\n';
    if (filename.endsWith('/cmdline')) return '/usr/bin/node\0/var/www/.dashboard-abbott-launcher.cjs\0';
    if (filename.endsWith('/.release-source-sha')) return fs.readFileSync(map(filename), 'utf8');
    throw new Error('unexpected fixture process read');
  };
  const platform = {
    deploymentPreflight() {},
    assertDeploymentPerimeter() {},
    account: () => ({ uid: 1001, gid: 1001 }),
    browser: () => '/var/lib/dashboard-abbott/browser-cache-chrome/chrome/linux-146.0.7680.76/chrome-linux64/chrome',
    chown: () => {},
    secrets: () => Object.fromEntries(Object.entries(runtime).filter(([key]) => !['NODE_ENV','HOSTNAME','PORT','INTERNAL_BASE_URL'].includes(key))),
    verify: async artifact => {
      assert.equal(fs.existsSync(map(artifact + '/.env')), false, 'sealed artifact verification must never include runtime secrets');
    },
    snapshot: () => processRow === null ? null : context.installer.captureRuntimeIdentity([processRow], { uid: 1001, gid: 1001 }, processText, () => '/var/www/dashboard-abbott/apps/abbott', listening ? `LISTEN 0 511 127.0.0.1:3004 0.0.0.0:* users:(("node",pid=${serial},fd=18))` : ''),
    registration: () => processRow === null ? null : ({ registration: context.installer.captureRuntimeRegistration([processRow], { uid: 1001, gid: 1001 }), pid: processRow.pid, status: processRow.pm2_env.status }),
    async assertNoListener() { assert.equal(listening, false, 'candidate listener must be absent before restoration'); events.push(['no-listener']); },
    async start(control) {
      events.push(['start', control]);
      const previousRegistration = processRow?.pm2_env;
      processRow = { name: 'dashboard-abbott', pid: ++serial, pm_id: serial, pm2_env: { pm_exec_path: '/usr/bin/env', pm_cwd: '/var/www/dashboard-abbott/apps/abbott', args: ['-i', 'PATH=/usr/local/bin:/usr/bin:/bin', '/usr/bin/node', '/var/www/.dashboard-abbott-launcher.cjs'], uid: 'dashboard-abbott', gid: 'dashboard-abbott', RUNTIME_RELEASE_ID: path.basename(control), RUNTIME_RELEASE_SOURCE_SHA: fs.readFileSync(map('/var/www/dashboard-abbott/.release-source-sha'), 'utf8').trim(), status: 'online' } };
      startup = nextStartup; nextStartup = 'ready'; listening = startup === 'ready';
      if(startup==='retained:predecessor'&&!previousRegistration){startup='ready';listening=true;}
      if (startup === 'retained:predecessor' && previousRegistration) {
        processRow.pm2_env.RUNTIME_RELEASE_ID = previousRegistration.RUNTIME_RELEASE_ID;
        processRow.pm2_env.RUNTIME_RELEASE_SOURCE_SHA = previousRegistration.RUNTIME_RELEASE_SOURCE_SHA;
        listening = true;
      }
      if(startup==='forged:predecessor'){
        processRow.pm2_env.RUNTIME_RELEASE_ID=lastDeletedRegistration.RUNTIME_RELEASE_ID;
        processRow.pm2_env.RUNTIME_RELEASE_SOURCE_SHA=lastDeletedRegistration.RUNTIME_RELEASE_SOURCE_SHA;
        listening=true;
      }
      if (startup.startsWith('early:')) {
        processRow.pid = 0;
        processRow.pm2_env.status = startup === 'early:waiting restart' ? 'waiting restart' : 'errored';
        if (startup === 'early:error mismatch') processRow.pm2_env.RUNTIME_RELEASE_ID = 'd'.repeat(32);
        if (startup.startsWith('early:error ')) throw new Error('start returned error after registration');
      }
    },
    async stop(pmId) {
      assert.equal(pmId, processRow.pm_id); events.push(['stop', pmId]);
      processRow.pid = 0; processRow.pm2_env.status = 'stopped';
      listening = false;
    },
    async delete(pmId) {
      assert.equal(pmId,processRow.pm_id);assert.equal(processRow.pid,0);assert.equal(processRow.pm2_env.status,'stopped');
      events.push(['delete',pmId]);lastDeletedRegistration=processRow.pm2_env;processRow=null;
    },
    async startFresh(control) {
      assert.equal(processRow,null,'fresh activation must delete the prior PM2 registration');
      events.push(['fresh',control]);await platform.start(control);
    },
    exited(proof) { assert.ok(!processRow||processRow.pid!==proof.pid,'owned process must be gone'); },
    async health() {
      if (healthFailure) { healthFailure = false; throw new Error('fixture failed health'); }
      for (let attempt = 0; attempt < 3; attempt++) {
        events.push(['readiness', serial, attempt]);
        if (startup === 'exited') { processRow = null; throw new Error('candidate exited before listener'); }
        if (['errored', 'waiting restart', 'launching'].includes(startup) || startup.startsWith('mismatched retained')) {
          processRow.pid = 0; processRow.pm2_env.status = startup.startsWith('mismatched retained') ? 'errored' : startup;
          const field = startup.split(':')[1];
          if (field === 'name') processRow.name = 'dashboard-other';
          else if (field === 'uid' || field === 'gid') processRow.pm2_env[field] = 1001;
          else if (field === 'exec') processRow.pm2_env.pm_exec_path = '/usr/bin/other';
          else if (field === 'cwd') processRow.pm2_env.pm_cwd = '/var/www/dashboard-other';
          else if (field === 'args') processRow.pm2_env.args[3] = '/var/www/other-launcher.cjs';
          else if (field === 'release') processRow.pm2_env.RUNTIME_RELEASE_ID = 'd'.repeat(32);
          else if (field === 'source') processRow.pm2_env.RUNTIME_RELEASE_SOURCE_SHA = 'd'.repeat(40);
          else if (startup.startsWith('mismatched retained')) processRow.pm_id += 100;
          throw new Error('retained candidate registration before listener');
        }
        if (startup === 'fail') throw new Error('failure before listener');
        if (startup === 'delayed' && attempt === 1) listening = true;
        if (listening) return;
      }
      throw new Error('listener readiness timeout');
    },
  };
  function payload(sourceSha) {
    const values = { '.release-source-sha': sourceSha + '\n', '.release-runtime-scope': 'abbott\n', 'apps/abbott/server.js': 'test fixture only\n' };
    const entries = Object.entries(values).map(([name, data]) => ({ path: name, type: 'file', required: true, mode: 0o644, size: Buffer.byteLength(data), sha256: createHash('sha256').update(data).digest('hex') }));
    const manifest = JSON.stringify({ version: 1, scope: 'abbott', sourceSha, files: entries });
    return { scope: 'abbott', sourceSha, manifest, manifestDigest: createHash('sha256').update(manifest).digest('hex'), control: [], files: entries.map(entry => ({ path: entry.path, mode: entry.mode, data: Buffer.from(values[entry.path]).toString('base64') })) };
  }
  return { installer: context.installer, platform, events, map, io, context, payload, exitProcess:()=>{processRow=null;listening=false;}, mutateRow: fn=>fn(processRow), nextStartup: value => { nextStartup = value; }, failHealth: () => { healthFailure = true; }, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('fresh Abbott activation deletes the proven predecessor and cannot retain its PM2 env',async()=>{
  const f=fixture();try{
    const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);
    const before=f.platform.snapshot();f.nextStartup('retained:predecessor');
    const candidate=await f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform);
    const stopped=f.events.findIndex(e=>e[0]==='stop'&&e[1]===before.pmId),deleted=f.events.findIndex(e=>e[0]==='delete'&&e[1]===before.pmId),started=f.events.findIndex(e=>e[0]==='fresh'&&e[1].endsWith(candidate.id));
    assert.ok(stopped>=0&&deleted>stopped&&started>deleted);
    assert.equal(f.platform.snapshot().registration.releaseId,candidate.id);
    assert.equal(f.installer.inspectActiveRuntime().id,candidate.id);
    assert.equal(fs.readFileSync(f.map(`/var/www/dashboard-abbott-backups/${old.id}/.release-source-sha`),'utf8').trim(),old.sourceSha);
  }finally{f.cleanup();}
});

test('acknowledged refusals carry the private boundary, never exception text or complete:none',async()=>{
 for(const mode of ['pre_abort','current','browser','lock','prepare','activation_precheck']){const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),abort=new AbortController();
  if(mode==='pre_abort')abort.abort();
  if(mode==='current')f.platform.deploymentPreflight=()=>{throw Error('private-token');};
  if(mode==='browser')f.platform.browser=()=>{throw Error('private-token');};
  if(mode==='lock')fs.mkdirSync(f.map('/var/www/.dashboard-abbott-deploy.lock'));
  if(mode==='prepare')f.platform.verify=()=>{throw Error('private-token');};
  if(mode==='activation_precheck')f.platform.health=()=>{throw Error('private-token');};
  const r=await f.installer.transactAcknowledged({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},abort.signal,f.platform);
  assert.equal(r.status,'REFUSED');assert.deepEqual(JSON.parse(JSON.stringify(r.diagnostic)),{stage:{pre_abort:'unknown',current:'preflight_current',browser:'preflight_browser',lock:'lock',prepare:'prepare',activation_precheck:'activation_precheck'}[mode],reason:'failed'});assert.doesNotMatch(JSON.stringify(r),/private-token/);
 }finally{f.cleanup();}}
});
test('acknowledged worker preserves only exact neighbor subreasons from private proof markers',async()=>{
 for(const stage of ['preflight_neighbor_combined','preflight_neighbor_zaruku','preflight_neighbor_medroche'])for(const reason of ['pid_absent','start_mismatch','uid_gid','cwd','release_record','executable','cmdline','listener','proc_metadata','unknown','private-token']){const f=fixture();try{
  f.platform.deploymentPreflight=note=>{note(stage,reason);throw Object.assign(Error('private-token'),{reason:'private-token'});};
  const r=await f.installer.transactAcknowledged({action:'inspect'},new AbortController().signal,f.platform);
  assert.deepEqual(JSON.parse(JSON.stringify(r)),{status:'REFUSED',record:null,diagnostic:{stage,reason:reason==='private-token'?'unknown':reason}});assert.doesNotMatch(JSON.stringify(r),/private-token/);assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),false);
 }finally{f.cleanup();}}
});
test('acknowledged worker carries only closed Nginx proof markers through REFUSED',async()=>{
 for(const reason of ['metadata','utf8','syntax','tls_count','include','nested_server','variable_routing','regex_location','unsupported_directive','existing_abbott_route','existing_3004','snapshot_drift','unknown','failed','private-token']){const f=fixture();try{
  f.platform.deploymentPreflight=note=>{note('preflight_nginx',reason);throw Object.assign(Error('private-token'),{stage:'complete',reason:'none',stderr:'private-token'});};
  const r=await f.installer.transactAcknowledged({action:'inspect'},new AbortController().signal,f.platform);
  assert.deepEqual(JSON.parse(JSON.stringify(r)),{status:'REFUSED',record:null,diagnostic:{stage:'preflight_nginx',reason:['failed','private-token'].includes(reason)?'unknown':reason}});assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),false);assert.doesNotMatch(JSON.stringify(r),/private-token/);
 }finally{f.cleanup();}}
});
test('acknowledged inspect only emits fixed unsupported names and never mutates',async()=>{
 for(const name of ['location','proxy_pass','return','add_header','root','alias','index','try_files','error_page','proxy_redirect','proxy_cache','ssl_ecdh_curve','ssl_conf_command','client_body_buffer_size','charset','gzip_vary','if','other','private_token']){const f=fixture();try{
  f.platform.deploymentPreflight=note=>{note('preflight_nginx','unsupported_'+name);throw Object.assign(Error('private-token'),{directive:'root',args:['private-token']});};
  const r=await f.installer.transactAcknowledged({action:'inspect'},new AbortController().signal,f.platform);assert.deepEqual(JSON.parse(JSON.stringify(r)),{status:'REFUSED',record:null,diagnostic:{stage:'preflight_nginx',reason:name==='private_token'?'unknown':'unsupported_'+name}});assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),false);assert.equal(f.events.length,0);assert.doesNotMatch(JSON.stringify(r),/private/);
 }finally{f.cleanup();}}
});
test('acknowledged worker returns only completed, restored or protected-review outcomes',async()=>{
 for(const mode of['success','pre_abort','compensated','rollback_failure','spoofed_error']){const f=fixture();try{
  assert.equal(typeof f.installer.transactAcknowledged,'function');const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),abort=new AbortController();
  if(mode==='pre_abort')abort.abort();if(mode==='compensated'||mode==='rollback_failure')f.nextStartup('fail');
  if(mode==='rollback_failure'){const start=f.platform.startFresh;let n=0;f.platform.startFresh=async control=>{if(++n===2)throw Error('private');return start(control);};}
  if(mode==='spoofed_error')f.platform.verify=()=>{throw Error('runtime activation failed; attested predecessor restored');};
  const r=await f.installer.transactAcknowledged({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},abort.signal,f.platform);
  assert.equal(r.status,{success:'COMMITTED',pre_abort:'REFUSED',compensated:'RESTORED',rollback_failure:'REVIEW_REQUIRED',spoofed_error:'REFUSED'}[mode]);assert.equal(r.record===null,mode!=='success');assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),mode==='rollback_failure');assert.doesNotMatch(JSON.stringify(r),/private/);
  assert.deepEqual(JSON.parse(JSON.stringify(r.diagnostic)),{success:{stage:'complete',reason:'none'},pre_abort:{stage:'unknown',reason:'failed'},compensated:{stage:'compensation',reason:'restored'},rollback_failure:{stage:'compensation',reason:'review_required'},spoofed_error:{stage:'prepare',reason:'failed'}}[mode]);
 }finally{f.cleanup();}}
});

for(const boundary of ['stop','delete','old_rename','candidate_rename','start','health','pointer'])test(`private phase precedes ${boundary} and exception contents never choose compensation status`,async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),terminal={status:'REFUSED',phase:'unknown'},seen=[];let hit=false;
  const inject=()=>{if(hit)return;hit=true;seen.push(terminal.phase);throw Object.assign(Error('private-token'),{stage:'complete',reason:'none',status:'COMMITTED'});};
  if(['stop','delete','start','health'].includes(boundary)){const name=boundary==='start'?'startFresh':boundary,method=f.platform[name];f.platform[name]=async(...args)=>{if(boundary!=='health'||args[0].sourceSha!==old.sourceSha)inject();return method(...args);};}
  else{const rename=f.io.renameSync;f.io.renameSync=(from,to)=>{if(boundary==='pointer'?to==='/var/www/.dashboard-abbott-control/current.json':boundary==='old_rename'?from==='/var/www/dashboard-abbott':to==='/var/www/dashboard-abbott')inject();return rename(from,to);};}
  await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform,undefined,terminal));
  assert.equal(hit,true);assert.deepEqual(seen,[boundary==='start'?'activation_start':boundary==='health'?'candidate_health':boundary==='pointer'?'pointer':'activation_stop']);assert.equal(terminal.phase,'compensation');assert.equal(terminal.status,'RESTORED');assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),false);
 }finally{f.cleanup();}
});

for(const event of['signal','eof','connection_loss'])for(const phase of['stop','delete','old_rename','candidate_rename','start','publish'])for(const when of['before','after'])test(`acknowledged ${event} ${when} ${phase} waits for restored state and cleared lock`,async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),abort=new AbortController();let hit=false;
  const interrupt=()=>{if(!hit){hit=true;abort.abort();}};
  if(['stop','delete','start'].includes(phase)){const name=phase==='start'?'startFresh':phase,method=f.platform[name];f.platform[name]=async(...args)=>{if(when==='before')interrupt();const r=await method(...args);if(when==='after')interrupt();return r;};}
  else{const rename=f.io.renameSync;f.io.renameSync=(from,to)=>{const match=phase==='old_rename'?from==='/var/www/dashboard-abbott':phase==='candidate_rename'?to==='/var/www/dashboard-abbott':to==='/var/www/.dashboard-abbott-control/current.json';if(match&&when==='before')interrupt();rename(from,to);if(match&&when==='after')interrupt();};}
  const r=await f.installer.transactAcknowledged({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},abort.signal,f.platform);
  assert.equal(hit,true);assert.deepEqual(JSON.parse(JSON.stringify(r)),{status:'RESTORED',record:null,diagnostic:{stage:'compensation',reason:'restored'}});assert.equal(f.installer.inspectActiveRuntime().id,old.id);assert.equal(f.platform.snapshot().registration.releaseId,old.id);assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),false);
 }finally{f.cleanup();}
});
test('unverifiable review journal never produces an acknowledged fail-closed outcome',async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),start=f.platform.startFresh,rename=f.io.renameSync;f.nextStartup('fail');let starts=0,failed=false;
  f.platform.startFresh=async c=>{if(++starts===2){failed=true;throw Error('private');}return start(c);};f.io.renameSync=(a,b)=>{if(failed&&b.includes('/activation-'))throw Error('private journal');return rename(a,b);};
  const r=await f.installer.transactAcknowledged({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},new AbortController().signal,f.platform);assert.equal(r.status,'UNACKNOWLEDGED');assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),true);
 }finally{f.cleanup();}
});

for(const method of['stop','delete','startFresh'])for(const when of['before','after'])test(`fresh activation compensates ${method} failure ${when} side effect`,async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);
  const original=f.platform[method];let failed=false;
  f.platform[method]=async(...args)=>{if(failed)return original(...args);failed=true;if(when==='after')await original(...args);throw Error('private failure');};
  await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform),/attested predecessor restored/);
  assert.equal(f.installer.inspectActiveRuntime().id,old.id);assert.equal(f.platform.snapshot().registration.releaseId,old.id);
  assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),false);
  const journal=fs.readdirSync(f.map('/var/www/.dashboard-abbott-control')).filter(n=>n.startsWith('activation-')).map(n=>JSON.parse(fs.readFileSync(f.map('/var/www/.dashboard-abbott-control/'+n)))).find(j=>j.predecessor?.id===old.id);
  assert.equal(journal.state,'restored');assert.equal(journal.candidate.sourceSha,'b'.repeat(40));
 }finally{f.cleanup();}
});

for(const field of['pid','startTime','uid','gid','sourceSha','releaseId'])test(`predecessor ${field} drift refuses before stop/delete or active rename`,async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),snapshot=f.platform.snapshot,verify=f.platform.verify;
  let changed=false;f.platform.verify=async(...args)=>{await verify(...args);changed=true;};
  f.platform.snapshot=()=>{const p=snapshot();if(changed){if(field==='releaseId')p.registration.releaseId='d'.repeat(32);else p[field]=['pid','uid','gid'].includes(field)?9999:'d'.repeat(field==='sourceSha'?40:5);}return p;};
  await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform));
  assert.equal(f.events.filter(e=>['stop','delete'].includes(e[0])).length,0);
  assert.equal(f.installer.inspectActiveRuntime().id,old.id);assert.equal(fs.existsSync(f.map('/var/www/dashboard-abbott-backups/'+old.id)),false);
 }finally{f.cleanup();}
});

test('candidate cannot publish pointer until complete health and stable binding verification',async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),health=f.platform.health;
  let candidateChecks=0;f.platform.health=async proof=>{if(proof.sourceSha!==old.sourceSha){candidateChecks++;assert.equal(JSON.parse(fs.readFileSync(f.map('/var/www/.dashboard-abbott-control/current.json'))).id,old.id);}await health(proof);};
  await f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform);assert.equal(candidateChecks,2);
 }finally{f.cleanup();}
});

for(const when of['before','after'])test(`failed fresh predecessor restart ${when} spawn leaves owned Abbott stopped and lock/journal`,async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),start=f.platform.startFresh;f.nextStartup('fail');let starts=0;
  f.platform.startFresh=async control=>{if(++starts===2){if(when==='after')await start(control);throw Error('private rollback failure');}return start(control);};
  await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform),/ownership requires review/);
  assert.equal(f.installer.inspectActiveRuntime().id,old.id);assert.equal(f.platform.registration(),null);assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),true);
  const journals=fs.readdirSync(f.map('/var/www/.dashboard-abbott-control')).filter(n=>n.startsWith('activation-')).map(n=>JSON.parse(fs.readFileSync(f.map('/var/www/.dashboard-abbott-control/'+n))));assert.ok(journals.some(j=>j.state==='review_required'));
 }finally{f.cleanup();}
});

test('online status is required for predecessor and candidate even with a healthy listener',async()=>{
 for(const side of['predecessor','candidate']){const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);
  if(side==='predecessor')f.mutateRow(r=>{r.pm2_env.status='launching';});
  else{const start=f.platform.startFresh;f.platform.startFresh=async control=>{await start(control);if(!control.endsWith(old.id))f.mutateRow(r=>{r.pm2_env.status='launching';});};}
  await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform));
  assert.equal(f.installer.inspectActiveRuntime().id,old.id);
  if(side==='predecessor')assert.equal(f.events.filter(e=>e[0]==='stop').length,0);
 }finally{f.cleanup();}}
});

for(const phase of['prepared','stop','delete','old_rename','candidate_rename','start','candidate_started','publish'])test(`cancellation at ${phase} restores predecessor without promoting candidate`,async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);let aborted=false,hit=false;
  for(const [name,event]of[['stop','stop'],['delete','delete'],['startFresh','start']]){const original=f.platform[name];f.platform[name]=async(...args)=>{const r=await original(...args);if(phase===event&&!hit){hit=true;aborted=true;}return r;};}
  const rename=f.io.renameSync;f.io.renameSync=(from,to)=>{rename(from,to);if(!hit&&((phase==='old_rename'&&from==='/var/www/dashboard-abbott')||(phase==='candidate_rename'&&to==='/var/www/dashboard-abbott')||(phase==='publish'&&to==='/var/www/.dashboard-abbott-control/current.json'))){hit=true;aborted=true;}};
  const guard=()=>{if(['prepared','candidate_started'].includes(phase)&&!hit){for(const n of fs.readdirSync(f.map('/var/www/.dashboard-abbott-control')).filter(n=>n.startsWith('activation-')&&!n.endsWith('.next'))){const j=JSON.parse(fs.readFileSync(f.map('/var/www/.dashboard-abbott-control/'+n)));if(j.predecessor?.id===old.id&&j.state===phase){hit=true;aborted=true;}}}if(aborted)throw Error('private cancellation');};
  await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform,guard));
  assert.equal(hit,true);assert.equal(f.installer.inspectActiveRuntime().id,old.id);assert.equal(f.platform.snapshot().registration.releaseId,old.id);assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),false);
 }finally{f.cleanup();}
});

test('remote Abbott signal lifecycle installs before dispatch and retains handlers until compensation returns',()=>{
 const source=read('scripts/abbott-runtime-release-remote.mjs'),main=source.slice(source.indexOf('async function remoteMain'));
 assert.match(main,/SIGINT.*SIGTERM.*SIGHUP/);
 assert.ok(main.indexOf('process.on(')<main.indexOf('await transact('));
 assert.match(main,/await transact\(request, realPlatform, guard\)/);
 assert.ok(main.indexOf('removeListener')>main.indexOf('await transact('));
});

test('pointer drift after candidate health stops only the proven candidate and preserves review state',async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),health=f.platform.health;
  f.platform.health=async proof=>{await health(proof);if(proof.sourceSha!==old.sourceSha)fs.writeFileSync(f.map('/var/www/.dashboard-abbott-control/current.json'),JSON.stringify({...old,id:'d'.repeat(32)}));};
  await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform),/ownership requires review/);
  assert.equal(f.platform.registration(),null);assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),true);
  assert.equal(fs.readFileSync(f.map(`/var/www/dashboard-abbott-backups/${old.id}/.release-source-sha`),'utf8').trim(),old.sourceSha);
 }finally{f.cleanup();}
});

test('registration replacement after stop is never deleted and leaves exact old tree for review',async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),registration=f.platform.registration;
  let stoppedReads=0;f.platform.registration=(...args)=>{const row=registration(...args);if(row?.status==='stopped'&&++stoppedReads===3)f.mutateRow(r=>{r.pm_id+=100;});return registration(...args);};
  await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform),/ownership requires review/);
  assert.equal(f.events.filter(e=>e[0]==='delete').length,0);assert.equal(f.installer.inspectActiveRuntime().id,old.id);assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),true);
 }finally{f.cleanup();}
});

test('real fresh adapter uses only fixed PM2 start/delete and never merges retained environment',async()=>{
 const f=fixture();try{
  const record=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),control='/var/www/.dashboard-abbott-control/'+record.id;
  fs.mkdirSync(f.map(control+'/deploy/abbott'),{recursive:true});fs.writeFileSync(f.map(control+'/deploy/abbott/start.cjs'),read('deploy/abbott/start.cjs'));
  const calls=[];f.context.execFileSync=(bin,args,options)=>{calls.push({bin,args:Array.from(args),env:options.env});if(bin==='pm2'&&args[0]==='jlist')return '[]';if(bin==='pm2'&&['start','delete'].includes(args[0]))return '';throw Error('unexpected fixture command');};
  const p=f.installer.interruptedRecoveryTools().platform;await p.startFresh(control);await p.delete(17);
  const actions=calls.filter(c=>c.args[0]!=='jlist');assert.deepEqual(actions.map(c=>c.args),[['start',control+'/deploy/abbott/ecosystem.config.cjs','--only','dashboard-abbott'],['delete','17']]);
  assert.equal(actions[0].env.RUNTIME_RELEASE_ID,record.id);assert.equal(actions[0].env.RUNTIME_RELEASE_SOURCE_SHA,record.sourceSha);
  assert.ok(actions.every(c=>c.bin==='pm2'));assert.doesNotMatch(JSON.stringify(actions),/startOrReload|--update-env|dashboard-next|dashboard-zaruku|dashboard-medroche/);
  const count=calls.length;await assert.rejects(p.delete('all'));await assert.rejects(p.startFresh('/var/www/other'));assert.equal(calls.filter(c=>c.args[0]!=='jlist').length,2);assert.ok(calls.length>=count);
 }finally{f.cleanup();}
});

for(const move of['predecessor','candidate'])for(const when of['before','after'])test(`atomic ${move} rename failure ${when} preserves trees and either restores or stops Abbott`,async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),rename=f.io.renameSync;let hit=false;
  f.io.renameSync=(from,to)=>{const match=move==='predecessor'?from==='/var/www/dashboard-abbott':to==='/var/www/dashboard-abbott';if(!hit&&match){hit=true;if(when==='after')rename(from,to);throw Error('private rename failure');}rename(from,to);};
  await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform));assert.equal(hit,true);
  const locked=fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock'));
  if(locked)assert.equal(f.platform.registration(),null);else{assert.equal(f.installer.inspectActiveRuntime().id,old.id);assert.equal(f.platform.snapshot().registration.releaseId,old.id);}
  const locations=['/var/www/dashboard-abbott',...fs.readdirSync(f.map('/var/www/dashboard-abbott-backups')).map(n=>'/var/www/dashboard-abbott-backups/'+n),...fs.readdirSync(f.map('/var/www/dashboard-abbott-releases')).map(n=>'/var/www/dashboard-abbott-releases/'+n)].filter(p=>fs.existsSync(f.map(p)));
  assert.deepEqual(locations.map(p=>fs.readFileSync(f.map(p+'/.release-source-sha'),'utf8').trim()).sort(),['a'.repeat(40),'b'.repeat(40)]);
 }finally{f.cleanup();}
});

test('candidate PID reuse after health never authorizes stopping a replacement',async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),health=f.platform.health,snapshot=f.platform.snapshot;let replaced=false;
  f.platform.health=async proof=>{await health(proof);if(proof.sourceSha!==old.sourceSha)replaced=true;};
  f.platform.snapshot=()=>{const proof=snapshot();if(replaced)proof.startTime='99999';return proof;};
  await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform),/ownership requires review/);
  assert.equal(f.events.filter(e=>e[0]==='stop').length,1);assert.equal(f.events.filter(e=>e[0]==='delete').length,1);assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),true);
 }finally{f.cleanup();}
});

test('last pre-publication identity drift cannot promote the candidate pointer',async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);let checks=0,hit=false;
  const guard=()=>{for(const n of fs.readdirSync(f.map('/var/www/.dashboard-abbott-control')).filter(n=>n.startsWith('activation-')&&!n.endsWith('.next'))){const j=JSON.parse(fs.readFileSync(f.map('/var/www/.dashboard-abbott-control/'+n)));if(j.predecessor?.id===old.id&&j.state==='candidate_started'&&++checks===3){hit=true;f.mutateRow(r=>{r.pm_id+=100;});}}};
  await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform,guard),/ownership requires review/);
  assert.equal(hit,true);assert.equal(JSON.parse(fs.readFileSync(f.map('/var/www/.dashboard-abbott-control/current.json'))).id,old.id);
 }finally{f.cleanup();}
});

test('post-publication rollback restores the exact original pointer bytes',async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),pointer=f.map('/var/www/.dashboard-abbott-control/current.json'),bytes=Buffer.from(JSON.stringify(old,null,2)+'\n');fs.writeFileSync(pointer,bytes);
  let published=false;const rename=f.io.renameSync;f.io.renameSync=(from,to)=>{rename(from,to);if(to==='/var/www/.dashboard-abbott-control/current.json')published=true;};
  await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform,()=>{if(published)throw Error('private cancellation');}),/attested predecessor restored/);
  assert.ok(fs.readFileSync(pointer).equals(bytes));assert.equal(f.platform.snapshot().registration.releaseId,old.id);
 }finally{f.cleanup();}
});

test('unsafe predecessor env metadata refuses before process mutation',async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);fs.chmodSync(f.map('/var/www/dashboard-abbott/.env'),0o600);
  await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform));
  assert.equal(f.events.filter(e=>e[0]==='stop'||e[0]==='delete').length,0);
 }finally{f.cleanup();}
});

test('candidate env drift after health stops its owned process and preserves sealed predecessor',async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),health=f.platform.health;
  f.platform.health=async proof=>{await health(proof);if(proof.sourceSha!==old.sourceSha)fs.appendFileSync(f.map('/var/www/dashboard-abbott/.env'),"UNAPPROVED='private'\n");};
  await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform),/ownership requires review/);
  assert.equal(f.platform.registration(),null);assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),true);assert.equal(fs.readFileSync(f.map(`/var/www/dashboard-abbott-backups/${old.id}/.release-source-sha`),'utf8').trim(),old.sourceSha);
 }finally{f.cleanup();}
});

test('candidate disappearance after final health cannot reuse a stale captured proof',async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),health=f.platform.health;let checks=0;
  f.platform.health=async proof=>{await health(proof);if(proof.sourceSha!==old.sourceSha&&++checks===2)f.exitProcess();};
  await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},f.platform),/attested predecessor restored/);
  assert.equal(f.installer.inspectActiveRuntime().id,old.id);assert.equal(f.platform.snapshot().registration.releaseId,old.id);
 }finally{f.cleanup();}
});

test('Abbott browser prerequisite refuses before deployment writes; verified path is rendered without altering secret input',async()=>{
  const f=fixture();try{
    const browser=f.platform.browser;f.platform.browser=()=>{throw Error('browser unavailable');};
    await assert.rejects(f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),/browser unavailable/);
    assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),false);assert.deepEqual(f.events,[]);
    f.platform.browser=browser;await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);
    assert.ok(fs.readFileSync(f.map('/var/www/dashboard-abbott/.env'),'utf8').includes(`PUPPETEER_EXECUTABLE_PATH='${browser()}'`));
    assert.equal(f.platform.secrets().PUPPETEER_EXECUTABLE_PATH,'/usr/bin/chromium');
  }finally{f.cleanup();}
});

for (const mode of ['delayed', 'timeout', 'fail', 'exited']) test(`candidate ownership is established before ${mode} listener readiness`, async () => {
  const f = fixture();
  try {
    const first = await f.installer.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload('a'.repeat(40)) }, f.platform);
    const second = await f.installer.transact({ action: 'deploy', expectedActiveSha: first.sourceSha, payload: f.payload('b'.repeat(40)) }, f.platform);
    f.nextStartup(mode);
    const operation = f.installer.transact({ action: 'deploy', expectedActiveSha: second.sourceSha, payload: f.payload('c'.repeat(40)) }, f.platform);
    if (mode === 'delayed') {
      assert.equal((await operation).sourceSha, 'c'.repeat(40));
      assert.equal(f.events.filter(event => event[0] === 'readiness' && event[1] === 13).length, 3);
    } else {
      await assert.rejects(operation, /attested predecessor restored/);
      if (mode !== 'exited') assert.ok(f.events.some(event => event[0] === 'stop' && event[1] === 13), 'only proven candidate must be stopped before restoring predecessor');
      assert.equal(f.events.filter(event => event[0] === 'stop').length, mode === 'exited' ? 2 : 3);
    }
    const active = f.installer.inspectActiveRuntime();
    assert.equal(active.sourceSha, (mode === 'delayed' ? 'c' : 'b').repeat(40));
    assert.equal(fs.readFileSync(f.map('/var/www/dashboard-abbott/.release-source-sha'), 'utf8').trim(), active.sourceSha);
    const restored = await f.installer.transact({ action: 'rollback', expectedActiveSha: active.sourceSha }, f.platform);
    assert.equal(restored.sourceSha, (mode === 'delayed' ? 'b' : 'a').repeat(40));
    assert.equal(f.installer.inspectActiveRuntime().sourceSha, restored.sourceSha);
    assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')), false);
  } finally { f.cleanup(); }
});

test('forged predecessor binding after fresh start requires review, not candidate promotion or unowned stop', async () => {
  const f = fixture();
  try {
    const old = await f.installer.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload('a'.repeat(40)) }, f.platform);
    f.nextStartup('forged:predecessor');
    await assert.rejects(f.installer.transact({ action: 'deploy', expectedActiveSha: old.sourceSha, payload: f.payload('b'.repeat(40)) }, f.platform), /ownership requires review/);
    assert.equal(f.events.filter(event => event[0] === 'start').length, 2);
    assert.equal(f.events.filter(event => event[0] === 'stop').length, 1);
    assert.equal(f.platform.registration().registration.releaseId, old.id);
    assert.equal(f.platform.registration().pid, 12);
    assert.equal(JSON.parse(fs.readFileSync(f.map('/var/www/.dashboard-abbott-control/current.json'))).id, old.id);
    assert.equal(fs.readFileSync(f.map('/var/www/dashboard-abbott/.release-source-sha'), 'utf8').trim(), 'b'.repeat(40));
    assert.equal(fs.readFileSync(f.map(`/var/www/dashboard-abbott-backups/${old.id}/.release-source-sha`), 'utf8').trim(), old.sourceSha);
    assert.throws(() => f.installer.inspectActiveRuntime(), /external authority/);
    assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')), true);
    await assert.rejects(f.installer.transact({ action: 'rollback', expectedActiveSha: old.sourceSha }, f.platform), /lock/);
    assert.equal(f.events.filter(event => event[0] === 'start').length, 2);
    assert.equal(f.events.filter(event => event[0] === 'stop').length, 1);
  } finally { f.cleanup(); }
});

for (const mode of ['early:errored', 'early:waiting restart', 'early:error matching', 'early:error mismatch']) test(`registration is owned before first live snapshot for ${mode}`, async () => {
  const f = fixture();
  try {
    const first = await f.installer.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload('a'.repeat(40)) }, f.platform);
    const second = await f.installer.transact({ action: 'deploy', expectedActiveSha: first.sourceSha, payload: f.payload('b'.repeat(40)) }, f.platform);
    f.nextStartup(mode);
    const operation = f.installer.transact({ action: 'deploy', expectedActiveSha: second.sourceSha, payload: f.payload('c'.repeat(40)) }, f.platform);
    if (mode === 'early:error mismatch') {
      await assert.rejects(operation, /ownership requires review/);
      assert.equal(f.events.filter(event => event[0] === 'stop').length, 2);
      assert.equal(f.events.filter(event => event[0] === 'start').length, 3);
      assert.equal(fs.readFileSync(f.map(`/var/www/dashboard-abbott-backups/${second.id}/.release-source-sha`), 'utf8').trim(), second.sourceSha, 'sealed predecessor remains recoverable');
      assert.equal(JSON.parse(fs.readFileSync(f.map('/var/www/.dashboard-abbott-control/current.json'), 'utf8')).id, second.id);
      return;
    }
    await assert.rejects(operation, /attested predecessor restored/);
    assert.ok(f.events.some(event => event[0] === 'stop' && event[1] === 13));
    assert.equal(f.installer.inspectActiveRuntime().sourceSha, second.sourceSha);
    assert.equal(fs.readFileSync(f.map('/var/www/dashboard-abbott/.release-source-sha'), 'utf8').trim(), second.sourceSha);
    const rollback = await f.installer.transact({ action: 'rollback', expectedActiveSha: second.sourceSha }, f.platform);
    assert.equal(rollback.sourceSha, first.sourceSha);
    assert.equal(f.installer.inspectActiveRuntime().sourceSha, first.sourceSha);
  } finally { f.cleanup(); }
});

for (const mode of ['errored', 'waiting restart', 'launching', ...['id','name','exec','cwd','args','uid','gid','release','source'].map(field => `mismatched retained:${field}`)]) test(`recovery handles ${mode} PM2 registration without an active PID`, async () => {
  const f = fixture();
  try {
    const first = await f.installer.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload('a'.repeat(40)) }, f.platform);
    const second = await f.installer.transact({ action: 'deploy', expectedActiveSha: first.sourceSha, payload: f.payload('b'.repeat(40)) }, f.platform);
    f.nextStartup(mode);
    const operation = f.installer.transact({ action: 'deploy', expectedActiveSha: second.sourceSha, payload: f.payload('c'.repeat(40)) }, f.platform);
    if (mode.startsWith('mismatched retained')) {
      await assert.rejects(operation, /ownership requires review/);
      assert.equal(f.events.filter(event => event[0] === 'stop').length, 2);
      assert.equal(f.events.filter(event => event[0] === 'start').length, 3, 'mismatched registration must not be replaced');
      return;
    }
    await assert.rejects(operation, /attested predecessor restored/);
    const stop = f.events.findIndex(event => event[0] === 'stop' && event[1] === 13);
    const listener = f.events.findIndex((event, index) => index > stop && event[0] === 'no-listener');
    const restart = f.events.findIndex((event, index) => index > stop && event[0] === 'start');
    assert.ok(stop >= 0 && listener > stop && restart > listener, 'cancel restart and verify no listener before predecessor restart');
    assert.equal(f.installer.inspectActiveRuntime().sourceSha, second.sourceSha);
    assert.equal(fs.readFileSync(f.map('/var/www/dashboard-abbott/.release-source-sha'), 'utf8').trim(), second.sourceSha);
    const rollback = await f.installer.transact({ action: 'rollback', expectedActiveSha: second.sourceSha }, f.platform);
    assert.equal(rollback.sourceSha, first.sourceSha);
    assert.equal(f.installer.inspectActiveRuntime().sourceSha, first.sourceSha);
  } finally { f.cleanup(); }
});

test('immutable install, lock exclusion, rollback and failed-health recovery affect only Abbott fixture', async () => {
  const f = fixture();
  try {
    const first = await f.installer.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload('a'.repeat(40)) }, f.platform);
    assert.equal(first.scope, 'abbott');
    assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')), false);
    fs.mkdirSync(f.map('/var/www/.dashboard-abbott-deploy.lock'));
    await assert.rejects(f.installer.transact({ action: 'inspect' }, f.platform), /lock/);
    fs.rmdirSync(f.map('/var/www/.dashboard-abbott-deploy.lock'));
    const second = await f.installer.transact({ action: 'deploy', expectedActiveSha: first.sourceSha, payload: f.payload('b'.repeat(40)) }, f.platform);
    assert.equal(second.previousId, first.id);
    f.nextStartup('fail');
    await assert.rejects(f.installer.transact({ action: 'rollback', expectedActiveSha: second.sourceSha }, f.platform), /predecessor restored/);
    assert.equal(f.installer.inspectActiveRuntime().sourceSha, second.sourceSha);
    const restored = await f.installer.transact({ action: 'rollback', expectedActiveSha: second.sourceSha }, f.platform);
    assert.equal(restored.sourceSha, first.sourceSha);
    assert.ok(f.events.filter(event => event[0] === 'start').every(event => event[1].startsWith('/var/www/.dashboard-abbott-control/')));
    for (const name of ['dashboard-next','dashboard-zaruku','dashboard-medroche']) assert.equal(fs.existsSync(f.map('/var/www/' + name)), false);
  } finally { f.cleanup(); }
});

test('artifact digest corruption and stale active authority fail before process activation', async () => {
  const f = fixture();
  try {
    const invalid = f.payload('a'.repeat(40));
    invalid.files[2].data = Buffer.from('tampered').toString('base64');
    await assert.rejects(f.installer.transact({ action: 'deploy', expectedActiveSha: null, payload: invalid }, f.platform), /external authority/);
    assert.equal(f.events.length, 0);
    const first = await f.installer.transact({ action: 'deploy', expectedActiveSha: null, payload: f.payload('a'.repeat(40)) }, f.platform);
    await assert.rejects(f.installer.transact({ action: 'rollback', expectedActiveSha: 'b'.repeat(40) }, f.platform), /SHA changed/);
    assert.equal(f.installer.inspectActiveRuntime().sourceSha, first.sourceSha);
    fs.appendFileSync(f.map('/var/www/dashboard-abbott/apps/abbott/server.js'), 'tampered');
    await assert.rejects(f.installer.transact({ action: 'rollback', expectedActiveSha: first.sourceSha }, f.platform), /external authority/);
  } finally { f.cleanup(); }
});

test('real Abbott payload materializes under the unchanged sealed artifact policy', async () => {
  const { preparePayload } = await import(modulePath);
  const { assertRuntimeArtifact } = await import('./abbott-runtime-artifact-policy.mjs');
  const sha = read('apps/abbott/.next-abbott/standalone/.release-source-sha').trim();
  const payload = preparePayload(RUNTIME_MANIFESTS.abbott, sha);
  const f = fixture();
  let verified = 0;
  f.platform.verify = async (artifact, manifest) => {
    assert.equal(fs.existsSync(f.map(artifact + '/.env')), false);
    assertRuntimeArtifact(f.map(artifact), 'abbott', f.map(manifest));
    verified += 1;
  };
  try {
    const result = await f.installer.transact({ action: 'deploy', expectedActiveSha: null, payload }, f.platform);
    assert.equal(result.sourceSha, sha);
    assert.equal(verified, 2);
  } finally { f.cleanup(); }
});

test('runtime env profiles and package commands retain the fixed reviewed boundaries', () => {
  const keys = JSON.parse(read('deploy/abbott/environment.json'));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes('ABBOTT_DASHBOARD_EMBED_KEY'));
  assert.ok(!keys.includes('ABBOTT_EMBED_KEY'));
  const source = read('deploy/abbott/start.cjs');
  const declared = JSON.parse(/const allowed = new Set\((\[[\s\S]*?\])\);/.exec(source)[1]);
  assert.deepEqual(keys, declared);
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.equal(scripts['deploy:abbott'], 'bash scripts/deploy-abbott.sh');
  assert.equal(scripts['deploy:abbott:rollback'], 'bash scripts/rollback-abbott.sh');
  assert.equal(scripts['ci:verify'], 'npm run predeploy:verify');
  const predeploy = read('scripts/predeploy-verify.sh');
  assert.match(predeploy, /npm run test:abbott-contract/);
  assert.match(scripts['test:abbott-runtime'], /build --workspace dashboard-abbott/);
});

test('identity proof binds launcher and release independently of listener ownership', async () => {
  const { createRuntimeInstaller } = await import('./abbott-runtime-release-remote.mjs');
  const installer = createRuntimeInstaller(RUNTIME_MANIFESTS.abbott, Object.keys(runtime));
  const row = { name: 'dashboard-abbott', pid: 123, pm_id: 7, pm2_env: { pm_exec_path: '/usr/bin/env', pm_cwd: '/var/www/dashboard-abbott/apps/abbott', args: ['-i', 'PATH=/usr/local/bin:/usr/bin:/bin', '/usr/bin/node', '/var/www/.dashboard-abbott-launcher.cjs'], uid: 'dashboard-abbott', gid: 'dashboard-abbott', RUNTIME_RELEASE_ID: 'b'.repeat(32), RUNTIME_RELEASE_SOURCE_SHA: 'a'.repeat(40) } };
  const readText = name => name.endsWith('/status') ? 'Uid:\t1001\t1001\t1001\t1001\nGid:\t1001\t1001\t1001\t1001\n' : name.endsWith('/stat') ? `123 (node) ${['S', ...Array(18).fill('0'), '300'].join(' ')}` : name.endsWith('/cmdline') ? '/usr/bin/node\0/var/www/.dashboard-abbott-launcher.cjs\0' : name.endsWith('/boot_id') ? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\n' : 'a'.repeat(40) + '\n';
  const args = [[row], { uid: 1001, gid: 1001 }, readText, () => '/var/www/dashboard-abbott/apps/abbott'];
  const proof = installer.captureRuntimeIdentity(...args);
  assert.equal(proof.sourceSha, 'a'.repeat(40));
  assert.equal(proof.script, '/var/www/.dashboard-abbott-launcher.cjs');
  assert.ok(!Object.hasOwn(proof, 'listener'));
  const changedTitle = installer.captureRuntimeIdentity(args[0], args[1], name => name.endsWith('/cmdline') ? 'next-server (v16.1.6)\0' : readText(name), args[3]);
  assert.deepEqual(changedTitle, proof, 'Next changes process.title; proof must use stable launcher metadata');
  const badRow = { ...row, pm2_env: { ...row.pm2_env, args: ['-i', 'PATH=/usr/local/bin:/usr/bin:/bin', '/usr/bin/node', '/var/www/other-launcher.cjs'] } };
  assert.throws(() => installer.captureRuntimeIdentity([badRow], args[1], readText, args[3]), /registration identity/);
  assert.deepEqual(installer.captureRuntimeRegistration([{ ...row, pid: 0, pm2_env: { ...row.pm2_env, status: 'waiting restart' } }], args[1]), proof.registration);
  assert.deepEqual(installer.releaseCommandEnvironment({ scope: 'abbott', id: 'b'.repeat(32), sourceSha: 'a'.repeat(40) }), { RUNTIME_RELEASE_ID: 'b'.repeat(32), RUNTIME_RELEASE_SOURCE_SHA: 'a'.repeat(40) });
  assert.throws(() => installer.releaseCommandEnvironment({ scope: 'other', id: 'b'.repeat(32), sourceSha: 'a'.repeat(40) }));
  assert.throws(() => installer.assertRuntimeListener(proof, ''), /listener ownership/);
  const listener = 'LISTEN 0 511 127.0.0.1:3004 0.0.0.0:* users:(("node",pid=123,fd=18))';
  installer.assertRuntimeListener(proof, listener);
  for (const invalid of [listener.replace('pid=123', 'pid=456'), listener.replace('127.0.0.1:3004', '0.0.0.0:3004'), listener + '\n' + listener]) assert.throws(() => installer.assertRuntimeListener(proof, invalid));
});
test('acknowledged worker exposes only the generic include-shape refusal',async()=>{for(const reason of ['include','include_forged','include_private']){const f=fixture();try{f.platform.deploymentPreflight=note=>{note('preflight_nginx',reason);throw Object.assign(Error('private-token'),{stage:'complete',reason:'include_private',stdout:'private-token'});};const result=await f.installer.transactAcknowledged({action:'inspect'},new AbortController().signal,f.platform);assert.deepEqual(JSON.parse(JSON.stringify(result)),{status:'REFUSED',record:null,diagnostic:{stage:'preflight_nginx',reason:reason==='include'?'include':'unknown'}});assert.equal(f.events.length,0);assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),false);assert.doesNotMatch(JSON.stringify(result),/private/);}finally{f.cleanup();}}});
