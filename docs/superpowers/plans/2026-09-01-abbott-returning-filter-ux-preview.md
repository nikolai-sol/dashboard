# Abbott Returning-Filter UX Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Build and screenshot a local-only Abbott tab 5 preview that separates period-wide visit frequency from the URL/direction Reports API control layer, then audit every production Abbott filter without changing production.

**Architecture:** Keep both canonical analytics layers and their calculations unchanged. Move the legacy URL/direction controls into the legacy section, add a pure empty-state helper, and render the component against a deterministic synthetic \`AbbottBiData\` fixture in a local preview route. Production audit is browser-only and records behavior; it does not authorize fixes.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, Recharts, Playwright CLI.

## Global Constraints

- Work only on branch \`preview/abbott-returning-filter-ux\` in \`.worktrees/abbott-returning-filter-ux\`.
- Do not call source APIs or change MySQL, releases, collectors, cron, tokens, or deployment.
- Frequency cards remain period-wide and mathematically unchanged.
- URL and direction continue to filter only \`data.returning\`.
- Use synthetic aggregate preview data with no raw user identifiers.
- Do not fix findings from the production filter audit.

---

### Task 1: Returning control empty-state model

**Files:**
- Create: \`src/components/abbott/abbott-returning-control-ui.ts\`
- Create: \`src/components/abbott/abbott-returning-control-ui.test.ts\`

**Interfaces:**
- Consumes: row count and \`{ url?: string; direction?: string }\` selected values.
- Produces: \`returningControlEmptyMessage(rowCount, filters): string | null\`.

- [ ] **Step 1: Write the failing test**

Cover these exact cases:

\`\`\`ts
assert.equal(returningControlEmptyMessage(0, {}), null);
assert.equal(returningControlEmptyMessage(0, { url: "https://abbottpro.ru/" }),
  "Для выбранного сочетания URL и направления данных нет.");
assert.equal(returningControlEmptyMessage(0, { direction: "Неврология и психиатрия [262339]" }),
  "Для выбранного сочетания URL и направления данных нет.");
assert.equal(returningControlEmptyMessage(1, {
  url: "https://abbottpro.ru/",
  direction: "Не относится / служебная",
}), null);
\`\`\`

- [ ] **Step 2: Run the test and verify RED**

Run \`node --import tsx --test src/components/abbott/abbott-returning-control-ui.test.ts\`.
Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement the pure helper**

Return the approved Russian message only when at least one control filter is selected and \`rowCount === 0\`; otherwise return \`null\`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from step 2. Expected: all assertions pass, 0 failures.

- [ ] **Step 5: Commit the model**

\`\`\`bash
git add src/components/abbott/abbott-returning-control-ui.ts \
  src/components/abbott/abbott-returning-control-ui.test.ts
git commit -m "test(abbott): model returning control empty state"
\`\`\`

### Task 2: Separate the two tab 5 analytics layers

**Files:**
- Modify: \`src/components/AbbottBiDashboard.ui.test.ts\`
- Modify: \`src/components/AbbottBiDashboard.tsx\`

**Interfaces:**
- Consumes: \`returningControlEmptyMessage\` from Task 1, existing \`returningRows\`, \`returningOptions\`, and \`filtersByTab.returning\`.
- Produces: period-wide heading/copy and legacy-local URL/direction controls.

- [ ] **Step 1: Add failing component-contract assertions**

Assert that source contains both approved strings:

\`\`\`ts
"Общая частота визитов за выбранный период"
"Показатели рассчитаны по всему сайту и не зависят от фильтров контрольного слоя ниже."
\`\`\`

Assert that the \`returning\` entry in \`tabFilterContent\` is \`null\`, and that the URL/direction controls are rendered after \`Интервалы возврата по Метрике\`.

- [ ] **Step 2: Run the contract test and verify RED**

Run \`node --import tsx --test src/components/AbbottBiDashboard.ui.test.ts\`.
Expected: FAIL because controls remain in the generic area and approved copy is absent.

- [ ] **Step 3: Make the minimal component change**

In \`AbbottBiDashboard.tsx\`:

1. import \`returningControlEmptyMessage\`;
2. compute the message from \`returningRows.length\`, \`filtersByTab.returning.url\`, and \`filtersByTab.returning.direction\`;
3. set \`tabFilterContent.returning\` to \`null\`;
4. add the approved heading and period-wide explanation above the frequency cards/chart;
5. add a note above the four frequency-detail filters stating that they change the two supporting tables only;
6. render URL/direction selects below the legacy heading and render the empty-state message when non-null.

Do not change \`buildAbbottReturnFrequencyUi\`, \`returningRows\`, percentages, visitor counts, or canonical loaders.

- [ ] **Step 4: Run focused Abbott tests and verify GREEN**

\`\`\`bash
node --import tsx --test \
  src/components/abbott/abbott-returning-control-ui.test.ts \
  src/components/abbott/abbott-return-frequency-ui.test.ts \
  src/components/AbbottBiDashboard.ui.test.ts
\`\`\`

Expected: all tests pass, 0 failures.

- [ ] **Step 5: Run \`npm run typecheck\`**

Expected: exit 0.

- [ ] **Step 6: Commit the UI change**

\`\`\`bash
git add src/components/AbbottBiDashboard.tsx \
  src/components/AbbottBiDashboard.ui.test.ts
git commit -m "feat(abbott): clarify returning filter scope"
\`\`\`

### Task 3: Synthetic preview and browser evidence

**Files:**
- Create: \`src/app/preview/abbott-returning/page.tsx\`
- Create: \`src/app/preview/abbott-returning/preview-data.ts\`
- Create: \`output/abbott-returning-filter-preview.png\` (untracked evidence only)

**Interfaces:**
- Consumes: \`AbbottBiDashboard\`, \`AbbottBiData\`.
- Produces: a local page with three legacy rows and a fixed 160-visitor frequency distribution.

- [ ] **Step 1: Add a typed synthetic fixture**

Use these three \`returning\` rows:

\`\`\`ts
[
  { url: "https://abbottpro.ru/", direction: "Не относится / служебная", visits: 100, returning_1_day: 7, returning_2_7_days: 8, returning_8_31_days: 3 },
  { url: "https://abbottpro.ru/nevro", direction: "Неврология и психиатрия [262339]", visits: 40, returning_1_day: 8, returning_2_7_days: 6, returning_8_31_days: 2 },
  { url: "https://abbottpro.ru/gastro", direction: "Гастроэнтерология [262340]", visits: 20, returning_1_day: 3, returning_2_7_days: 2, returning_8_31_days: 1 },
]
\`\`\`

Use frequency groups \`120 / 30 / 10\` visitors with shares \`75 / 18.75 / 6.25\`. Supply empty valid values for all other \`AbbottBiData\` fields.

- [ ] **Step 2: Render the fixture route**

Render \`<AbbottBiDashboard data={previewData} periodFrom="2026-08-01" periodTo="2026-08-31" />\` with a visible banner \`Локальный прототип — синтетические данные\`.

- [ ] **Step 3: Run build and focused tests**

Run \`npm run typecheck\`, \`npm run build\`, and the focused test command from Task 2. Expected: all commands exit 0.

- [ ] **Step 4: Start local server and capture both states**

Start \`npm run dev -- --hostname 127.0.0.1 --port 3115\`. With Playwright:

1. open \`http://127.0.0.1:3115/preview/abbott-returning\`;
2. click \`Вернувшиеся\`;
3. capture the matching home-page/service-direction state;
4. change direction to \`Неврология и психиатрия [262339]\` while keeping the home URL;
5. verify the global cards remain \`120 / 30 / 10\`;
6. verify the nearby empty-state message appears;
7. save a desktop screenshot to \`output/abbott-returning-filter-preview.png\`.

- [ ] **Step 5: Commit preview-only source**

Do not add \`output/\`. Commit only the local route and fixture:

\`\`\`bash
git add src/app/preview/abbott-returning/page.tsx \
  src/app/preview/abbott-returning/preview-data.ts
git commit -m "preview(abbott): add returning filter mini slice"
\`\`\`

### Task 4: Production Abbott filter audit

**Files:**
- Create: \`docs/reports/2026-09-01-abbott-filter-audit.md\`

**Interfaces:**
- Consumes: production dashboard UI and existing canonical read responses only.
- Produces: diagnostic findings table with no code or production changes.

- [ ] **Step 1: Inspect representative periods**

Use the production dashboard for the previous month and one completed custom week. Authenticate through the existing password page. Do not call source APIs.

- [ ] **Step 2: Exercise every visible filter**

For each available tab, capture baseline metrics/table count, apply one populated value, then one empty or unknown-looking value when present. Record which visible regions change.

- [ ] **Step 3: Classify findings**

Use these exact statuses: \`Функционален\`, \`Дублируется\`, \`Неясная область действия\`, \`Неизвестное значение\`, \`Пустая комбинация без пояснения\`.

- [ ] **Step 4: Write the audit report**

Include columns: tab, filter, controlled output, observed effect, status, recommendation. Do not implement recommendations.

- [ ] **Step 5: Verify isolation**

Run \`git status --short\` and \`git diff main...HEAD --name-only\`.
Expected: changes are limited to preview/spec/plan/tests/component/helper/audit files, with no Sale, QR, CooperVision, collector, migration, or deployment files.

- [ ] **Step 6: Commit the audit**

\`\`\`bash
git add docs/reports/2026-09-01-abbott-filter-audit.md
git commit -m "docs(abbott): audit dashboard filter behavior"
\`\`\`

### Task 5: Final verification and handoff

**Files:** No new files.

- [ ] **Step 1: Run \`npm run test:abbott-contract\`**

Expected: exit 0, 0 failures.

- [ ] **Step 2: Run \`npm run lint\` and \`npm run typecheck\`**

Expected: both exit 0.

- [ ] **Step 3: Confirm production remained unchanged**

Compare production health/release metadata before and after the local work. Confirm no deploy command, database write, migration, cron edit, or collector run occurred.

- [ ] **Step 4: Show the user the screenshot and audit summary**

Provide the local screenshot and branch name. Explicitly state that applying the component changes to production still requires user approval and that the \`preview\` route must not be included in the production merge.
