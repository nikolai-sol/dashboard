// Real Linux/root fixture. Run in a disposable network-disabled container with
// the reviewed checkout mounted read-only at /src and a Node + util-linux image.
// Add SYS_PTRACE to the verifier container so its root parent can independently
// read the different-UID child's /proc/<pid>/cwd; application capabilities drop to 0.
// This test never uses /var/www or any production file/account outside that container.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { bootRuntimeAsService } from './runtime-release-remote.mjs';

if (process.platform !== 'linux' || process.getuid() !== 0 || !fs.existsSync('/.dockerenv')) throw new Error('This behavioral fixture requires a disposable Linux root container');
const base = fs.mkdtempSync('/tmp/zaruku-privilege-');
fs.chmodSync(base, 0o755);
const artifact = path.join(base, 'artifact');
const control = path.join(base, 'control');
const sibling = path.join(base, 'sibling');
const proof = path.join('/tmp', path.basename(base) + '-proof.json');
execFileSync('/usr/sbin/groupadd', ['-g', '12345', 'dashboard-zaruku']);
execFileSync('/usr/sbin/useradd', ['-u', '12345', '-g', '12345', '-M', '-s', '/usr/sbin/nologin', 'dashboard-zaruku']);
fs.mkdirSync(path.join(artifact, 'apps/zaruku'), { recursive: true, mode: 0o755 });
fs.mkdirSync(control, { mode: 0o700 }); fs.mkdirSync(sibling, { mode: 0o755 });
fs.writeFileSync(path.join(control, 'manifest'), 'protected', { mode: 0o600 });
const server = `const fs = require('node:fs'); const http = require('node:http');
const attempts = ${JSON.stringify([path.join(control, 'manifest'), path.join(sibling, 'foreign-write'), path.join(artifact, 'injected')])}.map(file => { try { fs.writeFileSync(file, 'bad'); return true; } catch { return false; } });
fs.writeFileSync(${JSON.stringify(proof)}, JSON.stringify({uid:process.getuid(),euid:process.geteuid(),gid:process.getgid(),egid:process.getegid(),groups:process.getgroups(),cwd:process.cwd(),env:Object.keys(process.env).sort(),attempts,status:fs.readFileSync('/proc/self/status','utf8')}));
http.createServer((req,res) => {res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,scope:'zaruku'}));}).listen(+process.env.PORT, process.env.HOSTNAME);
`;
fs.writeFileSync(path.join(artifact, 'apps/zaruku/server.js'), server, { mode: 0o644 });

test('real boot drops all privilege before app code and cannot mutate authority, sibling or artifact', async () => {
  const identity = await bootRuntimeAsService(artifact);
  const data = JSON.parse(fs.readFileSync(proof));
  assert.deepEqual([data.uid, data.euid, data.gid, data.egid], [12345, 12345, 12345, 12345]);
  assert.ok(data.groups.every(group => group === 12345));
  assert.match(data.status, /^Groups:[\t ]*$/m);
  assert.match(data.status, /^NoNewPrivs:[\t ]*1$/m);
  for (const name of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) assert.match(data.status, new RegExp('^' + name + ':[\\t ]*0+$', 'm'));
  assert.equal(data.cwd, path.join(artifact, 'apps/zaruku'));
  assert.deepEqual(data.env, ['HOSTNAME', 'NODE_ENV', 'PORT']);
  assert.deepEqual(data.attempts, [false, false, false]);
  assert.equal(identity.uid, 12345); assert.equal(identity.gid, 12345);
  assert.deepEqual(identity.supplementaryGroups, []);
  assert.equal(fs.readFileSync(path.join(control, 'manifest'), 'utf8'), 'protected');
});

test('missing or impersonating setpriv fails before application execution', async () => {
  const original = '/usr/bin/setpriv', saved = '/usr/bin/setpriv-task6-original';
  fs.renameSync(original, saved);
  try {
    await assert.rejects(bootRuntimeAsService(artifact), /privilege|setpriv|ENOENT/i);
    fs.writeFileSync(original, '#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n', { mode: 0o755 });
    fs.unlinkSync(proof);
    await assert.rejects(bootRuntimeAsService(artifact), /identity|boot/i);
    assert.ok(!fs.existsSync(proof));
  } finally { fs.rmSync(original, { force: true }); fs.renameSync(saved, original); }
});

process.on('exit', () => { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(proof, { force: true }); });
