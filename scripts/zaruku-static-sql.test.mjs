import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { createStaticEvaluator, STATIC_ANALYSIS_LIMITS } from './zaruku-static-values.mjs';
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

test('SQL representations are equivalent across aliases, helpers, arrays, maps and records', () => {
  const representations = [
    'export const sql="SELECT * FROM dashboards";',
    'const query="SELECT * FROM dashboards"; export const sql=query;',
    'function make(){return ["SELECT * FROM dashboards"];} export const queries=make();',
    'export const queries=["SELECT * FROM dashboards"];',
    'const rows=[0]; export const queries=rows.map(()=>"SELECT * FROM dashboards");',
    'export const query={sql:"SELECT * FROM dashboards"};',
    'declare const pool:{execute(value:string):unknown}; const query="SELECT * FROM dashboards"; pool.execute(query);',
  ];
  for (const source of representations) {
    assert.deepEqual(extractStaticSql(source, 'fixture.ts').statements, ['SELECT * FROM dashboards']);
  }
});

test('SQL extraction preserves stored join boundaries and captured-condition correlation', () => {
  assert.deepEqual(extractStaticSql(`
    const parts=["SELECT * FR", "OM dashboards"];
    export const sql=parts.join("");
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);

  const { sourceFile, expression } = initializer(`
    declare const flag:boolean;
    const rows=[0,1];
    const sql=rows.map((row,index)=>flag
      ? (index===0 ? "SELECT * FR" : "OM report_bd_private.canonical_fact_metrika_visits")
      : (index===0 ? "SELECT * FR" : "OM dashboards")).join("");
  `, 2);
  const values = createStaticEvaluator(sourceFile).evaluate(expression).variants
    .map(variant => variant.value.kind === 'string' ? variant.value.text : variant.value.kind)
    .sort();
  assert.deepEqual(values, [
    'SELECT * FROM dashboards',
    'SELECT * FROM report_bd_private.canonical_fact_metrika_visits',
  ]);
});

test('SQL extraction refuses unknown members, recursion, async maps and mutable inputs', () => {
  const unsafe = [
    'declare const rows:unknown[]; export const sql=rows;',
    'declare const runtimeSql:()=>string; export const sql=runtimeSql();',
    'declare function runtimeSql():string; export const queries=["SELECT * FROM dashboards",runtimeSql(),"SELECT * FROM dashboard_sources"];',
    'declare const pool:{execute(value:string):unknown}; const query={safe:"SELECT * FROM dashboards"}; pool.execute(query.missing);',
    'function query(){return query();} export const sql=query();',
    'const rows=[0]; export const sql=rows.map(async()=>"SELECT * FROM dashboards").join("");',
    'let rows=[0]; export const queries=rows.map(()=>"SELECT * FROM dashboards");',
  ];
  for (const source of unsafe) {
    assert.throws(() => extractStaticSql(source, 'fixture.ts'), /UNRESOLVED_SQL|UNSUPPORTED_EXPRESSION/);
  }
});

test('SQL extraction exposes keyword, schema, comment and separator boundary attacks', () => {
  const unsafe = [
    'const rows=[0,1]; export const sql=rows.map((_,i)=>i===0?"SELECT * FR":"OM report_bd_private.canonical_fact_metrika_visits").join("");',
    'const rows=[0,1]; export const sql=rows.map((_,i)=>i===0?"SELECT * FROM report_":"bd_private.canonical_fact_metrika_visits").join("");',
    'const rows=[0,1]; export const sql=rows.map((_,i)=>i===0?"SELECT 1 /*":"*/ FROM report_bd_private.canonical_fact_metrika_visits").join("");',
    'const rows=[0,1]; export const sql=rows.map(()=>"SELECT * FROM dashboards").join(" UNION SELECT * FROM report_bd_private.canonical_fact_metrika_visits UNION ");',
  ];
  for (const source of unsafe) {
    const statements = extractStaticSql(source, 'fixture.ts').statements;
    assert.ok(statements.some(statement => statement.includes('report_bd_private')));
  }
});

test('typed evaluator enforces fixed variant, array, depth and string limits', () => {
  assert.deepEqual(STATIC_ANALYSIS_LIMITS, {
    variants: 64,
    arrayItems: 64,
    depth: 128,
    stringLength: 524288,
    work: 100000,
  });
  const oversizedArray = `[${Array.from({ length: 65 }, (_, index) => index).join(',')}]`;
  const arrayResult = initializer(`const unused=0; const value=${oversizedArray};`).sourceFile;
  const arrayExpression = arrayResult.statements[1].declarationList.declarations[0].initializer;
  assert.equal(createStaticEvaluator(arrayResult).evaluate(arrayExpression).variants[0].value.reason, 'ANALYSIS_LIMIT');

  const longText = 'x'.repeat(524289);
  const stringSource = ts.createSourceFile(
    'fixture.ts', `const value=${JSON.stringify(longText)};`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );
  const stringExpression = stringSource.statements[0].declarationList.declarations[0].initializer;
  assert.equal(createStaticEvaluator(stringSource).evaluate(stringExpression).variants[0].value.reason, 'ANALYSIS_LIMIT');
});
