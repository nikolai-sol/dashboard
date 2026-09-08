# Zaruku SQL source analysis report

## Scope and starting point

- Worktree: `.worktrees/three-dashboard-runtime-isolation`
- Branch: `codex/three-dashboard-runtime-isolation`
- Original code SHA: `4f5d19b80eb6d46016b1221024f790566fbb36de`
- Execution start SHA: `927b65e9befdf9d1705e8013c25d3e2000ab21e3`
- Final code SHA: `95f6ee26147387180417e1642d81082b232faccb`
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
- Regression matrix GREEN on final code: the same two files — 36/36 passed. It covers literal/alias/helper/array/map/record equivalence, exact join boundaries, captured-condition correlation, private SQL in every supported representation, missing and unknown members, recursion, async maps, mutable inputs, fixed limits, sanitized diagnostics and unrelated Abbott-source isolation.
- Self-review RED: a concrete record's missing property used as the first argument to `execute` initially produced no exception. The new regression failed 0/1 with `Missing expected exception`; commit `95f6ee2` distinguishes a missing concrete member from an intentionally inapplicable execution variant. The targeted two-case check and the focused 36-test matrix then passed.
- Final full Zaruku gate: `npm run test:zaruku-production-shadow` — exit 0; Node 170/170, fixture policy 8/8, Python 5/5 + 5/5 + 4/4.
- Final general gate: `npm run predeploy:verify` — exit 0. It includes the full Zaruku gate, release and artifact checks, isolated and combined builds, Abbott contract 111/111, security, typecheck and preview-release tests.
- Lint in the general gate: 0 errors and 12 pre-existing warnings. The analyzer change adds no warning.
- Direct final authority comparison: `exact_authority_match=true tables=35`; the real sorted graph equals the complete authority list.

## Changed-file and runtime isolation check

The diff from `4f5d19b` is limited to:

- this plan and report;
- `package.json`, only to add the new source test to the existing Zaruku test command;
- the Zaruku source contract and its tests;
- the two new source-only analyzer modules and their tests.

There is no diff under `apps/**`, `src/**`, `packages/**`, `deploy/**`, the lockfile or `scripts/predeploy-verify.sh`. The production control inventory does not include the analyzer modules. No dashboard request path, SQL query, grant, canonical fact, history, Wordstat/Alice data or other dashboard source was changed.

No network, database, source API, secret, migration, SSH, provisioning, freeze, push or deployment action was performed. The branch and worktree remain local and isolated.

## Review findings and remaining boundary

- Local self-review found one Important boundary defect (missing concrete object member), added a failing regression and fixed it before the final full gates.
- No further Critical or Important finding remains from local review of this SQL-analyzer change.
- A fresh independent Sol High review was not run in this session because no separate subagent review was requested. Consequently the larger production-shadow Task 5 is not marked accepted, and the earlier `22d1eca` SSH-routing and `4f5d19b` direct-entry changes still need their independent re-review.
- Live work remains separate: select and freeze a real release ref, verify host/MySQL prerequisites, provide manager authentication, and run loopback deployment/parity. Public Nginx routing and cutover remain unchanged and were not authorized here.
