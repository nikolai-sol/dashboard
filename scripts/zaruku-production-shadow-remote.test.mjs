import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProductionAdapter, shadowTransportArguments } from './zaruku-production-shadow-remote.mjs';
const sha='a'.repeat(40),digest='b'.repeat(64);

function fixture(allocationTransform=value=>value){
  const calls=[],remote=[];
  const adapter=createProductionAdapter({source:()=>({sha,branch:'codex/reviewed',clean:true}),readFile:name=>({bytes:Buffer.from(name),mode:0o644,regular:true,singleLink:true,safeAncestors:true}),commandRunner:(bin,args,options)=>{
    calls.push({bin,args});
    if(args.includes('ls-remote'))return {status:0,signal:null,stdout:sha+'\trefs/heads/release/zaruku\n',stderr:''};
    return {status:0,signal:null,stdout:args.some(arg=>arg.endsWith('run-zaruku-linux-fixtures.sh'))?'linux-build-helper-fixture passed\nlinux-privilege-drop-fixture passed\nlinux-mysql-descriptor-fixture passed\nlinux-evidence-writer-fixture passed\n':args.some(arg=>arg.endsWith('deploy-zaruku.sh'))?options.input:'',stderr:''};
  },remoteRunner:async(action,request,prepared)=>{remote.push({action,request,prepared});if(action==='allocateEvidence')return allocationTransform({passed:true,sourceSha:request.sourceSha,runId:request.runId,evidenceIdentity:{dev:'5',ino:'6'}});return {passed:true,mysqlIdentity:{dev:'1',ino:'2',sha256:digest},timeoutIdentity:{dev:'7',ino:'8',sha256:digest},inventoryIdentity:{dev:'3',ino:'4'},inventorySha256:digest,evidenceIdentity:{dev:'99',ino:'99'}};}});
  return {adapter,calls,remote};
}

test('concrete orchestration adapter verifies prepared controls but never stages, applies, or builds the image',async()=>{
  const f=fixture();await f.adapter.preflight();await f.adapter.linuxBuildHelperFixture();await f.adapter.linuxPrivilegeFixture();await f.adapter.fullPredeploy();await f.adapter.releaseAuthority();await f.adapter.deploy();
  assert.deepEqual(f.remote.map(row=>row.action),['preflight']);
  assert.equal(f.calls.filter(call=>call.args.some(arg=>arg.endsWith('run-zaruku-linux-fixtures.sh'))).length,1);
  assert.ok(f.calls.some(call=>call.args.includes('ls-remote')));
  assert.doesNotMatch(JSON.stringify(f.calls),/--lock|docker.*build|push|fetch|update-ref|nginx|groupadd|useradd|GRANT|CREATE USER/);
  assert.match(f.remote[0].prepared.digest,/^[a-f0-9]{64}$/);
});

test('allocation receipt is strictly bound to the fixed run and cannot be replaced by a parity reply',async()=>{
  const f=fixture();await f.adapter.preflight();assert.equal(typeof f.adapter.allocateEvidence,'function');
  await f.adapter.allocateEvidence();await f.adapter.parity();await f.adapter.cleanup();
  assert.deepEqual(f.remote.at(-1).request.context.evidenceIdentity,{dev:'5',ino:'6'});
  assert.deepEqual(f.remote.at(-1).request.context.timeoutIdentity,{dev:'7',ino:'8',sha256:digest});
  await assert.rejects(()=>f.adapter.allocateEvidence());
  assert.equal(f.remote.filter(row=>row.action==='allocateEvidence').length,1);
  for(const transform of [value=>({...value,sourceSha:'c'.repeat(40)}),value=>({...value,runId:'00000000-0000-4000-8000-000000000000'}),value=>({...value,passed:false}),value=>({...value,body:'PRIVATE_SENTINEL'}),value=>({...value,evidenceIdentity:{dev:'5',ino:'PRIVATE_SENTINEL'}}),value=>({...value,evidenceIdentity:{dev:'5',ino:'6',path:'/tmp'}}),value=>({...value,evidenceIdentity:{dev:5,ino:'6'}}),value=>({...value,evidenceIdentity:{dev:'5',ino:6}})]){
    const bad=fixture(transform);await bad.adapter.preflight();
    await assert.rejects(()=>bad.adapter.allocateEvidence(),error=>!error.message.includes('PRIVATE_SENTINEL'));
  }
});

test('remote transport uses fixed SSH/host, empty environment, outer digest and inspect-only staged worker',()=>{
  const args=shadowTransportArguments('preflight',{sourceSha:sha,runId:'00000000-0000-4000-8000-000000000000',context:{}},digest);
  assert.ok(args.includes('beget'));assert.match(args.at(-1),/^\/usr\/bin\/env -i \/usr\/bin\/node/);
  assert.match(args.at(-1),/undefined,true/);assert.match(args.at(-1),/zaruku-shadow-dispatch\.mjs/);assert.match(args.at(-1),/dispatchStaged/);
  assert.doesNotMatch(args.at(-1),/npm|node_modules|esbuild/);
  assert.throws(()=>shadowTransportArguments('apply',{},digest));
});

test('fixed source adapter rejects arbitrary factory options and stop names',async()=>{
  for(const options of [{host:'other'},{root:'/tmp'},{port:3001},{runtime:'abbott'}])assert.throws(()=>createProductionAdapter(options));
  const f=fixture();await assert.rejects(()=>f.adapter.stop('dashboard-next'));assert.equal(f.remote.length,0);
});

test('failed local tools and remote diagnostics cannot disclose any data',async()=>{
  const f=fixture();await f.adapter.preflight();
  const adapter=createProductionAdapter({source:()=>({sha,branch:'codex/reviewed',clean:true}),commandRunner:()=>({status:1,stdout:'PRIVATE_SENTINEL',stderr:'PRIVATE_SENTINEL'})});
  await assert.rejects(()=>adapter.fullPredeploy(),error=>!error.message.includes('PRIVATE_SENTINEL'));
});

test('production adapter rejects an ancestor release ref and binds child source through inherited input', async () => {
  const calls=[]; let remoteSha='b'.repeat(40);
  const adapter=createProductionAdapter({source:()=>({sha,branch:'codex/reviewed',clean:true}),readFile:name=>({bytes:Buffer.from(name),mode:0o644,regular:true,singleLink:true,safeAncestors:true}),remoteRunner:()=>({passed:true}),commandRunner:(bin,args,options)=>{
    calls.push({bin,args,options});
    return {status:0,stdout:args.includes('ls-remote')?`${remoteSha}\trefs/heads/release/zaruku\n`:JSON.stringify({sourceSha:sha,runId:JSON.parse(options.input??'{}').runId}),stderr:''};
  }});
  await adapter.preflight();
  await assert.rejects(adapter.releaseAuthority(),/adapter|release authority/);
  remoteSha=sha;
  await adapter.releaseAuthority();
  await adapter.deploy();
  const child=calls.find(call=>call.args.some(arg=>arg.endsWith('deploy-zaruku.sh')));
  assert.equal(JSON.parse(child.options.input).sourceSha,sha);
  assert.match(JSON.parse(child.options.input).runId,/^[a-f0-9-]{36}$/);
});

test('child response substitution and a ref changed before child launch fail closed',async()=>{
  for(const changed of ['sha','run','ref']) {
    let refs=0;const adapter=createProductionAdapter({source:()=>({sha,branch:'codex/reviewed',clean:true}),readFile:name=>({bytes:Buffer.from(name),mode:0o644,regular:true,singleLink:true,safeAncestors:true}),remoteRunner:()=>({passed:true}),commandRunner:(bin,args,options)=>{
      if(args.includes('ls-remote'))return {status:0,stdout:`${changed==='ref'&&refs++?'b'.repeat(40):sha}\trefs/heads/release/zaruku\n`,stderr:''};
      const input=JSON.parse(options.input);return {status:0,stdout:JSON.stringify({...input,...(changed==='sha'?{sourceSha:'b'.repeat(40)}:{runId:'wrong'})}),stderr:''};
    }});
    await adapter.preflight();await adapter.releaseAuthority();await assert.rejects(adapter.deploy());
  }
});
