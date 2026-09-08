import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';
import { RUNTIME_MANIFESTS } from '../packages/runtime-contract/src/index.ts';
import { loadShadowAuthority as loadRuntimeShadowAuthority, readJsonObject } from './zaruku-production-shadow-authority.mjs';
export { loadMysqlTableAuthority } from './zaruku-production-shadow-authority.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const RELEASE_AUTHORITY = path.join(ROOT, 'deploy/zaruku/release.json');
const RUNTIME_SOURCE_EXTENSIONS = Object.freeze(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

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

const DYNAMIC_SQL = '__ZARUKU_DYNAMIC_SQL__';
const UNSAFE_SQL = '__ZARUKU_UNSAFE_SQL_COMPOSITION__';

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

  // Joined map members are evaluated in order over a concrete array, never as
  // independent callback alternatives. Captured unknown scalar conditions fork
  // the entire evaluation, so a shared condition remains shared across members.
  // The only unknown-cardinality language is the exact parameter-only grammar.
  function composedJoin(expression) {
    const CAP = 64;
    class Unsupported extends Error {}
    class Choice extends Error { constructor(key) { super(); this.key=key; } }
    const unsupported=()=>{throw new Unsupported();};
    const unknown=key=>({unknown:key});
    const isUnknown=value=>value&&typeof value==='object'&&Object.hasOwn(value,'unknown');
    const primitive=value=>{if(isUnknown(value)||!['string','number','boolean'].includes(typeof value))unsupported();return value;};
    function declaration(node,name) {
      for(let scope=node.parent;scope;scope=scope.parent) {
        if(ts.isFunctionLike(scope))for(const parameter of scope.parameters)if(ts.isIdentifier(parameter.name)&&parameter.name.text===name)return parameter;
        if(ts.isBlock(scope)||ts.isSourceFile(scope))for(const statement of scope.statements) {
          if(ts.isFunctionDeclaration(statement)&&statement.name?.text===name)return statement;
          if(ts.isVariableStatement(statement))for(const item of statement.declarationList.declarations)if(ts.isIdentifier(item.name)&&item.name.text===name)return item;
        }
      }
      return null;
    }
    const inside=(node,fn)=>{for(let parent=node.parent;parent;parent=parent.parent)if(parent===fn)return true;return false;};
    function run(decisions) {
      const active=new Set(),visiting=new Set();
      function condition(value) {
        if(!isUnknown(value))return Boolean(primitive(value));
        if(!decisions.has(value.unknown))throw new Choice(value.unknown);
        return decisions.get(value.unknown);
      }
      function invoke(fn,args,frame,depth) {
        if(active.has(fn)||!fn.body||fn.asteriskToken||fn.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.AsyncKeyword)||fn.parameters.some(parameter=>!ts.isIdentifier(parameter.name)||parameter.dotDotDotToken))unsupported();
        const local=new Map(frame);
        fn.parameters.forEach((parameter,index)=>local.set(parameter,args[index]??unknown(`parameter:${parameter.pos}`)));
        active.add(fn);
        try {
          if(!ts.isBlock(fn.body))return value(fn.body,local,depth+1);
          function statements(block) {
            for(const statement of block.statements) {
              if(ts.isVariableStatement(statement)&&(statement.declarationList.flags&ts.NodeFlags.Const)) {
                for(const item of statement.declarationList.declarations) {
                  if(!ts.isIdentifier(item.name)||!item.initializer)unsupported();
                  local.set(item,value(item.initializer,local,depth+1));
                }
              } else if(ts.isReturnStatement(statement)&&statement.expression)return {returned:value(statement.expression,local,depth+1)};
              else if(ts.isIfStatement(statement)) {
                const branch=condition(value(statement.expression,local,depth+1))?statement.thenStatement:statement.elseStatement;
                if(!branch)continue;
                const result=ts.isBlock(branch)?statements(branch):ts.isReturnStatement(branch)&&branch.expression?{returned:value(branch.expression,local,depth+1)}:unsupported();
                if(result)return result;
              } else unsupported();
            }
          }
          const result=statements(fn.body);if(!result)unsupported();return result.returned;
        } finally {active.delete(fn);}
      }
      function value(expression,frame=new Map(),depth=0) {
        if(depth>128)unsupported();
        const node=unwrapExpression(expression);
        if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return node.text;
        if(ts.isNumericLiteral(node))return Number(node.text);
        if(node.kind===ts.SyntaxKind.TrueKeyword)return true;
        if(node.kind===ts.SyntaxKind.FalseKeyword)return false;
        if(ts.isIdentifier(node)) {
          const binding=declaration(node,node.text);
          if(!binding)return unknown(`unbound:${node.text}`);
          if(frame.has(binding))return frame.get(binding);
          if(!binding.initializer)return unknown(`binding:${binding.pos}`);
          if(ts.isVariableDeclaration(binding)&&!(binding.parent.flags&ts.NodeFlags.Const))return unknown(`mutable:${binding.pos}`);
          if(visiting.has(binding))unsupported();visiting.add(binding);
          try {return value(binding.initializer,frame,depth+1);}
          catch(error) {
            if(!(error instanceof Unsupported)||[...active].some(fn=>inside(binding,fn)))throw error;
            return unknown(`captured:${binding.pos}`);
          } finally {visiting.delete(binding);}
        }
        if(ts.isArrayLiteralExpression(node)) {
          if(node.elements.length>CAP||node.elements.some(ts.isSpreadElement))unsupported();
          return node.elements.map(item=>value(item,frame,depth+1));
        }
        if(ts.isObjectLiteralExpression(node)) {
          const object=new Map();
          for(const property of node.properties) {
            if(!ts.isPropertyAssignment(property)||!(ts.isIdentifier(property.name)||ts.isStringLiteral(property.name)))unsupported();
            object.set(property.name.text,value(property.initializer,frame,depth+1));
          }
          return object;
        }
        if(ts.isPropertyAccessExpression(node)) {
          const object=value(node.expression,frame,depth+1);
          if(isUnknown(object))return unknown(`${object.unknown}.${node.name.text}`);
          if(Array.isArray(object)&&node.name.text==='length')return object.length;
          if(!(object instanceof Map)||!object.has(node.name.text))unsupported();return object.get(node.name.text);
        }
        if(ts.isTemplateExpression(node)) {
          let text=node.head.text;
          for(const span of node.templateSpans)text+=String(primitive(value(span.expression,frame,depth+1)))+span.literal.text;
          return text;
        }
        if(ts.isConditionalExpression(node))return value(condition(value(node.condition,frame,depth+1))?node.whenTrue:node.whenFalse,frame,depth+1);
        if(ts.isBinaryExpression(node)) {
          const left=value(node.left,frame,depth+1),right=value(node.right,frame,depth+1),operator=node.operatorToken.kind;
          const operators=new Map([
            [ts.SyntaxKind.PlusToken,(a,b)=>a+b],[ts.SyntaxKind.MinusToken,(a,b)=>a-b],
            [ts.SyntaxKind.EqualsEqualsEqualsToken,(a,b)=>a===b],[ts.SyntaxKind.ExclamationEqualsEqualsToken,(a,b)=>a!==b],
            [ts.SyntaxKind.LessThanToken,(a,b)=>a<b],[ts.SyntaxKind.GreaterThanToken,(a,b)=>a>b],
            [ts.SyntaxKind.AmpersandAmpersandToken,(a,b)=>a&&b],[ts.SyntaxKind.BarBarToken,(a,b)=>a||b],
          ]);
          if(!operators.has(operator))unsupported();
          if(isUnknown(left)||isUnknown(right))return unknown(JSON.stringify([operator,left,right]));
          return operators.get(operator)(primitive(left),primitive(right));
        }
        if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)) {
          const fn=declaration(node.expression,node.expression.text);
          if(!fn||!ts.isFunctionDeclaration(fn))unsupported();
          return invoke(fn,node.arguments.map(argument=>value(argument,frame,depth+1)),frame,depth+1);
        }
        if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)) {
          const method=node.expression.name.text;
          if(method==='join') {
            if(node.arguments.length!==1||!ts.isStringLiteral(node.arguments[0]))unsupported();
            let receiver=unwrapExpression(node.expression.expression);
            if(ts.isCallExpression(receiver)&&ts.isPropertyAccessExpression(receiver.expression)&&receiver.expression.name.text==='map'&&receiver.arguments.length===1) {
              const fn=receiver.arguments[0];
              if(ts.isArrowFunction(fn)&&!fn.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.AsyncKeyword)&&fn.parameters.length===0&&ts.isStringLiteral(fn.body)&&fn.body.text==='?'&&node.arguments[0].text===', ')return '?';
            }
            const members=value(receiver,frame,depth+1);
            if(!Array.isArray(members)||members.length>CAP)unsupported();
            return members.map(member=>String(primitive(member))).join(node.arguments[0].text);
          }
          if(method==='map'&&node.arguments.length===1&&(ts.isArrowFunction(node.arguments[0])||ts.isFunctionExpression(node.arguments[0]))) {
            const members=value(node.expression.expression,frame,depth+1);
            if(!Array.isArray(members)||members.length>CAP)unsupported();
            return members.map((member,index)=>invoke(node.arguments[0],[member,index],frame,depth+1));
          }
        }
        unsupported();
      }
      return String(primitive(value(expression)));
    }
    const pending=[new Map()],results=[];
    try {
      while(pending.length) {
        const decisions=pending.pop();
        try {const result=run(decisions);if(result.length>524288)unsupported();results.push(result);}
        catch(error) {
          if(!(error instanceof Choice))throw error;
          if(pending.length+results.length+2>CAP||decisions.size>=6)unsupported();
          pending.push(new Map(decisions).set(error.key,false),new Map(decisions).set(error.key,true));
        }
      }
      return results;
    } catch(error) {if(!(error instanceof Unsupported))throw error;return [UNSAFE_SQL];}
  }

  function evaluate(expression, resolving = new Set()) {
    const node = unwrapExpression(expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isNumericLiteral(node)) return [node.text];
    if (ts.isTemplateExpression(node)) {
      let alternatives = [node.head.text];
      for (const span of node.templateSpans) {
        const values = evaluate(span.expression, resolving) ?? [DYNAMIC_SQL];
        alternatives = alternatives.flatMap(prefix =>
          values.map(value => `${prefix}${value}${span.literal.text}`));
      }
      return alternatives;
    }
    if (ts.isTaggedTemplateExpression(node)) return evaluate(node.template, resolving);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = evaluate(node.left, resolving);
      const right = evaluate(node.right, resolving);
      if (left === null && right === null) return null;
      return (left ?? [DYNAMIC_SQL]).flatMap(prefix =>
        (right ?? [DYNAMIC_SQL]).map(suffix => `${prefix}${suffix}`));
    }
    if (ts.isConditionalExpression(node)) {
      const whenTrue = evaluate(node.whenTrue, resolving);
      const whenFalse = evaluate(node.whenFalse, resolving);
      if (whenTrue === null && whenFalse === null) return null;
      return [...(whenTrue ?? [DYNAMIC_SQL]), ...(whenFalse ?? [DYNAMIC_SQL])];
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
        .flatMap(result => evaluate(result, next) ?? []);
      return values.length ? values : null;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.name.text === 'map' && node.arguments.length === 1 &&
          (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0]))) {
        return null; // A map is an array, not a SQL string; join owns its scope.
      }
      if (node.expression.name.text === 'join') return composedJoin(node);
    }
    return null;
  }

  const statements = new Set();
  function add(expression, sqlSink = false) {
    for (const text of evaluate(expression) ?? []) {
      if(text.includes(UNSAFE_SQL)&&(sqlSink||/\b(?:SELECT|WITH|FROM|JOIN)\b/i.test(text)))fail('Zaruku runtime unsupported SQL composition');
      if (/\b(?:SELECT|WITH|FROM|JOIN)\b/i.test(text)) statements.add(text);
    }
  }
  function collectCandidates(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) add(node.initializer,ts.isIdentifier(node.name)&&/sql$/i.test(node.name.text));
    if (ts.isPropertyAssignment(node) &&
        ((ts.isIdentifier(node.name) && node.name.text === 'sql') ||
         (ts.isStringLiteral(node.name) && node.name.text === 'sql'))) {
      add(node.initializer,true);
    }
    if (ts.isReturnStatement(node) && node.expression) add(node.expression);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ['execute', 'query'].includes(node.expression.name.text) && node.arguments[0]) {
      add(node.arguments[0],true);
    }
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='map')return;
    ts.forEachChild(node, collectCandidates);
  }
  collectCandidates(sourceFile);
  return statements;
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
