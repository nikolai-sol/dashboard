# Campaign Plan Dates Implementation Plan

> **For agentic workers:** Use subagent-driven-development for this bounded task and independent review.

**Goal:** Preserve monthly planned amounts while allocating them only within the configured campaign dates, consistently across dashboard/export views.

**Architecture:** Keep allocation in src/lib/plan-normalizer.ts. Pass existing campaign bounds into monthly normalization; project already normalized channel plan values into final platform plan output without mutating source data or normalizing twice.

**Tech Stack:** TypeScript, Node test runner, tsx, Next.js.

## Global Constraints

- Owner's dates are authoritative campaign dates. No DB/schema/source/collector/deployment changes in this implementation task.
- Preserve fact metrics, underlying planned totals, monthly breakdown inputs and manual history.
- Work only in /Users/nafanya/ReportingDash/dashboard-next/.worktrees/media-campaign-dates.
- Existing dependencies are linked from the primary checkout. Run tests with node --import tsx --test.

### Task 1: Bound plan normalization and output consistency

**Files:** Modify src/lib/plan-normalizer.ts and only necessary plan wiring in src/lib/dashboard-data-loader.ts. Add src/lib/plan-normalizer.test.ts; add or extend a focused existing loader/export test as appropriate. Read src/lib/dashboard-excel-views.ts and its tests for platform projection compatibility.

**Interfaces:** Existing normalizeValueForPeriod({total, monthly, periodFrom, periodTo, configFrom, configTo}) and normalizeChannelPlan(row, periodFrom, periodTo, configFrom, configTo) remain callers' APIs. normalizePlan can accept optional campaign bounds while preserving its old calls. Final plan_vs_fact fields must agree with channel_performance plan values for the same range; do not feed projected totals back through normalization.

- [ ] Run relevant baseline tests before implementation.
- [ ] Write and run the failing regression:

```ts
assert.equal(normalizeValueForPeriod({
 total: 3000, monthly: { сентябрь: 3000 },
 periodFrom: '2026-09-01', periodTo: '2026-09-15',
 configFrom: '2026-07-01', configTo: '2026-09-15',
}), 3000);
```

Add selected Sep1–5 => 1000, Sep16–30 => 0, full month selection still => 3000; partial first campaign month; multi-month and December–January cases; total-only plans; calendar behavior without campaign dates. Assert channel metrics and platform/export output agree, without altering actual metrics.

- [ ] Implement denominator and numerator over campaign/month intersection. Anchor month-year resolution on campaign bounds when present so requesting a range in another year cannot resurrect a finished plan.
- [ ] For platform output, project normalized plan metrics after calculations requiring the raw row. Keep monthly breakdown unchanged and avoid double normalization, especially total-only plans.
- [ ] Run focused tests, npm run typecheck, and lint changed TypeScript files. Record any pre-existing failure separately rather than broadening the task.
- [ ] Update DASHBOARDS-MEMORY.md with the owner-approved rule, commit only task files, and report tests, commit, scope and deployment limitations to the controller.
