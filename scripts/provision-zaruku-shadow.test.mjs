import assert from 'node:assert/strict';
import {test} from 'node:test';
import {provisionShadow} from './provision-zaruku-shadow.mjs';

test('provisioning exact-ref guard is fresh before each attested fixed dispatcher call',async()=>{
  const sha='a'.repeat(40);let remoteSha=sha;const calls=[];
  const adapter={source:()=>({sha,branch:'codex/reviewed',clean:true}),command:()=>{calls.push('ref');return {status:0,stdout:`${remoteSha}\trefs/heads/release/zaruku\n`,stderr:''};},readFile:name=>({bytes:Buffer.from(name),mode:0o644,regular:true,singleLink:true,safeAncestors:true}),dispatch:args=>{calls.push('dispatch');assert.match(args.at(-1),/env -i/);assert.match(args.at(-1),/undefined,true/);assert.match(args.at(-1),/dispatchStaged/);return {passed:true};}};
  assert.deepEqual(await provisionShadow('host-apply',adapter),{passed:true});
  assert.deepEqual(calls,['ref','ref','dispatch']);
  remoteSha='b'.repeat(40);calls.length=0;
  await assert.rejects(provisionShadow('db-provision',adapter));assert.deepEqual(calls,['ref']);
  await assert.rejects(provisionShadow('other',adapter));
});
