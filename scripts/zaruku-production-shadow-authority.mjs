import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const SHADOW_CONTROL_FILES=Object.freeze([
  'deploy/zaruku/mysql-read-tables.json','deploy/zaruku/production-shadow.json','deploy/zaruku/release.json',
  'scripts/install-zaruku-shadow-auth.mjs','scripts/install-zaruku-shadow-inventory.mjs','scripts/runtime-release-remote.mjs','scripts/verify-zaruku-shadow.sh',
  'scripts/zaruku-production-shadow-authority.mjs','scripts/zaruku-production-shadow-preflight.mjs','scripts/zaruku-production-shadow-worker.mjs',
  'scripts/zaruku-shadow-coverage.mjs','scripts/zaruku-shadow-db.mjs','scripts/zaruku-shadow-evidence-lock.py','scripts/zaruku-shadow-host.mjs','scripts/zaruku-shadow-mysql.py','scripts/zaruku-xlsx-semantic.py',
]);

const SHADOW_AUTHORITY = Object.freeze({
  scope: 'zaruku', combinedUrl: 'http://127.0.0.1:3001', isolatedUrl: 'http://127.0.0.1:3002',
  serviceAccount: 'dashboard-zaruku', mysqlAccount: 'dashboard_zaruku_reader@127.0.0.1', mysqlDatabase: 'report_bd',
  secretFile: '/var/www/.dashboard-zaruku-secrets/runtime.env',
  authDescriptor: '/var/www/.dashboard-zaruku-shadow/auth.json',
  otherRuntimeShas: '/var/www/.dashboard-zaruku-shadow/other-runtime-shas.tsv',
  otherRuntimeShaEntries: Object.freeze([Object.freeze({name:'combined-dashboard',path:'/var/www/dashboard/.release-source-sha'})]),
  evidenceRoot: '/var/www/.dashboard-zaruku-shadow/evidence',
  verifierTimeout: Object.freeze({binary:'/usr/bin/timeout',seconds:180,killAfterSeconds:5,lockWaitSeconds:210}),
  period: Object.freeze({ from: '2026-01-01', to: '2026-08-31' }), httpTimeoutMs: 15000, publicCutover: false,
});
const fail = label => { throw new Error(`Invalid ${label} authority`); };
const exactKeys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());

export function readJsonObject(filename, label) {
  try {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.nlink !== 1) fail(label);
    const text=fs.readFileSync(filename, 'utf8'), parsed = JSON.parse(text);
    // Committed authorities use canonical JSON tokens. This comparison retains
    // strings while stripping whitespace, so duplicate/escaped aliases fail.
    if (text.replace(/"(?:[^"\\]|\\.)*"|\s+/g, token=>token.startsWith('"')?token:'') !== JSON.stringify(parsed)) fail(label);
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') fail(label);
    return parsed;
  } catch { fail(label); }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function loadShadowAuthority(filename) {
  const parsed = readJsonObject(filename, 'production-shadow');
  if (!exactKeys(parsed, Object.keys(SHADOW_AUTHORITY)) || !exactKeys(parsed.period, ['from', 'to']) || !isDeepStrictEqual(parsed, SHADOW_AUTHORITY)) fail('production-shadow contract');
  for (const key of ['secretFile', 'authDescriptor', 'otherRuntimeShas', 'evidenceRoot']) {
    if (!path.posix.isAbsolute(parsed[key]) || path.posix.normalize(parsed[key]) !== parsed[key]) fail('production-shadow path contract');
  }
  return deepFreeze(parsed);
}

export function loadMysqlTableAuthority(filename) {
  const parsed = readJsonObject(filename, 'MySQL table');
  if (!exactKeys(parsed, ['account', 'database', 'scope', 'tables']) || parsed.scope !== 'zaruku' || parsed.account !== SHADOW_AUTHORITY.mysqlAccount || parsed.database !== SHADOW_AUTHORITY.mysqlDatabase || !Array.isArray(parsed.tables) || !parsed.tables.length) fail('MySQL table contract');
  if (parsed.tables.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name)) || new Set(parsed.tables).size !== parsed.tables.length || !isDeepStrictEqual(parsed.tables, [...parsed.tables].sort())) fail('MySQL table sorted contract');
  return deepFreeze(parsed);
}
