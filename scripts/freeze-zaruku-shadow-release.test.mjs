import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { freezeShadowRelease, requireExactShadowRelease, createFixtureReleaseAuthorityAdapter, createReleaseAuthorityAdapter, REPOSITORY_AUTHORITY } from './freeze-zaruku-shadow-release.mjs';

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
  assert.deepEqual(commands.find(args=>args[0]==='push'), ['push','--no-verify','--no-follow-tags','--recurse-submodules=no','--atomic',`--force-with-lease=${ref}:`,'--',REPOSITORY_AUTHORITY.url,`${sha}:${ref}`]);
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
    const adapter={destination:remote,source:()=>({sha:candidate,branch:'candidate',clean:true}),verifyBase:()=>{},command:args=>{
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

test('actual freeze binds one explicit destination despite pushurl and never follows annotated tags', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zaruku-freeze-destination-'));
  const remote=path.join(directory,'authority.git'),wrong=path.join(directory,'wrong.git'),repo=path.join(directory,'candidate');
  const env={PATH:'/usr/bin:/bin',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_ALLOW_PROTOCOL:'file'};
  const git=(cwd,args)=>spawnSync('/usr/bin/git',['-C',cwd,...args],{encoding:'utf8',env});
  try {
    for(const target of [remote,wrong])assert.equal(spawnSync('/usr/bin/git',['init','--bare','-q',target],{env}).status,0);
    assert.equal(spawnSync('/usr/bin/git',['init','-q',repo],{env}).status,0);
    for(const args of [['config','user.name','Fixture'],['config','user.email','fixture@example.invalid'],['checkout','-qb','candidate'],['commit','--allow-empty','-qm','candidate'],['remote','add','origin',remote],['config','remote.origin.pushurl',wrong],['config','push.followTags','true'],['tag','-am','fixture side ref','private-side-tag']])assert.equal(git(repo,args).status,0);
    for(const target of [remote,wrong])assert.equal(fs.realpathSync(target),fs.realpathSync(directory)+'/'+path.basename(target));
    const candidate=git(repo,['rev-parse','HEAD']).stdout.trim();
    const adapter={destination:remote,source:()=>({sha:candidate,branch:'candidate',clean:true}),verifyBase:()=>{},command:args=>git(repo,args)};
    let failure;try{await freezeShadowRelease(adapter,true);}catch(error){failure=error;}
    assert.equal(git(wrong,['for-each-ref','--format=%(refname)']).stdout,'','the alternate pushurl repository must remain untouched');
    assert.equal(failure,undefined);
    assert.equal(git(remote,['for-each-ref','--format=%(refname)']).stdout,ref+'\n','only the explicit release ref may be published');
  } finally {fs.rmSync(directory,{recursive:true});}
});

test('isolated Git rejects destination aliases and ignores source side-ref and hook configuration', async () => {
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'zaruku-freeze-isolated-')));
  const remote=path.join(directory,'authority.git'),wrong=path.join(directory,'wrong.git'),repo=path.join(directory,'candidate'),hooks=path.join(directory,'hooks'),marker=path.join(directory,'hook-ran');
  const env={PATH:'/usr/bin:/bin',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_ALLOW_PROTOCOL:'file'};
  const git=(cwd,args)=>spawnSync('/usr/bin/git',['-C',cwd,...args],{encoding:'utf8',env});
  try {
    for(const target of [remote,wrong])assert.equal(spawnSync('/usr/bin/git',['init','--bare','-q',target],{env}).status,0);
    assert.equal(spawnSync('/usr/bin/git',['init','-q',repo],{env}).status,0);
    for(const args of [['config','user.name','Fixture'],['config','user.email','fixture@example.invalid'],['checkout','-qb','candidate'],['commit','--allow-empty','-qm','candidate'],['remote','add','origin',remote],['config','push.followTags','true'],['tag','-am','side ref','private-side-tag']])assert.equal(git(repo,args).status,0);
    fs.mkdirSync(hooks);fs.writeFileSync(path.join(hooks,'pre-push'),`#!/bin/sh\n: > '${marker}'\nexit 1\n`,{mode:0o700});
    assert.equal(git(repo,['config','core.hooksPath',hooks]).status,0);
    const adapter=createFixtureReleaseAuthorityAdapter(directory);
    for(const [key,value] of [['remote.origin.pushurl',wrong],['remote.origin.url',wrong],[`url.${wrong}.insteadOf`,remote],[`url.${wrong}.pushInsteadOf`,remote]]) {
      assert.equal(git(repo,['config','--add',key,value]).status,0);
      await assert.rejects(freezeShadowRelease(adapter,true),/release authority/);
      assert.equal(git(repo,['config','--unset-all',key]).status,0);
      if(key==='remote.origin.url')assert.equal(git(repo,['config',key,remote]).status,0);
      assert.equal(git(remote,['for-each-ref']).stdout,'');assert.equal(git(wrong,['for-each-ref']).stdout,'');
    }
    const refs=git(repo,['for-each-ref']).stdout,config=fs.readFileSync(path.join(repo,'.git/config'));
    assert.equal((await freezeShadowRelease(adapter,true)).created,true);
    assert.equal((await freezeShadowRelease(adapter,false)).created,false);
    assert.equal(git(remote,['for-each-ref','--format=%(refname)']).stdout,ref+'\n');
    assert.equal(git(wrong,['for-each-ref']).stdout,'');assert.equal(fs.existsSync(marker),false);
    assert.equal(git(repo,['for-each-ref']).stdout,refs);assert.deepEqual(fs.readFileSync(path.join(repo,'.git/config')),config);
    assert.throws(()=>createReleaseAuthorityAdapter(remote),/release authority/);
  } finally {fs.rmSync(directory,{recursive:true});}
});
