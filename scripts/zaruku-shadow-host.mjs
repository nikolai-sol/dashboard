// Deprecated CLI: deliberately no implementation import or re-export.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function hostMain() {
  process.stderr.write('Refusing Zaruku host boundary operation; use the staged dispatcher\n');
  process.exitCode = 1;
}
if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) hostMain();
