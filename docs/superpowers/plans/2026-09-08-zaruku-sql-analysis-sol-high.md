# Zaruku SQL Analysis Implementation Plan — Sol High

> **For agentic workers:** Use `executing-plans` to implement this plan task-by-task in the current isolated worktree. Исполнение последовательно на **gpt-5.6-sol, reasoning high**. Пользователь запустит план самостоятельно. Не создавать новые задачи и не переключать модель. При отдельном ревью сохранять выбранную пользователем модель.

**Goal:** Устранить потерю SQL-запросов при статической проверке Zaruku, сохранив запросы, данные и поведение всех дашбордов.

**Architecture:** Один ограниченный статический вычислитель TypeScript AST сохраняет тип результата: строка, упорядоченный массив, вспомогательное значение либо неизвестное значение. Сборщик SQL использует этот результат одинаково для самостоятельных массивов и для `map/join`; SQL tokenizer проверяет полученные строки. Неподдерживаемое выражение, от которого зависит SQL, завершает проверку отказом с указанием места в исходнике.

**Tech Stack:** Node.js ESM, существующий TypeScript compiler API, `node:test`; без новых зависимостей, выполнения анализируемого кода или подключения к БД.

**Статус документа:** предложение и готовый план исполнения; реализация этого плана не начата. Запуск пользователем означает выбор рекомендованного варианта A. Это самостоятельное исправление source-проверки внутри незавершённого Task 5 большого плана production shadow, не продолжение серверного rollout.

## Что затрагивается и почему

Проверено на исходном коммите `4f5d19b80eb6d46016b1221024f790566fbb36de` в ветке `codex/three-dashboard-runtime-isolation`.

| Область | Прямое влияние | Косвенное влияние |
| --- | --- | --- |
| Работающий Zaruku, вкладки, показатели, история | Изменений нет: анализатор не обслуживает HTTP и не исполняет SQL | Локальная подготовка Zaruku будет надёжнее обнаруживать неизвестные/запрещённые запросы |
| Abbott, рекламные и sales-дашборды | Их исходники, данные, доступы и процессы вне плана | Общий `predeploy:verify` запускает Zaruku-тесты; их ошибка может блокировать общий выпуск |
| Общие `src/lib`-модули, импортируемые Zaruku | Анализатор читает их текст; менять эти модули не требуется | Их SQL учитывается, если модуль достижим из `apps/zaruku` |
| MySQL | Ни одного чтения или изменения реальной БД | Перечень разрешённых таблиц остаётся контрольным эталоном |
| Доменные ссылки, Nginx, PM2, релизы | Вне исполнения этого плана | Готовность source-проверки не означает готовность серверного разделения |

Доказательства в репозитории:

- `scripts/zaruku-production-shadow-contract.mjs`: `scanZarukuRuntimeMysqlTables()` начинает обход в `apps/zaruku` и читает текст транзитивных импортов.
- Прямой вызов scanner найден в `scripts/zaruku-production-shadow-contract.test.mjs`; runtime-код в `apps/`, `src/`, `packages/` его не импортирует.
- `scripts/predeploy-verify.sh:7` вызывает `npm run test:zaruku-production-shadow`; состав команды находится в `package.json`.
- `deploy/zaruku/mysql-read-tables.json`: точный текущий перечень — 35 физических таблиц. Равенство количеству само по себе недостаточно: сравнивать весь отсортированный список.

Следствие: ответ «вообще не касается других дашбордов» был бы неточным. Работающие дашборды не меняются, но связь проверок выпуска существует. Разделение CI по dashboard scope — отдельное последующее предложение; этот план не удаляет и не делает необязательным общий gate.

## Варианты

| Вариант | Что делаем | Достоинства | Ограничения и решение |
| --- | --- | --- | --- |
| **A. Единый типизированный анализатор только Zaruku — рекомендован** | Заменяем два несогласованных способа извлечения SQL одним вычислителем и явным сборщиком | Устраняет причину потери массивов; не требует менять dashboard SQL; ограниченная область файлов | Требует точной грамматики и регрессионной матрицы. Не обещает разобрать произвольный JavaScript |
| B. Обязательный реестр/обёртка для всех SQL-запросов Zaruku | Переносим объявления запросов в управляемый каталог или tagged API и запрещаем обход | Проще явно видеть владельцев запросов и проверять покрытие | Потребуется менять реальные query builders, включая общие модули; реестр без запрета обхода быстро устаревает. Слишком широкое изменение для текущего исправления |
| C. Полноценный MySQL parser и стандартный SQL AST | После извлечения строк передаём их библиотечному parser | Лучше покрывает синтаксис MySQL | Не решает исходную потерю строк при `map`; всё равно нужен A или B. Добавляет зависимость и проверку совместимости диалекта. Не включать сейчас |

Не продолжать вариант «отдельное исключение для очередного map»: предыдущие ошибки возникли на границах разных вычислителей и обхода AST. Тип результата должен сохраняться до потребителя.

## Исходная проблема и граница доказательства

В `collectStaticSqlExpressions()` одновременно существуют `evaluate()`, возвращающий массив альтернатив строк либо `null`, и `composedJoin()`, имеющий собственные scope/array semantics. `evaluate(map)` возвращает `null`, а `collectCandidates()` прекращает обход потомков любого `map`. Поэтому этот запрос исчезает:

```ts
const rows = [0];
export const queries = rows.map(() =>
  "SELECT * FROM report_bd_private.canonical_fact_metrika_visits");
```

Зафиксированный результат scanner — `[]`. Правильный результат — отказ из-за private schema. Для такого же запроса к `dashboards` ожидается `['dashboards']`, даже если переменная называется `queries`, а не `sql`.

На исходном HEAD 155 source-тестов и четыре Linux-группы проходили; это не закрывает найденный дефект. Полный `predeploy` на этом HEAD не завершался. Предыдущие зелёные отчёты не переиспользовать как доказательство исправления.

Scanner является дополнительной проверкой исходников для ограниченного поддерживаемого языка, а не песочницей для произвольного JS. Базовой защитой данных остаются отдельный reader и точные MySQL grants. Не заявлять формальную полноту анализа всего TypeScript или защиту от всех возможных runtime-конструкций.

## Global Constraints

- Рабочая директория: `/Users/nafanya/ReportingDash/dashboard-next/.worktrees/three-dashboard-runtime-isolation`.
- Ветка: `codex/three-dashboard-runtime-isolation`. Исходный code SHA: `4f5d19b80eb6d46016b1221024f790566fbb36de`. Более поздний planning-only commit допустим после проверки diff.
- Только локальные исходники проверки, тесты и документация. Этот план не разрешает push, freeze реального release-ref, SSH к production, provisioning, deploy, миграции, чтение секретов, внешние API или canonical data operations.
- `apps/**`, `src/**`, `packages/**`, `deploy/**`, lockfiles, runtime/deploy/auth/DB helpers не изменять. SQL дашбордов и 35-table authority не подгонять под scanner.
- Исторические ручные данные, Wordstat, Alice, SEO OS, Abbott/private и рекламные данные остаются неизменными.
- `scripts/predeploy-verify.sh` не менять; существующие проверки не отключать. В `package.json` допустимо только включение нового source-test файла в существующую Zaruku-команду, если выбран этот способ подключения.
- Scanner и новые helper-модули остаются source-only. Не включать их в staged production control bundle, HTTP runtime или Docker image manifest.
- Без `eval`, `Function`, выполнения импортов анализируемого приложения, запуска query builders или доступа к сети/БД. TypeScript используется как parser AST.
- Не менять regex импортов, модель разрешения транзитивных импортов или MySQL tokenizer без конкретной регрессии в этой задаче. Найденные независимые дефекты перечислять отдельно.
- Локальные коммиты разрешены; stage только конкретные файлы текущей задачи. Существующие чужие изменения сохранять. Не делать reset/rebase/merge общей ветки.

## Модель и интерфейсы

Один evaluator должен обслуживать литералы, template/concat, aliases, функции, arrays, map и join. Отдельного join-evaluator со своей системой bindings после завершения не остаётся.

Рекомендуемая внутренняя модель (JSDoc, без перехода проекта на новый язык):

```ts
type Value =
  | { kind: 'string'; text: string }
  | { kind: 'array'; items: readonly Value[] }
  | { kind: 'scalar'; value: number | boolean | null }
  | { kind: 'record'; fields: ReadonlyMap<string, Value> }
  | { kind: 'unknown'; reason: string; nodeStart: number };

type Variant = { value: Value; decisions: ReadonlyMap<string, boolean> };
type Evaluation = { variants: readonly Variant[] };
type SqlAnalysis = { statements: readonly string[] };
```

`null` допустим только как явно типизированное scalar-значение, не как отсутствие ответа evaluator. Не смешивать `variants` (альтернативные исполнения) с `array.items` (элементы одного результата). Unknown не превращается в `[]`, пустую строку или «нет SQL».

Новые файлы:

- `scripts/zaruku-static-values.mjs` — lexical bindings и единая ограниченная семантика AST. Экспорт: `createStaticEvaluator(sourceFile)`, возвращает объект с `evaluate(expression): Evaluation`. Scope выводится из AST/внутреннего frame, а не из глобального словаря имён.
- `scripts/zaruku-static-sql.mjs` — выбор SQL-кандидатов и сбор строк. Экспорт: `extractStaticSql(source: string, filename: string): SqlAnalysis`. При unresolved SQL выбрасывает фиксированную диагностическую ошибку.
- `scripts/zaruku-static-sql.test.mjs` — прямые проверки evaluator, extraction и интеграции с scanner; можно импортировать оба новых модуля.
- `scripts/zaruku-production-shadow-contract.mjs` — сохраняет существующие authority loaders, graph traversal и SQL owner tokenizer. Вместо старого extractor вызывает `extractStaticSql(source, filename).statements`. Публичный `scanZarukuRuntimeMysqlTables(rootDirectory)` не меняется.
- `scripts/zaruku-production-shadow-contract.test.mjs` — сохраняет старые регрессии и добавляет графовые/изоляционные проверки.

Поддерживаемая грамматика: литералы, const bindings с lexical shadowing, bounded immutable arrays/records, property reads, существующие поддерживаемые арифметические/логические операторы, templates, concat, conditional, синхронные чистые локальные functions, map над concrete array и join со статическим separator. Неподдерживаемые вызовы/мутации, async, spread, recursion и превышение бюджета возвращают unknown с причиной; SQL-потребитель отказывает.

Пределы: 64 варианта, 64 элемента concrete array, глубина 128, 524288 символов одной SQL-строки. Считать лимиты до выделения больших комбинаций, не после. Зафиксировать общий счётчик работы на одну evaluation (100000 посещений AST); превышение также unknown. Ни один лимит не настраивается через env/CLI. Дедупликация возможна только после полной сборки упорядоченного результата.

Для неизвестной длины сохранить только существующее точное исключение `values.map(() => "?").join(", ")`: синхронная arrow без параметров, тело StringLiteral `?`, separator StringLiteral `, `. Это bound-parameter grammar, не разрешение на динамические имена таблиц. Near-miss формы должны отказать в SQL-контексте. Внутренний frame может хранить symbolic boolean condition и согласованно раскрывать её для всего результата.

## Правила сбора SQL — согласовать до реализации

1. Известный SQL sink: первый аргумент `.query/.execute`, свойство `sql`, объявление с суффиксом `sql`. Его неразрешённое значение всегда блокирует анализ.
2. Лексический поиск также проверяет объявления и return-выражения, включая массивы строк и standalone map независимо от имени переменной. Полные строки с SQL-маркерами передаются tokenizer; неизвестное выражение с потенциальным SQL не игнорируется.
3. Обход callback нельзя прекращать только из-за имени метода `map`. Сохранить факт наличия SQL-литерала/зависимости в unsupported subtree и передать его потребителю. Отсутствие вычисленного значения не доказывает отсутствие SQL.
4. Не склеивать самостоятельные элементы массива между собой. Каждый полный query-member проверяется отдельно. Если массив потребляется join, проверяется точный итоговый join, включая границы элементов и separator. Промежуточный фрагмент `FROM (` или `SELECT * FR` не выдавать как отдельный полный query, когда есть разрешённый composing consumer.
5. Корреляция captured condition сохраняется между всеми элементами одного варианта. Разные параметры конкретных элементов вычисляются отдельно. Запрещён прежний подход «повторить каждую альтернативу callback и забыть смешанные комбинации».
6. Обычная обработка данных/подписей UI (`rows.map(r => r.label)`) без SQL-связи не должна блокировать source scan. Для этого SQL relevance определяется явными sinks, зависимостями и SQL-bearing subtree, не только именами переменных. Если неизвестный массив достигает SQL sink — отказ даже без видимого SQL-литерала.
7. Диагностика содержит относительный путь, строку/колонку и код причины (`UNSUPPORTED_EXPRESSION`, `UNRESOLVED_SQL`, `ANALYSIS_LIMIT`). Не включать исходный SQL, литералы или значения в сообщение ошибки.

## Task 1: Воспроизводимые критерии и поддерживаемый язык

**Files:** изменить `scripts/zaruku-production-shadow-contract.test.mjs`; создать отчёт `docs/superpowers/reports/2026-09-08-zaruku-sql-analysis.md`.
**Interfaces:** существующий `scanZarukuRuntimeMysqlTables(root)`; результат — полный sorted table list либо exception.

- [ ] Проверить branch, HEAD, status. Прочитать оба AGENTS: `/Users/nafanya/ReportingDash/AGENTS.md` и `AGENTS.md` worktree, этот план и начало `.superpowers/sdd/production-shadow-task-5-report.md`.
- [ ] Сохранить исходный code SHA и список изменённых файлов. При другой кодовой базе сопоставить изменения до редактирования; не cherry-pick старый код поверх новых dashboard-изменений.
- [ ] Добавить тесты в существующий temporary-root fixture (структура `apps/zaruku/entry.ts`), используя точные исходники:

```js
// scan(source) записывает только fixture entry.ts и вызывает реальный scanner.
assert.throws(() => scan(`const rows=[0]; export const queries=rows.map(() =>
  "SELECT * FROM report_bd_private.canonical_fact_metrika_visits");`));
assert.deepEqual(scan(`const rows=[0]; export const queries=rows.map(() =>
  "SELECT * FROM dashboards");`), ['dashboards']);
assert.throws(() => scan(`const rows=[true,false]; export const sql=rows.map(flag =>
  flag ? "SELECT * FR" : "OM report_bd_private.canonical_fact_metrika_visits").join("");`));
```

- [ ] Запустить `node --test --test-name-pattern='standalone mapped' scripts/zaruku-production-shadow-contract.test.mjs` (так назвать новые тесты). Зафиксировать содержательное падение на scanner, а не ошибку импорта. До рефакторинга добавить case inventory в отчёт: standalone arrays/maps; joined fragments; Metrika12; SEO concrete arrays; placeholder-only; UI-only maps.
- [ ] Инвентаризировать реальные формы SQL через статический текст reachable Zaruku sources; никаких вызовов функций приложения. Начать с `src/lib/zaruku-metrika.ts` и `apps/zaruku/src/lib/zaruku-seo.ts`, затем файлов, которые посещает graph traversal. Сохранить места, требующие symbolic scalar/boolean handling.

## Task 2: Единый вычислитель и сборщик

**Files:** создать два source-модуля и `scripts/zaruku-static-sql.test.mjs`; заменить extractor в contract; подключить новый test файл в существующую Zaruku test-команду.
**Interfaces:** `createStaticEvaluator(sourceFile).evaluate(expression)` → `Evaluation`; `extractStaticSql(source, filename)` → `SqlAnalysis`; graph scanner остаётся прежним.

- [ ] Реализовать типизированный evaluator и его unit cases: string/array/scalar/record/unknown; lexical shadowing; concrete map order; join boundaries; captured boolean correlation; cap/depth/size/work refusal. Перенести применимую существующую логику, удалив дублирование bindings/evaluation; не наращивать третий evaluator.
- [ ] Проверить различие списка и альтернатив непосредственно:

```js
const sourceFile = ts.createSourceFile('fixture.ts',
  'const rows=[true,false]; const queries=rows.map(flag => flag ? "A" : "B");',
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const expression = sourceFile.statements[1].declarationList.declarations[0].initializer;
const result = createStaticEvaluator(sourceFile).evaluate(expression);
assert.equal(result.variants.length, 1);
assert.deepEqual(result.variants[0].value, {
  kind: 'array', items: [{kind:'string',text:'A'}, {kind:'string',text:'B'}]
});
```

- [ ] Реализовать сбор кандидатов и зависимостей по семи правилам выше. Полные strings/arrays сохраняются; unresolved SQL отказывает; mapped callbacks не исчезают; intermediate fragment не ошибочно сканируется как finished query. Вспомогательный unknown UI map не становится SQL лишь из-за вызова `map`.
- [ ] Подключить extractor в contract через статический импорт source-only модуля; заменить старые `collectStaticSqlExpressions/evaluate/composedJoin`, сохранив tokenizer и обход импортов. Не оставить старый путь как fallback при ошибке нового.
- [ ] Выполнить `node --test scripts/zaruku-static-sql.test.mjs scripts/zaruku-production-shadow-contract.test.mjs`. Исправить только подтверждённые расхождения. Нельзя удалять регрессию или расширять grant list ради GREEN.
- [ ] Проверить diff по разрешённым файлам и сделать локальный коммит `fix(zaruku): preserve typed SQL values through extraction` после focused GREEN.

## Task 3: Регрессионная матрица и защита соседних дашбордов

**Files:** два test-файла Task 2, локальный отчёт; production/runtime sources остаются read-only.
**Interfaces:** тестировать public scanner и новый extractor; не подменять их mock-реализацией.

- [ ] Добавить положительные и отрицательные пары: inline array, variable alias, function-returned array, standalone map, map stored then joined, SQL property in record, SQL sink via alias. Неизвестный SQL-массив и unsafe member между безопасными членами должны отказать, а не частично вернуть результат.
- [ ] Добавить mixed-fragment/private-schema через keyword split, schema split, comment split и separator; scoped shadowing, recursive helpers, async callbacks, mutable bindings и cap overflow. Сохранить все прежние comma/comment/grouped-table/CTE cases.
- [ ] Для небольших deterministic fixtures сравнить representation-equivalence: literal, const alias, return helper, array member, standalone map дают один table set; вариант с private table отвергается во всех формах. Ожидаемые строки задавать вручную или собирать доверенным test generator, не запускать анализируемые JS-файлы.
- [ ] Изоляционный fixture: добавить SQL с `report_bd_private` в НЕ импортируемый `src/lib/abbott-unrelated.ts` и убедиться, что Zaruku scan его не посещает. Затем явно импортировать этот модуль из fixture `apps/zaruku/entry.ts` и потребовать отказ. Это проверяет область анализа, не разрешает private import в реальном коде.
- [ ] Проверить реальный exact graph:

```js
assert.deepEqual(scanZarukuRuntimeMysqlTables(root),
  loadMysqlTableAuthority(mysqlAuthorityPath).tables);
assert.equal(loadMysqlTableAuthority(mysqlAuthorityPath).tables.length, 35);
```

- [ ] Проверить диагностику на синтетическом чувствительном sentinel: ошибка содержит location/reason, но не sentinel/SQL. Проверить, что imports scanner/evaluator отсутствуют в application roots и production control inventory не изменился.
- [ ] Запустить два focused test-файла; сохранить результаты и локально закоммитить новые регрессии.

## Task 4: Проверка завершения и независимое ревью

**Files:** только отчёт и при необходимости фикс подтверждённой находки в разрешённых source/test-файлах.
**Interfaces:** готовый чистый локальный code commit и отчёт о source-готовности; никаких real release refs.

- [ ] Один раз на финальном кодовом состоянии выполнить `npm run test:zaruku-production-shadow`, затем `npm run predeploy:verify`. Общий gate обязан сохранить проверки Abbott, deploy, artifact, typechecks и сборки. Зафиксировать фактические exit codes и counts, новые warnings отделить от baseline 12.
- [ ] Locked Linux fixture не требуется повторять только из-за pure source-evaluator, если неизменность всех Linux/control/deploy файлов подтверждена. Уже выполненное доказательство четырёх Linux-групп относится к ним. Если обнаружено изменение их входов — это выход за scope: сначала объяснить его необходимость, затем соответствующий fixture.
- [ ] Сравнить diff с исходным code SHA: разрешены этот план/отчёт, contract, новые два helper-модуля, их тесты и только добавление test в `package.json`. Убедиться, что `apps`, `src`, `packages`, `deploy`, lockfiles, DB/auth/deploy workers и общий predeploy script не изменились этим планом.
- [ ] Свежий независимый ревьюер на **Sol High**, если пользователь использует subagent-review, проверяет модель типов, отсутствие потери unknown/array, выбор кандидатов, пределы, correlation и original standalone reproducer. Без широкого повторения уже прошедших suites. Не давать ревьюеру указаний игнорировать сложные случаи.
- [ ] Ревью должно также закрыть ожидающие проверки прежних `22d1eca` (SSH routing) и `4f5d19b` (canonical direct-entry guards) по их source diff и отчётам. Их реализация не часть SQL-рефакторинга; новое замечание вынести отдельно. Пока их re-review не пройден, весь Task 5 не считается принятым.
- [ ] При Critical/Important исправить подтверждённую причину, добавить failing regression и повторить затронутые тесты. Полный gate повторять, если после него изменился код; не запускать его многократно на неизменном SHA.
- [ ] В отчёт записать: final code SHA; original RED; focused/full results; exact 35-table set equality; changed-file scope; findings; остающиеся live prerequisites. Обновить `.superpowers/sdd/progress.md` только по фактическому результату, не объявляя freeze/provisioning завершёнными.
- [ ] Завершить локальным docs-коммитом и self-contained ответом: SQL source-blocker закрыт/не закрыт; влияние на dashboards и общий predeploy; отсутствие серверных действий; какие шаги большого production-shadow плана остаются.

## Критерии готовности и предел задачи

Готово, когда standalone array/map больше не теряет SQL; unknown SQL не принимается как отсутствие запроса; реальные query builders сохраняют exact 35-table result; регрессии и общий predeploy проходят; reviewer не оставляет Critical/Important в изменении. Число зелёных тестов без original reproducer не является критерием.

Самостоятельные scope-решения (разбиение helpers, типы, тестовые формы) исполнитель принимает по этому плану. Если для поддержания exact35 потребуется менять dashboard SQL, grants, production bundle или снижать гарантию отказа, зафиксировать конкретный конфликт и остановить именно зависимую часть. Не повторять старый цикл локальных исключений, скрывающих unknown.

После завершения этого плана остаются отдельные шаги большого плана: полное принятие Task 5, проверка и фиксация реального release-ref, реальные host/MySQL prerequisites, manager cookie, loopback deployment/parity. Ничего из этого не выполнять автоматически в рамках SQL-плана. Публичные ссылки и разделение Nginx здесь не меняются.

## Команда для запуска пользователем

Выбрать модель **Sol**, reasoning **High**, и передать:

```text
Выполни docs/superpowers/plans/2026-09-08-zaruku-sql-analysis-sol-high.md
в /Users/nafanya/ReportingDash/dashboard-next/.worktrees/three-dashboard-runtime-isolation.
Выбираю вариант A. Работай последовательно на Sol High, заверши source-исправление,
регрессии, общий predeploy и ревью в пределах плана. Исходная кодовая база —
4f5d19b80eb6d46016b1221024f790566fbb36de плюс planning-only commits.
SQL и данные самих дашбордов не менять. Этот запуск — только локальная реализация;
push, freeze реального ref, provisioning и deploy не выполнять.
```
