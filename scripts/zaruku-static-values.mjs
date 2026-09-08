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

  function inside(node, ancestor) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent === ancestor) return true;
    }
    return false;
  }

  const mutatedBindings = new Set();
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

  function collectDirectMutations(node) {
    preprocessingWork += 1;
    if (preprocessingWork > MAX_WORK) {
      preprocessingExceeded = true;
      return;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'Object' &&
        ['assign', 'defineProperties', 'defineProperty', 'setPrototypeOf'].includes(
          node.expression.name.text,
        ) && node.arguments[0]) {
      const binding = rootBinding(node.arguments[0]);
      if (binding) mutatedBindings.add(binding);
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        mutationMethods.has(node.expression.name.text)) {
      const binding = rootBinding(node.expression.expression);
      if (binding) mutatedBindings.add(binding);
    } else if (ts.isBinaryExpression(node) && assignmentOperators.has(node.operatorToken.kind)) {
      const binding = rootBinding(node.left);
      if (binding) mutatedBindings.add(binding);
    } else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) {
      const binding = rootBinding(node.operand);
      if (binding) mutatedBindings.add(binding);
    } else if (ts.isDeleteExpression(node)) {
      const binding = rootBinding(node.expression);
      if (binding) mutatedBindings.add(binding);
    }
    ts.forEachChild(node, collectDirectMutations);
  }
  collectDirectMutations(sourceFile);

  function localFunction(call) {
    if (!ts.isIdentifier(call.expression)) return null;
    const binding = declaration(call.expression, call.expression.text);
    if (binding && ts.isFunctionDeclaration(binding)) return binding;
    if (binding && ts.isVariableDeclaration(binding) && binding.initializer &&
        (ts.isArrowFunction(binding.initializer) || ts.isFunctionExpression(binding.initializer))) {
      return binding.initializer;
    }
    return null;
  }

  function propagateMutatedArguments(node) {
    let changed = false;
    function visit(current) {
      preprocessingWork += 1;
      if (preprocessingWork > MAX_WORK) {
        preprocessingExceeded = true;
        return;
      }
      if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name) && current.initializer) {
        const target = current;
        const source = rootBinding(current.initializer);
        if (source && (mutatedBindings.has(target) || mutatedBindings.has(source))) {
          for (const binding of [target, source]) {
            if (!mutatedBindings.has(binding)) {
              mutatedBindings.add(binding);
              changed = true;
            }
          }
        }
      } else if (ts.isCallExpression(current)) {
        const fn = localFunction(current);
        if (fn) {
          fn.parameters.forEach((parameter, index) => {
            if (!mutatedBindings.has(parameter) || !current.arguments[index]) return;
            const binding = rootBinding(current.arguments[index]);
            if (binding && !mutatedBindings.has(binding)) {
              mutatedBindings.add(binding);
              changed = true;
            }
          });
        }
      }
      ts.forEachChild(current, visit);
    }
    visit(node);
    return changed;
  }
  while (!preprocessingExceeded && propagateMutatedArguments(sourceFile)) {
    // Reach a fixed point for helpers that forward a mutable container.
  }

  function evaluate(expression) {
    work = preprocessingWork;
    if (preprocessingExceeded || work > MAX_WORK) {
      return {
        variants: [{
          value: unknownValue('ANALYSIS_LIMIT', expression),
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
          local.set(parameter, args[index]);
        } else if (parameter.initializer) {
          local.set(parameter, value(parameter.initializer, outerFrame, depth + 1));
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
        if (!binding) return unknownValue('UNSUPPORTED_EXPRESSION', node);
        if (frame.has(binding)) return frame.get(binding);
        if (mutatedBindings.has(binding)) return unknownValue('UNSUPPORTED_EXPRESSION', binding);
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
            return unknownValue('UNSUPPORTED_EXPRESSION', node);
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
            return unknownValue('UNSUPPORTED_EXPRESSION', node);
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
