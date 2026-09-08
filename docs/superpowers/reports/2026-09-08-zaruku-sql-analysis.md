# Zaruku SQL source analysis report

## Scope and starting point

- Worktree: `.worktrees/three-dashboard-runtime-isolation`
- Branch: `codex/three-dashboard-runtime-isolation`
- Original code SHA: `4f5d19b80eb6d46016b1221024f790566fbb36de`
- Execution start SHA: `927b65e9befdf9d1705e8013c25d3e2000ab21e3`
- The only commit between those points is the planning document for this change.
- Runtime dashboard code, dashboard SQL, grants, canonical data, deployment files and production systems are outside this change.

## Supported-form inventory before implementation

Static text inspection of sources reachable from `apps/zaruku` found these relevant forms:

- standalone string and array SQL declarations;
- standalone `map` results that contain complete query members;
- mapped fragments consumed by `join`, where only the exact joined result is a complete statement;
- the 12 concrete `ZARUKU_METRIKA_BREAKDOWN_REPORTS` records in `src/lib/zaruku-metrika.ts`, including record property reads and ordered mapped detail blocks;
- SEO concrete catalog arrays in `apps/zaruku/src/lib/zaruku-seo.ts`, including `sourceFreshnessCatalogSql()` and conditional source-key defaults;
- exact unknown-length parameter placeholders in `buildInClause`: `values.map(() => "?").join(", ")`;
- UI-only transformations such as `rows.map(row => row.label)` that must not become SQL failures;
- template, concatenation, alias, local function return, captured scalar/boolean condition and lexical shadowing dependencies.

The pre-change implementation has two evaluators with different value models. Its general evaluator returns `null` for `map`, while candidate traversal skips every `map` subtree. Consequently a standalone mapped SQL array can disappear entirely.

## Verification log

- Baseline before test change: `node --test scripts/zaruku-production-shadow-contract.test.mjs` — 21/21 passed.
- Original RED: `node --test --test-name-pattern='standalone mapped' scripts/zaruku-production-shadow-contract.test.mjs` — 0/1 passed. The expected private-schema exception was missing at the first assertion, proving the standalone mapped SQL array was dropped.
- First focused GREEN after the unified evaluator integration: `node --test scripts/zaruku-static-sql.test.mjs scripts/zaruku-production-shadow-contract.test.mjs` — 29/29 passed.
- Regression matrix GREEN: the same two files — 36/36 passed. It covers literal/alias/helper/array/map/record equivalence, exact join boundaries, captured-condition correlation, private SQL in every supported representation, unknown members, recursion, async maps, mutable inputs, fixed limits, sanitized diagnostics and unrelated Abbott-source isolation.
- The real graph equals the full sorted authority list and the authority remains exactly 35 tables.
- Full Zaruku gate and general predeploy verification remain pending.
