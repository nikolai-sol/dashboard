# Task 5 — universal target-intent review tables

## Status

Task 5 is implemented and locally verified. Feature commit `a46fd4bb9706b42b61ee699101b53eaae810ca75` has the requested message `feat(site-seo): add target intent review tables`. Final reviewed source head `236db55f88aafee975f7cd8cdf102a60fb1ae8df` includes all review remediations. Both MedRoche profile copies pin that exact reviewed source head; the documentation/profile attestation commit is reported in the final handoff because it cannot embed its own SHA.

No production deployment, database migration, catalogue import/publication, source API call, collector refresh, cron/scheduler edit, secret change, Telegram send or Hermes action occurred.

## Implementation

- Replaced the MedRoche-named presentation with generic `TargetIntentPanel` and `IntentQueryDisclosures` components. The overview goal reads `Цель: целевой органический трафик + ИИ-выдача` and is paired with the all-traffic health window.
- The selected-week cards show impression-weighted target/other shares, search impressions and clicks. Copy explicitly says clicks are transitions from search, not users; the old partial-data sentence is absent.
- Two independent native `details/summary` disclosures show the positive-impression row count. Target rows contain query, source, impressions, clicks, group, matched rule and match type. Other rows contain query, source, impressions, clicks and the classification status. Zero-impression rows are excluded and both categories sort by impressions descending, clicks descending, query and source.
- Added bounded HTML pagination plus authorized JSON/CSV/XLSX responses. Requests retain the server-resolved site/dashboard, selected traffic/GSC/Alice periods, filters, category and active target-intent publication. A stale publication fails with 409. JSON page size is capped at 100 and out-of-range pages clamp to the last page. CSV cells are protected against spreadsheet formulas.
- `not_configured` truthfully says no classification is configured and does not relabel all rows as other; `unavailable` says classification is temporarily unavailable.
- A generic optional profile flag explicitly enables truthful `not_configured` copy for MedRoche. Unrelated dashboards retain their existing overview until an active target-intent publication exists or their profile explicitly enables the feature.
- Responsive CSS gives the intent and traffic-health windows equal desktop weight, keeps two intent cards on mobile, and confines wide tables to local horizontal scrolling without page overflow. Pagination retains the opened disclosure category in the URL, including when returning to page 1.

## Strict TDD evidence

### Initial RED

1. Added `apps/site-seo/tests/target-intent-panel.test.ts` before implementation. The focused run failed against the existing `MedicalIntentPanel`: generic modules, native disclosures, required columns, deterministic filtering/sorting, truthful missing-state copy and bounded navigation were absent.
2. Added route/export assertions before the intent-query handler and public route. The focused run failed because the bounded options, category response/downloads and active-publication enforcement did not exist.
3. Implemented the minimum generic components and route handler, then reran the focused suite to GREEN.

### Independent-review RED/GREEN

The read-only reviewer found no Critical issue and five actionable items. Each was reproduced with a failing test before its fix:

1. Root `tsconfig.json` had excluded Site SEO JSX and `npm run test:site-seo` failed 33 component tests with `React is not defined`. A failing full-suite run proved it. The fix retains Site SEO sources in the root JSX transform, enables importing `.ts` extensions, and excludes only the unrelated `scripts/site-seo` boundary.
2. An attacker-influenced query beginning with a spreadsheet formula prefix was emitted directly to CSV. A failing export test was added; CSV strings are now neutralized.
3. The truthful `not_configured` panel was unreachable in a real overview. A failing integration render was added; resolved SEO query scopes now reach that panel while legacy non-SEO layouts remain stable.
4. HTML pagination carried but did not verify `intent_publication`. A failing page integration assertion was added; stale publication tokens now fail closed before paginated rendering.
5. JSON returned an impossible requested page number with empty rows. A failing route test was added; the response now clamps to the last page.
6. The first re-review found that source-status rows were accidentally acting as a feature flag and replacing every unrelated dashboard's overview. A failing integration render and profile-schema test were added. MedRoche now carries an explicit generic boolean flag; otherwise the panel appears only when a canonical target-intent state is active/unavailable.
7. The remaining pagination minor collapsed a disclosure when returning to page 1. Three failing assertions proved the missing URL/open-state contract; pagination now retains `intent_open=target|other` and restores the relevant native disclosure.

Final read-only re-review of `96ab3e4f66e7899e980340fe7c7f5c256407e163` found no remaining Critical or Important issue. It independently confirmed the default-off enablement boundary, identical enabled MedRoche profile copies, matching TypeScript/MJS validators, exact source pin and disclosure-state URL contract.

Focused final command:

```text
node --import tsx --test apps/site-seo/tests/target-intent-panel.test.ts apps/site-seo/tests/exports.test.ts
33 passed, 0 failed
```

## Final automated evidence

Run from `/Users/nafanya/ReportingDash/dashboard-next/.worktrees/medroche-medical-intent` on 2026-09-15:

```text
npm run test:site-seo
198 TypeScript tests + 27 build/isolation tests = 225 passed, 0 failed

npm run typecheck:site-seo
passed

npm run typecheck
passed

node --import tsx --test src/components/admin/DashboardTargetIntentScreen.test.tsx
17 passed, 0 failed

node --import tsx 'src/app/api/admin/dashboards/[id]/target-intent/route.test.ts'
12 passed, 0 failed

npm run build
passed; compiled, typechecked and generated 28 pages

node --import tsx scripts/site-seo-build.mjs --site medroche
passed; isolated standalone includes /api/dashboard/[siteSlug]/intent-queries
```

`git diff --check` is part of the final post-attestation verification recorded in the handoff.

## Standalone smoke and cleanup

The final rebuilt standalone artifact ran on temporary loopback port 43160 using its packaged `site-registration.json`:

- `GET /api/health` → HTTP 200, `{"siteId":"site-medroche","version":"2026.09.15-1"}`.
- `GET /dashboard/medroche` → HTTP 200 with `site-seo-login-form`, `Пароль` and `Войти`; no authenticated data read was attempted.
- Owned Node PID 1209 was interrupted and reaped. `lsof -nP -iTCP:43160 -sTCP:LISTEN` then found no listener.

## Synthetic visual verification

The actual dashboard components and `apps/site-seo/src/app/globals.css` were rendered with identities and every query visibly marked `[СИНТЕТИКА]`/`synthetic`. Both native disclosures were opened and inspected.

- 1440px: document client/scroll width `1440/1440`; no page overflow. Goal and health windows share `y=197.390625`, width `546` and height `699`. Table frames are contained at client widths `502`, with local scroll widths `797` and `780`.
- 390px: document client/scroll width `390/390`; no page overflow. Goal and health are stacked, equal-width `332` windows. Intent cards remain side by side at `143px` each. Table frames are contained at client width `296`, with local scroll widths `797` and `780`.
- Desktop screenshot: `/Users/nafanya/.codex/visualizations/2026/09/15/01a0a4b8-e246-7da0-995b-ba42f6c2e778/task-5/target-intent-desktop-1440.png`.
- Full mobile screenshot: `/Users/nafanya/.codex/visualizations/2026/09/15/01a0a4b8-e246-7da0-995b-ba42f6c2e778/task-5/target-intent-mobile-390-full.png`.
- Self-contained fixture: `/Users/nafanya/.codex/visualizations/2026/09/15/01a0a4b8-e246-7da0-995b-ba42f6c2e778/task-5/target-intent-synthetic.html`.

Screenshots were visually inspected: the equal desktop pairing is aligned, both mobile cards remain legible, the native disclosures and downloads are visible, and table overflow stays inside rounded local frames. The only browser console entry was the fixture preview server's harmless missing favicon. The Playwright session and temporary preview server were stopped; port 43158 was verified without a listener.

## Self-review

- Authorization remains the existing signed, dashboard-scoped viewer session and server-side binding resolution. No client-supplied site, dashboard, source account or version identity is trusted.
- Dashboard reads and downloads use the canonical read model only; no source OAuth token or source API enters a request/render/export path.
- Selected periods, filters and active publication are retained consistently between dashboard pagination and downloads. Stale classifications cannot silently cross page requests.
- UI copy does not equate clicks with people or claim unavailable data as zero/other.
- The pre-existing modified `.superpowers/sdd/task-1-report.md` and untracked `apps/site-seo/.next-medroche/` remain uncommitted. The required MedRoche build refreshed its generated output but it was not deleted or staged.

Done: Task 5 source, review fixes, documentation and local verification are complete.  
Accepted: pending parent/owner review.  
Reusable learning: no accepted-work skill update is permitted before acceptance.  
Skill action: executing-plans, strict TDD, systematic debugging, verification-before-completion, requesting-code-review and Playwright instructions were applied; no durable skill was edited.  
Evidence: commands, counts, artifact paths, process identities and listener checks above.  
Budget stop: none.

## Root Task 5 review remediation

Source commit: `236db55f88aafee975f7cd8cdf102a60fb1ae8df` (`fix(site-seo): require intent publication review token`). The separate attestation commit and exact parent relationship are reported in the final handoff.

### RED

The new integrated and route tests produced five focused failures:

1. Both explicitly enabled `not_configured` and active-but-`unavailable` overview renders still included “Доли рассчитаны…” and “Клики — переходы…”, contradicting their unavailable values and state copy.
2. `parseIntentQueryOptions` rejected an empty token before the handler could classify it as a missing publication, while an omitted token let a ready review response succeed.
3. `intentPublicationMatches` accepted a missing token for ready-catalogue review navigation.

After the initial implementation, the first full suite was 197/198 TypeScript tests: the remaining failure was an existing visual-shell assertion for the superseded “Классификация обновлена” wording. That contract was updated to the safe missing-or-stale message before the source commit was finalized.

### GREEN

- Non-ready panels now render distinct forward-looking footer copy. Only `ready` renders the calculated-share methodology and the reminder that clicks are not users.
- The endpoint loads canonical state first. `not_configured`/`unavailable` return their existing 503 classification-unavailable response without requiring a nonexistent publication. A `ready` state requires a non-empty token exactly equal to its active publication; omitted, empty and stale tokens all return 409 with the active publication ID, while a valid token succeeds.
- The dashboard distinguishes an ordinary overview request from review navigation. A ready review requires the same exact token and otherwise shows a neutral “Не удалось подтвердить версию классификации” state. Non-ready states and ordinary overview requests need no target-intent publication token. Every generated review pagination/download link still carries the valid active token.

Evidence after the final source commit and exact profile pin:

```text
node --import tsx --test apps/site-seo/tests/target-intent-panel.test.ts apps/site-seo/tests/exports.test.ts
33 passed, 0 failed

npm run test:site-seo
198 TypeScript tests + 27 build/isolation tests = 225 passed, 0 failed

npm run typecheck:site-seo && npm run typecheck
passed

npm run build
passed; compiled, typechecked and generated 28 pages

node --import tsx scripts/site-seo-build.mjs --site medroche
passed; isolated standalone contains the intent-query endpoint

standalone smoke on 127.0.0.1:43160
health 200; scoped login 200; PID 1209 stopped; listener closure verified
```

No production deployment, migration, import/publication, source API, collector, cron, secret, Telegram or Hermes action occurred. The unrelated modified Task 1 report and untracked generated `.next-medroche` remain uncommitted.

Done: both root-review Important findings are fixed with RED/GREEN evidence and the final source pin is ready for attestation.
Accepted: pending parent/owner review.
Reusable learning: no accepted-work skill update is permitted before acceptance.
Skill action: strict TDD, systematic debugging and verification-before-completion instructions were applied; no durable skill was edited.
Evidence: source commit, focused/full tests, both builds and owned-process smoke above.
Budget stop: none.
