// Deprecated CLI: deliberately no implementation import or re-export.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function authMain() {
  process.stderr.write('Failed to install Zaruku auth descriptor; use the staged dispatcher\n');
  process.exitCode = 1;
}
let refuseDirect = false;
try {
  const modulePath = fs.realpathSync(fileURLToPath(import.meta.url));
  refuseDirect = Boolean(process.argv[1]) && fs.realpathSync(path.resolve(process.argv[1])) === modulePath;
} catch { refuseDirect = true; }
if (refuseDirect) authMain();
