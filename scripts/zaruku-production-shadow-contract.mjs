import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';

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
const RUNTIME_SOURCE_EXTENSIONS = Object.freeze(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

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

const DYNAMIC_SQL = '__ZARUKU_DYNAMIC_SQL__';

function unwrapExpression(expression) {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) ||
         ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current) ||
         ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

function collectStaticSqlExpressions(source, filename) {
  const extension = path.extname(filename);
  const scriptKind = extension === '.tsx' ? ts.ScriptKind.TSX
    : extension === '.jsx' ? ts.ScriptKind.JSX
      : ['.js', '.mjs', '.cjs'].includes(extension) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, scriptKind);
  if (sourceFile.parseDiagnostics.length) fail('Zaruku runtime SQL parse');
  const bindings = new Map();
  const functions = new Map();

  function collectDefinitions(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer);
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
        functions.set(node.name.text, node.initializer);
      }
    } else if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      functions.set(node.name.text, node);
    }
    ts.forEachChild(node, collectDefinitions);
  }
  collectDefinitions(sourceFile);

  function functionReturns(fn) {
    if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return [fn.body];
    const returns = [];
    function visit(node) {
      if (node !== fn && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) return;
      if (ts.isReturnStatement(node) && node.expression) returns.push(node.expression);
      ts.forEachChild(node, visit);
    }
    if (fn.body) visit(fn.body);
    return returns;
  }

  function evaluate(expression, resolving = new Set()) {
    const node = unwrapExpression(expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      for (const span of node.templateSpans) {
        text += evaluate(span.expression, resolving) ?? DYNAMIC_SQL;
        text += span.literal.text;
      }
      return text;
    }
    if (ts.isTaggedTemplateExpression(node)) return evaluate(node.template, resolving);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = evaluate(node.left, resolving);
      const right = evaluate(node.right, resolving);
      if (left === null && right === null) return null;
      return `${left ?? DYNAMIC_SQL}${right ?? DYNAMIC_SQL}`;
    }
    if (ts.isConditionalExpression(node)) {
      const whenTrue = evaluate(node.whenTrue, resolving);
      const whenFalse = evaluate(node.whenFalse, resolving);
      if (whenTrue === null && whenFalse === null) return null;
      return `${whenTrue ?? DYNAMIC_SQL};\n${whenFalse ?? DYNAMIC_SQL}`;
    }
    if (ts.isIdentifier(node)) {
      const key = `binding:${node.text}`;
      if (resolving.has(key) || !bindings.has(node.text)) return null;
      const next = new Set(resolving).add(key);
      return evaluate(bindings.get(node.text), next);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && functions.has(node.expression.text)) {
      const key = `function:${node.expression.text}`;
      if (resolving.has(key)) return null;
      const next = new Set(resolving).add(key);
      const values = functionReturns(functions.get(node.expression.text))
        .map(result => evaluate(result, next))
        .filter(value => value !== null);
      return values.length ? values.join(';\n') : null;
    }
    return null;
  }

  const statements = new Set();
  function add(expression) {
    const text = evaluate(expression);
    if (text !== null && /\b(?:SELECT|WITH|FROM|JOIN)\b/.test(text)) statements.add(text);
  }
  function collectCandidates(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) add(node.initializer);
    if (ts.isPropertyAssignment(node) &&
        ((ts.isIdentifier(node.name) && node.name.text === 'sql') ||
         (ts.isStringLiteral(node.name) && node.name.text === 'sql'))) {
      add(node.initializer);
    }
    if (ts.isReturnStatement(node) && node.expression) add(node.expression);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ['execute', 'query'].includes(node.expression.name.text) && node.arguments[0]) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, collectCandidates);
  }
  collectCandidates(sourceFile);
  return statements;
}

function statementTableReferences(statement) {
  if (new RegExp(`\\b(?:FROM|JOIN)\\s+(?:${DYNAMIC_SQL}|(?:\`?report_bd\`?\\s*\\.\\s*)?${DYNAMIC_SQL})`, 'i').test(statement)) {
    fail('Zaruku runtime dynamic SQL owner');
  }
  const ctes = new Set(
    [...statement.matchAll(/\b([a-z][a-z0-9_]*)\s+AS\s*\(/gi)].map(match => match[1].toLowerCase()),
  );
  const tables = new Set();
  const reference = /\b(?:FROM|JOIN)\s+`?([a-z][a-z0-9_]*)`?(?:\s*\.\s*`?([a-z][a-z0-9_]*)`?)?/gi;
  for (const match of statement.matchAll(reference)) {
    const schemaOrTable = match[1].toLowerCase();
    const qualifiedTable = match[2]?.toLowerCase();
    if (qualifiedTable && schemaOrTable !== 'report_bd') fail('Zaruku runtime foreign-schema SQL owner');
    const table = qualifiedTable ?? schemaOrTable;
    if (!ctes.has(table)) tables.add(table);
  }
  return tables;
}

function sqlTableReferences(source, filename) {
  const tables = new Set();
  for (const statement of collectStaticSqlExpressions(source, filename)) {
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
