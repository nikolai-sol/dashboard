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

function scalarValue(value) {
  return { kind: 'scalar', value };
}

function unknownValue(reason, node) {
  return {
    kind: 'unknown',
    reason,
    nodeStart: Math.max(0, node?.getStart?.() ?? node?.pos ?? 0),
  };
}

function primitive(value, node) {
  if (value.kind === 'string') return value.text;
  if (value.kind === 'scalar') return value.value;
  throw new StaticFailure('UNSUPPORTED_EXPRESSION', node);
}

function choiceKey(value) {
  return `${value.reason}:${value.nodeStart}`;
}

/**
 * Build a deliberately limited, non-executing evaluator for one TypeScript AST.
 * The returned evaluator never uses null to mean "could not evaluate".
 */
export function createStaticEvaluator(sourceFile) {
  if (!ts.isSourceFile(sourceFile)) throw new TypeError('TypeScript SourceFile required');
  let work = 0;

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

  function evaluate(expression) {
    work = 0;
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

        function statements(block) {
          count(block, depth + 1);
          for (const statement of block.statements) {
            count(statement, depth + 1);
            if (ts.isVariableStatement(statement) &&
                (statement.declarationList.flags & ts.NodeFlags.Const)) {
              for (const item of statement.declarationList.declarations) {
                if (!ts.isIdentifier(item.name) || !item.initializer) {
                  throw new StaticFailure('UNSUPPORTED_EXPRESSION', item);
                }
                try {
                  local.set(item, value(item.initializer, local, depth + 1));
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
              return { returned: value(statement.expression, local, depth + 1) };
            } else if (ts.isThrowStatement(statement)) {
              throw new StaticFailure('INAPPLICABLE_VARIANT', statement);
            } else if (ts.isIfStatement(statement)) {
              const branch = condition(value(statement.expression, local, depth + 1), statement.expression)
                ? statement.thenStatement : statement.elseStatement;
              if (!branch) continue;
              let result;
              if (ts.isBlock(branch)) {
                result = statements(branch);
              } else if (ts.isReturnStatement(branch) && branch.expression) {
                result = { returned: value(branch.expression, local, depth + 1) };
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

        const result = statements(fn.body);
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
        if (object.kind === 'unknown') return unknownValue(object.reason, node);
        if (object.kind === 'array' && node.name.text === 'length') {
          return scalarValue(object.items.length);
        }
        if (object.kind !== 'record' || !object.fields.has(node.name.text)) {
          return unknownValue('INAPPLICABLE_VARIANT', node);
        }
        return object.fields.get(node.name.text);
      }

      if (ts.isElementAccessExpression(node) && node.argumentExpression) {
        const object = value(node.expression, frame, depth + 1);
        const key = value(node.argumentExpression, frame, depth + 1);
        if (object.kind === 'unknown' || key.kind === 'unknown') {
          return unknownValue('UNSUPPORTED_EXPRESSION', node);
        }
        const rawKey = primitive(key, node.argumentExpression);
        if (object.kind === 'array' && Number.isInteger(rawKey) && object.items[rawKey]) {
          return object.items[rawKey];
        }
        if (object.kind === 'record' && object.fields.has(String(rawKey))) {
          return object.fields.get(String(rawKey));
        }
        return unknownValue('INAPPLICABLE_VARIANT', node);
      }

      if (ts.isTemplateExpression(node)) {
        let text = node.head.text;
        for (const span of node.templateSpans) {
          const evaluated = value(span.expression, frame, depth + 1);
          if (evaluated.kind === 'unknown') return evaluated;
          text += String(primitive(evaluated, span.expression)) + span.literal.text;
          if (text.length > MAX_STRING_LENGTH) throw new StaticFailure('ANALYSIS_LIMIT', node);
        }
        return stringValue(text, node);
      }

      if (ts.isTaggedTemplateExpression(node)) return value(node.template, frame, depth + 1);

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
          return unknownValue('UNSUPPORTED_EXPRESSION', node);
        }
        const a = primitive(left, node.left);
        const b = primitive(right, node.right);
        if (operator === ts.SyntaxKind.PlusToken &&
            (typeof a === 'string' || typeof b === 'string')) {
          return stringValue(String(a) + String(b), node);
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
        return invoke(fn, args, frame, depth + 1);
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
            if (ts.isArrowFunction(callback) &&
                !callback.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) &&
                callback.parameters.length === 0 && ts.isStringLiteral(callback.body) &&
                callback.body.text === '?' && separator === ', ') {
              const receiverValue = value(receiver.expression.expression, frame, depth + 1);
              if (receiverValue.kind === 'unknown') return stringValue('?', node);
            }
          }
          const members = value(receiver, frame, depth + 1);
          if (members.kind !== 'array' || members.items.length > MAX_ARRAY_ITEMS) {
            return unknownValue('UNSUPPORTED_EXPRESSION', node);
          }
          const parts = [];
          for (const member of members.items) {
            if (member.kind === 'unknown') return member;
            if (member.kind !== 'string' && member.kind !== 'scalar') {
              return unknownValue('UNSUPPORTED_EXPRESSION', node);
            }
            parts.push(String(primitive(member, node)));
          }
          return stringValue(parts.join(separator), node);
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
