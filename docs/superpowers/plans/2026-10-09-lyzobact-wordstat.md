# Lysobact Wordstat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The owner has authorized inline implementation and later gated deployment.

**Goal:** Publish three Wordstat baskets for two full weeks in the existing private regional module.

**Architecture:** Add an optional versioned Wordstat block to each existing observation JSON. Existing immutable snapshots, transactional publisher and MySQL-only reader remain authoritative. Preserve every clinical field and source page; old snapshots have no new block.

**Tech Stack:** TypeScript, Node tests, React, existing MySQL JSON tables. No new dependency or DDL.

## Global Constraints

- Canonical85 regions;83 complete,2 unmapped;255 basket observations,249 complete,6 null.
- Weeks21–27Sep and28Sep–4Oct2026 retained; counts are queries, not people/cases.
- Preserve Moscow proxy, combined Leningrad geography and Crimea/Sevastopol overlap.
- No auth, bindings, schedules, source calls, neighboring runtime or shared schema changes.
- Deployment/import require independent review before activation; no additional user approval is needed.

### Task1: Typed validation and successor import

Files: create `src/lib/lyzobact-wordstat.ts` and `.test.ts`; modify `lyzobact-regions-types.ts`, `lyzobact-regions-import.ts`, `lyzobact-regions-store.ts` and targeted tests.

Interface: `validateRegionalWordstat(value:unknown,regionKey:string):RegionalWordstat`; `prepareWordstatSuccessor(base:RegionalImport,normalizedJson:string,options:{snapshotId:string;label:string;checkedAt:string}):RegionalImport`.

- [ ] Add failing real frozen-input test: `assert.equal(next.rows.filter(r=>r.wordstat?.status==='complete').length,83)`; compare each row with its block removed to original and exact sourcePages equality.
- [ ] Reject invalid date pairs, duplicate baskets, incomplete14-day coverage, unsafe counts, incorrect percentage, invalid SHA/geography. Test zero prior/current and missing-null behavior.
- [ ] Run `node --import tsx --test src/lib/lyzobact-wordstat.test.ts`, observe missing implementation failure, implement strict validators and deterministic successor digest, rerun.
- [ ] Reader calls validator only when block exists; test old snapshot compatibility and corrupted block yields unavailable. Existing persist transaction/replay tests remain required.

### Task2: Three-basket detail display

Files: `src/components/lyzobact/RegionalDashboard.tsx` and `.test.tsx`.

- [ ] Add failing SSR test for both week labels, three basket names/counts/changes, proxy label and unmapped explanation.
- [ ] Replace scalar placeholder with optional typed detail table; retain old snapshot placeholder. `count===null` renders dash; `wowPct===0` renders0%, zero prior is explicitly not a percentage.
- [ ] Run targeted tests, ESLint on changed files and `tsc --noEmit`.

### Task3: Reviewed release and publication

- [ ] Prepare operator outside app tree: pin source hash; read exact current snapshot; compare original85/236; prepare successor using normalized255; dry-run before writes.
- [ ] Send scoped diff, tests and operator to independent reviewer. Commit and standard deploy only after approval; active source CAS must still match reviewed ancestor.
- [ ] Publish via existing transaction; replay returns already_exists; verify API/UI, old snapshot/timestamp equality and neighbors. Cleanup owned resources and hand receipts to root.
