import path from 'node:path';
import ts from 'typescript';
import { createStaticEvaluator } from './zaruku-static-values.mjs';

const SQL_MARKER = /\b(?:SELECT|WITH)\b/i;
const SQL_RELEVANCE = /\b(?:SELECT|WITH)\b|\b(?:FROM|JOIN)\s+[a-z_(]|report_bd(?:_private)?\s*\.|canonical_fact_|canonical_/i;

function scriptKind(filename) {
  const extension = path.extname(filename);
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (['.js', '.mjs', '.cjs'].includes(extension)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function unwrapExpression(expression) {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) ||
         ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current) ||
         ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

function displayFilename(filename) {
  if (!path.isAbsolute(filename)) return filename;
  const relative = path.relative(process.cwd(), filename);
  return relative && !relative.startsWith('..') ? relative : path.basename(filename);
}

function analysisError(sourceFile, filename, nodeStart, reason) {
  const safeStart = Math.min(Math.max(0, nodeStart), sourceFile.getFullText().length);
  const location = sourceFile.getLineAndCharacterOfPosition(safeStart);
  return new Error(
    `Zaruku SQL analysis ${displayFilename(filename)}:${location.line + 1}:${location.character + 1} ${reason}`,
  );
}

function hasSqlRelevance(node) {
  let relevant = false;
  function visit(current) {
    if (relevant) return;
    if ((ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current) ||
         ts.isTemplateHead(current) || ts.isTemplateMiddle(current) || ts.isTemplateTail(current)) &&
        SQL_RELEVANCE.test(current.text)) {
      relevant = true;
      return;
    }
    if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) &&
        ['query', 'execute'].includes(current.expression.name.text)) {
      relevant = true;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return relevant;
}

function collectStrings(value, strings, unknowns) {
  if (value.kind === 'string') {
    if (SQL_MARKER.test(value.text)) strings.push(value.text);
    return;
  }
  if (value.kind === 'unknown') {
    unknowns.push(value);
    return;
  }
  if (value.kind === 'array') {
    value.items.forEach(item => collectStrings(item, strings, unknowns));
    return;
  }
  if (value.kind === 'record') {
    if (value.fields.has('sql')) {
      collectStrings(value.fields.get('sql'), strings, unknowns);
    } else {
      value.fields.forEach(item => collectStrings(item, strings, unknowns));
    }
  }
}

/** Extract complete, statically evaluated SQL statements without executing source code. */
export function extractStaticSql(source, filename) {
  const sourceFile = ts.createSourceFile(
    filename, source, ts.ScriptTarget.Latest, true, scriptKind(filename),
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostic = sourceFile.parseDiagnostics[0];
    throw analysisError(sourceFile, filename, diagnostic.start ?? 0, 'UNSUPPORTED_EXPRESSION');
  }
  const evaluator = createStaticEvaluator(sourceFile);
  const statements = new Set();
  const calledFunctions = new Set();
  const escapedFunctions = new Set();
  const joinedDeclarations = new Set();
  const forwardedSinkCalls = new Set();
  const forwardedSqlCalls = new Map();
  const explicitlyExportedNames = new Set();
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier &&
        statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        explicitlyExportedNames.add((element.propertyName ?? element.name).text);
      }
    } else if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      explicitlyExportedNames.add(statement.expression.text);
    }
  }

  function declaration(node, name) {
    for (let scope = node.parent; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope)) {
        for (const parameter of scope.parameters) {
          if (ts.isIdentifier(parameter.name) && parameter.name.text === name) return parameter;
        }
      }
      if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
        for (const statement of scope.statements) {
          if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
          if (!ts.isVariableStatement(statement)) continue;
          for (const item of statement.declarationList.declarations) {
            if (ts.isIdentifier(item.name) && item.name.text === name) return item;
          }
        }
      }
    }
    return null;
  }

  function collectConsumers(node) {
    if (ts.isIdentifier(node)) {
      const binding = declaration(node, node.text);
      const functionBinding = binding && (ts.isFunctionDeclaration(binding) ||
        (ts.isVariableDeclaration(binding) && binding.initializer &&
         (ts.isArrowFunction(binding.initializer) || ts.isFunctionExpression(binding.initializer))))
        ? binding : null;
      const declarationName = node.parent?.name === node &&
        !ts.isShorthandPropertyAssignment(node.parent) && !ts.isExportSpecifier(node.parent);
      const directCall = ts.isCallExpression(node.parent) && node.parent.expression === node;
      const propertyName = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
      if (functionBinding && !declarationName && !directCall && !propertyName) {
        escapedFunctions.add(functionBinding);
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const binding = declaration(node.expression, node.expression.text);
      if (binding && (ts.isFunctionDeclaration(binding) ||
          (ts.isVariableDeclaration(binding) && binding.initializer &&
           (ts.isArrowFunction(binding.initializer) || ts.isFunctionExpression(binding.initializer))))) {
        calledFunctions.add(binding);
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'join') {
      const receiver = unwrapExpression(node.expression.expression);
      if (ts.isIdentifier(receiver)) {
        const binding = declaration(receiver, receiver.text);
        if (binding) joinedDeclarations.add(binding);
      }
    }
    ts.forEachChild(node, collectConsumers);
  }
  collectConsumers(sourceFile);

  const sqlExecutors = new Map();
  function functionNodes(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
         ts.isArrowFunction(node)) && node.body) {
      for (let index = 0; index < node.parameters.length; index += 1) {
        const parameter = node.parameters[index];
        if (!ts.isIdentifier(parameter.name)) continue;
        function inspect(current) {
          if (current !== node && ts.isFunctionLike(current)) return;
          if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) &&
              ['query', 'execute'].includes(current.expression.name.text) && current.arguments[0]) {
            const argument = unwrapExpression(current.arguments[0]);
            if (ts.isPropertyAccessExpression(argument) && argument.name.text === 'sql' &&
                ts.isIdentifier(argument.expression) && argument.expression.text === parameter.name.text) {
              sqlExecutors.set(node, { parameterIndex: index, sink: current });
            }
          }
          ts.forEachChild(current, inspect);
        }
        inspect(node.body);
      }
    }
    ts.forEachChild(node, functionNodes);
  }
  functionNodes(sourceFile);

  const executorParameters = new Map();
  function collectExecutorParameters(node) {
    if (ts.isFunctionLike(node)) {
      for (const parameter of node.parameters) {
        if (!ts.isIdentifier(parameter.name) || !parameter.initializer) continue;
        const initializer = unwrapExpression(parameter.initializer);
        if (!ts.isIdentifier(initializer)) continue;
        const binding = declaration(initializer, initializer.text);
        let fn = binding;
        if (binding && ts.isVariableDeclaration(binding) && binding.initializer &&
            (ts.isArrowFunction(binding.initializer) || ts.isFunctionExpression(binding.initializer))) {
          fn = binding.initializer;
        }
        if (fn && sqlExecutors.has(fn)) executorParameters.set(parameter, sqlExecutors.get(fn));
      }
    }
    ts.forEachChild(node, collectExecutorParameters);
  }
  collectExecutorParameters(sourceFile);

  function collectForwardedCalls(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const binding = declaration(node.expression, node.expression.text);
      let executor = executorParameters.get(binding);
      let fn = binding;
      if (binding && ts.isVariableDeclaration(binding) && binding.initializer &&
          (ts.isArrowFunction(binding.initializer) || ts.isFunctionExpression(binding.initializer))) {
        fn = binding.initializer;
      }
      if (!executor && fn && sqlExecutors.has(fn)) executor = sqlExecutors.get(fn);
      if (executor && node.arguments[executor.parameterIndex]) {
        forwardedSqlCalls.set(node, node.arguments[executor.parameterIndex]);
        forwardedSinkCalls.add(executor.sink);
      }
    }
    ts.forEachChild(node, collectForwardedCalls);
  }
  collectForwardedCalls(sourceFile);

  function add(expression, sqlSink = false) {
    const analysis = evaluator.evaluate(expression);
    const variantResults = analysis.variants.map(variant => {
      const strings = [];
      const unknowns = [];
      collectStrings(variant.value, strings, unknowns);
      return { strings, unknowns };
    });
    const strings = variantResults.flatMap(result => result.strings);
    const blockingUnknowns = variantResults.flatMap(result =>
      result.unknowns.filter(value => value.reason !== 'INAPPLICABLE_VARIANT' ||
        result.strings.length > 0 || strings.length === 0));
    const unresolvedSqlRelevance = blockingUnknowns.some(value =>
      value.staticText && SQL_RELEVANCE.test(value.staticText));
    if (blockingUnknowns.length > 0 &&
        (sqlSink || unresolvedSqlRelevance || hasSqlRelevance(expression))) {
      const first = blockingUnknowns[0];
      const reason = first.reason === 'ANALYSIS_LIMIT'
        ? 'ANALYSIS_LIMIT'
        : sqlSink ? 'UNRESOLVED_SQL' : 'UNSUPPORTED_EXPRESSION';
      throw analysisError(
        sourceFile,
        filename,
        sqlSink ? expression.getStart(sourceFile) : first.nodeStart,
        reason,
      );
    }
    strings.forEach(statement => statements.add(statement));
  }

  function forwardedMapReceiver(call, argument) {
    const unwrapped = unwrapExpression(argument);
    if (!ts.isIdentifier(unwrapped)) return null;
    for (let parent = call.parent; parent; parent = parent.parent) {
      if (!ts.isFunctionLike(parent)) continue;
      const parameterIndex = parent.parameters.findIndex(parameter =>
        ts.isIdentifier(parameter.name) && parameter.name.text === unwrapped.text);
      const mapCall = parent.parent;
      if (parameterIndex === 0 && ts.isCallExpression(mapCall) &&
          mapCall.arguments[0] === parent && ts.isPropertyAccessExpression(mapCall.expression) &&
          mapCall.expression.name.text === 'map') {
        return mapCall.expression.expression;
      }
      return null;
    }
    return null;
  }

  function forwardedSqlExpression(call) {
    const argument = forwardedSqlCalls.get(call);
    return forwardedMapReceiver(call, argument) ?? argument;
  }

  function collectExplicitSinks(node) {
    if (forwardedSqlCalls.has(node)) {
      add(forwardedSqlExpression(node), true);
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ['execute', 'query'].includes(node.expression.name.text) && node.arguments[0] &&
        !forwardedSinkCalls.has(node)) {
      add(node.arguments[0], true);
    }
    ts.forEachChild(node, collectExplicitSinks);
  }
  collectExplicitSinks(sourceFile);

  function containsExplicitSink(node) {
    let found = false;
    function visit(current) {
      if (found) return;
      if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) &&
          ['execute', 'query'].includes(current.expression.name.text)) {
        found = true;
        return;
      }
      ts.forEachChild(current, visit);
    }
    visit(node);
    return found;
  }

  function collectContainerMembers(node) {
    const current = unwrapExpression(node);
    if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) &&
        ['execute', 'query'].includes(current.expression.name.text)) return;
    if (ts.isArrayLiteralExpression(current)) {
      for (const element of current.elements) {
        if (containsExplicitSink(element)) collectContainerMembers(element);
        else add(element);
      }
      return;
    }
    if (ts.isConditionalExpression(current)) {
      for (const branch of [current.whenTrue, current.whenFalse]) {
        if (containsExplicitSink(branch)) collectContainerMembers(branch);
        else add(branch);
      }
      return;
    }
    if (ts.isObjectLiteralExpression(current)) {
      for (const property of current.properties) {
        if (ts.isPropertyAssignment(property)) {
          if (containsExplicitSink(property.initializer)) {
            collectContainerMembers(property.initializer);
          } else {
            add(property.initializer);
          }
        } else if (ts.isShorthandPropertyAssignment(property)) {
          if (property.objectAssignmentInitializer &&
              containsExplicitSink(property.objectAssignmentInitializer)) {
            collectContainerMembers(property.objectAssignmentInitializer);
          } else {
            add(property.name);
          }
        } else if (ts.isSpreadAssignment(property)) {
          if (containsExplicitSink(property.expression)) {
            collectContainerMembers(property.expression);
          } else {
            add(property.expression);
          }
        } else if (ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property) ||
            ts.isSetAccessorDeclaration(property)) {
          collectCandidates(property);
        }
      }
      return;
    }
    ts.forEachChild(current, collectContainerMembers);
  }

  function isExported(binding) {
    if (escapedFunctions.has(binding)) return true;
    if (binding.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      return true;
    }
    if (ts.isVariableDeclaration(binding)) {
      if (ts.isIdentifier(binding.name) && explicitlyExportedNames.has(binding.name.text)) {
        return true;
      }
      const statement = binding.parent?.parent;
      return Boolean(statement?.modifiers?.some(
        modifier => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ));
    }
    if (ts.isFunctionDeclaration(binding) && binding.name &&
        explicitlyExportedNames.has(binding.name.text)) return true;
    return false;
  }

  function collectCandidates(node, skipReturns = false) {
    if (forwardedSqlCalls.has(node)) {
      add(forwardedSqlExpression(node), true);
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.body) {
      collectCandidates(node.body, calledFunctions.has(node) && !isExported(node));
      return;
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initializer = node.initializer;
      if (joinedDeclarations.has(node)) return;
      if (skipReturns) {
        collectCandidates(initializer, skipReturns);
        return;
      }
      if (!ts.isIdentifier(node.name)) {
        if (containsExplicitSink(initializer)) collectContainerMembers(initializer);
        else add(initializer);
        return;
      }
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        const consumed = calledFunctions.has(node) && !isExported(node);
        if (ts.isBlock(initializer.body)) collectCandidates(initializer.body, consumed);
        else if (!consumed) add(initializer.body);
      } else {
        add(initializer, ts.isIdentifier(node.name) && /sql$/i.test(node.name.text));
      }
      return;
    }
    if (ts.isPropertyAssignment(node) &&
        ((ts.isIdentifier(node.name) && node.name.text === 'sql') ||
         (ts.isStringLiteral(node.name) && node.name.text === 'sql'))) {
      add(node.initializer, true);
      return;
    }
    if (ts.isReturnStatement(node) && node.expression) {
      if (skipReturns) collectCandidates(node.expression, skipReturns);
      else add(node.expression);
      return;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ['execute', 'query'].includes(node.expression.name.text) && node.arguments[0]) {
      if (forwardedSinkCalls.has(node)) return;
      add(node.arguments[0], true);
      return;
    }
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.expression.name.text === 'map') {
      add(node.expression);
      return;
    }
    ts.forEachChild(node, child => collectCandidates(child, skipReturns));
  }

  collectCandidates(sourceFile);
  return { statements: [...statements] };
}
