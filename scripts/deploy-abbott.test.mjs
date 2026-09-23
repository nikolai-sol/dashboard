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

test('cold local authority has one fixed closed schema and the exact authorized successor binding',async()=>{
 const m=await import(modulePath),off={version:1,scope:'abbott',armed:false,expectedCurrent:null},current={id:'a'.repeat(32),sourceSha:'b'.repeat(40),manifestDigest:'c'.repeat(64)},on={...off,armed:true,expectedCurrent:current};
 assert.deepEqual(m.validateColdCurrentAuthority(off),off);assert.deepEqual(m.validateColdCurrentAuthority(on),on);
 for(const value of [null,{}, {...off,extra:1},{...off,version:2},{...off,scope:'zaruku'},{...off,armed:'false'},{...off,expectedCurrent:current},{...on,expectedCurrent:null},...['id','sourceSha','manifestDigest'].map(k=>({...on,expectedCurrent:{...current,[k]:'F'.repeat(current[k].length)}})),{...on,expectedCurrent:{...current,path:'/tmp'}}])assert.throws(()=>m.validateColdCurrentAuthority(value));
 assert.deepEqual(JSON.parse(read('deploy/abbott/cold-current.json')),{version:1,scope:'abbott',armed:true,expectedCurrent:{id:'1fdaecbdad47430a9d1375566abad001',sourceSha:'dfd6267a742d1c7d88ccac636b89661df9b96f9f',manifestDigest:'586533387dca0928c75d6e9807503e918d316507b6f1ec128e087e075211690e'}});
 const args=[path.join(root,'deploy/abbott/release.json'),'cold-restore-current'];
 assert.equal(m.validateInvocation(args,{}).action,'cold-restore-current');
 for(const key of ['COLD_CURRENT_PATH','COLD_CURRENT_AUTHORITY','EXPECTED_CURRENT_ID','EXPECTED_CURRENT_SOURCE_SHA','EXPECTED_CURRENT_MANIFEST_DIGEST'])assert.throws(()=>m.validateInvocation(args,{[key]:'injected'}),/override/);
 for(const action of ['cold-restore-other','force'])assert.throws(()=>m.validateInvocation([args[0],action],{}));
});
function coldDriver(value,{changed=false,badResult=false}={}){
 const calls=[],paths=[],context={fs,path,os,createHash,randomUUID,isDeepStrictEqual,Buffer,RUNTIME_MANIFESTS,calls,paths,cold:value,changed,badResult,process:{argv:['node','driver',path.join(root,'deploy/abbott/release.json'),'cold-restore-current'],env:{},getuid:()=>501,geteuid:()=>501},console:{log:value=>calls.push(['log',value])},testRoot:root};
 const source=read('scripts/abbott-deploy-runtime.mjs').replace(/^import .*;\n/gm,'').replaceAll('export function ','function ').replaceAll('export const ','const ').replace("const ROOT = path.resolve(import.meta.dirname, '..');",'const ROOT=testRoot;').split('\nif (process.argv[1]')[0];
 vm.createContext(context);vm.runInContext(source+`
 validateInvocation=()=>({authority:RUNTIME_MANIFESTS.abbott,action:'cold-restore-current'});
 repositoryFor=()=>({version:1,url:'git@github.com:nikolai-sol/dashboard.git',ref:'refs/heads/release/abbott',base:'d'.repeat(40)});
 git=()=>'';let reads=0;
 regular=filename=>{paths.push(filename);if(filename!==path.join(ROOT,'deploy/abbott/cold-current.json'))throw Error('not fixed cold path');reads++;return Buffer.from(JSON.stringify(changed&&reads>1?{...cold,expectedCurrent:{...cold.expectedCurrent,id:'f'.repeat(32)}}:cold));};
 approvedSource=()=>{calls.push(['approved']);return 'e'.repeat(40);};
 verifySource=(a,r,active,approved)=>{calls.push(['verify',active,approved]);return approved;};
 validateAuthority=()=>RUNTIME_MANIFESTS.abbott;
 prepareTransport=()=>{calls.push(['transport']);return async request=>{calls.push(['request',JSON.parse(JSON.stringify(request))]);return {...cold.expectedCurrent,id:badResult?'f'.repeat(32):cold.expectedCurrent.id,scope:'abbott'};};};
 build=preparePayload=()=>{throw Error('forbidden cold build');};this.run=main;`,context);
 return {run:context.run,calls,paths};
}
test('cold local unarmed refusal occurs before approved ref or SSH preparation',async()=>{
 const f=coldDriver({version:1,scope:'abbott',armed:false,expectedCurrent:null});
 await assert.rejects(f.run(),/unarmed/);assert.deepEqual(f.calls,[]);assert.deepEqual(f.paths,[path.join(root,'deploy/abbott/cold-current.json')]);
});
test('cold local armed dispatch sends exact current authority without live inspect or build',async()=>{
 const authority={version:1,scope:'abbott',armed:true,expectedCurrent:{id:'a'.repeat(32),sourceSha:'b'.repeat(40),manifestDigest:'c'.repeat(64)}};
 const f=coldDriver(authority);await f.run();
 const requests=f.calls.filter(c=>c[0]==='request');assert.equal(requests.length,1);assert.deepEqual(JSON.parse(JSON.stringify(requests[0][1])),{action:'cold-restore-current',expectedCurrent:authority.expectedCurrent});
 assert.equal(f.calls.filter(c=>c[0]==='approved').length,2);assert.ok(f.calls.filter(c=>c[0]==='verify').every(c=>c[1]===authority.expectedCurrent.sourceSha));
 assert.ok(f.paths.length>=2);assert.ok(f.paths.every(p=>p===path.join(root,'deploy/abbott/cold-current.json')));
 assert.deepEqual(f.calls.at(-1),['log','ABBOTT_DEPLOY_COMMITTED stage=complete reason=none']);
 for(const options of [{changed:true},{badResult:true}]){const bad=coldDriver(authority,options);await assert.rejects(bad.run());assert.equal(bad.calls.some(c=>c[0]==='log'),false);if(options.changed)assert.equal(bad.calls.some(c=>c[0]==='request'),false);}
});
test('cold fixed wrapper rejects arguments and delegates only inside an inert private fixture',()=>{
 const wrapper=path.join(root,'scripts/restore-abbott-current.sh');assert.ok(fs.existsSync(wrapper));
 const argument=spawnSync('/bin/bash',[wrapper,'force'],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8'});assert.equal(argument.status,1);assert.match(argument.stderr,/accepts no arguments/);
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'abbott-cold-wrapper-'));
 try{
  assert.equal(fs.statSync(fixture).mode&0o077,0);
  const scripts=path.join(fixture,'scripts'),fixtureWrapper=path.join(scripts,'restore-abbott-current.sh'),stub=path.join(scripts,'abbott-deploy-runtime.sh'),record=stub+'.args';
  fs.mkdirSync(scripts,{mode:0o700});fs.mkdirSync(path.join(fixture,'deploy/abbott'),{recursive:true,mode:0o700});
  fs.writeFileSync(fixtureWrapper,fs.readFileSync(wrapper),{mode:0o700});
  fs.writeFileSync(path.join(fixture,'deploy/abbott/release.json'),'{}\n',{mode:0o600});
  for(const status of [0,7]){
   // This inert sibling records arguments only. It never loads the real driver.
   fs.writeFileSync(stub,`#!/bin/bash\nprintf '%s\\n' "$@" > "$0.args"\nprintf 'fixture result\\n'\nprintf 'fixture diagnostic\\n' >&2\nexit ${status}\n`,{mode:0o700});
   const rejected=spawnSync('/bin/bash',[fixtureWrapper,'force'],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8'});assert.equal(rejected.status,1);assert.match(rejected.stderr,/accepts no arguments/);assert.equal(fs.existsSync(record),false);
   const result=spawnSync('/bin/bash',[fixtureWrapper],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8'});
   assert.equal(result.status,status);assert.equal(result.stdout,'fixture result\n');assert.equal(result.stderr,'fixture diagnostic\n');
   assert.deepEqual(fs.readFileSync(record,'utf8').split('\n'),[fs.realpathSync(scripts)+'/../deploy/abbott/release.json','cold-restore-current','']);
   fs.unlinkSync(record);
  }
 }finally{fs.rmSync(fixture,{recursive:true,force:true});}
 assert.equal(fs.existsSync(fixture),false);
 assert.equal(JSON.parse(read('package.json')).scripts['restore:abbott:current'],'bash scripts/restore-abbott-current.sh');
});

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
  let saved = [], backup = [], neighbors = [], bootId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const clone = value => JSON.parse(JSON.stringify(value));
  const definitions = () => [...clone(neighbors), ...(processRow ? [{...clone(processRow.pm2_env), name:processRow.name, pm_id:processRow.pm_id}] : [])];
  let nextStartup = 'ready', startup = 'ready', listening = false;
  const events = [];
  const processText = filename => {
    if (filename.endsWith('/status')) return 'Uid:\t1001\t1001\t1001\t1001\nGid:\t1001\t1001\t1001\t1001\n';
    if (filename.endsWith('/stat')) return `${serial} (node) ${['S', ...Array(18).fill('0'), String(serial)].join(' ')}`;
    if (filename.endsWith('/boot_id')) return bootId+'\n';
    if (filename.endsWith('/cmdline')) return '/usr/bin/node\0/var/www/.dashboard-abbott-launcher.cjs\0';
    if (filename.endsWith('/.release-source-sha')) return fs.readFileSync(map(filename), 'utf8');
    throw new Error('unexpected fixture process read');
  };
  const platform = {
    startupState: () => clone({live:definitions(), saved, backup}),
    async saveStartup() { events.push(['save']); backup=clone(saved);saved=definitions(); },
    deploymentPreflight() {return platform.snapshot();},
    coldPreflight(expected) {const record=context.installer.inspectActiveRuntime();assert.deepEqual({id:record.id,sourceSha:record.sourceSha,manifestDigest:record.manifestDigest},{...expected});return {record};},
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
      Object.assign(processRow.pm2_env,{PORT:3004,HOSTNAME:'127.0.0.1'});
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
  return { installer: context.installer, platform, events, map, io, context, payload,
    makeCold:()=>{processRow=null;listening=false;saved=clone(neighbors);backup=clone(neighbors);},
    saved:()=>clone(saved), backup:()=>clone(backup),
    neighbors:rows=>{neighbors=clone(rows);saved=clone(rows);backup=clone(rows);},
    mutateNeighbors:fn=>fn(neighbors), mutateSaved:fn=>fn(saved), mutateBackup:fn=>fn(backup),
    restart:({fallback=false}={})=>{const rows=(fallback?backup:saved).filter(r=>r.name==='dashboard-abbott');assert.ok(rows.length<=1);bootId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';processRow=rows.length?{name:'dashboard-abbott',pid:++serial,pm_id:serial,pm2_env:{...clone(rows[0]),status:'online'}}:null;listening=Boolean(processRow);},
    exitProcess:()=>{processRow=null;listening=false;}, mutateRow: fn=>fn(processRow), nextStartup: value => { nextStartup = value; }, failHealth: () => { healthFailure = true; }, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

const coldRequest=r=>({action:'cold-restore-current',expectedCurrent:{id:r.id,sourceSha:r.sourceSha,manifestDigest:r.manifestDigest}});
test('cold environment read wipes its buffer on stable-read attestation failure',async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);f.makeCold();f.events.length=0;
  const open=f.io.openSync,read=f.io.readFileSync,stat=f.io.fstatSync;let targetFd,bytes;
  f.io.openSync=(file,...args)=>{const fd=open(file,...args);if(file==='/var/www/dashboard-abbott/.env')targetFd=fd;return fd;};
  f.io.readFileSync=(file,...args)=>{const value=read(file,...args);if(file===targetFd)bytes=value;return value;};
  f.io.fstatSync=(fd,...args)=>{const value=stat(fd,...args);if(fd===targetFd)value.ino+=typeof value.ino==='bigint'?1n:1;return value;};
  const result=await f.installer.transactAcknowledged(coldRequest(old),new AbortController().signal,f.platform);
  assert.equal(result.status,'REFUSED');assert.ok(Buffer.isBuffer(bytes)&&bytes.length>0);assert.ok(bytes.every(b=>b===0));
  assert.equal(f.events.filter(e=>['fresh','save','stop','delete'].includes(e[0])).length,0);assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),false);
 }finally{f.cleanup();}
});
for(const mode of ['cancel','environment'])test(`cold start journal rechecks ${mode} before process creation`,async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);f.makeCold();f.events.length=0;
  const abort=new AbortController(),rename=f.io.renameSync;
  f.io.renameSync=(a,b)=>{const result=rename(a,b);if(b.includes('/cold-current-')&&JSON.parse(fs.readFileSync(f.map(b),'utf8')).state==='starting'){if(mode==='cancel')abort.abort();else fs.appendFileSync(f.map('/var/www/dashboard-abbott/.env'),'\n');}return result;};
  const result=await f.installer.transactAcknowledged(coldRequest(old),abort.signal,f.platform);
  assert.equal(result.status,'REFUSED');assert.equal(f.events.filter(e=>['fresh','save','stop','delete'].includes(e[0])).length,0);assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),false);
 }finally{f.cleanup();}
});
test('cold current restores exact stored release and both startup copies',async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40)),binding:{sourceSha:'a'.repeat(40),runId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}},f.platform);
  f.makeCold();f.events.length=0;
  const receiptPath=f.map('/var/www/.dashboard-abbott-control/ownership-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json'),receipt=fs.readFileSync(receiptPath);
  const pointer=fs.readFileSync(f.map('/var/www/.dashboard-abbott-control/current.json')),env=fs.readFileSync(f.map('/var/www/dashboard-abbott/.env'));
  const result=await f.installer.transactAcknowledged(coldRequest(old),new AbortController().signal,f.platform);
  assert.equal(result.status,'COMMITTED');assert.equal(result.record.id,old.id);
  assert.deepEqual(fs.readFileSync(f.map('/var/www/.dashboard-abbott-control/current.json')),pointer);assert.deepEqual(fs.readFileSync(f.map('/var/www/dashboard-abbott/.env')),env);
  assert.equal(f.events.filter(e=>e[0]==='save').length,2);
  assert.deepEqual(fs.readFileSync(receiptPath),receipt);
  assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),false);
  for(const fallback of [false,true]){f.restart({fallback});assert.equal(f.platform.snapshot().registration.releaseId,old.id);}
 }finally{f.cleanup();}
});
test('failed cold health compensates to absent Abbott, not a healthy predecessor',async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);f.makeCold();f.failHealth();
  const result=await f.installer.transactAcknowledged(coldRequest(old),new AbortController().signal,f.platform);
  assert.equal(result.status,'RESTORED');assert.equal(result.record,null);
  for(const fallback of [false,true]){f.restart({fallback});assert.equal(f.platform.snapshot(),null);}
  assert.equal(f.installer.inspectActiveRuntime().id,old.id);
 }finally{f.cleanup();}
});

for(const mode of ['extra','force','action','id','sourceSha','manifestDigest','missing_current','live','saved','backup','missing_backup','missing_primary','missing_live','listener','tree','receipt','browser','account','lock','neighbor'])test(`cold refusal before start: ${mode}`,async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),definition=f.saved()[0];
  if(mode!=='live')f.makeCold();f.events.length=0;
  const request=coldRequest(old),pointer=f.map('/var/www/.dashboard-abbott-control/current.json'),env=f.map('/var/www/dashboard-abbott/.env'),tree=f.map('/var/www/dashboard-abbott/apps/abbott/server.js'),lock=f.map('/var/www/.dashboard-abbott-deploy.lock');
  if(mode==='extra')request.payload={};if(mode==='force')request.force=true;if(mode==='action')request.action='cold-restore-other';
  if(['id','sourceSha','manifestDigest'].includes(mode))request.expectedCurrent[mode]='f'.repeat(request.expectedCurrent[mode].length);
  if(mode==='missing_current')fs.unlinkSync(pointer);
  if(mode==='saved')f.mutateSaved(rows=>rows.push(definition));if(mode==='backup')f.mutateBackup(rows=>rows.push(definition));
  if(mode==='missing_backup'){const state=f.platform.startupState;f.platform.startupState=()=>({...state(),backup:null});}
  if(mode==='missing_primary'||mode==='missing_live'){const state=f.platform.startupState,key=mode==='missing_primary'?'saved':'live',decode=vm.runInContext('value=>JSON.parse(value)',f.context);f.platform.startupState=()=>decode(JSON.stringify({...state(),[key]:null}));}
  if(mode==='listener')f.platform.assertNoListener=async()=>{throw Error('occupied');};
  if(mode==='tree')fs.appendFileSync(tree,'corrupt');
  if(['receipt','browser'].includes(mode))f.platform.coldPreflight=()=>{throw Error('synthetic external proof refusal');};
  if(mode==='account')f.platform.account=()=>({uid:0,gid:0});
  if(mode==='lock'){fs.mkdirSync(lock,{mode:0o700});fs.writeFileSync(path.join(lock,'owner'),'foreign');}
  if(mode==='neighbor')f.mutateSaved(rows=>rows.push({name:'foreign',env:{secret:'synthetic'}}));
  const before={pointer:fs.existsSync(pointer)?fs.readFileSync(pointer):null,env:fs.readFileSync(env),tree:fs.readFileSync(tree),saved:f.saved(),backup:f.backup()};
  const result=await f.installer.transactAcknowledged(request,new AbortController().signal,f.platform);
  assert.equal(result.status,'REFUSED');assert.equal(result.record,null);
  assert.equal(f.events.filter(e=>['fresh','start','stop','delete','save'].includes(e[0])).length,0);
  assert.deepEqual(f.saved(),before.saved);assert.deepEqual(f.backup(),before.backup);
  assert.deepEqual(fs.existsSync(pointer)?fs.readFileSync(pointer):null,before.pointer);assert.deepEqual(fs.readFileSync(env),before.env);assert.deepEqual(fs.readFileSync(tree),before.tree);
  assert.equal(fs.existsSync(lock),mode==='lock');if(mode==='lock')assert.equal(fs.readFileSync(path.join(lock,'owner'),'utf8'),'foreign');
 }finally{f.cleanup();}
});

for(const field of ['live','saved'])for(const boundary of ['under_lock','after_health'])test(`cold raw ${field} must remain available ${boundary}`,async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);f.makeCold();f.events.length=0;
  const pointer=f.map('/var/www/.dashboard-abbott-control/current.json'),env=f.map('/var/www/dashboard-abbott/.env'),tree=f.map('/var/www/dashboard-abbott/apps/abbott/server.js');
  const before={pointer:fs.readFileSync(pointer),env:fs.readFileSync(env),tree:fs.readFileSync(tree),saved:f.saved(),backup:f.backup()};
  const state=f.platform.startupState,health=f.platform.health,decode=vm.runInContext('value=>JSON.parse(value)',f.context);let calls=0,unavailable=false;
  f.platform.health=async proof=>{await health(proof);unavailable=true;};
  f.platform.startupState=()=>{const raw=state();calls++;return decode(JSON.stringify(boundary==='under_lock'&&calls===2||boundary==='after_health'&&unavailable?{...raw,[field]:null}:raw));};
  const result=await f.installer.transactAcknowledged(coldRequest(old),new AbortController().signal,f.platform);
  assert.equal(result.status,boundary==='under_lock'?'REFUSED':'REVIEW_REQUIRED');assert.equal(result.record,null);
  if(boundary==='under_lock'){assert.equal(calls,2);assert.equal(f.events.filter(e=>['fresh','start','stop','delete','save'].includes(e[0])).length,0);}
  else{assert.equal(f.events.filter(e=>e[0]==='fresh').length,1);assert.equal(f.events.filter(e=>e[0]==='stop').length,1);assert.equal(f.events.filter(e=>e[0]==='delete').length,1);assert.equal(f.events.filter(e=>e[0]==='save').length,0);}
  assert.equal(f.platform.registration(),null);assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),boundary==='after_health');
  for(const key of ['pointer','env','tree'])assert.deepEqual(fs.readFileSync({pointer,env,tree}[key]),before[key]);
  assert.deepEqual(f.saved(),before.saved);assert.deepEqual(f.backup(),before.backup);
 }finally{f.cleanup();}
});

for(const mode of ['partial','partial_foreign','health','save_before','save_after','second_save','readback','backup_readback','persistent_save','cancel_health','cancel_save1','cancel_save2','neighbor_env','neighbor_policy','replacement','env','pointer','receipt','journal_before_save','journal_prepared_failure'])test(`cold failure compensation: ${mode}`,async()=>{
 const f=fixture();try{
  const neighbors=[{name:'neighbor',env:{VALUE:'before'},autorestart:true}];f.neighbors(neighbors);
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);f.makeCold();f.events.length=0;
  const abort=new AbortController(),pointer=f.map('/var/www/.dashboard-abbott-control/current.json'),env=f.map('/var/www/dashboard-abbott/.env'),tree=f.map('/var/www/dashboard-abbott/apps/abbott/server.js');
  const receipt=f.map('/var/www/.dashboard-abbott-control/ownership-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json');fs.writeFileSync(receipt,'synthetic receipt',{mode:0o600});
  const before={pointer:fs.readFileSync(pointer),env:fs.readFileSync(env),tree:fs.readFileSync(tree),receipt:fs.readFileSync(receipt)};
  const health=f.platform.health,save=f.platform.saveStartup,rename=f.io.renameSync;let saveCalls=0,changed=false;
  if(mode==='partial')f.nextStartup('early:error match');if(mode==='partial_foreign')f.nextStartup('early:error mismatch');if(mode==='health')f.failHealth();
  f.platform.health=async proof=>{
   await health(proof);
   if(mode==='cancel_health')abort.abort();
   if(mode==='replacement'){f.mutateRow(row=>{row.pid+=100;});throw Error('replaced');}
   if(mode==='neighbor_env'||mode==='neighbor_policy'){f.mutateNeighbors(rows=>{if(mode==='neighbor_env')rows[0].env.VALUE='after';else rows[0].autorestart=false;});changed=true;}
   if(['env','pointer','receipt'].includes(mode)){fs.appendFileSync({env,pointer,receipt}[mode],'\n');changed=true;}
  };
  f.platform.saveStartup=async()=>{
   saveCalls++;
   if(mode==='persistent_save'||mode==='save_before'&&saveCalls===1||mode==='second_save'&&saveCalls===2)throw Error('save failed');
   await save();
   if(mode==='save_after'&&saveCalls===1)throw Error('save wrote then failed');
   if(mode==='readback'&&saveCalls===1)f.mutateSaved(rows=>{rows.find(r=>r.name==='dashboard-abbott').PORT=9999;});
   if(mode==='backup_readback'&&saveCalls===2)f.mutateBackup(rows=>{rows.find(r=>r.name==='dashboard-abbott').PORT=9999;});
   if(mode==='cancel_save1'&&saveCalls===1||mode==='cancel_save2'&&saveCalls===2)abort.abort();
  };
  f.io.renameSync=(a,b)=>{
   if(!changed&&b.includes('/cold-current-')){
    const j=JSON.parse(fs.readFileSync(f.map(a),'utf8'));
    if(mode==='journal_prepared_failure'&&j.state==='prepared'){changed=true;throw Error('before journal publish');}
    if(mode==='journal_before_save'&&j.state==='persisting_primary'){changed=true;fs.appendFileSync(env,'\n');}
   }
   return rename(a,b);
  };
  const result=await f.installer.transactAcknowledged(coldRequest(old),abort.signal,f.platform);
  const review=['partial_foreign','persistent_save','neighbor_env','neighbor_policy','replacement','env','pointer','receipt','journal_before_save'].includes(mode);
  assert.equal(result.status,mode==='journal_prepared_failure'?'REFUSED':review?'REVIEW_REQUIRED':'RESTORED');assert.equal(result.record,null);
  assert.equal(f.events.filter(e=>e[0]==='fresh').length,mode==='journal_prepared_failure'?0:1);
  const foreign=['partial_foreign','replacement'].includes(mode);
  assert.equal(f.events.filter(e=>e[0]==='stop').length,mode==='journal_prepared_failure'||foreign?0:1);
  assert.equal(f.events.filter(e=>e[0]==='delete').length,mode==='journal_prepared_failure'||foreign?0:1);
  assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),review);
  if(!foreign)assert.equal(f.platform.registration(),null);
  const expectedSaves=({save_before:2,save_after:3,second_save:3,readback:3,backup_readback:4,cancel_save1:3,cancel_save2:4})[mode]??(review||mode==='journal_prepared_failure'?0:2);
  assert.equal(f.events.filter(e=>e[0]==='save').length,expectedSaves);
  for(const rows of [f.saved(),f.backup()]){assert.equal(rows.some(r=>r.name==='dashboard-abbott'),false);assert.deepEqual(rows,neighbors);}
  for(const key of ['pointer','env','tree','receipt']){
   const expected=mode===key||mode==='journal_before_save'&&key==='env'?Buffer.concat([before[key],Buffer.from('\n')]):before[key];
   assert.deepEqual(fs.readFileSync({pointer,env,tree,receipt}[key]),expected);
  }
  const files=fs.readdirSync(f.map('/var/www/.dashboard-abbott-control')).filter(n=>n.startsWith('cold-current-'));
  if(mode==='journal_prepared_failure')assert.deepEqual(files,[]);
  for(const file of files){const journal=JSON.parse(fs.readFileSync(f.map('/var/www/.dashboard-abbott-control/'+file),'utf8'));assert.deepEqual(Object.keys(journal).sort(),['action','directory','expectedCurrent','owner','state','version']);assert.doesNotMatch(JSON.stringify(journal),/DB_PASSWORD|envDigest|synthetic/);}
 }finally{f.cleanup();}
});

test('healthy first deployment survives restart from primary and backup startup lists',async()=>{
 const f=fixture();try{
  const record=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);
  for(const rows of [f.saved(),f.backup()]){assert.equal(rows.length,1);assert.equal(rows[0].PORT,3004);assert.equal(rows[0].HOSTNAME,'127.0.0.1');}
  for(const fallback of [false,true]){f.restart({fallback});assert.equal(f.platform.snapshot()?.registration.releaseId,record.id);assert.equal(f.platform.snapshot().sourceSha,record.sourceSha);assert.equal(f.platform.snapshot().cwd,'/var/www/dashboard-abbott/apps/abbott');}
 }finally{f.cleanup();}
});

test('real PM2 persistence adapter reads owned default-mode dumps and saves through fixed PM2 home',async()=>{
 const f=fixture();try{
  fs.mkdirSync(f.map('/root/.pm2'),{recursive:true,mode:0o700});
  const dump=f.map('/root/.pm2/dump.pm2'),backup=dump+'.bak',rows=[{name:'other',pm2_env:{name:'other',pm_exec_path:'/usr/bin/node',env:{SYNTHETIC:'fixture'}}}];
  fs.writeFileSync(dump,'[]',{mode:0o644});const calls=[];
  f.context.execFileSync=(bin,args,options)=>{assert.equal(bin,'pm2');assert.equal(options.env.PM2_HOME,'/root/.pm2');calls.push(args);
    if(args[0]==='jlist')return JSON.stringify(rows);
    assert.deepEqual(Array.from(args),['save','--force']);fs.copyFileSync(dump,backup);fs.writeFileSync(dump,JSON.stringify(rows.map(row=>row.pm2_env)));return '';
  };
  const platform=f.installer.interruptedRecoveryTools().platform;
  assert.deepEqual(JSON.parse(JSON.stringify(platform.startupState().saved)),[]);
  await platform.saveStartup();await platform.saveStartup();
  const state=platform.startupState();assert.deepEqual(JSON.parse(JSON.stringify(state.live)),rows.map(row=>row.pm2_env));assert.deepEqual(state.live,state.saved);assert.deepEqual(state.saved,state.backup);assert.equal(calls.filter(args=>args[0]==='save').length,2);
 }finally{f.cleanup();}
});

test('successor and explicit rollback persist exactly the selected release',async()=>{
 const f=fixture();try{
  const first=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform);
  const second=await f.installer.transact({action:'deploy',expectedActiveSha:first.sourceSha,payload:f.payload('b'.repeat(40))},f.platform);
  f.restart();assert.equal(f.platform.snapshot()?.registration.releaseId,second.id);
  await f.installer.transact({action:'rollback',expectedActiveSha:second.sourceSha},f.platform);
  f.restart({fallback:true});assert.equal(f.platform.snapshot()?.registration.releaseId,first.id);
 }finally{f.cleanup();}
});

for(const failure of ['health','save_before','save_after','readback','interrupt_before','interrupt_after','permanent_save'])test(`startup failure ${failure} cannot acknowledge a live-only deployment`,async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),abort=new AbortController();
  const save=f.platform.saveStartup;let hit=false;
  if(failure==='health')f.nextStartup('fail');
  else f.platform.saveStartup=async()=>{if(hit&&failure!=='permanent_save')return save();hit=true;if(failure==='save_before'||failure==='permanent_save')throw Error('private');if(failure==='interrupt_before')abort.abort();await save();if(failure==='save_after')throw Error('private');if(failure==='readback')f.mutateSaved(rows=>rows.find(r=>r.name==='dashboard-abbott').RUNTIME_RELEASE_ID='d'.repeat(32));if(failure==='interrupt_after')abort.abort();};
  const result=await f.installer.transactAcknowledged({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},abort.signal,f.platform);
  assert.equal(result.status,failure==='permanent_save'?'REVIEW_REQUIRED':'RESTORED');
  if(result.status==='RESTORED')for(const fallback of [false,true]){f.restart({fallback});assert.equal(f.platform.snapshot()?.registration.releaseId,old.id);assert.equal(f.installer.inspectActiveRuntime().id,old.id);}
 }finally{f.cleanup();}
});

test('failed first install clears candidate from primary and backup startup lists',async()=>{
 const f=fixture();try{const save=f.platform.saveStartup;let failed=false;f.platform.saveStartup=async()=>{await save();if(!failed){failed=true;throw Error('private');}};
  const result=await f.installer.transactAcknowledged({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},new AbortController().signal,f.platform);
  assert.equal(result.status,'RESTORED');for(const fallback of [false,true]){f.restart({fallback});assert.equal(f.platform.snapshot(),null);}
 }finally{f.cleanup();}
});

for(const drift of [false,true])test(`shared startup definitions ${drift?'refuse neighbor drift':'preserve unrelated environment and restart policy'}`,async()=>{
 const f=fixture();try{
  const neighbors=[{name:'dashboard-zaruku',pm_exec_path:'/usr/bin/node',pm_cwd:'/var/www/dashboard-zaruku',args:['server.js'],uid:984,gid:991,env:{PRIVATE:'fixture-value'},autorestart:true,restart_delay:700}];f.neighbors(neighbors);
  if(drift)f.mutateNeighbors(rows=>rows[0].env.PRIVATE='changed');
  const result=await f.installer.transactAcknowledged({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},new AbortController().signal,f.platform);
  assert.equal(result.status,drift?'REFUSED':'COMMITTED');
  assert.deepEqual(f.saved().filter(r=>r.name!=='dashboard-abbott'),neighbors);assert.deepEqual(f.backup().filter(r=>r.name!=='dashboard-abbott'),neighbors);
  if(drift){assert.equal(result.diagnostic.reason,'neighbor_saved_drift');assert.equal(f.events.filter(e=>['fresh','save','stop'].includes(e[0])).length,0);}
 }finally{f.cleanup();}
});

test('backup readback failure compensates both startup copies',async()=>{
 const f=fixture();try{
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),save=f.platform.saveStartup;let saves=0;
  f.platform.saveStartup=async()=>{await save();if(++saves===2)f.mutateBackup(rows=>rows.find(r=>r.name==='dashboard-abbott').RUNTIME_RELEASE_ID='f'.repeat(32));};
  const result=await f.installer.transactAcknowledged({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},new AbortController().signal,f.platform);
  assert.equal(result.status,'RESTORED');for(const fallback of [false,true]){f.restart({fallback});assert.equal(f.platform.snapshot().registration.releaseId,old.id);}
 }finally{f.cleanup();}
});

for(const boundary of ['before_save','after_save'])test(`concurrent neighbor change ${boundary} preserves new state and requires review`,async()=>{
 const f=fixture();try{
  f.neighbors([{name:'other',env:{PRIVATE:'original'},restart_delay:100}]);
  const old=await f.installer.transact({action:'deploy',expectedActiveSha:null,payload:f.payload('a'.repeat(40))},f.platform),save=f.platform.saveStartup,health=f.platform.health;let changed=false;
  const drift=()=>{if(!changed){changed=true;f.mutateNeighbors(rows=>rows[0].env.PRIVATE='newer');}};
  if(boundary==='before_save')f.platform.health=async proof=>{await health(proof);if(proof.sourceSha!==old.sourceSha)drift();};
  else f.platform.saveStartup=async()=>{drift();await save();};
  const result=await f.installer.transactAcknowledged({action:'deploy',expectedActiveSha:old.sourceSha,payload:f.payload('b'.repeat(40))},new AbortController().signal,f.platform);
  assert.equal(result.status,'REVIEW_REQUIRED');assert.equal(fs.existsSync(f.map('/var/www/.dashboard-abbott-deploy.lock')),true);
  assert.equal(f.platform.startupState().live.find(r=>r.name==='other').env.PRIVATE,'newer');
  assert.equal(f.saved().find(r=>r.name==='other').env.PRIVATE,boundary==='before_save'?'original':'newer');
 }finally{f.cleanup();}
});

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
    // The now-real fixture preflight detects this forged process before the lock check.
    await assert.rejects(f.installer.transact({ action: 'rollback', expectedActiveSha: old.sourceSha }, f.platform), /Runtime source identity mismatch/);
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
