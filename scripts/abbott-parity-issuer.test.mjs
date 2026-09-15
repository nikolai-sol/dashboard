import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function moduleUnderTest() {
  try { return await import('./abbott-parity-issuer.mjs'); } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  }
}
const values = { DASHBOARD_AUTH_SECRET: 'synthetic-signing-secret', ABBOTT_DASHBOARD_EMBED_KEY: 'synthetic-embed', DB_NAME: 'report_bd', DB_HOST: 'localhost', DB_PORT: '3306', DB_USER: 'synthetic-reader', DB_PASSWORD: 'synthetic-db' };
const source = fs.readFileSync(new URL('../src/lib/access-auth.ts', import.meta.url));
const compiled = ts.transpileModule(source.toString(), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2020 } }).outputText;

test('issuer uses existing pinned signing implementation for a single strict manager frame', async () => {
  const api = await moduleUnderTest();
  assert.equal(typeof api.createOneShotIssuer, 'function');
  let proofs = 0, reads = 0;
  const before = JSON.stringify(process.env);
  const issue = api.createOneShotIssuer({ outputPipe: () => true, readSource: () => { proofs++; return { ...values }; }, readVersion: async env => { assert.equal(env.DB_NAME, 'report_bd'); reads++; return 7; }, signingCode: compiled, now: () => 1000 });
  const frame = await issue();
  try {
    const lines = frame.toString().split('\n');
    assert.equal(lines.length, 4); assert.equal(lines[0], 'manager_access_token'); assert.equal(lines[2], values.ABBOTT_DASHBOARD_EMBED_KEY); assert.equal(lines[3], '');
    const claims = JSON.parse(Buffer.from(lines[1].split('.')[0], 'base64url'));
    assert.deepEqual(claims, { type: 'viewer', dashboard_id: 18, audience: 'manager', credential_version: 7, exp: 1600 });
    assert.equal(proofs, 2); assert.equal(reads, 1);
    await assert.rejects(issue(), /ABBOTT_ISSUER_REFUSED/);
    assert.equal(proofs, 2);
    assert.equal(JSON.stringify(process.env), before);
  } finally { frame.fill(0); }
});

test('issuer refuses TTY/file output, source drift, invalid version or missing secret before output', async () => {
  const api = await moduleUnderTest();
  assert.equal(typeof api.createOneShotIssuer, 'function');
  for (const change of [
    { outputPipe: () => false },
    { readSource: () => { throw Error('secret-looking-source-error'); } },
    ...[null, 0, -1, '7', 1.5].map(version => ({ readVersion: async () => version })),
    ...['DASHBOARD_AUTH_SECRET', 'ABBOTT_DASHBOARD_EMBED_KEY'].map(key => ({ readSource: () => ({ ...values, [key]: '' }) })),
    { readSource: (() => { let n = 0; return () => ({ ...values, DB_USER: String(n++) }); })() },
    { readSource: () => ({ ...values, ABBOTT_DASHBOARD_EMBED_KEY: 'x\nextra' }) },
    { readSource: () => ({ ...values, ABBOTT_DASHBOARD_EMBED_KEY: 'x'.repeat(65536) }) },
  ]) {
    const issue = api.createOneShotIssuer({ outputPipe: () => true, readSource: () => ({ ...values }), readVersion: async () => 7, signingCode: compiled, now: () => 1000, ...change });
    await assert.rejects(issue(), error => String(error) === 'Error: ABBOTT_ISSUER_REFUSED');
  }
});

test('issuer current-version query is fixed read-only and captures failures without secrets', async () => {
  const api = await moduleUnderTest();
  assert.equal(typeof api.readCurrentVersion, 'function');
  let called = 0;
  const execute = (binary, args, options) => {
    called++;
    assert.equal(binary, '/root/reportingdash-canonical/venv/bin/python');
    assert.equal(args[0], '-c');
    assert.match(args[1], /SELECT/);
    assert.doesNotMatch(args[1], /INSERT|UPDATE|DELETE|password_hash|SET ROLE/);
    assert.ok(!JSON.stringify(args).includes(values.DB_PASSWORD));
    assert.deepEqual(options.env, {}); assert.deepEqual(options.stdio, ['pipe','pipe','pipe']);
    assert.ok(Buffer.isBuffer(options.input));
    return { status: 0, stdout: Buffer.from('7\n'), stderr: Buffer.alloc(0) };
  };
  assert.equal(api.readCurrentVersion(values, execute), 7); assert.equal(called, 1);
  for (const output of [{ status: 1, stdout: Buffer.from('secret'), stderr: Buffer.from('secret') }, { status: 0, stdout: Buffer.from('7\nextra'), stderr: Buffer.alloc(0) }, { status: 0, stdout: Buffer.from('7\n'), stderr: Buffer.from('secret') }]) {
    assert.throws(() => api.readCurrentVersion(values, () => output), /^Error: ABBOTT_ISSUER_REFUSED$/);
    assert.ok(output.stdout.every(byte => byte === 0)); assert.ok(output.stderr.every(byte => byte === 0));
  }
  assert.equal(createHash('sha256').update(source).digest('hex'), '71fad58b4eb66b2cd5dd29b7c463043c5cc8a04d839e597a14e0d9a2fae8e64f');
});

test('real remote entrypoint refuses file-backed stdout before reading any source', async () => {
  const moduleSource = fs.readFileSync(new URL('./abbott-parity-issuer.mjs',import.meta.url));
  const url='data:text/javascript;base64,'+moduleSource.toString('base64');
  const script=`const m=await import(${JSON.stringify(url)});await m.runRemoteIssuer(()=>{process.stdout.write('SOURCE_READ_ATTEMPTED');throw Error('must-not-read');},'');`;
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'abbott-issuer-output-'));
  const filename=path.join(temp,'stdout');const fd=fs.openSync(filename,'wx',0o600);
  try{
    const result=spawnSync(process.execPath,['--input-type=module'],{input:script,env:{},stdio:['pipe',fd,'pipe'],encoding:'utf8',timeout:3000});
    assert.equal(result.status,1);assert.equal(result.stderr,'ABBOTT_ISSUER_REFUSED\n');assert.equal(fs.statSync(filename).size,0);
  }finally{fs.closeSync(fd);fs.rmSync(temp,{recursive:true});}
});

test('missing or malformed database credentials refuse before starting a database child',async()=>{
  const api=await moduleUnderTest();let calls=0;
  for(const change of [{DB_HOST:''},{DB_USER:''},{DB_PASSWORD:''},{DB_PORT:'0'},{DB_PORT:'65536'},{DB_PORT:'invalid'}]){
    assert.throws(()=>api.readCurrentVersion({...values,...change},()=>{calls++;return{status:0,stdout:Buffer.from('7\n'),stderr:Buffer.alloc(0)};}),/^Error: ABBOTT_ISSUER_REFUSED$/);
  }
  assert.equal(calls,0);
});

test('existing embed key uses the same trimming semantics as the authorizer',async()=>{
  const api=await moduleUnderTest();
  const issue=api.createOneShotIssuer({outputPipe:()=>true,readSource:()=>({...values,ABBOTT_DASHBOARD_EMBED_KEY:'  synthetic-embed  '}),readVersion:async()=>7,signingCode:compiled,now:()=>1000});
  const bytes=await issue();
  try{assert.equal(bytes.toString().split('\n')[2],'synthetic-embed');}finally{bytes.fill(0);}
});
