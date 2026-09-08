import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadShadowAuthority,loadMysqlTableAuthority } from './zaruku-production-shadow-contract.mjs';
import { CONTROL_FILES,prepareReviewedControl,readControlSource,receiveControlPayload,reviewedSource } from './stage-zaruku-shadow-control.mjs';

const ROOT=path.resolve(import.meta.dirname,'..');
const ACTIONS=['preflight','hostBoundary','dbBoundary','runtimeSecrets','managerAuth','attest','parity','recheck','cleanup','stop','writeDecision'];
const fail=()=>{throw new Error('Zaruku fixed shadow adapter failed');};
const quote=value=>`'${value.replaceAll("'","'\\''")}'`;

export function shadowTransportArguments(action,request,digest) {
  if(!ACTIONS.includes(action)||!/^[a-f0-9]{64}$/.test(digest)||!/^[a-f0-9]{40}$/.test(request?.sourceSha))fail();
  const code=`const CONTROL_FILES=${JSON.stringify(CONTROL_FILES)};const inspect=(${receiveControlPayload.toString()});let size=0;const chunks=[];try{for await(const bytes of process.stdin){size+=bytes.length;if(size>2097152)throw new Error();chunks.push(bytes);}const control=await inspect(Buffer.concat(chunks),${JSON.stringify(digest)},undefined,true);const module=await import('file://'+control.destination.path+'/scripts/zaruku-production-shadow-worker.mjs');const result=await module.runShadowWorker(${JSON.stringify(action)},${JSON.stringify(request)});process.stdout.write(JSON.stringify(result)+'\\n');}catch{process.stderr.write('Zaruku shadow worker check failed\\n');process.exitCode=1;}`;
  return ['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','--','beget',`/usr/bin/env -i /usr/bin/node --input-type=module -e ${quote(code)}`];
}

function remote(action,request,prepared) {
  const result=spawnSync('/usr/bin/ssh',shadowTransportArguments(action,request,prepared.digest),{input:prepared.bytes,stdio:['pipe','pipe','pipe'],timeout:240000,maxBuffer:262144,env:{PATH:'/usr/bin:/bin'}});
  try{if(result.error||result.signal||result.status!==0||result.stderr.length)fail();return JSON.parse(result.stdout);}catch{fail();}
}

/** Injection exists for source fixtures, never for CLI arguments/environment. */
export function createProductionAdapter(options={}) {
  if(Object.keys(options).some(key=>!['source','readFile','commandRunner','remoteRunner'].includes(key))||Object.values(options).some(value=>typeof value!=='function'))fail();
  const source=options.source??reviewedSource,readFile=options.readFile??readControlSource,runner=options.commandRunner??spawnSync,remoteRunner=options.remoteRunner??remote;
  const runId=randomUUID();let prepared,sourceSha,context={},linuxProof=false;
  const command=(bin,args)=>{
    const result=runner(bin,args,{cwd:ROOT,env:{PATH:path.dirname(process.execPath)+':/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin',HOME:process.env.HOME,GIT_PAGER:'/bin/cat'},stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:1800000,maxBuffer:16777216});
    if(result.error||result.signal||result.status!==0)fail();return result.stdout.trim();
  };
  const call=async(action,decision)=>{
    if(!prepared||!sourceSha)fail();
    try{const result=await remoteRunner(action,{sourceSha,runId,context,...(decision?{decision}:{})},prepared);if(action==='parity'&&result.evidenceIdentity)context={...context,evidenceIdentity:result.evidenceIdentity};return result;}catch{fail();}
  };
  const adapter={
    source,
    loadAuthorities:async()=>({shadow:loadShadowAuthority(path.join(ROOT,'deploy/zaruku/production-shadow.json')),mysql:loadMysqlTableAuthority(path.join(ROOT,'deploy/zaruku/mysql-read-tables.json'))}),
    async preflight(){const state=await source();sourceSha=state.sha;prepared=await prepareReviewedControl({source,readFile},sourceSha);const result=await call('preflight');context={mysqlIdentity:result.mysqlIdentity,inventoryIdentity:result.inventoryIdentity,inventorySha256:result.inventorySha256};return result;},
    async linuxBuildHelperFixture(){const output=command('/bin/bash',[path.join(ROOT,'scripts/run-zaruku-linux-fixtures.sh')]);linuxProof=output==='linux-build-helper-fixture passed\nlinux-privilege-drop-fixture passed\nlinux-mysql-descriptor-fixture passed';return {passed:linuxProof};},
    async linuxPrivilegeFixture(){return {passed:linuxProof};},
    async fullPredeploy(){command('npm',['run','predeploy:verify']);return {passed:true};},
    async releaseAuthority(){
      const output=command('/usr/bin/git',['--no-replace-objects','-C',ROOT,'ls-remote','--exit-code','origin','refs/heads/release/zaruku']);
      const match=/^([a-f0-9]{40})\trefs\/heads\/release\/zaruku$/.exec(output);if(!match)fail();
      command('/usr/bin/git',['--no-replace-objects','-C',ROOT,'cat-file','-e',match[1]+'^{commit}']);
      command('/usr/bin/git',['--no-replace-objects','-C',ROOT,'merge-base','--is-ancestor',match[1],sourceSha]);
      return {passed:true,sourceSha};
    },
    async deploy(){command('/bin/bash',[path.join(ROOT,'scripts/deploy-zaruku.sh')]);return {passed:true,sourceSha};},
    async stop(name){if(name!=='dashboard-zaruku')fail();return call('stop');},
    async cleanup(){return prepared?call('cleanup'):{passed:true};},
    async writeDecision(evidence){return call('writeDecision',evidence);},
  };
  for(const action of ['hostBoundary','dbBoundary','runtimeSecrets','managerAuth','attest','parity','recheck'])adapter[action]=()=>call(action);
  return Object.freeze(adapter);
}
