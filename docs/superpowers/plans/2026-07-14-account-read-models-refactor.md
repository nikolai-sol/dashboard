# Account Read Models Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scattered Zaruku-specific dashboard read calls with three account-scoped read models while removing the dead weekly AI visibility contract.

**Architecture:** Keep existing SQL-producing modules intact where they already query the correct live tables, and add a neutral facade in `src/lib/account-read-models.ts`. `loadZarukuSeoData()` remains the Zaruku compatibility wrapper that assembles the existing UI DTO, but it consumes only `loadAccountFacts`, `loadSeoProcess`, and `loadSeoIntelligence`.

**Tech Stack:** Next.js 16, TypeScript, MySQL canonical tables, node:test.

## Global Constraints

- Do not change database schema or data.
- Every new read model requires `accountId`.
- Do not change Abbott loaders or dashboard panels.
- Runtime read-layer must not reference `src/lib/zaruku-ai-visibility.ts`, `seo_ai_visibility_weekly`, or `seo_webmaster_queries_weekly`.
- Keep `seo_webmaster_queries_weekly` only as a deprecated legacy collector/migration artifact until TASK-062 removes it physically.

---

### Task 1: Contract Tests

**Files:**
- Create: `src/lib/account-read-models.test.ts`

**Interfaces:**
- Produces expected imports for `loadAccountFacts`, `loadSeoProcess`, `loadSeoIntelligence`.

- [ ] Write tests asserting the three read-model functions exist, require `accountId`, pass account scope to lower-level query builders, and contain no client name in exported read-model names.
- [ ] Write a kill-list test asserting runtime read-layer files do not reference `zaruku-ai-visibility`, `seo_ai_visibility_weekly`, or `seo_webmaster_queries_weekly`.
- [ ] Run `npm test -- src/lib/account-read-models.test.ts`; expected RED before implementation.

### Task 2: Neutral Facade

**Files:**
- Create: `src/lib/account-read-models.ts`
- Modify: `src/lib/zaruku-yandex-webmaster.ts`
- Modify: `src/lib/zaruku-seo-os.ts`
- Modify: `src/lib/zaruku-seo-intelligence.ts`

**Interfaces:**
- `loadAccountFacts(accountId: string, dateRange: { from: string; to: string }, options?: { weeks?: string[] }): Promise<AccountFactsReadModel>`
- `loadSeoProcess(accountId: string, week?: string): Promise<SeoProcessReadModel>`
- `loadSeoIntelligence(accountId: string, period?: string): Promise<SeoIntelligenceReadModel>`

- [ ] Implement thin wrappers over the existing live-table loaders.
- [ ] Add neutral aliases for existing lower-level loaders while preserving old compatibility exports.
- [ ] Run targeted tests; expected GREEN.

### Task 3: Wire Dashboard Loader

**Files:**
- Modify: `src/lib/zaruku-seo.ts`

**Interfaces:**
- Consumes the three read models from `src/lib/account-read-models.ts`.

- [ ] Replace direct calls to old scattered loaders with `loadSeoProcess`, `loadAccountFacts`, and `loadSeoIntelligence`.
- [ ] Remove weekly AI visibility from the assembled DTO by setting the old `ai_visibility` compatibility field to an empty deprecated shell.
- [ ] Run `npm test -- src/lib/account-read-models.test.ts src/lib/zaruku-seo.test.ts`.

### Task 4: Kill Dead Weekly AI Contract

**Files:**
- Delete: `src/lib/zaruku-ai-visibility.ts`
- Delete: `src/lib/zaruku-ai-visibility.test.ts`

**Interfaces:**
- No runtime imports of the deleted module.

- [ ] Delete the files.
- [ ] Run grep over runtime source for the kill list.
- [ ] Run `npm run ci:verify`.

### Task 5: Commit and Deploy

**Files:**
- Commit only dashboard-next changes and root subrepo pointer.

- [ ] Commit dashboard-next.
- [ ] Push `origin/main`.
- [ ] Deploy with `npm run deploy`.
- [ ] Verify `https://dashboards.adreports.ru/api/health` returns `ok`.
