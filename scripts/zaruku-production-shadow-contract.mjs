import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { RUNTIME_MANIFESTS } from '../packages/runtime-contract/src/index.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const RELEASE_AUTHORITY = path.join(ROOT, 'deploy/zaruku/release.json');

const SHADOW_AUTHORITY = Object.freeze({
  scope: 'zaruku',
  combinedUrl: 'http://127.0.0.1:3001',
  isolatedUrl: 'http://127.0.0.1:3002',
  serviceAccount: 'dashboard-zaruku',
  mysqlAccount: 'dashboard_zaruku_reader@127.0.0.1',
  mysqlDatabase: 'report_bd',
  secretFile: '/var/www/.dashboard-zaruku-secrets/runtime.env',
  authDescriptor: '/var/www/.dashboard-zaruku-shadow/auth.json',
  otherRuntimeShas: '/var/www/.dashboard-zaruku-shadow/other-runtime-shas.tsv',
  evidenceRoot: '/var/www/.dashboard-zaruku-shadow/evidence',
  period: Object.freeze({ from: '2026-01-01', to: '2026-08-31' }),
  httpTimeoutMs: 15000,
  publicCutover: false,
});

const SHADOW_KEYS = Object.freeze(Object.keys(SHADOW_AUTHORITY).sort());
const MYSQL_KEYS = Object.freeze(['account', 'database', 'scope', 'tables']);
const TABLE_NAME = /^[a-z][a-z0-9_]*$/;

function fail(label) {
  throw new Error(`Invalid ${label} authority`);
}

function readJsonObject(filename, label) {
  let stat;
  try {
    stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.nlink !== 1) fail(label);
    const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') fail(label);
    return parsed;
  } catch (error) {
    if (error?.message === `Invalid ${label} authority`) throw error;
    fail(label);
  }
}

function exactKeys(value, expected) {
  return isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function assertReleaseCrossContract() {
  const release = readJsonObject(RELEASE_AUTHORITY, 'Zaruku release');
  if (!isDeepStrictEqual(release, RUNTIME_MANIFESTS.zaruku)) fail('Zaruku release cross-contract');
  if (RUNTIME_MANIFESTS.zaruku.scope !== SHADOW_AUTHORITY.scope ||
      RUNTIME_MANIFESTS.zaruku.port !== Number(new URL(SHADOW_AUTHORITY.isolatedUrl).port) ||
      RUNTIME_MANIFESTS.zaruku.appName !== SHADOW_AUTHORITY.serviceAccount) {
    fail('Zaruku runtime cross-contract');
  }
}

export function loadShadowAuthority(filename) {
  const parsed = readJsonObject(filename, 'production-shadow');
  if (!exactKeys(parsed, SHADOW_KEYS) || !exactKeys(parsed.period ?? {}, ['from', 'to'])) fail('production-shadow contract');
  if (!isDeepStrictEqual(parsed, SHADOW_AUTHORITY)) fail('production-shadow contract');

  for (const key of ['secretFile', 'authDescriptor', 'otherRuntimeShas', 'evidenceRoot']) {
    if (!path.posix.isAbsolute(parsed[key]) || path.posix.normalize(parsed[key]) !== parsed[key]) fail('production-shadow path contract');
  }
  for (const key of ['combinedUrl', 'isolatedUrl']) {
    const url = new URL(parsed[key]);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      fail('production-shadow loopback contract');
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.period.from) || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.period.to) || parsed.period.from > parsed.period.to) {
    fail('production-shadow period contract');
  }
  assertReleaseCrossContract();
  return deepFreeze(parsed);
}

export function loadMysqlTableAuthority(filename) {
  const parsed = readJsonObject(filename, 'MySQL table');
  if (!exactKeys(parsed, MYSQL_KEYS) || parsed.scope !== 'zaruku' ||
      parsed.account !== SHADOW_AUTHORITY.mysqlAccount || parsed.database !== SHADOW_AUTHORITY.mysqlDatabase ||
      !Array.isArray(parsed.tables) || parsed.tables.length === 0) fail('MySQL table contract');
  if (parsed.tables.some(name => typeof name !== 'string' || !TABLE_NAME.test(name)) ||
      new Set(parsed.tables).size !== parsed.tables.length ||
      !isDeepStrictEqual(parsed.tables, [...parsed.tables].sort())) fail('MySQL table sorted contract');
  return deepFreeze(parsed);
}
