import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { createStaticEvaluator } from './zaruku-static-values.mjs';
import { extractStaticSql } from './zaruku-static-sql.mjs';

function initializer(source, statementIndex = 1) {
  const sourceFile = ts.createSourceFile(
    'fixture.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );
  const statement = sourceFile.statements[statementIndex];
  return {
    sourceFile,
    expression: statement.declarationList.declarations[0].initializer,
  };
}

test('typed evaluator keeps one concrete mapped array distinct from execution variants', () => {
  const { sourceFile, expression } = initializer(
    'const rows=[true,false]; const queries=rows.map(flag => flag ? "A" : "B");',
  );
  const result = createStaticEvaluator(sourceFile).evaluate(expression);
  assert.equal(result.variants.length, 1);
  assert.deepEqual(result.variants[0].value, {
    kind: 'array',
    items: [
      { kind: 'string', text: 'A' },
      { kind: 'string', text: 'B' },
    ],
  });
});

test('typed evaluator preserves lexical shadowing and exact join boundaries', () => {
  const { sourceFile, expression } = initializer(`
    const part="FROM dashboards";
    const sql=[0].map(()=>{const part="FROM dashboard_sources";return "SELECT * "+part;}).join(" UNION ALL ");
  `);
  const result = createStaticEvaluator(sourceFile).evaluate(expression);
  assert.deepEqual(result.variants.map(variant => variant.value), [
    { kind: 'string', text: 'SELECT * FROM dashboard_sources' },
  ]);
});

test('typed evaluator returns an explicit unknown for unsupported expressions', () => {
  const { sourceFile, expression } = initializer(
    'declare function runtimeSql(): string; const sql=runtimeSql();',
  );
  const result = createStaticEvaluator(sourceFile).evaluate(expression);
  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0].value.kind, 'unknown');
  assert.equal(result.variants[0].value.reason, 'UNSUPPORTED_EXPRESSION');
});

test('SQL extraction keeps standalone mapped members and ignores an unrelated UI map', () => {
  const result = extractStaticSql(`
    declare const uiRows: Array<{label:string}>;
    const labels=uiRows.map(row=>row.label);
    const rows=[0,1];
    export const queries=rows.map(index=>index===0
      ? "SELECT * FROM dashboards"
      : "SELECT * FROM dashboard_sources");
  `, 'fixture.ts');
  assert.deepEqual(result.statements, [
    'SELECT * FROM dashboards',
    'SELECT * FROM dashboard_sources',
  ]);
});

test('SQL extraction accepts only the exact unknown-length placeholder grammar', () => {
  assert.deepEqual(extractStaticSql(`
    declare const values: unknown[];
    const placeholders=values.map(()=>"?").join(", ");
    export const sql=\`SELECT * FROM dashboards WHERE id IN (\${placeholders})\`;
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards WHERE id IN (?)']);
  assert.throws(() => extractStaticSql(`
    declare const values: unknown[];
    export const sql=\`SELECT * FROM dashboards WHERE id IN (\${values.map(()=>\`?\`).join(", ")})\`;
  `, 'fixture.ts'), /UNRESOLVED_SQL|UNSUPPORTED_EXPRESSION/);
});

test('SQL extraction ignores a concrete non-query branch while retaining the query branch', () => {
  assert.deepEqual(extractStaticSql(`
    declare const empty: boolean;
    function build() {
      if (empty) return null;
      return { detail: { sql: "SELECT * FROM dashboards" } };
    }
    const queries=build();
    export const sql=queries.detail.sql;
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);
});

test('SQL extraction redacts literals while reporting location and reason', () => {
  const sentinel = 'SENSITIVE_SENTINEL_MUST_NOT_APPEAR';
  assert.throws(
    () => extractStaticSql(
      `declare function ${sentinel}(): string;\nexport const sql=\`SELECT * FROM \${${sentinel}()}\`;`,
      '/tmp/private/fixture.ts',
    ),
    error => /fixture\.ts:2:\d+ (?:UNRESOLVED_SQL|UNSUPPORTED_EXPRESSION)/.test(error.message) &&
      !error.message.includes(sentinel) && !error.message.includes('SELECT'),
  );
});
