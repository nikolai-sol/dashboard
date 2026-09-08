import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { installShadowAuth, validateAuthDescriptor, createAuthAdapter } from './install-zaruku-shadow-auth.mjs';

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
