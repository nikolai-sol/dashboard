import assert from 'node:assert/strict';
import test from 'node:test';

const api=async()=>{try{return await import('./abbott-verification-diagnostics.mjs');}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;}};
const secret='synthetic-secret https://invalid.test/?access_token=private';
test('closed diagnostic enums never inspect or serialize arbitrary error fields',async()=>{
  const m=await api();assert.equal(typeof m.formatVerificationFailure,'function');
  for(const stage of m.DIAGNOSTIC_STAGES)for(const reason of m.DIAGNOSTIC_REASONS){
    const error=Object.assign(new Error(secret),{stage:secret,reason:secret,code:secret,stack:secret,cause:secret,url:secret,headers:secret,body:secret,stdout:secret,stderr:secret,path:secret});
    m.markDiagnostic(error,stage,reason);
    assert.equal(m.formatVerificationFailure(error),`ABBOTT_VERIFICATION_REFUSED stage=${stage} reason=${reason}\n`);
  }
  const poison=new Proxy({}, {get(){throw Error(secret);}});
  for(const error of [poison,null,undefined,secret,{stage:'pdf_parse',reason:'shape',message:secret}])assert.equal(m.formatVerificationFailure(error),'ABBOTT_VERIFICATION_REFUSED stage=unknown reason=unknown\n');
  for(const value of [secret,'pdf_parse\n','PDF_PARSE','',null,{},'__proto__']){
    assert.equal(m.formatVerificationFailure(m.markDiagnostic(new Error(secret),value,value)),'ABBOTT_VERIFICATION_REFUSED stage=unknown reason=unknown\n');
  }
});
test('child diagnostics accept exactly one bounded allowlisted frame and never relay streams',async()=>{
  const m=await api();assert.equal(typeof m.diagnosticFromChild,'function');
  const valid='ABBOTT_VERIFICATION_REFUSED stage=capture_navigation reason=failed\n';
  assert.equal(m.formatVerificationFailure(m.diagnosticFromChild({status:1,signal:null,stdout:Buffer.alloc(0),stderr:Buffer.from(valid)})),valid);
  for(const response of [
    {status:0,stderr:Buffer.from(valid)},{status:1,signal:'SIGTERM',stderr:Buffer.from(valid)},
    {status:1,stdout:Buffer.from(secret),stderr:Buffer.from(valid)},
    ...[secret,valid+secret,valid+valid,valid+'\n',valid.replace('capture_navigation','fake'),valid.replace('failed','private'),valid.replace('\n','\r\n'),'x'.repeat(1024)].map(text=>({status:1,stderr:Buffer.from(text)})),
  ])assert.equal(m.formatVerificationFailure(m.diagnosticFromChild({stdout:Buffer.alloc(0),signal:null,...response})),'ABBOTT_VERIFICATION_REFUSED stage=unknown reason=unknown\n');
});

test('PDF origin/status class diagnostics survive only exact closed child frames',async()=>{
  const m=await api();
  for(const reason of ['control_4xx','control_5xx','candidate_4xx','candidate_5xx','control_other_status','candidate_other_status']){
    const frame=`ABBOTT_VERIFICATION_REFUSED stage=pdf_fetch reason=${reason}\n`;
    assert.equal(m.formatVerificationFailure(m.markDiagnostic(Error(secret),'pdf_fetch',reason)),frame);
    assert.equal(m.formatVerificationFailure(m.diagnosticFromChild({status:1,stdout:Buffer.alloc(0),stderr:Buffer.from(frame)})),frame);
    for(const bad of [reason+'_synthetic_secret',reason+'\n'+secret,'candidate_500','control_401']){
      assert.equal(m.formatVerificationFailure(m.markDiagnostic(Error(secret),'pdf_fetch',bad)),'ABBOTT_VERIFICATION_REFUSED stage=pdf_fetch reason=unknown\n');
    }
  }
});

test('real parent and visual CLIs emit only the closed failure frame on invalid invocation',async()=>{
  const {captureBoundedChild}=await import('./abbott-bounded-child.mjs');
  for(const file of ['scripts/verify-abbott-shadow.mjs','scripts/capture-abbott-runtime.mjs']){
    const result=await captureBoundedChild(process.execPath,[file],{input:Buffer.alloc(0),timeout:3000,maxBytes:1024});
    try{assert.equal(result.status,1);assert.equal(result.stdout.length,0);assert.equal(result.stderr.toString(),'ABBOTT_VERIFICATION_REFUSED stage=unknown reason=unknown\n');}
    finally{result.stdout.fill(0);result.stderr.fill(0);}
  }
});
