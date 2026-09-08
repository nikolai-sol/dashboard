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

  assert.throws(() => extractStaticSql(`
      declare const db:{query(value:string):unknown[]};
      export const sql=\`SELECT * FROM dashboards WHERE id IN (\${
        db.query("SELECT * FROM report_bd_private.canonical_fact_metrika_visits")
          .map(()=>"?").join(", ")
      })\`;
    `, 'fixture.ts'), /UNRESOLVED_SQL|UNSUPPORTED_EXPRESSION/);
});

test('SQL extraction checks explicit sinks nested inside candidate containers', () => {
  const statements = extractStaticSql(`
    declare const db:{query(value:string):unknown};
    export const bundle={
      sql:"SELECT * FROM dashboards",
      hidden:db.query("SELECT * FROM report_bd_private.canonical_fact_metrika_visits"),
    };
  `, 'fixture.ts').statements;
  assert.ok(statements.includes('SELECT * FROM dashboards'));
  assert.ok(statements.includes(
    'SELECT * FROM report_bd_private.canonical_fact_metrika_visits',
  ));

  const forwarded = extractStaticSql(`
    declare const db:{execute(value:string):unknown};
    function execute(query:{sql:string}) { return db.execute(query.sql); }
    const queries=[
      {sql:"SELECT * FROM dashboards"},
      {sql:"SELECT * FROM report_bd_private.canonical_fact_metrika_visits"},
    ];
    queries.map(query=>execute(query));
  `, 'fixture.ts').statements;
  assert.ok(forwarded.includes('SELECT * FROM dashboards'));
  assert.ok(forwarded.includes(
    'SELECT * FROM report_bd_private.canonical_fact_metrika_visits',
  ));

  const destructured = extractStaticSql(`
    declare const db:{query(value:string):unknown};
    const [rows, hidden]=[
      db.query("SELECT * FROM dashboards"),
      "SELECT * FROM report_bd_private.canonical_fact_metrika_visits",
    ];
  `, 'fixture.ts').statements;
  assert.ok(destructured.includes('SELECT * FROM dashboards'));
  assert.ok(destructured.includes(
    'SELECT * FROM report_bd_private.canonical_fact_metrika_visits',
  ));

  const conditionalSibling = extractStaticSql(`
    declare const db:{query(value:string):unknown};
    declare const chooseSafe:boolean;
    const [row]=[
      chooseSafe
        ? db.query("SELECT * FROM dashboards")
        : "SELECT * FROM report_bd_private.canonical_fact_metrika_visits",
    ];
  `, 'fixture.ts').statements;
  assert.ok(conditionalSibling.includes('SELECT * FROM dashboards'));
  assert.ok(conditionalSibling.includes(
    'SELECT * FROM report_bd_private.canonical_fact_metrika_visits',
  ));

  for (const member of [
    'hidden',
    '...{sql:hidden}',
    'method(){return hidden}',
  ]) {
    const objectSibling = extractStaticSql(`
      declare const db:{query(value:string):unknown};
      const hidden="SELECT * FROM report_bd_private.canonical_fact_metrika_visits";
      const {safe}={safe:db.query("SELECT * FROM dashboards"),${member}};
    `, 'fixture.ts').statements;
    assert.ok(objectSibling.includes('SELECT * FROM dashboards'));
    assert.ok(objectSibling.includes(
      'SELECT * FROM report_bd_private.canonical_fact_metrika_visits',
    ));
  }

  for (const expression of [
    '(db.query("SELECT * FROM dashboards"), hidden)',
    'choose(db.query("SELECT * FROM dashboards"), hidden)',
    'db.query("SELECT * FROM dashboards") || hidden',
  ]) {
    const genericSibling = extractStaticSql(`
      declare const db:{query(value:string):unknown};
      declare function choose(left:unknown,right:unknown):unknown;
      const hidden="SELECT * FROM report_bd_private.canonical_fact_metrika_visits";
      const [row]=[${expression}];
    `, 'fixture.ts').statements;
    assert.ok(genericSibling.includes('SELECT * FROM dashboards'));
    assert.ok(genericSibling.includes(
      'SELECT * FROM report_bd_private.canonical_fact_metrika_visits',
    ));
  }

  assert.throws(() => extractStaticSql(`
    declare const db:{query(value:string):unknown};
    const [row]=[\`${'${db.query("SELECT * FROM dashboards")}'}SELECT * FROM report_bd_private.canonical_fact_metrika_visits\`];
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

test('SQL extraction keeps dynamic indexed conditions independent across map members', () => {
  const statements = extractStaticSql(`
    declare const flags:boolean[];
    const rows=[0,1];
    export const sql=rows.map((_,index)=>flags[index]
      ? (index===0 ? "SELECT * FR" : "safe")
      : (index===0 ? "safe" : "OM report_bd_private.canonical_fact_metrika_visits")
    ).join("");
  `, 'fixture.ts').statements;
  assert.ok(statements.includes(
    'SELECT * FROM report_bd_private.canonical_fact_metrika_visits',
  ));
});

test('SQL extraction checks helper return variants beyond one concrete call', () => {
  const statements = extractStaticSql(`
    export function makeQuery(usePrivate:boolean) {
      return usePrivate
        ? "SELECT * FROM report_bd_private.canonical_fact_metrika_visits"
        : "SELECT * FROM dashboards";
    }
    export const sql=makeQuery(false);
  `, 'fixture.ts').statements;
  assert.ok(statements.includes(
    'SELECT * FROM report_bd_private.canonical_fact_metrika_visits',
  ));
  assert.ok(statements.includes('SELECT * FROM dashboards'));

  const namedExport = extractStaticSql(`
    function makeQuery(usePrivate:boolean) {
      return usePrivate
        ? "SELECT * FROM report_bd_private.canonical_fact_metrika_visits"
        : "SELECT * FROM dashboards";
    }
    export { makeQuery };
    const localQuery=makeQuery(false);
  `, 'fixture.ts').statements;
  assert.ok(namedExport.includes(
    'SELECT * FROM report_bd_private.canonical_fact_metrika_visits',
  ));

  for (const [source, filename] of [[`
    function makeQuery(usePrivate:boolean) {
      return usePrivate ? "SELECT * FROM report_bd_private.canonical_fact_metrika_visits" :
        "SELECT * FROM dashboards";
    }
    const localQuery=makeQuery(false);
    export const api={makeQuery};
  `, 'fixture.ts'], [`
    function makeQuery(usePrivate) {
      return usePrivate ? "SELECT * FROM report_bd_private.canonical_fact_metrika_visits" :
        "SELECT * FROM dashboards";
    }
    const localQuery=makeQuery(false);
    module.exports={makeQuery};
  `, 'fixture.js']]) {
    assert.ok(extractStaticSql(source, filename).statements.includes(
      'SELECT * FROM report_bd_private.canonical_fact_metrika_visits',
    ));
  }
});

test('SQL extraction refuses unknown members, recursion, async maps and mutable inputs', () => {
  const unsafe = [
    'declare const rows:unknown[]; export const sql=rows;',
    'declare const runtimeSql:()=>string; export const sql=runtimeSql();',
    'declare function runtimeSql():string; export const queries=["SELECT * FROM dashboards",runtimeSql(),"SELECT * FROM dashboard_sources"];',
    'declare const pool:{execute(value:string):unknown}; const query={safe:"SELECT * FROM dashboards"}; pool.execute(query.missing);',
    'declare const pool:{query(value:string):unknown}; pool.query(("SELECT * FROM report_bd_private.canonical_fact_metrika_visits" as unknown as {sql:string}).sql);',
    'export const queries=["SELECT * FROM dashboards",(null as unknown as {sql:string}).sql];',
    'const queries=[]; queries.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits"); export const sql=queries.join("");',
    'export const queries:string[]=[]; queries.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits");',
    'const select="SELECT * FROM "; const owner="report_bd_private.canonical_fact_metrika_visits"; export const queries:string[]=[]; queries.push(select+owner);',
    'const queries:string[]=[]; queries.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits"); export const result=queries.join("");',
    'function append(queries:string[]){queries.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits");} const queries:string[]=[]; append(queries); export const sql=queries.join("");',
    'const queries=[]; const alias=queries; alias.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits"); export const sql=queries.join("");',
    'function append(queries:string[]){const alias=queries;alias.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits");} const queries:string[]=[]; append(queries); export const sql=queries.join("");',
    'const queries:string[]=[]; let alias:string[]=[]; alias=queries; alias.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits"); export const sql=queries.join("");',
    'const queries:string[]=[]; const [alias]=[queries]; alias.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits"); export const sql=queries.join("");',
    'const queries:string[]=[]; const {alias}={alias:queries}; alias.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits"); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; const source=[queries]; const [alias]=source; alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; const ui:string[]=[]; const [alias]=true?[queries]:[ui]; alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; const ui:string[]=[]; const {alias}=true?{alias:queries}:{alias:ui}; alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; const [alias=queries]=[]; alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; const {alias=queries}={}; alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; declare const maybe:string[]|undefined; const queries:string[]=[]; const [alias=queries]=[maybe]; alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; declare const maybe:string[]|undefined; const queries:string[]=[]; const {alias=queries}={alias:maybe}; alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; function identity(value=queries){return value;} const alias=identity(); alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; function identity(value=queries){return value;} const alias=identity(undefined); alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; declare const maybe:string[]|undefined; const queries:string[]=[]; function identity(value=queries){return value;} const alias=identity(maybe); alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; function append(value=queries){value.push(runtimeSql());} append(); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; function append(value=queries){value.push(runtimeSql());} append(undefined); export const sql=queries.join("");',
    'declare function runtimeSql():string; declare const maybe:string[]|undefined; const queries:string[]=[]; function append(value=queries){value.push(runtimeSql());} append(maybe); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; function getQueries(){return queries;} function identity(value=getQueries()){return value;} const alias=identity(); alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; function getQueries(){return queries;} function append(value=getQueries()){value.push(runtimeSql());} append(); export const sql=queries.join("");',
    'declare function runtimeSql():string; declare const maybe:string[]|undefined; const queries:string[]=[]; function getQueries(){return queries;} function identity(value=getQueries()){return value;} const alias=identity(maybe); alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; function getQueries(){return queries;} function choose(){return true?getQueries():[];} function identity(value=choose()){return value;} const alias=identity(); alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; function getQueries(){return queries;} function choose(){return true&&getQueries();} function identity(value=choose()){return value;} const alias=identity(); alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; function getQueries(){return queries;} function choose(){return {value:getQueries()}.value;} function identity(value=choose()){return value;} const alias=identity(); alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; function getQueries(){return queries;} function choose(){return true?getQueries():[];} function append(value=choose()){value.push(runtimeSql());} append(); export const sql=queries.join("");',
    'declare function runtimeSql():string; declare const flag:boolean; const queries:string[]=[]; const ui:string[]=[]; function getQueries(){return queries;} function choose(value:boolean){return value?getQueries():ui;} function identity(value=choose(flag)){return value;} const alias=identity(); alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; declare const flag:boolean; const queries:string[]=[]; const ui:string[]=[]; function pass(value:string[]){return value;} function choose(value:boolean){return pass(value?queries:ui);} function identity(value=choose(flag)){return value;} const alias=identity(); alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; function pass<T>(value:T){return value;} const box=pass([queries]); box[0].push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; function pass<T>(value:T){return value;} const box=pass({value:queries}); box.value.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; function mutate(box:string[][]){box[0].push(runtimeSql());} mutate([queries]); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; function mutate(box:{value:string[]}){box.value.push(runtimeSql());} mutate({value:queries}); export const sql=queries.join("");',
    'declare function runtimeSql():string; declare const outerFlag:boolean; const queries:string[]=[]; const ui:string[]=[]; function pass(value:string[]){return value;} function outer(flag:boolean){function inner(innerFlag:boolean){return pass(innerFlag&&flag?queries:ui);} return inner(true);} const alias=outer(outerFlag); alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare const flag:boolean; const queries:string[]=[]; const alias=flag?queries:[]; alias.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits"); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; const ui:string[]=[]; const alias=true?queries:ui; alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare const flag:boolean; declare function runtimeSql():string; const queries:string[]=[]; const alias=flag?queries:[]; alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; const ui:string[]=[]; const alias=true&&queries||ui; alias.push(runtimeSql()); export const sql=queries.join("");',
    'const queries:string[]=[]; const box=[queries]; const alias=box[0]; alias.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits"); export const sql=queries.join("");',
    'function box(value:string[]){return [value];} const queries:string[]=[]; const alias=box(queries)[0]; alias.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits"); export const sql=queries.join("");',
    'function box(value:string[]){return {value};} const queries:string[]=[]; const alias=box(queries).value; alias.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits"); export const sql=queries.join("");',
    'declare function runtimeSql():string; function box(value:string[]){const result=[value];return result;} const queries:string[]=[]; const alias=box(queries)[0]; alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; function box(value:string[]){const result={value};return result;} const queries:string[]=[]; const alias=box(queries).value; alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; const box=[queries]; function mutate(value:string[]){value.push(runtimeSql());} mutate(box[0]); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; const box=[queries]; const copy=box; const alias=copy[0]; alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; const box=[[queries]]; const alias=box[0][0]; alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; const key=0; const box=[queries]; const alias=box[key]; alias.push(runtimeSql()); export const sql=queries.join("");',
    'declare function runtimeSql():string; const queries:string[]=[]; const box={queries}; const alias=box.queries; alias.push(runtimeSql()); export const sql=queries.join("");',
    'function identity(value:string[]){const alias=value;return alias;} const queries:string[]=[]; const alias=identity(queries); alias.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits"); export const sql=queries.join("");',
    'function identity(value:string[]){const alias=value;return alias;} const queries:string[]=[]; let alias:string[]=[]; alias=identity(queries); alias.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits"); export const sql=queries.join("");',
    'const queries:string[]=[]; [queries].map(alias=>alias.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits")); export const sql=queries.join("");',
    'const queries:string[]=[]; [queries].map(alias=>{alias.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits");return 0;}); export const sql=queries.join("");',
    'function mutate(alias:string[]){alias.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits");} const queries:string[]=[]; [queries].map(mutate); export const sql=queries.join("");',
    'function mutate(alias:string[]){alias.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits");} const callback=mutate; const queries:string[]=[]; [queries].map(callback); export const sql=queries.join("");',
    'declare const flag:boolean; function mutate(alias:string[]){alias.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits");} function noop(alias:string[]){} const callback=flag?mutate:noop; const queries:string[]=[]; [queries].map(callback); export const sql=queries.join("");',
    'const queries:string[]=[]; const alias=queries; alias.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits"); export {queries};',
    'const queries:string[]=[]; Object.assign(queries,{0:"SELECT * FROM report_bd_private.canonical_fact_metrika_visits",length:1}); export const sql=queries.join("");',
    'function query(){return query();} export const sql=query();',
    'declare const rewrite:(parts:TemplateStringsArray)=>string; export const sql=rewrite`SELECT * FROM dashboards`;',
    'const rows=[0]; export const sql=rows.map(async()=>"SELECT * FROM dashboards").join("");',
    'let rows=[0]; export const queries=rows.map(()=>"SELECT * FROM dashboards");',
  ];
  for (const source of unsafe) {
    assert.throws(
      () => extractStaticSql(source, 'fixture.ts'),
      /UNRESOLVED_SQL|UNSUPPORTED_EXPRESSION/,
      source,
    );
  }


  assert.deepEqual(extractStaticSql(`
    const safe=["SELECT * FROM dashboards"];
    function maybe(flag:boolean,queries:string[]){return flag?queries:[];}
    const ui=maybe(false,safe);
    ui.push("label");
    export const sql=safe.join("");
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);

  for (const source of [`
    const flag=false;
    const safe=["SELECT * FROM dashboards"];
    function maybe(flag:boolean,queries:string[]){return flag?queries:[];}
    const ui=maybe(flag,safe);
    ui.push("label");
    export const sql=safe.join("");
  `, `
    const mode="safe";
    const safe=["SELECT * FROM dashboards"];
    function maybe(flag:boolean,queries:string[]){return flag?queries:[];}
    const ui=maybe(mode==="private",safe);
    ui.push("label");
    export const sql=safe.join("");
  `, `
    const safe=["SELECT * FROM dashboards"];
    function maybe(flag:boolean,queries:string[]){if(flag)return queries;return [];}
    const ui=maybe(false,safe);
    ui.push("label");
    export const sql=safe.join("");
  `]) {
    assert.deepEqual(extractStaticSql(source, 'fixture.ts').statements, [
      'SELECT * FROM dashboards',
    ]);
  }

  assert.deepEqual(extractStaticSql(`
    const safe=["SELECT * FROM dashboards"];
    const ui:string[]=[];
    function identity(value:string[]){return value;}
    const mutable=identity(ui);
    mutable.push("label");
    const untouched=identity(safe);
    export const sql=safe.join("");
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);

  assert.deepEqual(extractStaticSql(`
    declare function runtimeBool():boolean;
    const safe=["SELECT * FROM dashboards"];
    function maybe(flag:boolean,queries:string[]){
      return flag && runtimeBool()?queries:[];
    }
    const ui=maybe(false,safe);
    ui.push("label");
    export const sql=safe.join("");
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);

  assert.deepEqual(extractStaticSql(`
    const safe=["SELECT * FROM dashboards"];
    function maybe(index:number,queries:string[]){return index+1===1?[]:queries;}
    const ui=maybe(0,safe);
    ui.push("label");
    export const sql=safe.join("");
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);

  assert.deepEqual(extractStaticSql(`
    function box():unknown[]{return box();}
    const value=box()[0];
    export const sql="SELECT * FROM dashboards";
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);

  assert.deepEqual(extractStaticSql(`
    const safe=["SELECT * FROM dashboards"];
    const ui:string[]=[];
    function identity(value:string[]){return value;}
    const mutable=false?identity(safe):identity(ui);
    mutable.push("label");
    export const sql=safe.join("");
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);

  assert.deepEqual(extractStaticSql(`
    const safe=["SELECT * FROM dashboards"];
    function mutate(value:string[]){value.push("SELECT * FROM report_bd_private.canonical_fact_metrika_visits");}
    function noop(value:string[]){}
    const callback=false?mutate:noop;
    [safe].map(callback);
    export const sql=safe.join("");
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);

  assert.deepEqual(extractStaticSql(`
    const safe=["SELECT * FROM dashboards"];
    const ui:string[]=[];
    const alias=(false?[safe]:[ui])[0];
    alias.push("label");
    export const sql=safe.join("");
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);

  assert.deepEqual(extractStaticSql(`
    const safe=["SELECT * FROM dashboards"];
    const ui:string[]=[];
    const word="safe";
    const mode=\`\${word}\`;
    const alias=mode==="private"?safe:ui;
    alias.push("label");
    export const sql=safe.join("");
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);

  assert.deepEqual(extractStaticSql(`
    const safe=["SELECT * FROM dashboards"];
    const ui:string[]=[];
    const [alias=safe]=[ui];
    alias.push("label");
    export const sql=safe.join("");
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);

  for (const destructuring of [
    'const [alias=safe]=[identity(ui)];',
    'const {alias=safe}={alias:identity(ui)};',
    'const [alias=safe]=[identity()];',
    'const {alias=safe}={alias:identity(undefined)};',
  ]) {
    assert.deepEqual(extractStaticSql(`
      const safe=["SELECT * FROM dashboards"];
      const ui:string[]=[];
      function identity(value:string[]=ui){return value;}
      ${destructuring}
      alias.push("label");
      export const sql=safe.join("");
    `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);
  }

  assert.deepEqual(extractStaticSql(`
    const safe=["SELECT * FROM dashboards"];
    const ui:string[]=[];
    function append(value:string[]=safe){value.push("label");}
    append(ui);
    export const sql=safe.join("");
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);

  assert.deepEqual(extractStaticSql(`
    const safe=["SELECT * FROM dashboards"];
    const ui:string[]=[];
    declare const maybe:string[]|undefined;
    function identity(value:string[]=ui){return value;}
    const [alias=safe]=[identity(maybe)];
    alias.push("label");
    export const sql=safe.join("");
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);

  assert.deepEqual(extractStaticSql(`
    const safe=["SELECT * FROM dashboards"];
    const ui:string[]=[];
    function getUi(){return ui;}
    function identity(value:string[]=getUi()){return value;}
    const [alias=safe]=[identity()];
    alias.push("label");
    export const sql=safe.join("");
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);

  assert.deepEqual(extractStaticSql(`
    const safe=["SELECT * FROM dashboards"];
    const ui:string[]=[];
    function getSafe(){return safe;}
    function choose(){return false?getSafe():ui;}
    function identity(value:string[]=choose()){return value;}
    const alias=identity();
    alias.push("label");
    export const sql=safe.join("");
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);

  for (const choice of [
    'flag?getSafe():ui',
    'flag&&getSafe()||ui',
  ]) {
    assert.deepEqual(extractStaticSql(`
      const safe=["SELECT * FROM dashboards"];
      const ui:string[]=[];
      function getSafe(){return safe;}
      function choose(flag:boolean){return ${choice};}
      function identity(value=choose(false)){return value;}
      const alias=identity();
      alias.push("label");
      export const sql=safe.join("");
    `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);
  }

  for (const argument of [
    'flag?safe:ui',
    'flag&&safe||ui',
    '[flag?safe:ui][0]',
    '{value:flag?safe:ui}.value',
  ]) {
    assert.deepEqual(extractStaticSql(`
      const safe=["SELECT * FROM dashboards"];
      const ui:string[]=[];
      function pass(value:string[]){return value;}
      function choose(flag:boolean){return pass(${argument});}
      function identity(value=choose(false)){return value;}
      const alias=identity();
      alias.push("label");
      export const sql=safe.join("");
    `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);
  }

  assert.deepEqual(extractStaticSql(`
    const safe=["SELECT * FROM dashboards"];
    const ui:string[]=[];
    function pass<T>(value:T){return value;}
    const arrayBox=pass([safe,ui]);
    const objectBox=pass({safe,ui});
    arrayBox[1].push("label");
    objectBox.ui.push("label");
    export const sql=safe.join("");
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);

  assert.deepEqual(extractStaticSql(`
    const safe=["SELECT * FROM dashboards"];
    const ui:string[]=[];
    function mutateArray(box:string[][]){box[1].push("label");}
    function mutateObject(box:{safe:string[],ui:string[]}){box.ui.push("label");}
    mutateArray([safe,ui]);
    mutateObject({safe,ui});
    export const sql=safe.join("");
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);

  for (const argument of [
    'innerFlag&&outerFlag?safe:ui',
    '[innerFlag&&outerFlag?safe:ui][0]',
    '{value:innerFlag&&outerFlag?safe:ui}.value',
  ]) {
    assert.deepEqual(extractStaticSql(`
      const safe=["SELECT * FROM dashboards"];
      const ui:string[]=[];
      function pass(value:string[]){return value;}
      function outer(outerFlag:boolean){
        function inner(innerFlag:boolean){return pass(${argument});}
        return inner(true);
      }
      function identity(value=outer(false)){return value;}
      const alias=identity();
      alias.push("label");
      export const sql=safe.join("");
    `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);
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
  assert.throws(() => extractStaticSql(`
    declare function piece():string;
    export const queries=piece()+"SEL"+"ECT * FR"+"OM repo"+
      "rt_bd_pri"+"vate.can"+"onical_fact_metrika_visits";
  `, 'fixture.ts'), /UNRESOLVED_SQL|UNSUPPORTED_EXPRESSION/);
  assert.throws(() => extractStaticSql(`
    declare function piece():string;
    export const queries=[piece(),"SEL","ECT * FR","OM repo","rt_bd_pri",
      "vate.can","onical_fact_metrika_visits"].join("");
  `, 'fixture.ts'), /UNRESOLVED_SQL|UNSUPPORTED_EXPRESSION/);

  assert.deepEqual(extractStaticSql(`
    export const queries=["SEL",null,
      "ECT * FROM report_bd_private.canonical_fact_metrika_visits"].join("");
  `, 'fixture.ts').statements, [
    'SELECT * FROM report_bd_private.canonical_fact_metrika_visits',
  ]);
  assert.deepEqual(extractStaticSql(`
    const rows=[0,1,2];
    export const queries=rows.map(index=>index===0 ? "SEL" : index===1 ? null :
      "ECT * FROM report_bd_private.canonical_fact_metrika_visits").join("");
  `, 'fixture.ts').statements, [
    'SELECT * FROM report_bd_private.canonical_fact_metrika_visits',
  ]);
});

test('typed evaluator enforces fixed variant, array, depth and string limits', () => {
  assert.deepEqual(STATIC_ANALYSIS_LIMITS, {
    variants: 64,
    arrayItems: 64,
    depth: 128,
    stringLength: 524288,
    work: 100000,
  });
  assert.deepEqual(extractStaticSql(`
    function make(value="SELECT * FROM dashboards"){return value;}
    export const sql=make(undefined);
  `, 'fixture.ts').statements, ['SELECT * FROM dashboards']);
  assert.throws(() => extractStaticSql(`
    declare const maybe:string|undefined;
    function make(value="SELECT * FROM dashboards"){return value;}
    export const sql=make(maybe);
  `, 'fixture.ts'), /UNRESOLVED_SQL|UNSUPPORTED_EXPRESSION/);
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

  const half = 'y'.repeat(300000);
  const concatSource = ts.createSourceFile(
    'fixture.ts', `const value=${JSON.stringify(half)}+${JSON.stringify(half)};`,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );
  const concatExpression = concatSource.statements[0].declarationList.declarations[0].initializer;
  assert.equal(
    createStaticEvaluator(concatSource).evaluate(concatExpression).variants[0].value.reason,
    'ANALYSIS_LIMIT',
  );

  const nestedSource = `function make(){${'if(true){'.repeat(140)}return "SELECT * FROM dashboards";${'}'.repeat(140)}} export const sql=make();`;
  assert.throws(
    () => extractStaticSql(nestedSource, 'fixture.ts'),
    /ANALYSIS_LIMIT/,
  );

  let nestedTemplate = '"safe"';
  for (let depth = 0; depth < 130; depth += 1) {
    nestedTemplate = `\`\${${nestedTemplate}}\``;
  }
  assert.throws(
    () => extractStaticSql(`
      const safe=["SELECT * FROM dashboards"];
      const ui:string[]=[];
      const mode=${nestedTemplate};
      const alias=mode==="private"?safe:ui;
      alias.push("label");
      export const sql=safe.join("");
    `, 'fixture.ts'),
    /ANALYSIS_LIMIT/,
  );

  function decisionTree(depth, leaf) {
    if (depth === 0) return leaf;
    const condition = `flag${depth}`;
    return `${condition}?(${decisionTree(depth - 1, leaf)}):(${decisionTree(depth - 1, leaf)})`;
  }
  const flags = Array.from({ length: 7 }, (_, index) =>
    `declare const flag${index + 1}:boolean;`).join('');
  const variantSource = ts.createSourceFile(
    'fixture.ts', `${flags}const value=${decisionTree(7, '"x"')};`,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );
  const variantExpression = variantSource.statements.at(-1)
    .declarationList.declarations[0].initializer;
  assert.ok(createStaticEvaluator(variantSource).evaluate(variantExpression).variants
    .some(variant => variant.value.kind === 'unknown' && variant.value.reason === 'ANALYSIS_LIMIT'));

  const payload = `{${Array.from({ length: 64 }, (_, field) =>
    `p${field}:[${Array.from({ length: 32 }, (_, value) => value).join(',')}]`).join(',')}}`;
  const workFlags = Array.from({ length: 6 }, (_, index) =>
    `declare const flag${index + 1}:boolean;`).join('');
  const workSource = ts.createSourceFile(
    'fixture.ts', `${workFlags}const payload=${payload};const value=${decisionTree(6, 'payload')};`,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );
  const workExpression = workSource.statements.at(-1)
    .declarationList.declarations[0].initializer;
  assert.ok(createStaticEvaluator(workSource).evaluate(workExpression).variants
    .some(variant => variant.value.kind === 'unknown' && variant.value.reason === 'ANALYSIS_LIMIT'));

  const preprocessingSource = `${';'.repeat(STATIC_ANALYSIS_LIMITS.work + 1)}export const sql="SELECT * FROM dashboards";`;
  assert.throws(
    () => extractStaticSql(preprocessingSource, 'fixture.ts'),
    /ANALYSIS_LIMIT/,
  );

  const oversizedMutation = `export const sql:string[]=[];sql.push("${'x'.repeat(524289)}")`;
  assert.throws(
    () => extractStaticSql(oversizedMutation, '/tmp/private/fixture.ts'),
    error => /fixture\.ts:1:\d+ ANALYSIS_LIMIT/.test(error.message) &&
      error.constructor === Error,
  );
});
