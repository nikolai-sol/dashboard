import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function inventoryMain(args=process.argv.slice(2),adapter) {
  try {
    if(args.length>1||args.length&&!['check','install'].includes(args[0]))throw new Error();
    if(!adapter)throw new Error('Use the staged dispatcher');
    const method=args[0]??'check';
    const result=await adapter[method]();
    return adapter?result:{passed:true,sha256:result.inventorySha256,entries:result.foreignShas.length};
  }catch{throw new Error('Zaruku fixed inventory check/install failed');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{process.stdout.write(JSON.stringify(await inventoryMain())+'\n');}
  catch{process.stderr.write('Zaruku fixed inventory check/install failed\n');process.exitCode=1;}
}
