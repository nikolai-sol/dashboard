import ts from 'typescript';

const MAX_VARIANTS = 64;
const MAX_ARRAY_ITEMS = 64;
const MAX_DEPTH = 128;
const MAX_STRING_LENGTH = 524_288;
const MAX_WORK = 100_000;

class StaticFailure extends Error {
  constructor(reason, node) {
    super(reason);
    this.reason = reason;
    this.nodeStart = Math.max(0, node?.getStart?.() ?? node?.pos ?? 0);
  }
}

class StaticChoice extends Error {
  constructor(key) {
    super(key);
    this.key = key;
  }
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

function stringValue(text, node) {
  if (text.length > MAX_STRING_LENGTH) throw new StaticFailure('ANALYSIS_LIMIT', node);
  return { kind: 'string', text };
}

function concatenateTexts(parts, node, separator = '') {
  let total = separator.length * Math.max(0, parts.length - 1);
  for (const part of parts) {
    if (part.length > MAX_STRING_LENGTH - total) {
      throw new StaticFailure('ANALYSIS_LIMIT', node);
    }
    total += part.length;
  }
  return parts.join(separator);
}

function scalarValue(value) {
  return { kind: 'scalar', value };
}

function unknownValue(reason, node, decisionKey = null, staticText = '') {
  if (staticText.length > MAX_STRING_LENGTH) throw new StaticFailure('ANALYSIS_LIMIT', node);
  const value = {
    kind: 'unknown',
    reason,
    nodeStart: Math.max(0, node?.getStart?.() ?? node?.pos ?? 0),
  };
  if (decisionKey !== null) value.decisionKey = decisionKey;
  if (staticText.length > 0) value.staticText = staticText;
  return value;
}

function primitive(value, node) {
  if (value.kind === 'string') return value.text;
  if (value.kind === 'scalar') return value.value;
  throw new StaticFailure('UNSUPPORTED_EXPRESSION', node);
}

function choiceKey(value) {
  return value.decisionKey ?? `${value.reason}:${value.nodeStart}`;
}

function staticText(value) {
  if (value.kind === 'string') return value.text;
  if (value.kind === 'scalar') return String(value.value);
  if (value.kind === 'unknown') return value.staticText ?? '';
  return '';
}

/**
 * Build a deliberately limited, non-executing evaluator for one TypeScript AST.
 * The returned evaluator never uses null to mean "could not evaluate".
 */
export function createStaticEvaluator(sourceFile) {
  if (!ts.isSourceFile(sourceFile)) throw new TypeError('TypeScript SourceFile required');
  let work = 0;
  let preprocessingWork = 0;
  let preprocessingExceeded = false;

  function preprocessStep() {
    preprocessingWork += 1;
    if (preprocessingWork > MAX_WORK) preprocessingExceeded = true;
    return !preprocessingExceeded;
  }

  function bindingInPattern(declarationNode, name) {
    function find(pattern) {
      if (ts.isIdentifier(pattern)) {
        if (pattern.text !== name) return null;
        return pattern === declarationNode.name ? declarationNode : pattern.parent;
      }
      for (const element of pattern.elements) {
        if (!ts.isBindingElement(element)) continue;
        const found = find(element.name);
        if (found) return found;
      }
      return null;
    }
    return find(declarationNode.name);
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
            const binding = bindingInPattern(item, name);
            if (binding) return binding;
          }
        }
      }
    }
    return null;
  }

  function inside(node, ancestor) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent === ancestor) return true;
    }
    return false;
  }

  const mutatedBindings = new Set();
  const mutationTexts = new Map();
  const aliasEdges = new Map();
  const directedTaintEdges = new Map();
  const mutationMethods = new Set([
    'copyWithin', 'delete', 'fill', 'pop', 'push', 'reverse', 'set', 'shift',
    'sort', 'splice', 'unshift', 'clear',
  ]);
  const assignmentOperators = new Set([
    ts.SyntaxKind.EqualsToken,
    ts.SyntaxKind.PlusEqualsToken,
    ts.SyntaxKind.MinusEqualsToken,
    ts.SyntaxKind.AsteriskEqualsToken,
    ts.SyntaxKind.AsteriskAsteriskEqualsToken,
    ts.SyntaxKind.SlashEqualsToken,
    ts.SyntaxKind.PercentEqualsToken,
    ts.SyntaxKind.LessThanLessThanEqualsToken,
    ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
    ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
    ts.SyntaxKind.AmpersandEqualsToken,
    ts.SyntaxKind.BarEqualsToken,
    ts.SyntaxKind.CaretEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken,
  ]);

  function rootBinding(expression) {
    const node = unwrapExpression(expression);
    if (ts.isIdentifier(node)) return declaration(node, node.text);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      return rootBinding(node.expression);
    }
    return null;
  }

  function mutationText(nodeOrNodes) {
    function textOf(current, seen = new Set()) {
      if (!preprocessStep()) return '';
      const node = unwrapExpression(current);
      if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current) ||
          ts.isTemplateHead(current) || ts.isTemplateMiddle(current) || ts.isTemplateTail(current)) {
        return current.text;
      }
      if (ts.isIdentifier(node)) {
        const binding = declaration(node, node.text);
        if (binding && ts.isVariableDeclaration(binding) && binding.initializer &&
            (binding.parent.flags & ts.NodeFlags.Const) && !seen.has(binding)) {
          const nextSeen = new Set(seen).add(binding);
          return textOf(binding.initializer, nextSeen);
        }
        return '';
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        return concatenateTexts([textOf(node.left, seen), textOf(node.right, seen)], node);
      }
      if (ts.isTemplateExpression(node)) {
        const parts = [node.head.text];
        for (const span of node.templateSpans) {
          parts.push(textOf(span.expression, seen), span.literal.text);
        }
        return concatenateTexts(parts, node);
      }
      const parts = [];
      ts.forEachChild(node, child => parts.push(textOf(child, seen)));
      return concatenateTexts(parts, node);
    }
    const nodes = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
    return concatenateTexts(nodes.map(node => textOf(node)), nodes[0] ?? sourceFile);
  }

  function markMutated(binding, evidence) {
    if (!binding) return;
    mutatedBindings.add(binding);
    let text;
    try {
      text = mutationText(evidence);
    } catch (error) {
      if (error instanceof StaticFailure && error.reason === 'ANALYSIS_LIMIT') {
        preprocessingExceeded = true;
        return;
      }
      throw error;
    }
    if (text.length === 0) return;
    const texts = mutationTexts.get(binding) ?? new Set();
    texts.add(text);
    mutationTexts.set(binding, texts);
  }

  function collectDirectMutations(node) {
    if (!preprocessStep()) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'Object' &&
        ['assign', 'defineProperties', 'defineProperty', 'setPrototypeOf'].includes(
          node.expression.name.text,
        ) && node.arguments[0]) {
      markMutated(rootBinding(node.arguments[0]), node.arguments.slice(1));
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        mutationMethods.has(node.expression.name.text)) {
      markMutated(rootBinding(node.expression.expression), node.arguments);
    } else if (ts.isBinaryExpression(node) && assignmentOperators.has(node.operatorToken.kind)) {
      if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
          ts.isPropertyAccessExpression(unwrapExpression(node.left)) ||
          ts.isElementAccessExpression(unwrapExpression(node.left))) {
        markMutated(rootBinding(node.left), node.right);
      }
    } else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) {
      markMutated(rootBinding(node.operand), node.operand);
    } else if (ts.isDeleteExpression(node)) {
      markMutated(rootBinding(node.expression), node.expression);
    }
    ts.forEachChild(node, collectDirectMutations);
  }
  collectDirectMutations(sourceFile);

  function localFunction(call) {
    return functionExpression(call.expression);
  }

  function functionExpression(expression, seen = new Set()) {
    const current = unwrapExpression(expression);
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) return current;
    if (!ts.isIdentifier(current)) return null;
    const binding = declaration(current, current.text);
    if (binding && ts.isFunctionDeclaration(binding)) return binding;
    if (binding && ts.isVariableDeclaration(binding) && binding.initializer && !seen.has(binding)) {
      return functionExpression(binding.initializer, new Set(seen).add(binding));
    }
    return null;
  }

  function staticPrimitiveValue(expression, seen = new Set(), depth = 0) {
    if (!preprocessStep()) return { known: false };
    if (depth > MAX_DEPTH) {
      preprocessingExceeded = true;
      return { known: false };
    }
    const current = unwrapExpression(expression);
    function known(value) {
      if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
        preprocessingExceeded = true;
        return { known: false };
      }
      return { known: true, value };
    }
    if (current.kind === ts.SyntaxKind.TrueKeyword) return { known: true, value: true };
    if (current.kind === ts.SyntaxKind.FalseKeyword) return { known: true, value: false };
    if (current.kind === ts.SyntaxKind.NullKeyword) return { known: true, value: null };
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
      return known(current.text);
    }
    if (ts.isNumericLiteral(current)) return { known: true, value: Number(current.text) };
    if (ts.isTemplateExpression(current)) {
      const parts = [current.head.text];
      for (const span of current.templateSpans) {
        const value = staticPrimitiveValue(span.expression, seen, depth + 1);
        if (!value.known) return value;
        parts.push(String(value.value), span.literal.text);
      }
      try {
        return known(concatenateTexts(parts, current));
      } catch (error) {
        if (error instanceof StaticFailure && error.reason === 'ANALYSIS_LIMIT') {
          preprocessingExceeded = true;
          return { known: false };
        }
        throw error;
      }
    }
    if (ts.isIdentifier(current)) {
      const binding = declaration(current, current.text);
      if (!binding && current.text === 'undefined') return { known: true, value: undefined };
      if (!binding || seen.has(binding) || !ts.isVariableDeclaration(binding) ||
          !binding.initializer || !(binding.parent.flags & ts.NodeFlags.Const)) {
        return { known: false };
      }
      return staticPrimitiveValue(
        binding.initializer, new Set(seen).add(binding), depth + 1,
      );
    }
    if (ts.isPrefixUnaryExpression(current)) {
      const operand = staticPrimitiveValue(current.operand, seen, depth + 1);
      if (!operand.known) return operand;
      if (current.operator === ts.SyntaxKind.ExclamationToken) {
        return { known: true, value: !operand.value };
      }
      if (current.operator === ts.SyntaxKind.MinusToken && typeof operand.value === 'number') {
        return { known: true, value: -operand.value };
      }
      return { known: false };
    }
    if (!ts.isBinaryExpression(current)) return { known: false };
    const left = staticPrimitiveValue(current.left, seen, depth + 1);
    if (!left.known) return { known: false };
    if (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && !left.value) {
      return left;
    }
    if (current.operatorToken.kind === ts.SyntaxKind.BarBarToken && left.value) return left;
    if (current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
        left.value !== null && left.value !== undefined) return left;
    const right = staticPrimitiveValue(current.right, seen, depth + 1);
    if (!right.known) return { known: false };
    const operations = new Map([
      [ts.SyntaxKind.PlusToken, (a, b) => a + b],
      [ts.SyntaxKind.MinusToken, (a, b) => a - b],
      [ts.SyntaxKind.AsteriskToken, (a, b) => a * b],
      [ts.SyntaxKind.SlashToken, (a, b) => a / b],
      [ts.SyntaxKind.EqualsEqualsEqualsToken, (a, b) => a === b],
      [ts.SyntaxKind.ExclamationEqualsEqualsToken, (a, b) => a !== b],
      [ts.SyntaxKind.EqualsEqualsToken, (a, b) => a == b],
      [ts.SyntaxKind.ExclamationEqualsToken, (a, b) => a != b],
      [ts.SyntaxKind.LessThanToken, (a, b) => a < b],
      [ts.SyntaxKind.LessThanEqualsToken, (a, b) => a <= b],
      [ts.SyntaxKind.GreaterThanToken, (a, b) => a > b],
      [ts.SyntaxKind.GreaterThanEqualsToken, (a, b) => a >= b],
      [ts.SyntaxKind.AmpersandAmpersandToken, (a, b) => a && b],
      [ts.SyntaxKind.BarBarToken, (a, b) => a || b],
      [ts.SyntaxKind.QuestionQuestionToken, (a, b) => a ?? b],
    ]);
    return operations.has(current.operatorToken.kind)
      ? known(operations.get(current.operatorToken.kind)(left.value, right.value))
      : { known: false };
  }

  function functionExpressions(expression, seen = new Set()) {
    const current = unwrapExpression(expression);
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) return [current];
    if (ts.isConditionalExpression(current)) {
      const condition = staticPrimitiveValue(current.condition);
      if (condition.known) {
        return functionExpressions(condition.value ? current.whenTrue : current.whenFalse, seen);
      }
      return [...new Set([
        ...functionExpressions(current.whenTrue, seen),
        ...functionExpressions(current.whenFalse, seen),
      ])];
    }
    if (ts.isBinaryExpression(current) && [
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(current.operatorToken.kind)) {
      const left = staticPrimitiveValue(current.left);
      if (left.known) {
        if (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
          return functionExpressions(left.value ? current.right : current.left, seen);
        }
        if (current.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
          return functionExpressions(left.value ? current.left : current.right, seen);
        }
        if (left.value !== null && left.value !== undefined) {
          return functionExpressions(current.left, seen);
        }
        return functionExpressions(current.right, seen);
      }
      return [...new Set([
        ...functionExpressions(current.left, seen),
        ...functionExpressions(current.right, seen),
      ])];
    }
    if (!ts.isIdentifier(current)) return [];
    const binding = declaration(current, current.text);
    if (!binding || seen.has(binding)) return [];
    if (ts.isFunctionDeclaration(binding)) return [binding];
    if (ts.isVariableDeclaration(binding) && binding.initializer) {
      return functionExpressions(binding.initializer, new Set(seen).add(binding));
    }
    return [];
  }

  function propagateMutatedArguments(node) {
    const pendingCalls = [];
    const pendingReturnLinks = [];
    const pendingMapCalls = [];

    function linkBindings(left, right) {
      if (!left || !right || left === right) return;
      if (!aliasEdges.has(left)) aliasEdges.set(left, new Set());
      if (!aliasEdges.has(right)) aliasEdges.set(right, new Set());
      aliasEdges.get(left).add(right);
      aliasEdges.get(right).add(left);
    }

    function linkDirected(left, right) {
      if (!left || !right || left === right) return;
      if (!directedTaintEdges.has(left)) directedTaintEdges.set(left, new Set());
      directedTaintEdges.get(left).add(right);
    }

    function selectedAliasExpressions(expression) {
      if (!preprocessStep()) return [];
      const current = unwrapExpression(expression);
      if (ts.isConditionalExpression(current)) {
        const condition = staticPrimitiveValue(current.condition);
        if (condition.known) {
          return selectedAliasExpressions(condition.value ? current.whenTrue : current.whenFalse);
        }
        return [
          ...selectedAliasExpressions(current.whenTrue),
          ...selectedAliasExpressions(current.whenFalse),
        ];
      }
      if (ts.isBinaryExpression(current) && [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(current.operatorToken.kind)) {
        const left = staticPrimitiveValue(current.left);
        if (left.known) {
          if (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
            return selectedAliasExpressions(left.value ? current.right : current.left);
          }
          if (current.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
            return selectedAliasExpressions(left.value ? current.left : current.right);
          }
          return selectedAliasExpressions(left.value !== null && left.value !== undefined
            ? current.left : current.right);
        }
        return [
          ...selectedAliasExpressions(current.left),
          ...selectedAliasExpressions(current.right),
        ];
      }
      return [current];
    }

    function linkPattern(pattern, expression) {
      if (!preprocessStep()) return;
      const value = unwrapExpression(expression);
      if (ts.isIdentifier(pattern)) {
        const target = declaration(pattern, pattern.text);
        for (const candidate of selectedAliasExpressions(value)) {
          if (ts.isCallExpression(candidate)) {
            const fn = localFunction(candidate);
            if (fn) {
              pendingReturnLinks.push({ target, fn, call: candidate });
              continue;
            }
          }
          for (const source of actualizeSources(candidate, sourceBindings(candidate))) {
            linkBindings(target, source);
          }
        }
        return;
      }
      const patternItems = ts.isArrayBindingPattern(pattern) || ts.isArrayLiteralExpression(pattern)
        ? pattern.elements : null;
      if (patternItems) {
        for (const container of valueExpressions(value)) {
          const resolved = unwrapExpression(container);
          if (!ts.isArrayLiteralExpression(resolved)) continue;
          patternItems.forEach((item, index) => {
            if (!item || ts.isOmittedExpression(item)) return;
            const target = ts.isBindingElement(item) ? item.name : item;
            const source = resolved.elements[index];
            if (source) linkPattern(target, source);
            if (ts.isBindingElement(item) && item.initializer &&
                (!source || mayBeUndefined(source))) {
              linkPattern(target, item.initializer);
            }
          });
        }
        return;
      }
      const patternItemsByKey = ts.isObjectBindingPattern(pattern) || ts.isObjectLiteralExpression(pattern)
        ? pattern.elements ?? pattern.properties : null;
      if (patternItemsByKey) {
        for (const container of valueExpressions(value)) {
          const resolved = unwrapExpression(container);
          if (!ts.isObjectLiteralExpression(resolved)) continue;
          const sourceByKey = new Map();
          for (const property of resolved.properties) {
            if (ts.isPropertyAssignment(property) &&
                (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
              sourceByKey.set(property.name.text, property.initializer);
            } else if (ts.isShorthandPropertyAssignment(property)) {
              sourceByKey.set(property.name.text, property.name);
            }
          }
          for (const item of patternItemsByKey) {
            if (ts.isBindingElement(item)) {
              if (item.dotDotDotToken) {
                for (const source of sourceByKey.values()) linkPattern(item.name, source);
                continue;
              }
              const keyNode = item.propertyName ?? item.name;
              if ((ts.isIdentifier(keyNode) || ts.isStringLiteral(keyNode)) &&
                  sourceByKey.has(keyNode.text)) {
                const source = sourceByKey.get(keyNode.text);
                linkPattern(item.name, source);
                if (item.initializer && mayBeUndefined(source)) {
                  linkPattern(item.name, item.initializer);
                }
              } else if (item.initializer) {
                linkPattern(item.name, item.initializer);
              }
            } else if (ts.isShorthandPropertyAssignment(item) && sourceByKey.has(item.name.text)) {
              linkPattern(item.name, sourceByKey.get(item.name.text));
            } else if (ts.isPropertyAssignment(item) &&
                (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) &&
                sourceByKey.has(item.name.text)) {
              linkPattern(item.initializer, sourceByKey.get(item.name.text));
            }
          }
        }
      }
    }

    function undefinedState(expression, state = {
      bindings: new Set(), calls: new Set(), parameters: new Map(), depth: 0,
    }) {
      if (!expression || !preprocessStep()) return { mayBeUndefined: true, mayBeDefined: true };
      if (state.depth > MAX_DEPTH) {
        preprocessingExceeded = true;
        return { mayBeUndefined: true, mayBeDefined: true };
      }
      const current = unwrapExpression(expression);
      const next = overrides => ({ ...state, ...overrides, depth: state.depth + 1 });
      const combine = variants => ({
        mayBeUndefined: variants.some(item => item.mayBeUndefined),
        mayBeDefined: variants.some(item => item.mayBeDefined),
      });
      if (ts.isIdentifier(current)) {
        const binding = declaration(current, current.text);
        if (!binding && current.text === 'undefined') {
          return { mayBeUndefined: true, mayBeDefined: false };
        }
        if (!binding || state.bindings.has(binding)) {
          return { mayBeUndefined: true, mayBeDefined: true };
        }
        if (state.parameters.has(binding)) return state.parameters.get(binding);
        if (ts.isVariableDeclaration(binding) && binding.initializer &&
            (binding.parent.flags & ts.NodeFlags.Const)) {
          return undefinedState(binding.initializer, next({
            bindings: new Set(state.bindings).add(binding),
          }));
        }
        return { mayBeUndefined: true, mayBeDefined: true };
      }
      if (ts.isConditionalExpression(current)) {
        const condition = staticPrimitiveValue(current.condition);
        if (condition.known) {
          return undefinedState(condition.value ? current.whenTrue : current.whenFalse, next({}));
        }
        return combine([
          undefinedState(current.whenTrue, next({})),
          undefinedState(current.whenFalse, next({})),
        ]);
      }
      if (ts.isBinaryExpression(current) && [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(current.operatorToken.kind)) {
        const left = staticPrimitiveValue(current.left);
        if (left.known) {
          if (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
            return undefinedState(left.value ? current.right : current.left, next({}));
          }
          if (current.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
            return undefinedState(left.value ? current.left : current.right, next({}));
          }
          return undefinedState(left.value !== null && left.value !== undefined
            ? current.left : current.right, next({}));
        }
        return combine([
          undefinedState(current.left, next({})),
          undefinedState(current.right, next({})),
        ]);
      }
      if (ts.isCallExpression(current)) {
        if (state.calls.has(current)) return { mayBeUndefined: true, mayBeDefined: true };
        const fn = localFunction(current);
        if (!fn) return { mayBeUndefined: true, mayBeDefined: true };
        const parameters = new Map(state.parameters);
        fn.parameters.forEach((parameter, index) => {
          const argument = current.arguments[index];
          const argumentState = argument
            ? undefinedState(argument, state)
            : { mayBeUndefined: true, mayBeDefined: false };
          if (!parameter.initializer) {
            parameters.set(parameter, argumentState);
            return;
          }
          const initializerState = undefinedState(parameter.initializer, {
            ...state, parameters, depth: state.depth + 1,
          });
          parameters.set(parameter, {
            mayBeUndefined: argumentState.mayBeUndefined && initializerState.mayBeUndefined,
            mayBeDefined: argumentState.mayBeDefined ||
              (argumentState.mayBeUndefined && initializerState.mayBeDefined),
          });
        });
        const callState = next({
          calls: new Set(state.calls).add(current),
          parameters,
        });
        const returned = selectedReturnExpressions(fn, current);
        if (returned.length === 0) return { mayBeUndefined: true, mayBeDefined: false };
        return combine(returned.map(value => undefinedState(value, callState)));
      }
      if (ts.isArrayLiteralExpression(current) || ts.isObjectLiteralExpression(current) ||
          ts.isArrowFunction(current) || ts.isFunctionExpression(current) ||
          ts.isClassExpression(current) || ts.isNewExpression(current) ||
          ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current) ||
          ts.isTemplateExpression(current) || ts.isNumericLiteral(current) ||
          current.kind === ts.SyntaxKind.TrueKeyword ||
          current.kind === ts.SyntaxKind.FalseKeyword ||
          current.kind === ts.SyntaxKind.NullKeyword ||
          ts.isPrefixUnaryExpression(current) || ts.isBinaryExpression(current)) {
        return { mayBeUndefined: false, mayBeDefined: true };
      }
      return { mayBeUndefined: true, mayBeDefined: true };
    }

    function mayBeUndefined(expression) {
      return undefinedState(expression).mayBeUndefined;
    }

    function parameterExpressions(parameter, index, call) {
      const argument = call.arguments[index];
      if (!argument) return parameter.initializer ? [parameter.initializer] : [];
      if (!parameter.initializer) return [argument];
      const state = undefinedState(argument);
      if (state.mayBeUndefined && !state.mayBeDefined) return [parameter.initializer];
      if (state.mayBeUndefined) return [argument, parameter.initializer];
      return [argument];
    }

    function staticKey(expression, seen = new Set()) {
      if (!preprocessStep() || seen.size > MAX_DEPTH) return null;
      const current = unwrapExpression(expression);
      if (ts.isStringLiteral(current) || ts.isNumericLiteral(current)) return current.text;
      if (!ts.isIdentifier(current)) return null;
      const binding = declaration(current, current.text);
      if (!binding || seen.has(binding) || !ts.isVariableDeclaration(binding) ||
          !binding.initializer || !(binding.parent.flags & ts.NodeFlags.Const)) return null;
      return staticKey(binding.initializer, new Set(seen).add(binding));
    }

    function valueExpressions(expression, state = {
      bindings: new Set(), calls: new Set(), parameters: new Map(), depth: 0,
    }) {
      if (!expression || !preprocessStep() || state.depth > MAX_DEPTH) return [];
      const current = unwrapExpression(expression);
      const next = overrides => ({ ...state, ...overrides, depth: state.depth + 1 });
      if (ts.isIdentifier(current)) {
        const binding = declaration(current, current.text);
        if (!binding || state.bindings.has(binding)) return [current];
        if (state.parameters.has(binding)) {
          return state.parameters.get(binding).flatMap(parameterValue =>
            valueExpressions(parameterValue, next({
              bindings: new Set(state.bindings).add(binding),
            })));
        }
        if (!ts.isVariableDeclaration(binding) ||
            !binding.initializer || !(binding.parent.flags & ts.NodeFlags.Const)) return [current];
        return valueExpressions(binding.initializer, next({
          bindings: new Set(state.bindings).add(binding),
        }));
      }
      if (ts.isConditionalExpression(current)) {
        const condition = staticPrimitiveValue(current.condition);
        const branches = condition.known
          ? [condition.value ? current.whenTrue : current.whenFalse]
          : [current.whenTrue, current.whenFalse];
        return branches.flatMap(branch => valueExpressions(branch, next({})));
      }
      if (ts.isBinaryExpression(current) && [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(current.operatorToken.kind)) {
        const left = staticPrimitiveValue(current.left);
        if (left.known) {
          if (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
            return valueExpressions(left.value ? current.right : current.left, next({}));
          }
          if (current.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
            return valueExpressions(left.value ? current.left : current.right, next({}));
          }
          return valueExpressions(left.value !== null && left.value !== undefined
            ? current.left : current.right, next({}));
        }
        return [current.left, current.right].flatMap(branch =>
          valueExpressions(branch, next({})));
      }
      if (ts.isCallExpression(current)) {
        if (state.calls.has(current)) return [];
        const fn = localFunction(current);
        if (!fn) return [current];
        const parameters = new Map(state.parameters);
        fn.parameters.forEach((parameter, index) => {
          const values = parameterExpressions(parameter, index, current);
          if (values.length > 0) parameters.set(parameter, values);
        });
        const callState = next({
          calls: new Set(state.calls).add(current),
          parameters,
        });
        return selectedReturnExpressions(fn, current).flatMap(returned =>
          valueExpressions(returned, callState));
      }
      if (ts.isElementAccessExpression(current) && current.argumentExpression) {
        const key = staticKey(current.argumentExpression);
        if (key === null) return [];
        return valueExpressions(current.expression, next({})).flatMap(container => {
          const resolved = unwrapExpression(container);
          if (ts.isArrayLiteralExpression(resolved)) {
            const element = resolved.elements[Number(key)];
            return element ? valueExpressions(element, next({})) : [];
          }
          if (ts.isObjectLiteralExpression(resolved)) {
            const property = resolved.properties.find(item =>
              (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) &&
              (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name) ||
               ts.isNumericLiteral(item.name)) && item.name.text === key);
            if (property && ts.isPropertyAssignment(property)) {
              return valueExpressions(property.initializer, next({}));
            }
            if (property && ts.isShorthandPropertyAssignment(property)) {
              return valueExpressions(property.name, next({}));
            }
          }
          return [];
        });
      }
      if (ts.isPropertyAccessExpression(current)) {
        return valueExpressions(current.expression, next({})).flatMap(container => {
          const resolved = unwrapExpression(container);
          if (!ts.isObjectLiteralExpression(resolved)) return [];
          const property = resolved.properties.find(item =>
            (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) &&
            (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) &&
            item.name.text === current.name.text);
          if (property && ts.isPropertyAssignment(property)) {
            return valueExpressions(property.initializer, next({}));
          }
          if (property && ts.isShorthandPropertyAssignment(property)) {
            return valueExpressions(property.name, next({}));
          }
          return [];
        });
      }
      return [current];
    }

    function sourceBindings(expression) {
      if (!preprocessStep()) return [];
      const current = unwrapExpression(expression);
      if (ts.isIdentifier(current)) {
        const binding = declaration(current, current.text);
        return binding ? [binding] : [];
      }
      if (ts.isElementAccessExpression(current) && current.argumentExpression) {
        const key = staticKey(current.argumentExpression);
        if (key === null) return [];
        return [...new Set(valueExpressions(current.expression).flatMap(container => {
          const resolved = unwrapExpression(container);
          if (ts.isArrayLiteralExpression(resolved)) {
            const element = resolved.elements[Number(key)];
            return element ? sourceBindings(element) : [];
          }
          if (!ts.isObjectLiteralExpression(resolved)) return [];
          const property = resolved.properties.find(item =>
            (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) &&
            (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name) ||
             ts.isNumericLiteral(item.name)) && item.name.text === key);
          if (property && ts.isPropertyAssignment(property)) {
            return sourceBindings(property.initializer);
          }
          if (property && ts.isShorthandPropertyAssignment(property)) {
            return sourceBindings(property.name);
          }
          return [];
        }))];
      }
      if (ts.isPropertyAccessExpression(current)) {
        return [...new Set(valueExpressions(current.expression).flatMap(container => {
          const resolved = unwrapExpression(container);
          if (!ts.isObjectLiteralExpression(resolved)) return [];
          const property = resolved.properties.find(item =>
            (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) &&
            (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) &&
            item.name.text === current.name.text);
          if (property && ts.isPropertyAssignment(property)) {
            return sourceBindings(property.initializer);
          }
          if (property && ts.isShorthandPropertyAssignment(property)) {
            return sourceBindings(property.name);
          }
          return [];
        }))];
      }
      if (ts.isConditionalExpression(current) ||
          (ts.isBinaryExpression(current) && [
            ts.SyntaxKind.AmpersandAmpersandToken,
            ts.SyntaxKind.BarBarToken,
            ts.SyntaxKind.QuestionQuestionToken,
          ].includes(current.operatorToken.kind))) {
        return [...new Set(selectedAliasExpressions(current).flatMap(value => {
          const resolved = unwrapExpression(value);
          if (resolved === current) return [];
          return sourceBindings(resolved);
        }))];
      }
      return [];
    }

    function actualizeSources(expression, sources) {
      const calls = [];
      function inspect(current) {
        if (!preprocessStep()) return;
        if (ts.isCallExpression(current) && localFunction(current)) calls.push(current);
        ts.forEachChild(current, inspect);
      }
      inspect(expression);
      const actual = new Set();
      for (const source of sources) {
        let replaced = false;
        for (const call of calls) {
          const fn = localFunction(call);
          const index = fn?.parameters.indexOf(source) ?? -1;
          if (index >= 0 && call.arguments[index]) {
            sourceBindings(call.arguments[index]).forEach(binding => actual.add(binding));
            replaced = true;
          }
        }
        if (!replaced) actual.add(source);
      }
      return [...actual];
    }

    const returnBindingCache = new Map();
    function concretePrimitive(fn, call, expression, resolveParameters = true, seen = new Set()) {
      if (!preprocessStep() || seen.size > MAX_DEPTH) return { known: false };
      const current = unwrapExpression(expression);
      if (current.kind === ts.SyntaxKind.TrueKeyword) return { known: true, value: true };
      if (current.kind === ts.SyntaxKind.FalseKeyword) return { known: true, value: false };
      if (current.kind === ts.SyntaxKind.NullKeyword) return { known: true, value: null };
      if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
        return { known: true, value: current.text };
      }
      if (ts.isNumericLiteral(current)) return { known: true, value: Number(current.text) };
      if (ts.isIdentifier(current)) {
        const binding = declaration(current, current.text);
        if (!binding || seen.has(binding)) return { known: false };
        const parameterIndex = resolveParameters ? fn.parameters.indexOf(binding) : -1;
        if (parameterIndex >= 0 && call.arguments[parameterIndex]) {
          return concretePrimitive(
            fn, call, call.arguments[parameterIndex], false, new Set(seen).add(binding),
          );
        }
        if (ts.isVariableDeclaration(binding) && binding.initializer &&
            (binding.parent.flags & ts.NodeFlags.Const)) {
          return concretePrimitive(
            fn, call, binding.initializer, false, new Set(seen).add(binding),
          );
        }
        return { known: false };
      }
      if (ts.isPrefixUnaryExpression(current)) {
        const operand = concretePrimitive(fn, call, current.operand, resolveParameters, seen);
        if (!operand.known) return operand;
        if (current.operator === ts.SyntaxKind.ExclamationToken) {
          return { known: true, value: !operand.value };
        }
        if (current.operator === ts.SyntaxKind.MinusToken && typeof operand.value === 'number') {
          return { known: true, value: -operand.value };
        }
        return { known: false };
      }
      if (ts.isBinaryExpression(current)) {
        const left = concretePrimitive(fn, call, current.left, resolveParameters, seen);
        if (!left.known) return { known: false };
        if (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && !left.value) {
          return left;
        }
        if (current.operatorToken.kind === ts.SyntaxKind.BarBarToken && left.value) return left;
        if (current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
            left.value !== null && left.value !== undefined) return left;
        const right = concretePrimitive(fn, call, current.right, resolveParameters, seen);
        if (!right.known) return { known: false };
        const operations = new Map([
          [ts.SyntaxKind.PlusToken, (a, b) => a + b],
          [ts.SyntaxKind.MinusToken, (a, b) => a - b],
          [ts.SyntaxKind.AsteriskToken, (a, b) => a * b],
          [ts.SyntaxKind.SlashToken, (a, b) => a / b],
          [ts.SyntaxKind.EqualsEqualsEqualsToken, (a, b) => a === b],
          [ts.SyntaxKind.ExclamationEqualsEqualsToken, (a, b) => a !== b],
          [ts.SyntaxKind.EqualsEqualsToken, (a, b) => a == b],
          [ts.SyntaxKind.ExclamationEqualsToken, (a, b) => a != b],
          [ts.SyntaxKind.LessThanToken, (a, b) => a < b],
          [ts.SyntaxKind.LessThanEqualsToken, (a, b) => a <= b],
          [ts.SyntaxKind.GreaterThanToken, (a, b) => a > b],
          [ts.SyntaxKind.GreaterThanEqualsToken, (a, b) => a >= b],
          [ts.SyntaxKind.AmpersandAmpersandToken, (a, b) => a && b],
          [ts.SyntaxKind.BarBarToken, (a, b) => a || b],
          [ts.SyntaxKind.QuestionQuestionToken, (a, b) => a ?? b],
        ]);
        return operations.has(current.operatorToken.kind)
          ? { known: true, value: operations.get(current.operatorToken.kind)(left.value, right.value) }
          : { known: false };
      }
      return { known: false };
    }

    function concreteBoolean(fn, call, expression) {
      const result = concretePrimitive(fn, call, expression);
      return result.known ? Boolean(result.value) : null;
    }

    function selectedReturnExpressions(fn, call) {
      const expressions = [];

      function collectAll(current) {
        if (!preprocessStep()) return;
        if (current !== fn && ts.isFunctionLike(current)) return;
        if (ts.isReturnStatement(current) && current.expression) {
          expressions.push(current.expression);
          return;
        }
        ts.forEachChild(current, collectAll);
      }

      function selectedStatement(statement) {
        if (!preprocessStep()) return false;
        if (ts.isReturnStatement(statement) && statement.expression) {
          expressions.push(statement.expression);
          return true;
        }
        if (ts.isBlock(statement)) return selectedStatements(statement.statements);
        if (ts.isIfStatement(statement)) {
          const decision = concreteBoolean(fn, call, statement.expression);
          if (decision === true) return selectedStatement(statement.thenStatement);
          if (decision === false) {
            return statement.elseStatement ? selectedStatement(statement.elseStatement) : false;
          }
          collectAll(statement.thenStatement);
          if (statement.elseStatement) collectAll(statement.elseStatement);
        }
        return false;
      }

      function selectedStatements(statements) {
        for (const statement of statements) {
          if (selectedStatement(statement)) return true;
        }
        return false;
      }

      if (!fn.body) return expressions;
      if (ts.isBlock(fn.body)) selectedStatements(fn.body.statements);
      else expressions.push(fn.body);
      return expressions;
    }

    function returnedBindings(fn, call) {
      if (returnBindingCache.has(call)) return returnBindingCache.get(call);
      const bindings = new Set();

      function collectExpression(expression) {
        if (!preprocessStep()) return;
        const current = unwrapExpression(expression);
        if (ts.isConditionalExpression(current)) {
          const selected = concreteBoolean(fn, call, current.condition);
          if (selected === true) collectExpression(current.whenTrue);
          else if (selected === false) collectExpression(current.whenFalse);
          else {
            collectExpression(current.whenTrue);
            collectExpression(current.whenFalse);
          }
          return;
        }
        for (const binding of sourceBindings(current)) bindings.add(binding);
      }
      selectedReturnExpressions(fn, call).forEach(collectExpression);
      returnBindingCache.set(call, bindings);
      return bindings;
    }

    function containedBindings(expression, seen = new Set()) {
      if (!preprocessStep()) return [];
      const current = unwrapExpression(expression);
      if (ts.isIdentifier(current)) {
        const binding = declaration(current, current.text);
        if (!binding || seen.has(binding)) return binding ? [binding] : [];
        seen.add(binding);
        if (ts.isVariableDeclaration(binding) && binding.initializer) {
          return [binding, ...containedBindings(binding.initializer, seen)];
        }
        return [binding];
      }
      if (ts.isArrayLiteralExpression(current)) {
        return current.elements.flatMap(element => containedBindings(element, seen));
      }
      if (ts.isConditionalExpression(current)) {
        return [
          ...containedBindings(current.whenTrue, seen),
          ...containedBindings(current.whenFalse, seen),
        ];
      }
      return [];
    }

    function visit(current) {
      if (!preprocessStep()) return;
      if (ts.isVariableDeclaration(current) && current.initializer) {
        linkPattern(current.name, current.initializer);
        if (ts.isIdentifier(current.name) && ts.isCallExpression(current.initializer)) {
          const fn = localFunction(current.initializer);
          if (fn) pendingReturnLinks.push({ target: current, fn, call: current.initializer });
        }
      } else if (ts.isBinaryExpression(current) &&
          current.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        linkPattern(current.left, current.right);
        if (ts.isCallExpression(current.right)) {
          const fn = localFunction(current.right);
          const target = rootBinding(current.left);
          if (fn) pendingReturnLinks.push({ target, fn, call: current.right });
        }
      } else if (ts.isCallExpression(current)) {
        const fn = localFunction(current);
        if (fn) pendingCalls.push({ fn, call: current });
        if (ts.isPropertyAccessExpression(current.expression) &&
            current.expression.name.text === 'map' && current.arguments[0]) {
          pendingMapCalls.push({
            callbacks: functionExpressions(current.arguments[0]),
            receiver: current.expression.expression,
          });
        }
      }
      ts.forEachChild(current, visit);
    }
    visit(node);

    function aliasClosure(start) {
      const closure = new Set();
      const pending = [start];
      while (pending.length > 0) {
        if (!preprocessStep()) break;
        const binding = pending.pop();
        if (!binding || closure.has(binding)) continue;
        closure.add(binding);
        for (const adjacent of aliasEdges.get(binding) ?? []) pending.push(adjacent);
      }
      return closure;
    }

    function callAwareSourceBindings(expression, state = {
      calls: new Set(), bindings: new Set(), fn: null, call: null, depth: 0,
    }) {
      if (!expression || !preprocessStep()) return [];
      if (state.depth > MAX_DEPTH) {
        preprocessingExceeded = true;
        return [];
      }
      const current = unwrapExpression(expression);
      const direct = new Set(sourceBindings(current));
      const next = overrides => ({ ...state, ...overrides, depth: state.depth + 1 });
      if (ts.isIdentifier(current)) {
        const binding = declaration(current, current.text);
        if (binding && !state.bindings.has(binding) && ts.isVariableDeclaration(binding) &&
            binding.initializer && (binding.parent.flags & ts.NodeFlags.Const)) {
          for (const nested of callAwareSourceBindings(binding.initializer, next({
            bindings: new Set(state.bindings).add(binding),
          }))) direct.add(nested);
        }
        return [...direct];
      }
      if (ts.isConditionalExpression(current)) {
        const condition = state.fn && state.call
          ? concretePrimitive(state.fn, state.call, current.condition)
          : staticPrimitiveValue(current.condition);
        const branches = condition.known
          ? [condition.value ? current.whenTrue : current.whenFalse]
          : [current.whenTrue, current.whenFalse];
        for (const branch of branches) {
          for (const binding of callAwareSourceBindings(branch, next({}))) direct.add(binding);
        }
        return [...direct];
      }
      if (ts.isBinaryExpression(current) && [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(current.operatorToken.kind)) {
        const left = state.fn && state.call
          ? concretePrimitive(state.fn, state.call, current.left)
          : staticPrimitiveValue(current.left);
        let branches;
        if (!left.known) {
          branches = [current.left, current.right];
        } else if (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
          branches = [left.value ? current.right : current.left];
        } else if (current.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
          branches = [left.value ? current.left : current.right];
        } else {
          branches = [left.value !== null && left.value !== undefined
            ? current.left : current.right];
        }
        for (const branch of branches) {
          for (const binding of callAwareSourceBindings(branch, next({}))) direct.add(binding);
        }
        return [...direct];
      }
      if (ts.isElementAccessExpression(current) && current.argumentExpression) {
        const key = staticKey(current.argumentExpression);
        if (key === null) return [...direct];
        for (const container of valueExpressions(current.expression)) {
          const resolved = unwrapExpression(container);
          if (ts.isArrayLiteralExpression(resolved)) {
            const element = resolved.elements[Number(key)];
            if (element) {
              for (const binding of callAwareSourceBindings(element, next({}))) direct.add(binding);
            }
            continue;
          }
          if (!ts.isObjectLiteralExpression(resolved)) continue;
          const property = resolved.properties.find(item =>
            (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) &&
            (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name) ||
             ts.isNumericLiteral(item.name)) && item.name.text === key);
          const member = property && ts.isPropertyAssignment(property)
            ? property.initializer
            : property && ts.isShorthandPropertyAssignment(property) ? property.name : null;
          if (member) {
            for (const binding of callAwareSourceBindings(member, next({}))) direct.add(binding);
          }
        }
        return [...direct];
      }
      if (ts.isPropertyAccessExpression(current)) {
        for (const container of valueExpressions(current.expression)) {
          const resolved = unwrapExpression(container);
          if (!ts.isObjectLiteralExpression(resolved)) continue;
          const property = resolved.properties.find(item =>
            (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) &&
            (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) &&
            item.name.text === current.name.text);
          const member = property && ts.isPropertyAssignment(property)
            ? property.initializer
            : property && ts.isShorthandPropertyAssignment(property) ? property.name : null;
          if (member) {
            for (const binding of callAwareSourceBindings(member, next({}))) direct.add(binding);
          }
        }
        return [...direct];
      }
      if (!ts.isCallExpression(current) || state.calls.has(current)) return [...direct];
      const fn = localFunction(current);
      if (!fn) return [...direct];
      const callState = next({
        calls: new Set(state.calls).add(current),
        fn,
        call: current,
      });
      for (const returned of selectedReturnExpressions(fn, current)) {
        for (const returnedSource of callAwareSourceBindings(returned, callState)) {
          const closure = aliasClosure(returnedSource);
          const parameterIndexes = fn.parameters.flatMap((parameter, index) =>
            closure.has(parameter) ? [index] : []);
          if (parameterIndexes.length === 0) {
            direct.add(returnedSource);
            continue;
          }
          for (const index of parameterIndexes) {
            for (const parameterValue of parameterExpressions(fn.parameters[index], index, current)) {
              for (const binding of callAwareSourceBindings(parameterValue, callState)) {
                direct.add(binding);
              }
            }
          }
        }
      }
      return [...direct];
    }

    for (const { target, fn, call } of pendingReturnLinks) {
      for (const returned of returnedBindings(fn, call)) {
        const closure = aliasClosure(returned);
        const parameterIndexes = fn.parameters.flatMap((parameter, index) =>
          closure.has(parameter) ? [index] : []);
        if (parameterIndexes.length === 0) {
          linkBindings(target, returned);
          continue;
        }
        for (const index of parameterIndexes) {
          for (const expression of parameterExpressions(fn.parameters[index], index, call)) {
            for (const actual of callAwareSourceBindings(expression)) {
              linkBindings(target, actual);
            }
          }
        }
      }
    }

    for (const { fn, call } of pendingCalls) {
      fn.parameters.forEach((parameter, index) => {
        for (const expression of parameterExpressions(parameter, index, call)) {
          for (const actual of callAwareSourceBindings(expression)) {
            linkDirected(parameter, actual);
          }
        }
      });
    }

    for (const { callbacks, receiver } of pendingMapCalls) {
      const receiverBindings = containedBindings(receiver);
      for (const callback of callbacks) {
        const parameter = callback.parameters[0];
        if (!parameter || !ts.isIdentifier(parameter.name)) continue;
        for (const binding of receiverBindings) linkDirected(parameter, binding);
      }
    }
  }
  propagateMutatedArguments(sourceFile);

  const pendingTaint = [...mutatedBindings];
  while (pendingTaint.length > 0) {
    if (!preprocessStep()) break;
    const source = pendingTaint.pop();
    const sourceTexts = mutationTexts.get(source) ?? new Set();
    const targets = new Set([
      ...(aliasEdges.get(source) ?? []),
      ...(directedTaintEdges.get(source) ?? []),
    ]);
    for (const target of targets) {
      const targetTexts = mutationTexts.get(target) ?? new Set();
      const nextTexts = new Set([...targetTexts, ...sourceTexts]);
      const changed = !mutatedBindings.has(target) || nextTexts.size !== targetTexts.size;
      mutatedBindings.add(target);
      mutationTexts.set(target, nextTexts);
      if (changed) pendingTaint.push(target);
    }
  }

  function evaluate(expression) {
    work = 0;
    if (preprocessingExceeded || preprocessingWork > MAX_WORK) {
      return {
        variants: [{
          value: unknownValue('PREPROCESSING_LIMIT', expression),
          decisions: new Map(),
        }],
      };
    }
    const pending = [new Map()];
    const variants = [];

    while (pending.length > 0) {
      const decisions = pending.pop();
      try {
        const value = run(expression, decisions);
        variants.push({ value, decisions: new Map(decisions) });
      } catch (error) {
        if (error instanceof StaticChoice) {
          if (pending.length + variants.length + 2 > MAX_VARIANTS || decisions.size >= 6) {
            variants.push({
              value: unknownValue('ANALYSIS_LIMIT', expression),
              decisions: new Map(decisions),
            });
          } else {
            pending.push(
              new Map(decisions).set(error.key, false),
              new Map(decisions).set(error.key, true),
            );
          }
        } else if (error instanceof StaticFailure) {
          variants.push({
            value: unknownValue(error.reason, { pos: error.nodeStart }),
            decisions: new Map(decisions),
          });
        } else {
          throw error;
        }
      }
    }
    return { variants };
  }

  function run(rootExpression, decisions) {
    const activeFunctions = new Set();
    const resolving = new Set();

    function count(node, depth) {
      work += 1;
      if (work > MAX_WORK || depth > MAX_DEPTH) {
        throw new StaticFailure('ANALYSIS_LIMIT', node);
      }
    }

    function condition(value, node) {
      if (value.kind !== 'unknown') return Boolean(primitive(value, node));
      const key = choiceKey(value);
      if (!decisions.has(key)) throw new StaticChoice(key);
      return decisions.get(key);
    }

    function invoke(fn, args, outerFrame, depth) {
      count(fn, depth);
      if (activeFunctions.has(fn) || !fn.body || fn.asteriskToken ||
          fn.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ||
          fn.parameters.some(parameter => !ts.isIdentifier(parameter.name) || parameter.dotDotDotToken)) {
        throw new StaticFailure('UNSUPPORTED_EXPRESSION', fn);
      }
      const local = new Map(outerFrame);
      fn.parameters.forEach((parameter, index) => {
        if (index < args.length) {
          const argument = args[index];
          if (parameter.initializer && argument.kind === 'scalar' &&
              argument.value === undefined) {
            local.set(parameter, value(parameter.initializer, local, depth + 1));
          } else if (parameter.initializer && argument.kind === 'unknown') {
            const key = `parameter-default:${parameter.pos}:${choiceKey(argument)}`;
            if (!decisions.has(key)) throw new StaticChoice(key);
            local.set(parameter, decisions.get(key)
              ? value(parameter.initializer, local, depth + 1) : argument);
          } else {
            local.set(parameter, argument);
          }
        } else if (parameter.initializer) {
          local.set(parameter, value(parameter.initializer, local, depth + 1));
        } else {
          local.set(parameter, unknownValue('UNSUPPORTED_EXPRESSION', parameter));
        }
      });
      activeFunctions.add(fn);
      try {
        if (!ts.isBlock(fn.body)) return value(fn.body, local, depth + 1);

        function returnReferences(name) {
          let referenced = false;
          function visit(current) {
            if (current !== fn && ts.isFunctionLike(current)) return;
            if (ts.isReturnStatement(current) && current.expression) {
              function inspect(expression) {
                if (ts.isIdentifier(expression) && expression.text === name) referenced = true;
                if (!referenced) ts.forEachChild(expression, inspect);
              }
              inspect(current.expression);
            } else {
              ts.forEachChild(current, visit);
            }
          }
          visit(fn.body);
          return referenced;
        }

        function ignorableParameterPush(statement) {
          if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression) ||
              !ts.isPropertyAccessExpression(statement.expression.expression) ||
              statement.expression.expression.name.text !== 'push') return false;
          const receiver = unwrapExpression(statement.expression.expression.expression);
          if (!ts.isIdentifier(receiver)) return false;
          const parameter = fn.parameters.find(item =>
            ts.isIdentifier(item.name) && item.name.text === receiver.text);
          return Boolean(parameter) && !returnReferences(receiver.text);
        }

        function statements(block, statementDepth) {
          count(block, statementDepth);
          for (const statement of block.statements) {
            count(statement, statementDepth);
            if (ts.isVariableStatement(statement) &&
                (statement.declarationList.flags & ts.NodeFlags.Const)) {
              for (const item of statement.declarationList.declarations) {
                if (!ts.isIdentifier(item.name) || !item.initializer) {
                  throw new StaticFailure('UNSUPPORTED_EXPRESSION', item);
                }
                try {
                  local.set(item, value(item.initializer, local, statementDepth + 1));
                } catch (error) {
                  if (!(error instanceof StaticFailure)) throw error;
                  local.set(item, unknownValue(error.reason, item.initializer));
                }
              }
            } else if (ts.isFunctionDeclaration(statement)) {
              continue;
            } else if (ignorableParameterPush(statement)) {
              continue;
            } else if (ts.isReturnStatement(statement) && statement.expression) {
              return { returned: value(statement.expression, local, statementDepth + 1) };
            } else if (ts.isThrowStatement(statement)) {
              throw new StaticFailure('INAPPLICABLE_VARIANT', statement);
            } else if (ts.isIfStatement(statement)) {
              const branch = condition(
                value(statement.expression, local, statementDepth + 1), statement.expression,
              )
                ? statement.thenStatement : statement.elseStatement;
              if (!branch) continue;
              let result;
              if (ts.isBlock(branch)) {
                result = statements(branch, statementDepth + 1);
              } else if (ts.isReturnStatement(branch) && branch.expression) {
                result = { returned: value(branch.expression, local, statementDepth + 1) };
              } else if (ts.isThrowStatement(branch)) {
                throw new StaticFailure('INAPPLICABLE_VARIANT', branch);
              } else {
                throw new StaticFailure('UNSUPPORTED_EXPRESSION', branch);
              }
              if (result) return result;
            } else {
              throw new StaticFailure('UNSUPPORTED_EXPRESSION', statement);
            }
          }
          return null;
        }

        const result = statements(fn.body, depth + 1);
        if (!result) throw new StaticFailure('UNSUPPORTED_EXPRESSION', fn.body);
        return result.returned;
      } finally {
        activeFunctions.delete(fn);
      }
    }

    function value(expression, frame = new Map(), depth = 0) {
      count(expression, depth);
      const node = unwrapExpression(expression);
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        return stringValue(node.text, node);
      }
      if (ts.isNumericLiteral(node)) return scalarValue(Number(node.text));
      if (node.kind === ts.SyntaxKind.TrueKeyword) return scalarValue(true);
      if (node.kind === ts.SyntaxKind.FalseKeyword) return scalarValue(false);
      if (node.kind === ts.SyntaxKind.NullKeyword) return scalarValue(null);

      if (ts.isIdentifier(node)) {
        const binding = declaration(node, node.text);
        if (!binding && node.text === 'undefined') return scalarValue(undefined);
        if (!binding) return unknownValue('UNSUPPORTED_EXPRESSION', node);
        if (frame.has(binding)) return frame.get(binding);
        if (mutatedBindings.has(binding)) {
          const text = concatenateTexts([...(mutationTexts.get(binding) ?? [])], binding);
          return unknownValue('UNSUPPORTED_EXPRESSION', binding, null, text);
        }
        if (ts.isParameter(binding) && binding.initializer) {
          return value(binding.initializer, frame, depth + 1);
        }
        if (!binding.initializer) return unknownValue('UNSUPPORTED_EXPRESSION', binding);
        if (binding && ts.isVariableDeclaration(binding) && binding.initializer &&
            !(binding.parent.flags & ts.NodeFlags.Const)) {
          return unknownValue('UNSUPPORTED_EXPRESSION', binding);
        }
        if (resolving.has(binding)) return unknownValue('UNSUPPORTED_EXPRESSION', binding);
        resolving.add(binding);
        try {
          return value(binding.initializer, frame, depth + 1);
        } catch (error) {
          if (error instanceof StaticFailure && [...activeFunctions].some(fn => inside(binding, fn))) {
            throw error;
          }
          if (error instanceof StaticFailure) return unknownValue(error.reason, binding);
          throw error;
        } finally {
          resolving.delete(binding);
        }
      }

      if (ts.isArrayLiteralExpression(node)) {
        if (node.elements.length > MAX_ARRAY_ITEMS || node.elements.some(ts.isSpreadElement)) {
          throw new StaticFailure('ANALYSIS_LIMIT', node);
        }
        return {
          kind: 'array',
          items: node.elements.map(item => value(item, frame, depth + 1)),
        };
      }

      if (ts.isObjectLiteralExpression(node)) {
        const fields = new Map();
        for (const property of node.properties) {
          if (ts.isPropertyAssignment(property) &&
              (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
            try {
              fields.set(property.name.text, value(property.initializer, frame, depth + 1));
            } catch (error) {
              if (!(error instanceof StaticFailure)) throw error;
              fields.set(property.name.text, unknownValue(error.reason, property.initializer));
            }
          } else if (ts.isShorthandPropertyAssignment(property)) {
            fields.set(property.name.text, value(property.name, frame, depth + 1));
          } else {
            fields.set(`unsupported:${property.pos}`, unknownValue('UNSUPPORTED_EXPRESSION', property));
          }
        }
        return { kind: 'record', fields };
      }

      if (ts.isPropertyAccessExpression(node)) {
        const object = value(node.expression, frame, depth + 1);
        if (object.kind === 'unknown') {
          return unknownValue(object.reason, node, `${choiceKey(object)}.${node.name.text}`);
        }
        if (object.kind === 'array' && node.name.text === 'length') {
          return scalarValue(object.items.length);
        }
        if (object.kind === 'record' && !object.fields.has(node.name.text)) {
          return unknownValue('UNSUPPORTED_EXPRESSION', node);
        }
        if (object.kind !== 'record') {
          return unknownValue('INAPPLICABLE_VARIANT', node);
        }
        return object.fields.get(node.name.text);
      }

      if (ts.isElementAccessExpression(node) && node.argumentExpression) {
        const object = value(node.expression, frame, depth + 1);
        const key = value(node.argumentExpression, frame, depth + 1);
        if (key.kind === 'unknown') {
          const objectKey = object.kind === 'unknown' ? choiceKey(object) : `node:${node.expression.pos}`;
          return unknownValue(
            'UNSUPPORTED_EXPRESSION', node, `${objectKey}[${choiceKey(key)}]`,
          );
        }
        const rawKey = primitive(key, node.argumentExpression);
        if (object.kind === 'unknown') {
          return unknownValue(
            object.reason,
            node,
            `${choiceKey(object)}[${typeof rawKey}:${String(rawKey)}]`,
          );
        }
        if (object.kind === 'array' && Number.isInteger(rawKey) && object.items[rawKey]) {
          return object.items[rawKey];
        }
        if (object.kind === 'record' && object.fields.has(String(rawKey))) {
          return object.fields.get(String(rawKey));
        }
        if (object.kind === 'array' || object.kind === 'record') {
          return unknownValue('UNSUPPORTED_EXPRESSION', node);
        }
        return unknownValue('INAPPLICABLE_VARIANT', node);
      }

      if (ts.isTemplateExpression(node)) {
        const parts = [node.head.text];
        let unresolved = null;
        for (const span of node.templateSpans) {
          const evaluated = value(span.expression, frame, depth + 1);
          if (evaluated.kind === 'unknown') {
            unresolved ??= evaluated;
            parts.push(staticText(evaluated));
          } else {
            parts.push(String(primitive(evaluated, span.expression)));
          }
          parts.push(span.literal.text);
        }
        const text = concatenateTexts(parts, node);
        return unresolved
          ? unknownValue(unresolved.reason, node, unresolved.decisionKey ?? null, text)
          : stringValue(text, node);
      }

      if (ts.isTaggedTemplateExpression(node)) {
        const template = value(node.template, frame, depth + 1);
        return unknownValue('UNSUPPORTED_EXPRESSION', node, null, staticText(template));
      }

      if (ts.isConditionalExpression(node)) {
        return value(
          condition(value(node.condition, frame, depth + 1), node.condition)
            ? node.whenTrue : node.whenFalse,
          frame,
          depth + 1,
        );
      }

      if (ts.isPrefixUnaryExpression(node)) {
        const operand = value(node.operand, frame, depth + 1);
        if (operand.kind === 'unknown') return operand;
        const raw = primitive(operand, node.operand);
        if (node.operator === ts.SyntaxKind.ExclamationToken) return scalarValue(!raw);
        if (node.operator === ts.SyntaxKind.MinusToken && typeof raw === 'number') return scalarValue(-raw);
        if (node.operator === ts.SyntaxKind.PlusToken && typeof raw === 'number') return scalarValue(raw);
        return unknownValue('UNSUPPORTED_EXPRESSION', node);
      }

      if (ts.isBinaryExpression(node)) {
        const left = value(node.left, frame, depth + 1);
        const operator = node.operatorToken.kind;
        if (operator === ts.SyntaxKind.QuestionQuestionToken && left.kind !== 'unknown') {
          const raw = primitive(left, node.left);
          return raw == null ? value(node.right, frame, depth + 1) : left;
        }
        if (operator === ts.SyntaxKind.AmpersandAmpersandToken && left.kind !== 'unknown' &&
            !Boolean(primitive(left, node.left))) return left;
        if (operator === ts.SyntaxKind.BarBarToken && left.kind !== 'unknown' &&
            Boolean(primitive(left, node.left))) return left;
        const right = value(node.right, frame, depth + 1);
        if (left.kind === 'unknown' || right.kind === 'unknown') {
          const reason = [left, right].some(item =>
            item.kind === 'unknown' && item.reason === 'ANALYSIS_LIMIT')
            ? 'ANALYSIS_LIMIT' : 'UNSUPPORTED_EXPRESSION';
          const partial = operator === ts.SyntaxKind.PlusToken
            ? concatenateTexts([staticText(left), staticText(right)], node) : '';
          return unknownValue(reason, node, null, partial);
        }
        const a = primitive(left, node.left);
        const b = primitive(right, node.right);
        if (operator === ts.SyntaxKind.PlusToken &&
            (typeof a === 'string' || typeof b === 'string')) {
          return stringValue(concatenateTexts([String(a), String(b)], node), node);
        }
        const operators = new Map([
          [ts.SyntaxKind.PlusToken, (x, y) => x + y],
          [ts.SyntaxKind.MinusToken, (x, y) => x - y],
          [ts.SyntaxKind.AsteriskToken, (x, y) => x * y],
          [ts.SyntaxKind.SlashToken, (x, y) => x / y],
          [ts.SyntaxKind.EqualsEqualsEqualsToken, (x, y) => x === y],
          [ts.SyntaxKind.ExclamationEqualsEqualsToken, (x, y) => x !== y],
          [ts.SyntaxKind.EqualsEqualsToken, (x, y) => x == y],
          [ts.SyntaxKind.ExclamationEqualsToken, (x, y) => x != y],
          [ts.SyntaxKind.LessThanToken, (x, y) => x < y],
          [ts.SyntaxKind.LessThanEqualsToken, (x, y) => x <= y],
          [ts.SyntaxKind.GreaterThanToken, (x, y) => x > y],
          [ts.SyntaxKind.GreaterThanEqualsToken, (x, y) => x >= y],
          [ts.SyntaxKind.AmpersandAmpersandToken, (x, y) => x && y],
          [ts.SyntaxKind.BarBarToken, (x, y) => x || y],
          [ts.SyntaxKind.QuestionQuestionToken, (x, y) => x ?? y],
        ]);
        if (!operators.has(operator)) return unknownValue('UNSUPPORTED_EXPRESSION', node);
        const result = operators.get(operator)(a, b);
        return typeof result === 'string' ? stringValue(result, node) : scalarValue(result);
      }

      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const binding = declaration(node.expression, node.expression.text);
        let fn = binding;
        if (binding && ts.isVariableDeclaration(binding) && binding.initializer &&
            (ts.isArrowFunction(binding.initializer) || ts.isFunctionExpression(binding.initializer))) {
          fn = binding.initializer;
        }
        if (!fn || !(ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
          return unknownValue('UNSUPPORTED_EXPRESSION', node);
        }
        const args = node.arguments.map(argument => value(argument, frame, depth + 1));
        try {
          return invoke(fn, args, frame, depth + 1);
        } catch (error) {
          if (error instanceof StaticFailure) return unknownValue(error.reason, node);
          throw error;
        }
      }

      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if (method === 'join') {
          if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) {
            return unknownValue('UNSUPPORTED_EXPRESSION', node);
          }
          const separator = node.arguments[0].text;
          const receiver = unwrapExpression(node.expression.expression);
          if (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression) &&
              receiver.expression.name.text === 'map' && receiver.arguments.length === 1) {
            const callback = receiver.arguments[0];
            const placeholderInput = unwrapExpression(receiver.expression.expression);
            const placeholderBinding = ts.isIdentifier(placeholderInput)
              ? declaration(placeholderInput, placeholderInput.text) : null;
            const unknownCardinalityBinding = Boolean(placeholderBinding) &&
              (ts.isParameter(placeholderBinding) ||
               ts.isVariableDeclaration(placeholderBinding));
            if (ts.isArrowFunction(callback) &&
                !callback.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) &&
                callback.parameters.length === 0 && ts.isStringLiteral(callback.body) &&
                callback.body.text === '?' && separator === ', ' && unknownCardinalityBinding) {
              const receiverValue = value(receiver.expression.expression, frame, depth + 1);
              if (receiverValue.kind === 'unknown') return stringValue('?', node);
            }
          }
          const members = value(receiver, frame, depth + 1);
          if (members.kind !== 'array' || members.items.length > MAX_ARRAY_ITEMS) {
            return members.kind === 'unknown'
              ? unknownValue(members.reason, node, members.decisionKey ?? null, staticText(members))
              : unknownValue('UNSUPPORTED_EXPRESSION', node);
          }
          const parts = [];
          let unresolved = null;
          for (const member of members.items) {
            if (member.kind === 'unknown') {
              unresolved ??= member;
              parts.push(staticText(member));
              continue;
            }
            if (member.kind !== 'string' && member.kind !== 'scalar') {
              return unknownValue('UNSUPPORTED_EXPRESSION', node);
            }
            const raw = primitive(member, node);
            parts.push(raw === null ? '' : String(raw));
          }
          const text = concatenateTexts(parts, node, separator);
          return unresolved
            ? unknownValue(unresolved.reason, node, unresolved.decisionKey ?? null, text)
            : stringValue(text, node);
        }

        if (method === 'map' && node.arguments.length === 1 &&
            (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0]))) {
          const members = value(node.expression.expression, frame, depth + 1);
          if (members.kind !== 'array' || members.items.length > MAX_ARRAY_ITEMS) {
            return members.kind === 'unknown'
              ? unknownValue(members.reason, node, members.decisionKey ?? null, staticText(members))
              : unknownValue('UNSUPPORTED_EXPRESSION', node);
          }
          return {
            kind: 'array',
            items: members.items.map((member, index) => invoke(
              node.arguments[0], [member, scalarValue(index)], frame, depth + 1,
            )),
          };
        }
      }

      return unknownValue('UNSUPPORTED_EXPRESSION', node);
    }

    return value(rootExpression);
  }

  return { evaluate };
}

export const STATIC_ANALYSIS_LIMITS = Object.freeze({
  variants: MAX_VARIANTS,
  arrayItems: MAX_ARRAY_ITEMS,
  depth: MAX_DEPTH,
  stringLength: MAX_STRING_LENGTH,
  work: MAX_WORK,
});
