import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { freezeShadowRelease, requireExactShadowRelease } from './freeze-zaruku-shadow-release.mjs';

const sha = 'a'.repeat(40), ref = 'refs/heads/release/zaruku';
function fixture(change = {}) {
  const commands = [];
  const source = { sha, branch: 'codex/candidate', clean: true };
  const adapter = { source: () => source, verifyBase: () => {}, command: args => {
    commands.push(args);
    return { status: 0, stdout: `${sha}\t${ref}\n`, stderr: '' };
  }, ...change };
  return { adapter, commands, source };
}

test('exact frozen authority rejects every different missing malformed or multiple remote ref', async () => {
  const good = fixture(); assert.equal((await requireExactShadowRelease(good.adapter, sha)).sourceSha, sha);
  for (const result of [
    {status:0,stdout:`${'b'.repeat(40)}\t${ref}\n`,stderr:''},
    {status:0,stdout:`${sha}\t${ref}\n${sha}\trefs/heads/other\n`,stderr:''},
    {status:0,stdout:`${sha}\trefs/heads/other\n`,stderr:''},
    {status:0,stdout:'malformed',stderr:''}, {status:2,stdout:'',stderr:''},
  ]) await assert.rejects(requireExactShadowRelease(fixture({command:()=>result}).adapter,sha), /release authority/i);
  for (const source of [{sha,clean:false,branch:'codex/candidate'}, {sha,clean:true,branch:''}, {sha:'b'.repeat(40),clean:true,branch:'codex/candidate'}])
    await assert.rejects(requireExactShadowRelease(fixture({source:()=>source}).adapter,sha), /release authority/i);
  let count = 0;
  await assert.rejects(requireExactShadowRelease(fixture({source:()=>({sha:count++ ? 'b'.repeat(40) : sha,branch:'codex/candidate',clean:true})}).adapter,sha));
});

test('freeze uses an expected-absent atomic lease and exact readback', async () => {
  let exists = false; const commands=[];
  const f = fixture({command: args => {
    commands.push(args);
    if (args[0] === 'push') { exists = true; return {status:0,stdout:'',stderr:''}; }
    return {status:exists?0:2,stdout:exists?`${sha}\t${ref}\n`:'',stderr:''};
  }});
  assert.deepEqual(await freezeShadowRelease(f.adapter, true), {sourceSha:sha,ref,created:true});
  assert.deepEqual(commands.find(args=>args[0]==='push'), ['push','--atomic',`--force-with-lease=${ref}:`,'origin',`${sha}:${ref}`]);
  assert.equal(commands.filter(args=>args[0]==='ls-remote').length,2);
});

test('actual Git expected-absent lease refuses a ref that appears after observation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'zaruku-freeze-'));
  const remote = path.join(directory,'origin.git'), repo=path.join(directory,'candidate');
  const git=(cwd,args)=>spawnSync('/usr/bin/git',['-C',cwd,...args],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_ALLOW_PROTOCOL:'file'}});
  try {
    assert.equal(spawnSync('/usr/bin/git',['init','--bare','-q',remote]).status,0);
    assert.equal(spawnSync('/usr/bin/git',['init','-q',repo]).status,0);
    for(const args of [['config','user.name','Fixture'],['config','user.email','fixture@example.invalid'],['checkout','-qb','candidate'],['commit','--allow-empty','-qm','candidate'],['remote','add','origin',remote]]) assert.equal(git(repo,args).status,0);
    const candidate=git(repo,['rev-parse','HEAD']).stdout.trim();
    assert.equal(git(repo,['commit','--allow-empty','-qm','racing successor']).status,0);
    const successor=git(repo,['rev-parse','HEAD']).stdout.trim();
    assert.equal(git(repo,['checkout','-q','-B','candidate',candidate]).status,0);
    assert.equal(git(repo,['remote','get-url','origin']).stdout.trim(), remote);
    assert.equal(fs.realpathSync(remote), fs.realpathSync(directory) + '/origin.git');
    let raced=false;
    const adapter={source:()=>({sha:candidate,branch:'candidate',clean:true}),verifyBase:()=>{},command:args=>{
      if(args[0]==='push'&&!raced){raced=true;assert.equal(git(repo,['push','origin',`${successor}:${ref}`]).status,0);}
      return git(repo,args);
    }};
    await assert.rejects(freezeShadowRelease(adapter,true),/release authority/);
    assert.equal(git(repo,['ls-remote','origin',ref]).stdout.trim(),`${successor}\t${ref}`);
    await assert.rejects(freezeShadowRelease(adapter,true),/release authority/);
    assert.equal(git(remote,['update-ref','-d',ref,successor]).status,0);
    assert.equal((await freezeShadowRelease(adapter,true)).created,true);
    assert.equal((await freezeShadowRelease(adapter,true)).created,false);
  } finally { fs.rmSync(directory,{recursive:true}); }
});
