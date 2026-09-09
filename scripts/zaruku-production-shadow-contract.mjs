import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { RUNTIME_MANIFESTS } from '../packages/runtime-contract/src/manifest.mjs';
import { loadShadowAuthority as loadRuntimeShadowAuthority, readJsonObject } from './zaruku-production-shadow-authority.mjs';
import { extractStaticSql } from './zaruku-static-sql.mjs';
export { loadMysqlTableAuthority } from './zaruku-production-shadow-authority.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const RELEASE_AUTHORITY = path.join(ROOT, 'deploy/zaruku/release.json');
const RUNTIME_SOURCE_EXTENSIONS = Object.freeze(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const DYNAMIC_SQL = '__ZARUKU_DYNAMIC_SQL__';

function fail(label) { throw new Error(`Invalid ${label} authority`); }

export function loadShadowAuthority(filename) {
  const parsed = loadRuntimeShadowAuthority(filename);
  const release = readJsonObject(RELEASE_AUTHORITY, 'Zaruku release');
  if (!isDeepStrictEqual(release, RUNTIME_MANIFESTS.zaruku)) fail('Zaruku release cross-contract');
  if (release.scope !== parsed.scope || release.port !== Number(new URL(parsed.isolatedUrl).port) || release.appName !== parsed.serviceAccount) fail('Zaruku runtime cross-contract');
  return parsed;
}

function runtimeSourceFile(filename) {
  return RUNTIME_SOURCE_EXTENSIONS.includes(path.extname(filename)) &&
    !/\.(?:test|spec)\.[^.]+$/.test(filename) &&
    !filename.split(path.sep).some(part => part.startsWith('.next') || part === 'node_modules');
}

function listRuntimeSources(directory) {
  const sources = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && !entry.name.startsWith('.next')) {
        sources.push(...listRuntimeSources(filename));
      }
    } else if (entry.isFile() && runtimeSourceFile(filename)) {
      sources.push(filename);
    }
  }
  return sources;
}

function importSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return specifiers;
}

function resolveRuntimeImport(rootDirectory, importer, specifier) {
  let candidate;
  if (specifier.startsWith('@/')) {
    candidate = path.join(rootDirectory, 'src', specifier.slice(2));
  } else if (specifier.startsWith('@zaruku/')) {
    candidate = path.join(rootDirectory, 'apps/zaruku/src', specifier.slice('@zaruku/'.length));
  } else if (specifier === '@reportingdash/runtime-contract') {
    candidate = path.join(rootDirectory, 'packages/runtime-contract/src/index');
  } else if (specifier.startsWith('.')) {
    candidate = path.resolve(path.dirname(importer), specifier);
  } else {
    return null;
  }

  const normalizedRoot = `${path.resolve(rootDirectory)}${path.sep}`;
  const resolvedCandidate = path.resolve(candidate);
  if (!`${resolvedCandidate}${path.sep}`.startsWith(normalizedRoot) && !resolvedCandidate.startsWith(normalizedRoot)) fail('Zaruku runtime SQL owner');
  const choices = [
    resolvedCandidate,
    ...RUNTIME_SOURCE_EXTENSIONS.map(extension => `${resolvedCandidate}${extension}`),
    ...RUNTIME_SOURCE_EXTENSIONS.map(extension => path.join(resolvedCandidate, `index${extension}`)),
  ];
  return choices.find(filename => {
    try {
      return fs.statSync(filename).isFile() && runtimeSourceFile(filename);
    } catch {
      return false;
    }
  }) ?? null;
}

function sqlTokens(statement) {
  const tokens = [];
  for (let index = 0; index < statement.length;) {
    const rest = statement.slice(index);
    const space = /^\s+/.exec(rest);
    if (space) { index += space[0].length; continue; }
    if (rest.startsWith('/*')) {
      const end = statement.indexOf('*/', index + 2);
      if (end < 0 || rest.startsWith('/*!') || rest.startsWith('/*+')) fail('Zaruku runtime unsupported SQL comment');
      index = end + 2; continue;
    }
    if (/^--\s/.test(rest) || rest.startsWith('#')) {
      const end = statement.indexOf('\n', index);
      index = end < 0 ? statement.length : end + 1; continue;
    }
    if (rest[0] === "'" || rest[0] === '"' || rest[0] === '`') {
      const quote = rest[0]; let value = '', closed = false;
      for (index++; index < statement.length; index++) {
        const char = statement[index];
        if (char === '\\') fail('Zaruku runtime unsupported SQL escape');
        if (char !== quote) { value += char; continue; }
        if (statement[index + 1] === quote) { value += char; index++; continue; }
        index++; closed = true; break;
      }
      if (!closed) fail('Zaruku runtime unterminated SQL token');
      tokens.push({ value: quote === '`' ? value.toLowerCase() : '', identifier: quote === '`', quoted: true });
      continue;
    }
    const identifier = /^[a-z_][a-z0-9_$]*/i.exec(rest);
    if (identifier) { tokens.push({ value: identifier[0].toLowerCase(), identifier: true }); index += identifier[0].length; }
    else { tokens.push({ value: rest[0], identifier: false }); index++; }
  }
  return tokens;
}

function statementTableReferences(statement) {
  const tokens = sqlTokens(statement), tables = new Set(), closing = new Map(), stack = [];
  const keyword = (token, value) => token?.value === value && !token.quoted;
  const punctuation = (token, value) => token?.value === value && !token.quoted;
  for (let index = 0; index < tokens.length; index++) {
    if (punctuation(tokens[index], '(')) stack.push(index);
    if (punctuation(tokens[index], ')')) {
      if (!stack.length) fail('Zaruku runtime unbalanced SQL owner');
      closing.set(stack.pop(), index);
    }
  }
  if (stack.length) fail('Zaruku runtime unbalanced SQL owner');
  function scan(start, end, inherited = new Set()) {
    const ctes = new Set(inherited);
    let cursor = start, from = false, expected = false;
    if (keyword(tokens[cursor], 'with')) {
      cursor++;
      const recursive = keyword(tokens[cursor], 'recursive');
      if (recursive) cursor++;
      while (true) {
        const alias = tokens[cursor];
        if (!alias?.identifier || !keyword(tokens[cursor + 1], 'as') || !punctuation(tokens[cursor + 2], '(')) fail('Zaruku runtime unsupported CTE SQL owner');
        const close = closing.get(cursor + 2);
        if (close >= end) fail('Zaruku runtime unsupported CTE SQL owner');
        // A nonrecursive CTE cannot conceal a physical table in its own body;
        // later CTEs and the containing query can reference the completed alias.
        scan(cursor + 3, close, recursive ? new Set([...ctes, alias.value]) : ctes);
        ctes.add(alias.value); cursor = close + 1;
        if (!punctuation(tokens[cursor], ',')) break;
        cursor++;
      }
    }
    for (let index = cursor; index < end; index++) {
      const token = tokens[index];
      if (punctuation(token, '(')) {
        if (expected) {
          let query = index + 1;
          while (punctuation(tokens[query], '(')) query++;
          if (!keyword(tokens[query], 'select') && !keyword(tokens[query], 'with')) fail('Zaruku runtime grouped-table SQL owner unsupported');
        }
        expected = false;
        const close = closing.get(index); scan(index + 1, close, ctes); index = close; continue;
      }
      if (punctuation(token, ';')) {
        if (index !== end - 1) fail('Zaruku runtime multiple SQL statements unsupported');
        continue;
      }
      if (keyword(token, 'with') && (keyword(tokens[index + 1], 'recursive') || keyword(tokens[index + 2], 'as'))) fail('Zaruku runtime unsupported CTE SQL owner');
      if (keyword(token, 'from') || keyword(token, 'join')) { from = true; expected = true; continue; }
      if (!token.quoted && ['where', 'group', 'having', 'order', 'limit', 'union', 'except', 'intersect', 'window', 'for', 'into', 'set', 'values'].includes(token.value)) { from = false; expected = false; continue; }
      if (punctuation(token, ',') && from) { expected = true; continue; }
      if (!expected) continue;
      expected = false;
      if (!token.identifier || token.value === DYNAMIC_SQL.toLowerCase()) fail('Zaruku runtime dynamic SQL owner');
      let table = token.value, qualified = false;
      if (punctuation(tokens[index + 1], '.')) {
        if (table !== 'report_bd') fail('Zaruku runtime foreign-schema SQL owner');
        const next = tokens[index + 2];
        if (!next?.identifier || next.value === DYNAMIC_SQL.toLowerCase()) fail('Zaruku runtime dynamic SQL owner');
        table = next.value; qualified = true; index += 2;
        if (punctuation(tokens[index + 1], '.')) fail('Zaruku runtime unsupported SQL owner');
      }
      if (qualified || !ctes.has(table)) tables.add(table);
    }
    if (expected) fail('Zaruku runtime incomplete SQL owner');
  }
  scan(0, tokens.length);
  return tables;
}

function sqlTableReferences(source, filename) {
  const tables = new Set();
  for (const statement of extractStaticSql(source, filename).statements) {
    for (const table of statementTableReferences(statement)) tables.add(table);
  }
  return tables;
}

export function scanZarukuRuntimeMysqlTables(rootDirectory = ROOT) {
  const resolvedRoot = path.resolve(rootDirectory);
  const entryDirectory = path.join(resolvedRoot, 'apps/zaruku');
  let entries;
  try {
    entries = listRuntimeSources(entryDirectory);
  } catch {
    fail('Zaruku runtime SQL owner');
  }
  if (entries.length === 0) fail('Zaruku runtime SQL owner');

  const pending = [...entries];
  const visited = new Set();
  const tables = new Set();
  while (pending.length) {
    const filename = pending.pop();
    if (visited.has(filename)) continue;
    visited.add(filename);
    const source = fs.readFileSync(filename, 'utf8');
    for (const table of sqlTableReferences(source, filename)) tables.add(table);
    for (const specifier of importSpecifiers(source)) {
      const dependency = resolveRuntimeImport(resolvedRoot, filename, specifier);
      if (dependency && !visited.has(dependency)) pending.push(dependency);
    }
  }
  return Object.freeze([...tables].sort());
}
