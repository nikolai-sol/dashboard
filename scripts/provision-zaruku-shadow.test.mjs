import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import {test} from 'node:test';
import {provisionArguments,provisionShadow} from './provision-zaruku-shadow.mjs';
import {CONTROL_FILES,prepareReviewedControl,readControlSource,reviewedSource} from './stage-zaruku-shadow-control.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function remoteCode(args) {
  const prefix='/usr/bin/env -i /usr/bin/node --input-type=module -e ';
  assert.ok(args.at(-1).startsWith(prefix));
  const quoted=args.at(-1).slice(prefix.length);
  assert.ok(quoted.startsWith("'")&&quoted.endsWith("'"));
  return quoted.slice(1,-1).replaceAll("'\\''","'");
}

test('actual 22-file control at the current HEAD fits the unchanged provisioning command budget',async()=>{
  const {sha}=reviewedSource();
  // The source marker is a fixture: test-file edits must not block measuring the real control bytes.
  const prepared=await prepareReviewedControl({source:()=>({sha,branch:'codex/transport-budget-fixture',clean:true}),readFile:readControlSource},sha);
  assert.equal(CONTROL_FILES.length,22);
  assert.equal(JSON.parse(prepared.bytes).sourceSha,sha);
  const args=provisionArguments('host-check',prepared);
  assert.ok(Buffer.byteLength(args.at(-1))<120000);
  assert.deepEqual(args.slice(0,-1),['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','--','beget']);
  const code=remoteCode(args);
  const compressed=/z\.brotliDecompressSync\(Buffer\.from\('([A-Za-z0-9+/=]+)','base64'\),\{maxOutputLength:2097152\}\)/.exec(code);
  assert.ok(compressed,'fixed bounded Brotli decoder must be embedded');
  assert.deepEqual(brotliDecompressSync(Buffer.from(compressed[1],'base64'),{maxOutputLength:2097152}),prepared.bytes);
  assert.ok(code.includes(`,'${prepared.digest}',undefined,true)`));
  assert.ok(code.indexOf('const c=await inspect(')<code.indexOf("const m=await import('file://'"));
  assert.doesNotMatch(code,/gzipSync|gunzipSync/);
  assert.equal(provisionArguments('host-check',prepared).at(-1),args.at(-1));
});

test('Brotli provisioning keeps auth stdin exclusive and exact action and digest guards',()=>{
  const bytes=Buffer.from('public reviewed fixture'),prepared={bytes,digest:digest(bytes)};
  const args=provisionArguments('auth-install',prepared),code=remoteCode(args);
  assert.deepEqual(args.slice(0,-1),['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-tt','--','beget']);
  assert.match(code,/brotliDecompressSync/);
  assert.ok(code.includes("m.dispatchStaged('auth-install')"));
  assert.doesNotMatch(code,/process\.stdin|readFileSync\(0|\/dev\/stdin/);
  assert.throws(()=>provisionArguments('host-check;other',prepared),/fixed provisioning refused/);
  assert.throws(()=>provisionArguments('host-check',{...prepared,digest:'invalid'}),/fixed provisioning refused/);
});

test('an incompressible oversized control still refuses the unchanged command budget',()=>{
  const bytes=Buffer.concat(Array.from({length:4096},(_,index)=>createHash('sha256').update(`provision-budget-${index}`).digest()));
  assert.throws(()=>provisionArguments('host-check',{bytes,digest:digest(bytes)}),/fixed provisioning refused/);
});

test('provisioning exact-ref guard is fresh before each attested fixed dispatcher call',async()=>{
  const sha='a'.repeat(40);let remoteSha=sha;const calls=[];
  const adapter={source:()=>({sha,branch:'codex/reviewed',clean:true}),command:()=>{calls.push('ref');return {status:0,stdout:`${remoteSha}\trefs/heads/release/zaruku\n`,stderr:''};},readFile:name=>({bytes:Buffer.from(name),mode:0o644,regular:true,singleLink:true,safeAncestors:true}),dispatch:args=>{calls.push('dispatch');assert.match(args.at(-1),/env -i/);assert.match(args.at(-1),/undefined,true/);assert.match(args.at(-1),/dispatchStaged/);return {passed:true};}};
  assert.deepEqual(await provisionShadow('host-apply',adapter),{passed:true});
  assert.deepEqual(calls,['ref','ref','dispatch']);
  remoteSha='b'.repeat(40);calls.length=0;
  await assert.rejects(provisionShadow('db-provision',adapter));assert.deepEqual(calls,['ref']);
  await assert.rejects(provisionShadow('other',adapter));
});
