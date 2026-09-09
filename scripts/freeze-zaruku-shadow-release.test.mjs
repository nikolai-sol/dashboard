import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { advanceApprovedSuccessor, freezeShadowRelease, requireExactShadowRelease, createFixtureReleaseAuthorityAdapter, createReleaseAuthorityAdapter, releaseAuthorityGitEnvironment, assertReleaseAuthorityInvocation, REPOSITORY_AUTHORITY } from './freeze-zaruku-shadow-release.mjs';

test('release authority pins the approved predecessor and matches the committed repository policy', () => {
  assert.equal(REPOSITORY_AUTHORITY.approvedPredecessor, '00e5b33a22d567f6f17a6966a2a1f8d6a8b849da');
  const policy = JSON.parse(fs.readFileSync(new URL('../deploy/zaruku/repository.json', import.meta.url), 'utf8'));
  assert.deepEqual(policy, REPOSITORY_AUTHORITY);
});

const expectedSsh = ['/usr/bin/ssh','-F','/dev/null',
  '-o','HostName=github.com','-o','User=git','-o','Port=22','-o','HostKeyAlias=github.com',
  '-o','CanonicalizeHostname=no','-o','ProxyCommand=none','-o','ProxyJump=none',
  '-o','PermitLocalCommand=no','-o','LocalCommand=none','-o','RemoteCommand=none',
  '-o','ClearAllForwardings=yes','-o','ForwardAgent=no','-o','ForwardX11=no','-o','ForwardX11Trusted=no','-o','Tunnel=no',
  '-o','ControlMaster=no','-o','ControlPath=none','-o','ControlPersist=no',
  '-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','GlobalKnownHostsFile=/dev/null',
  '-o','UserKnownHostsFile=~/.ssh/known_hosts','-o','KnownHostsCommand=none','-o','VerifyHostKeyDNS=no','-o','UpdateHostKeys=no'];

test('release SSH transport pins exact options and strips inherited routing inputs', () => {
  const inherited={HOME:'/untrusted-home',GIT_SSH:'/untrusted-ssh',GIT_SSH_COMMAND:'ssh -p 2222',GIT_SSH_VARIANT:'plink',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.sshCommand',GIT_CONFIG_VALUE_0:'evil',SSH_ASKPASS:'/untrusted-askpass',SSH_SK_PROVIDER:'/untrusted-provider',LD_PRELOAD:'/untrusted-loader',DYLD_INSERT_LIBRARIES:'/untrusted-loader'};
  const saved=Object.fromEntries([...Object.keys(inherited),'SSH_AUTH_SOCK'].map(key=>[key,process.env[key]]));
  try {
    Object.assign(process.env,inherited);delete process.env.SSH_AUTH_SOCK;
    const env=releaseAuthorityGitEnvironment('ssh');
    assert.equal(env.GIT_SSH_COMMAND,expectedSsh.join(' '));
    assert.equal(env.HOME,os.userInfo().homedir);
    assert.deepEqual(Object.keys(env).sort(),['PATH','HOME','GIT_CONFIG_NOSYSTEM','GIT_CONFIG_SYSTEM','GIT_CONFIG_GLOBAL','GIT_NO_REPLACE_OBJECTS','GIT_GRAFT_FILE','GIT_PAGER','GIT_TERMINAL_PROMPT','GIT_ALLOW_PROTOCOL','GIT_SSH_COMMAND','GIT_SSH_VARIANT'].sort());
    assert.equal(env.GIT_ALLOW_PROTOCOL,'ssh');assert.equal(env.GIT_SSH_VARIANT,'ssh');assert.ok(Object.isFrozen(env));
    for(const value of ['file:ssh','https','ssh -o ProxyCommand=evil',''])assert.throws(()=>releaseAuthorityGitEnvironment(value),/release authority/);
    for(const [key,value] of [['GIT_SSH_COMMAND','/usr/bin/ssh -F /evil'],['GIT_SSH_VARIANT','plink'],['GIT_ALLOW_PROTOCOL','file'],['HOME','/evil']])assert.throws(()=>{env[key]=value;},TypeError);
  } finally {for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

test('no-network OpenSSH config expansion ignores malicious routes and sharing', () => {
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'zaruku-ssh-config-'))),config=path.join(directory,'config'),marker=path.join(directory,'side-effect');
  const saved=process.env.SSH_AUTH_SOCK;
  try {
    delete process.env.SSH_AUTH_SOCK;
    fs.writeFileSync(config,`Host *\n HostName attacker.invalid\n User attacker\n Port 2222\n HostKeyAlias attacker.invalid\n ProxyCommand /usr/bin/touch ${marker}\n PermitLocalCommand yes\n LocalCommand /usr/bin/touch ${marker}\n ForwardAgent yes\n LocalForward 127.0.0.1:19876 127.0.0.1:1\n RemoteForward 19877 127.0.0.1:1\n ControlMaster auto\n ControlPath ${directory}/shared\n ControlPersist 600\n StrictHostKeyChecking no\n UserKnownHostsFile /dev/null\n KnownHostsCommand /usr/bin/touch ${marker}\n`,{mode:0o600});
    const expand=args=>spawnSync('/usr/bin/ssh',['-G','-F',config,...args,'git@github.com'],{env:{PATH:'/usr/bin:/bin',HOME:directory},encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:5000});
    const baseline=expand([]);assert.equal(baseline.status,0);assert.match(baseline.stdout,/^hostname attacker.invalid$/m);assert.match(baseline.stdout,/^port 2222$/m);
    const result=expand(releaseAuthorityGitEnvironment('ssh').GIT_SSH_COMMAND.split(' ').slice(1));
    assert.equal(result.status,0,result.stderr);
    const options=new Map(result.stdout.trim().split('\n').map(line=>{const at=line.indexOf(' ');return [line.slice(0,at),line.slice(at+1)];}));
    for(const [key,value] of Object.entries({hostname:'github.com',user:'git',port:'22',hostkeyalias:'github.com',canonicalizehostname:'false',permitlocalcommand:'no',clearallforwardings:'yes',forwardagent:'no',forwardx11:'no',forwardx11trusted:'no',tunnel:'false',controlmaster:'false',controlpersist:'no',batchmode:'yes',stricthostkeychecking:'true',globalknownhostsfile:'/dev/null',verifyhostkeydns:'false',updatehostkeys:'false'}))assert.equal(options.get(key),value,key);
    assert.equal(options.get('userknownhostsfile'),path.join(os.userInfo().homedir,'.ssh/known_hosts'));
    for(const key of ['proxycommand','proxyjump','localcommand','remotecommand','localforward','remoteforward','dynamicforward','controlpath','knownhostscommand'])assert.ok(!options.has(key)||options.get(key)==='none',key);
    assert.equal(fs.existsSync(marker),false,'ssh -G must not execute any command or open a network connection');
  } finally {if(saved===undefined)delete process.env.SSH_AUTH_SOCK;else process.env.SSH_AUTH_SOCK=saved;fs.rmSync(directory,{recursive:true});}
});

test('release SSH authentication accepts only a canonical owned socket', async () => {
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'zaruku-ssh-auth-'))),socket=path.join(directory,'agent'),alias=path.join(directory,'alias'),regular=path.join(directory,'regular');
  const saved=process.env.SSH_AUTH_SOCK,server=net.createServer();
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});fs.chmodSync(socket,0o600);
    process.env.SSH_AUTH_SOCK=socket;assert.equal(releaseAuthorityGitEnvironment('ssh').SSH_AUTH_SOCK,socket);
    fs.symlinkSync(socket,alias);fs.writeFileSync(regular,'not an agent');
    for(const value of ['relative',regular,alias,path.join(directory,'missing')]){process.env.SSH_AUTH_SOCK=value;assert.throws(()=>releaseAuthorityGitEnvironment('ssh'),/release authority/);}
    fs.chmodSync(directory,0o777);process.env.SSH_AUTH_SOCK=socket;assert.throws(()=>releaseAuthorityGitEnvironment('ssh'),/release authority/);fs.chmodSync(directory,0o700);
    process.env.SSH_AUTH_SOCK='invalid';assert.equal(releaseAuthorityGitEnvironment('file').SSH_AUTH_SOCK,undefined);
  } finally {if(saved===undefined)delete process.env.SSH_AUTH_SOCK;else process.env.SSH_AUTH_SOCK=saved;await new Promise(resolve=>server.close(resolve));fs.chmodSync(directory,0o700);fs.rmSync(directory,{recursive:true});}
});

test('release CLI permits only the agent socket accepted by the SSH authority', async () => {
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'zaruku-ssh-cli-'))),socket=path.join(directory,'agent'),alias=path.join(directory,'alias');
  const saved={SSH_AUTH_SOCK:process.env.SSH_AUTH_SOCK,SSH_ASKPASS:process.env.SSH_ASKPASS},server=net.createServer();
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});fs.chmodSync(socket,0o600);
    process.env.SSH_AUTH_SOCK=socket;delete process.env.SSH_ASKPASS;
    assert.doesNotThrow(()=>assertReleaseAuthorityInvocation([]));
    fs.symlinkSync(socket,alias);process.env.SSH_AUTH_SOCK=alias;
    assert.throws(()=>assertReleaseAuthorityInvocation([]),/release authority/);
    process.env.SSH_AUTH_SOCK=socket;process.env.SSH_ASKPASS='/untrusted-askpass';
    assert.throws(()=>assertReleaseAuthorityInvocation([]),/control operation/);
  } finally {
    for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
    await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true});
  }
});

test('every release-bound production CLI uses the validated agent boundary', () => {
  for(const name of ['stage-zaruku-shadow-control.mjs','provision-zaruku-shadow.mjs','run-zaruku-production-shadow.mjs']) {
    const source=fs.readFileSync(path.join(import.meta.dirname,name),'utf8');
    assert.match(source,/assertReleaseAuthorityInvocation\(/,name);
  }
});

const sha = 'a'.repeat(40), ref = 'refs/heads/release/zaruku';
const predecessorSha = REPOSITORY_AUTHORITY.approvedPredecessor;
const successorSha = 'c'.repeat(40);
function fixture(change = {}) {
  const commands = [];
  const source = { sha, branch: 'codex/candidate', clean: true };
  const adapter = { source: () => source, verifyBase: () => {}, command: args => {
    commands.push(args);
    return { status: 0, stdout: `${sha}\t${ref}\n`, stderr: '' };
  }, ...change };
  return { adapter, commands, source };
}

test('approved successor uses strict ancestry, an exact lease, and exact readback', async () => {
  let remote = predecessorSha;
  const commands = [], ancestry = [];
  const source = {sha:successorSha, branch:'codex/candidate', clean:true};
  const adapter = {
    source: () => source,
    destination: REPOSITORY_AUTHORITY.url,
    verifyBase: () => {},
    verifyAncestor: (ancestor, descendant) => ancestry.push([ancestor, descendant]),
    command: args => {
      commands.push(args);
      if (args[0] === 'push') {
        remote = successorSha;
        return {status:0, stdout:'', stderr:''};
      }
      return {status:0, stdout:`${remote}\t${ref}\n`, stderr:''};
    },
  };
  assert.deepEqual(await advanceApprovedSuccessor(adapter), {
    ref, predecessorSha, successorSha, advanced:true,
  });
  assert.deepEqual(ancestry, [[predecessorSha, successorSha]]);
  assert.deepEqual(commands.find(args => args[0] === 'push'), [
    'push', '--no-verify', '--no-follow-tags', '--recurse-submodules=no',
    '--atomic', `--force-with-lease=${ref}:${predecessorSha}`, '--',
    REPOSITORY_AUTHORITY.url, `${successorSha}:${ref}`,
  ]);
  assert.equal(commands.filter(args => args[0] === 'ls-remote').length, 2);
});

test('approved successor refuses every non-exact or non-fast-forward state', async () => {
  const result = value => value === null
    ? {status:2, stdout:'', stderr:''}
    : {status:0, stdout:`${value}\t${ref}\n`, stderr:''};
  for (const observed of [null, 'd'.repeat(40), successorSha]) {
    const adapter = {
      source: () => ({sha:successorSha, branch:'codex/candidate', clean:true}),
      verifyBase: () => {}, verifyAncestor: () => {},
      command: () => result(observed),
    };
    await assert.rejects(advanceApprovedSuccessor(adapter), /release authority/);
  }
  await assert.rejects(advanceApprovedSuccessor({
    source: () => ({sha:successorSha, branch:'codex/candidate', clean:false}),
  }), /release authority/);
  let sourceRead = 0;
  await assert.rejects(advanceApprovedSuccessor({
    source: () => sourceRead++ === 0
      ? {sha:successorSha, branch:'codex/candidate', clean:true}
      : {sha:'d'.repeat(40), branch:'codex/candidate', clean:true},
    verifyBase: () => {}, verifyAncestor: () => {},
    command: () => result(predecessorSha),
  }), /release authority/);
  await assert.rejects(advanceApprovedSuccessor({
    source: () => ({sha:predecessorSha, branch:'codex/candidate', clean:true}),
  }), /release authority/);
  await assert.rejects(advanceApprovedSuccessor({
    source: () => ({sha:successorSha, branch:'codex/candidate', clean:true}),
    verifyBase: () => {},
    verifyAncestor: () => { throw new Error('not ancestor'); },
    command: () => result(predecessorSha),
  }), /release authority/);
});

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

function successorFixture(race) {
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'zaruku-freeze-')));
  const remote=path.join(directory,'authority.git'),repo=path.join(directory,'candidate');
  const env={PATH:'/usr/bin:/bin',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_ALLOW_PROTOCOL:'file'};
  const git=(cwd,args)=>spawnSync('/usr/bin/git',['-C',cwd,...args],{encoding:'utf8',env});
  try {
    assert.equal(spawnSync('/usr/bin/git',['init','--bare','-q',remote],{env}).status,0);
    assert.equal(spawnSync('/usr/bin/git',['init','-q',repo],{env}).status,0);
    for(const args of [['config','user.name','Fixture'],['config','user.email','fixture@example.invalid'],['checkout','-qb','candidate'],['commit','--allow-empty','-qm','predecessor']])assert.equal(git(repo,args).status,0);
    const localPredecessorSha=git(repo,['rev-parse','HEAD']).stdout.trim();
    assert.equal(git(repo,['commit','--allow-empty','-qm','successor']).status,0);
    const successorSha=git(repo,['rev-parse','HEAD']).stdout.trim();
    assert.equal(git(repo,['checkout','-qb','race',localPredecessorSha]).status,0);
    assert.equal(git(repo,['commit','--allow-empty','-qm','racing successor']).status,0);
    const racingSha=git(repo,['rev-parse','HEAD']).stdout.trim();
    assert.equal(git(repo,['checkout','-q','candidate']).status,0);
    assert.equal(git(repo,['remote','add','origin',remote]).status,0);
    assert.equal(git(repo,['push','-q','origin',`${localPredecessorSha}:${ref}`]).status,0);
    const fixtureAdapter=createFixtureReleaseAuthorityAdapter(directory);
    const commands=[],ancestry=[],translatedPush=[];let raced=false;
    const adapter={...fixtureAdapter,open:async source=>{
      const isolated=await fixtureAdapter.open(source);
      return {...isolated,
        verifyAncestor:(ancestor,descendant)=>{
          ancestry.push([ancestor,descendant]);
          return isolated.verifyAncestor(ancestor===predecessorSha?localPredecessorSha:ancestor,descendant);
        },
        command:args=>{
          commands.push(args);
          if(args[0]==='ls-remote'){
            const result=isolated.command(args);
            return result.stdout===`${localPredecessorSha}\t${ref}\n`
              ? {...result,stdout:`${predecessorSha}\t${ref}\n`}
              : result;
          }
          if(args[0]==='push'){
            if(race&&!raced){
              raced=true;
              assert.equal(git(repo,['push','-q','origin',`${racingSha}:${ref}`]).status,0);
            }
            const translated=args.map(arg=>arg===`--force-with-lease=${ref}:${predecessorSha}`?`--force-with-lease=${ref}:${localPredecessorSha}`:arg);
            translatedPush.push(...translated);
            return isolated.command(translated);
          }
          return isolated.command(args);
        }};
    }};
    return {adapter,ancestry,commands,directory,git,localPredecessorSha,remote,racingSha,successorSha,translatedPush,close:()=>fs.rmSync(directory,{recursive:true})};
  } catch(error) {fs.rmSync(directory,{recursive:true});throw error;}
}

test('successor seam publishes an unraced ref', async () => {
  const fixture=successorFixture(false);
  try {
    assert.deepEqual(await advanceApprovedSuccessor(fixture.adapter),{
      ref,predecessorSha,successorSha:fixture.successorSha,advanced:true,
    });
    assert.deepEqual(fixture.ancestry,[[predecessorSha,fixture.successorSha]]);
    assert.deepEqual(fixture.commands.find(args=>args[0]==='push'),[
      'push','--no-verify','--no-follow-tags','--recurse-submodules=no',
      '--atomic',`--force-with-lease=${ref}:${predecessorSha}`,'--',fixture.remote,
      `${fixture.successorSha}:${ref}`,
    ]);
    assert.deepEqual(fixture.translatedPush,[
      'push','--no-verify','--no-follow-tags','--recurse-submodules=no',
      '--atomic',`--force-with-lease=${ref}:${fixture.localPredecessorSha}`,'--',fixture.remote,
      `${fixture.successorSha}:${ref}`,
    ]);
    assert.equal(fixture.commands.filter(args=>args[0]==='ls-remote').length,2);
    assert.equal(fixture.git(fixture.remote,['rev-parse',ref]).stdout.trim(),fixture.successorSha);
    assert.equal(fixture.git(fixture.remote,['for-each-ref','--format=%(refname)']).stdout,ref+'\n');
  } finally {fixture.close();}
});

test('successor lease refuses a racing ref', async () => {
  const fixture=successorFixture(true);
  try {
    await assert.rejects(advanceApprovedSuccessor(fixture.adapter), /release authority/);
    assert.deepEqual(fixture.ancestry,[[predecessorSha,fixture.successorSha]]);
    assert.deepEqual(fixture.commands.find(args=>args[0]==='push'),[
      'push','--no-verify','--no-follow-tags','--recurse-submodules=no',
      '--atomic',`--force-with-lease=${ref}:${predecessorSha}`,'--',fixture.remote,
      `${fixture.successorSha}:${ref}`,
    ]);
    assert.deepEqual(fixture.translatedPush,[
      'push','--no-verify','--no-follow-tags','--recurse-submodules=no',
      '--atomic',`--force-with-lease=${ref}:${fixture.localPredecessorSha}`,'--',fixture.remote,
      `${fixture.successorSha}:${ref}`,
    ]);
    assert.equal(fixture.git(fixture.remote,['rev-parse',ref]).stdout.trim(),fixture.racingSha);
    assert.equal(fixture.git(fixture.remote,['for-each-ref','--format=%(refname)']).stdout,ref+'\n');
    assert.notEqual(fixture.successorSha,fixture.racingSha);
  } finally {fixture.close();}
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
