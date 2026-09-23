import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXACT = ["/dashboard/18","/dashboard/18/","/dashboard/abbott","/dashboard/abbott/","/api/dashboard/18","/api/dashboard/18/pdf","/api/dashboard/18/excel","/api/dashboard/18/abbott-admin-users","/api/dashboard/abbott","/api/dashboard/abbott/pdf","/api/dashboard/abbott/excel","/api/dashboard/abbott/abbott-admin-users"];
const DIRECTIONS = [
  'proxy_pass http://127.0.0.1:3004;',
  'proxy_set_header Host $host;',
  'proxy_set_header X-Real-IP $remote_addr;',
  'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
  'proxy_set_header X-Forwarded-Proto $scheme;',
];

// Deliberately accepts only this small, auditable fragment grammar. Unknown
// directives (including nested locations, includes and rewrites) fail closed.
export function validateAbbottNginxRoutes(text) {
  const source = text.replace(/#[^\n]*/g, '').trim();
  const locations = new Map();
  let offset = 0;
  const block = /\s*location\s+(=|\^~)\s+(\/[^\s{};]+)\s*\{([^{}]*)\}/y;
  while (offset < source.length) {
    block.lastIndex = offset;
    const match = block.exec(source);
    if (!match) throw new Error('Invalid Abbott Nginx fragment');
    const [, modifier, route, body] = match;
    const identity = modifier + ' ' + route;
    if (locations.has(identity)) throw new Error('Duplicate Abbott location');
    const directives = body.trim().split(';').slice(0, -1).map(value => value.trim().replace(/\s+/g, ' ') + ';');
    if (!body.trim().endsWith(';') || directives.length !== DIRECTIONS.length || directives.some((line, i) => line !== DIRECTIONS[i])) throw new Error('Unexpected Abbott proxy directive');
    locations.set(identity, true);
    offset = block.lastIndex;
  }
  const expected = [...EXACT.map(route => '= ' + route), '^~ /_next-abbott/'];
  if (locations.size !== expected.length || expected.some(route => !locations.has(route))) throw new Error('Unexpected Abbott route ownership');
  return '12 exact Abbott routes, 1 Abbott asset prefix, upstream 127.0.0.1:3004';
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Expected one Nginx fragment');
    console.log(validateAbbottNginxRoutes(fs.readFileSync(process.argv[2], 'utf8')));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
