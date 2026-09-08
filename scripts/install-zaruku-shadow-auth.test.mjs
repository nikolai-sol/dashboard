import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installShadowAuth, validateAuthDescriptor, createAuthAdapter } from './zaruku-shadow-auth-implementation.mjs';

const cookie = Buffer.from('opaque-auth-fixture').toString('base64');
const bytes = Buffer.from(JSON.stringify({ headers: { cookie } }));

test('auth validator accepts only one lowercase cookie header and rejects unsafe or oversized bytes', () => {
  assert.doesNotThrow(() => validateAuthDescriptor(bytes));
  const invalid = [
    { headers: { authorization: cookie } }, { headers: { host: cookie } },
    { headers: { cookie }, other: true }, { headers: { cookie, other: 'x' } },
    { headers: { cookie: `${cookie}\n` } }, { headers: { cookie: `${cookie}\r` } },
    { headers: { cookie: '' } }, { headers: { Cookie: cookie } }, { headers: { cookie: 'x'.repeat(4097) } },
  ].map(value => Buffer.from(JSON.stringify(value)));
  invalid.push(Buffer.from([0xff]), Buffer.alloc(65537), Buffer.from(`{"headers":{"cookie":"${cookie}","cookie":"x"}}`));
  for (const input of invalid) assert.throws(() => validateAuthDescriptor(input), error => error.message === 'Invalid Zaruku auth descriptor' && !error.stack.includes(cookie));
});

test('installer reads stdin only with echo disabled and restored, prints status and descriptor SHA only', async () => {
  const events = [];
  const adapter = {
    currentIdentity: () => ({ uid: 0, euid: 0 }),
    isTerminal: () => true,
    disableEcho: () => { events.push('echo-off'); return 'terminal-state'; },
    restoreEcho: state => { assert.equal(state, 'terminal-state'); events.push('echo-restored'); },
    readStdin: () => { assert.equal(events.at(-1), 'echo-off'); events.push('read'); return bytes; },
    publishDescriptor: content => { assert.ok(content.equals(bytes)); events.push('publish'); },
  };
  const result = await installShadowAuth(adapter);
  assert.deepEqual(result, { status: 'installed', sha256: createHash('sha256').update(bytes).digest('hex') });
  assert.deepEqual(events, ['echo-off', 'read', 'publish', 'echo-restored']);
  assert.ok(!JSON.stringify(result).includes(cookie));
});

test('installer refuses terminal input if echo cannot be disabled, and restores terminal on failures', async () => {
  for (const stage of ['echo', 'read', 'publish']) {
    const events = [];
    const adapter = {
      currentIdentity: () => ({ uid: 0, euid: 0 }), isTerminal: () => true,
      disableEcho() { events.push('echo-off'); if (stage === 'echo') throw new Error(cookie); return 'saved'; },
      restoreEcho() { events.push('restore'); },
      readStdin() { events.push('read'); if (stage === 'read') throw new Error(cookie); return bytes; },
      publishDescriptor() { events.push('publish'); if (stage === 'publish') throw new Error(cookie); },
    };
    await assert.rejects(installShadowAuth(adapter), error => error.message === 'Failed to install Zaruku auth descriptor' && !error.stack.includes(cookie));
    if (stage === 'echo') assert.deepEqual(events, ['echo-off']);
    else assert.equal(events.at(-1), 'restore');
  }
});

test('auth CLI rejects arguments without echoing their bytes', () => {
  const result = spawnSync(process.execPath, ['scripts/install-zaruku-shadow-auth.mjs', cookie], { input: bytes, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.ok(!result.stderr.includes(cookie));
});

test('deprecated direct CLI paths refuse before any changed dependency side effect', async t => {
  for(const [entry,dependency,exports] of [
    ['install-zaruku-shadow-auth.mjs','zaruku-shadow-host.mjs','export const createHostAdapter=()=>({});'],
    ['zaruku-shadow-host.mjs','runtime-release-remote.mjs','export const parseZarukuSecrets=()=>{},serializeZarukuSecrets=()=>{},renderEnvironment=()=>{},HOST_DIRECTORY_MODES={};'],
    ['zaruku-shadow-auth-implementation.mjs','zaruku-shadow-host-implementation.mjs','export const createHostAdapter=()=>({});'],
    ['zaruku-shadow-host-implementation.mjs','runtime-release-remote.mjs','export const parseZarukuSecrets=()=>{},serializeZarukuSecrets=()=>{},renderEnvironment=()=>{},HOST_DIRECTORY_MODES={};'],
  ]) await t.test(entry,()=>{
    const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'zaruku-direct-refusal-'))),marker=path.join(directory,'dependency-ran');
    try {
      fs.copyFileSync(path.join(import.meta.dirname,entry),path.join(directory,entry));
      fs.writeFileSync(path.join(directory,dependency),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'executed');${exports}`);
      const alias=path.join(directory,'entry-alias.mjs');fs.symlinkSync(path.join(directory,entry),alias);
      for(const flags of [[],['--preserve-symlinks-main']])for(const filename of [path.join(directory,entry),alias]) {
        const result=spawnSync(process.execPath,[...flags,filename,'apply'],{input:bytes,encoding:'utf8',env:{},timeout:5000});
        assert.equal(fs.existsSync(marker),false,'changed dependency must not execute before direct refusal');
        assert.notEqual(result.status,0);assert.match(result.stderr,/staged dispatcher/);assert.equal(result.stdout,'');
      }
      for(const broken of ['argv','module']) {
        const target=path.join(directory,entry),unrelated=path.join(directory,dependency);
        const script=`import fs from 'node:fs';import {pathToFileURL} from 'node:url';const target=${JSON.stringify(target)};process.argv[1]=${JSON.stringify(broken==='argv'?path.join(directory,'missing-PRIVATE_SENTINEL'):unrelated)};const original=fs.realpathSync;if(${JSON.stringify(broken)}==='module')fs.realpathSync=(filename,...args)=>{if(filename===target)throw new Error('PRIVATE_SENTINEL');return original(filename,...args);};await import(pathToFileURL(target));`;
        const result=spawnSync(process.execPath,['--input-type=module','-e',script],{input:bytes,encoding:'utf8',env:{},timeout:5000});
        assert.equal(fs.existsSync(marker),false,'realpath uncertainty must refuse before dependency evaluation');
        assert.notEqual(result.status,0);assert.match(result.stderr,/staged dispatcher/);assert.doesNotMatch(result.stderr,/PRIVATE_SENTINEL/);assert.equal(result.stdout,'');
      }
    } finally {fs.rmSync(directory,{recursive:true});}
  });
});

test('real stdin lifecycle restores echo on interruption and removes its signal handlers', async () => {
  const stdin = new PassThrough(), signals = new EventEmitter(), calls = [];
  const adapter = createAuthAdapter({
    hostAdapter: { currentIdentity: () => ({ uid: 0, euid: 0 }), publishDescriptor() { throw new Error('Must not publish interrupted input'); } },
    stdin, signals, isTerminal: () => true,
    commandRunner: (bin, args) => { calls.push({ bin, args }); return { status: 0, stdout: args[0] === '-g' ? '1:2:3' : '', stderr: '', signal: null }; },
  });
  const pending = installShadowAuth(adapter);
  signals.emit('SIGINT');
  await assert.rejects(pending, /Failed to install Zaruku auth descriptor/);
  assert.deepEqual(calls, [
    { bin: '/usr/bin/stty', args: ['-g'] },
    { bin: '/usr/bin/stty', args: ['-echo', '-echonl'] },
    { bin: '/usr/bin/stty', args: ['1:2:3'] },
  ]);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});
