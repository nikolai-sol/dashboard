import path from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { assertReleaseAuthorityInvocation, createReleaseAuthorityAdapter, requireExactShadowRelease } from './freeze-zaruku-shadow-release.mjs';
import { CONTROL_FILES, prepareReviewedControl, readControlSource, receiveControlPayload } from './stage-zaruku-shadow-control.mjs';

const ACTIONS = ['host-check','host-apply','host-rollback','db-provision','auth-install','inventory-check','inventory-install'];
const fail = () => { throw new Error('Zaruku fixed provisioning refused'); };
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

export function provisionArguments(action, prepared) {
  if (!ACTIONS.includes(action) || !/^[a-f0-9]{64}$/.test(prepared.digest)) fail();
  // Only public reviewed control bytes enter argv. stdin remains exclusively the
  // auth input; the complete closure (including dispatcher) is checked before it.
  const compressed = brotliCompressSync(prepared.bytes).toString('base64');
  const code = `const CONTROL_FILES=${JSON.stringify(CONTROL_FILES)};const inspect=(${receiveControlPayload.toString()});try{const z=await import('node:zlib');const c=await inspect(z.brotliDecompressSync(Buffer.from('${compressed}','base64'),{maxOutputLength:2097152}),'${prepared.digest}',undefined,true);const m=await import('file://'+c.destination.path+'/scripts/zaruku-shadow-dispatch.mjs');process.stdout.write(JSON.stringify(await m.dispatchStaged('${action}'))+'\\n');}catch{process.stderr.write('Zaruku fixed provisioning refused\\n');process.exitCode=1;}`;
  const command = `/usr/bin/env -i /usr/bin/node --input-type=module -e ${quote(code)}`;
  if (Buffer.byteLength(command) > 120000) fail();
  return ['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',...(action==='auth-install'?['-tt']:[]),'--','beget',command];
}

export async function provisionShadow(action, adapter) {
  if (!ACTIONS.includes(action)) fail();
  const source = await adapter.source();
  await requireExactShadowRelease(adapter, source.sha);
  const prepared = await prepareReviewedControl(adapter, source.sha);
  await requireExactShadowRelease(adapter, source.sha);
  return adapter.dispatch(provisionArguments(action, prepared), action);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    assertReleaseAuthorityInvocation([]);
    if (process.argv.length !== 3) fail();
    const adapter = {...createReleaseAuthorityAdapter(),readFile:readControlSource,dispatch(args,action) {
      const result=spawnSync('/usr/bin/ssh',args,{env:{PATH:'/usr/bin:/bin'},stdio:[action==='auth-install'?'inherit':'ignore','pipe','pipe'],timeout:120000,maxBuffer:65536,encoding:'utf8'});
      if(result.error||result.signal||result.status!==0||result.stderr)fail();
      return JSON.parse(result.stdout);
    }};
    process.stdout.write(JSON.stringify(await provisionShadow(process.argv[2],adapter))+'\n');
  } catch {process.stderr.write('Zaruku fixed provisioning refused\n');process.exitCode=1;}
}
