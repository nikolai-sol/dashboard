# Runtime isolation Task 3 report: Zaruku page extraction

## Status and commits

Implemented and locally verified. No production activation is part of this task.

- Implementation: `4b9ab544ef353016bc53d040807595b5ef2a81cc` — `refactor(zaruku): extract isolated dashboard page`.
- This report is recorded in the subsequent Task 3 evidence-only documentation commit.

## Exact changes and preserved behavior

Created:

- `apps/zaruku/src/components/ZarukuDashboardPage.tsx`: the default zero-prop Next page renders the shared named `ZarukuDashboardPageContent` orchestration.
- `apps/zaruku/src/app/dashboard/zaruku/page.tsx`: directly re-exports the default page and declares `dynamic = "force-dynamic"` to preserve request-time query rendering.
- `apps/zaruku/src/compat/combined.ts`: re-exports the named content component for the temporary combined adapter.
- `apps/zaruku/src/components/zaruku-dashboard-page.test.ts`: eight extraction, compatibility, payload-boundary, behavior-preservation, date-parity, and emitted-dependency tests.
- `src/lib/zaruku-date-range.ts`: Zaruku reporting-date and clamping helpers, copied byte-identically from the shared helper module, with the same private UTC date-shift implementation.

Modified:

- `src/app/dashboard/[id]/page.tsx`: adds one compatibility import and a hook-safe slug dispatcher. The pre-existing component body is renamed `CombinedDashboardByIdPage` and otherwise unchanged.
- `src/lib/dashboard-date-range.ts`: imports/re-exports the extracted Zaruku helpers while keeping the existing public import path and all Abbott/advertising resolution logic unchanged.
- `tsconfig.json`: adds the app-local `@zaruku/*` alias.
- `apps/zaruku/tsconfig.json`: resolves shared `@/*` imports to the existing root `src`, and app-local `@zaruku/*` imports to its own `src`.

Moved/reused client behavior:

- Fixed slug `"zaruku"`; same `from`, `to`, `compare_from`, `compare_to`, `access_token`, `embed_key`, `brand`, `pdf=true`, and `mobile=1` interpretation and initial values.
- Same viewer-token, embed-key, brand, reload-key, active-tab, date/draft-date, quick-preset, comparison-range, loading, demo, API-error, password-gate, and not-found state.
- Same canonical dashboard fetch response handling, no-store request, cancellation, auth reload, period hydration, date-clamping/replacement, query preservation, and scrolling behavior.
- All active fetch-effect dependencies remain in the original order. Only the Abbott-only invariant entries `abbottEmptyMessage`, `abbottPreset`, and `isAbbottDashboard` are removed. Zaruku URL-normalization and brand-sync dependencies are unchanged.
- Same header, gate, and `ZarukuSeoDashboard` props, technical-error and not-found copy, dimensions, PDF/mobile classes, locale, and date formatting.
- Existing PDF and Excel handler bodies are retained with the same period, comparison, token, embed, and brand parameters, with the endpoint slug fixed. These handlers remain unbound because the original Zaruku header did not expose export buttons.
- Selected-week state already belongs to the existing `ZarukuSeoDashboard`; its initial selection, comparison mode, reconciliation, tab rules, and calculations remain untouched. No second week owner was added.
- Advertising and Abbott components, calculations, rendering branches, hooks, source files, data access, and date behavior remain unchanged. Numeric/type-driven legacy dashboard URLs still use the original combined component.

The pre-existing combined component body is protected by its baseline SHA-256:
`a78bfb341fa9b0453e1bd83d5edd93ef37afa8d30f3787f55c40e1bcdbfb1a31`.
The characterization test verifies this exact body after the dispatcher extraction.

## Explicitly approved ownership boundary

A canonical response with a non-Zaruku dashboard type or missing `zaruku_seo` previously fell through to generic advertising UI. The isolated page cannot import that UI. Its necessary divergence is to render the existing technical-unavailable state with `data-dashboard-ready="false"`.

The combined adapter alone supplies `<CombinedDashboardByIdPage />` as an optional fallback. It targets the non-dispatch body, so it cannot recursively re-enter the Zaruku dispatcher. That exceptional fallback mounts the old page and may refetch through its existing lifecycle; the normal/auth/404/error/loading paths are unchanged.

The regression executes the actual ownership-guard JSX for wrong-type and missing-data fixtures, verifies the isolated error copy/readiness, verifies a supplied legacy fallback renders once per malformed result, and checks that the combined dispatcher supplies the non-recursive component. This is a focused boundary test, not a browser-level assertion of fetch counts.

The parent explicitly approved both this malformed-payload boundary and the minimal date-helper file extension after the dependency trace exposed the shared Abbott import.

## RED evidence

The initial test version had an off-by-one repository-root calculation. Its missing-file failures are invalid evidence and are not counted.

After fixing that test path, all Task 3 production additions were withdrawn and the original tracked production files were restored. `git diff --stat` was empty; only the new test was present. Then:

```text
node --import tsx --test apps/zaruku/src/components/zaruku-dashboard-page.test.ts
tests 7; pass 0; fail 7; exit 1
Missing extracted Zaruku file: apps/zaruku/src/components/ZarukuDashboardPage.tsx
Missing extracted Zaruku file: apps/zaruku/src/app/dashboard/zaruku/page.tsx
Missing extracted Zaruku file: src/lib/zaruku-date-range.ts
```

Additional independently observed failures:

1. Before the approved date-helper split, the emitted dependency test failed because `src/lib/dashboard-date-range.ts` unconditionally imported `src/lib/abbott-date-range.ts`.
2. The first isolated build failed its generated Next `PageProps` check because the directly exported component accepted the compatibility-only fallback prop. A new zero-prop route regression failed 1/8 before introducing the default zero-prop wrapper and named compatibility content.
3. The next isolated build compiled and typechecked, then failed prerendering because `useSearchParams()` lacked a static-page Suspense boundary. Before changing route configuration, the request-time rendering assertion failed 1/1. Setting `dynamic = "force-dynamic"` preserves the combined dynamic route's rendering model without adding a new loading UI.

## GREEN and verification

All commands ran in the isolation worktree.

| Check | Result |
| --- | --- |
| Requested extraction/UI/date-wiring tests, plus shared date, shell-health, and real middleware-manifest tests | 56 passed, 0 failed, 0 skipped |
| `npm run typecheck`, after both builds | Exit 0, no diagnostics |
| `./node_modules/.bin/tsc --project apps/zaruku/tsconfig.json --noEmit`, after both builds | Exit 0, no diagnostics |
| `npm run build` | Exit 0, combined Turbopack build, all existing routes and admin middleware retained |
| `npm --workspace apps/zaruku run build` | Exit 0, Webpack build, dynamic `/dashboard/zaruku`, dynamic `/api/health`, framework error routes, no middleware |
| `npm test` | 944 Node passed, 10 existing skipped; 13 Python passed; exit 0 |
| Targeted ESLint for new page/test/route/adapter and date modules | Exit 0, no errors; two expected unused-handler warnings for intentionally unbound PDF/Excel handlers |
| `git diff --check` and staged equivalent | Exit 0 |

Full-suite environment note: the first sandboxed run had 943 Node passes, one failure, and 10 skips because a `tsx` subprocess in the existing shared-password CLI test could not create its local IPC socket (`listen EPERM`). The test supplies deliberately rejected arguments and synthetic stdin, failing before any DB access. The identical authorized `npm test` command was rerun with local IPC permission and passed. No test or security assertion was weakened.

The repository's existing `npm test` discovers `src` and `scripts`, not workspace test directories. The eight new workspace tests and existing shell tests were therefore run explicitly in the 56-test focused command.

Final focused command:

```sh
node --import tsx --test \
  apps/zaruku/src/components/zaruku-dashboard-page.test.ts \
  src/components/ZarukuSeoDashboard.ui.test.ts \
  src/app/dashboard/dashboard-page-date-wiring.test.ts \
  src/lib/dashboard-date-range.test.ts \
  apps/zaruku/src/app/api/health/route.test.ts \
  apps/zaruku/src/app/middleware-manifest.test.ts
```

## Emitted dependency and artifact evidence

The actual esbuild browser bundle uses the isolated app's TypeScript configuration, the real isolated route entry, `bundle: true`, `metafile: true`, `write: false`, and external npm packages. It emitted 49 application runtime inputs and 448353 bytes. Its transitive module graph includes the existing Zaruku UI, gate, header, and Zaruku-only date helper. It contains no Abbott UI/date module, advertising KPI component, campaign table, multibrand module, combined page, or compatibility adapter. Type-only DashboardData/DateRange references are erased.

The real Next output was also inspected:

- `apps/zaruku/.next-zaruku/server/app/dashboard/zaruku/page_client-reference-manifest.js` contains framework modules, app CSS, and the extracted Zaruku page as the only application client entry, with no forbidden dashboard module.
- `page.js.nft.json` exists with 60 traced server files.
- `server/middleware-manifest.json` is exactly `{"version":3,"middleware":{},"functions":{},"sortedMiddleware":[]}`.
- `server/app-paths-manifest.json` contains only framework error pages, `/api/health/route`, and `/dashboard/zaruku/page`.
- Combined `.next` and isolated `.next-zaruku` outputs coexist.

Complete emitted application input inventory:

```json
{
  "entry": "apps/zaruku/src/app/dashboard/zaruku/page.tsx",
  "tool": "esbuild 0.27.3",
  "runtimeInputs": [
    "apps/zaruku/src/app/dashboard/zaruku/page.tsx",
    "apps/zaruku/src/components/ZarukuDashboardPage.tsx",
    "src/components/ComparisonToggle.tsx",
    "src/components/DashboardAccessGate.tsx",
    "src/components/DashboardHeader.tsx",
    "src/components/ZarukuAliceVisibilityTab.tsx",
    "src/components/ZarukuAudienceTab.tsx",
    "src/components/ZarukuContentTab.tsx",
    "src/components/ZarukuInfoPopover.tsx",
    "src/components/ZarukuOverviewTab.tsx",
    "src/components/ZarukuPanelGrid.tsx",
    "src/components/ZarukuPanelState.tsx",
    "src/components/ZarukuQualityTab.tsx",
    "src/components/ZarukuRussiaDemandMap.tsx",
    "src/components/ZarukuSectionState.tsx",
    "src/components/ZarukuSeoAnalytics.tsx",
    "src/components/ZarukuSeoDashboard.tsx",
    "src/components/ZarukuSeoDiagnostics.tsx",
    "src/components/ZarukuSeoOperations.tsx",
    "src/components/ZarukuSeoPageComparison.tsx",
    "src/components/ZarukuSeoQueryComparison.tsx",
    "src/components/ZarukuSeoWeekToolbar.tsx",
    "src/components/ZarukuTableFrame.tsx",
    "src/components/ZarukuTrafficVisibility.tsx",
    "src/components/ZarukuWordstatTab.tsx",
    "src/components/ZarukuWorkTab.tsx",
    "src/components/zaruku-alice-visibility-view.ts",
    "src/components/zaruku-client-copy.ts",
    "src/components/zaruku-content-table.ts",
    "src/components/zaruku-north-star.ts",
    "src/components/zaruku-overview-layout.ts",
    "src/components/zaruku-panel-layout.ts",
    "src/components/zaruku-quality-state.ts",
    "src/components/zaruku-russia-map-data.ts",
    "src/components/zaruku-russia-map-layout.ts",
    "src/components/zaruku-seo-analytics.ts",
    "src/components/zaruku-seo-operations.ts",
    "src/components/zaruku-seo-source-week.ts",
    "src/components/zaruku-seo-week-selection.ts",
    "src/components/zaruku-seo-workspace.ts",
    "src/components/zaruku-source-rows-label.ts",
    "src/components/zaruku-table-pagination.ts",
    "src/components/zaruku-traffic-visibility.ts",
    "src/components/zaruku-work-state.ts",
    "src/components/zaruku-yandex-webmaster-panels.ts",
    "src/lib/chart-palette.ts",
    "src/lib/dashboard-i18n.ts",
    "src/lib/zaruku-date-range.ts",
    "src/lib/zaruku-url.ts"
  ],
  "outputBytes": 448353,
  "forbiddenRuntimeInputs": []
}
```

## Self-review and concerns

- Checked the original combined body hash, identical shared handler/helper bodies, unchanged non-Zaruku source files, and the resulting staged file scope.
- Confirmed auth/404/error/loading branches precede the isolated ownership guard; normal Zaruku rendering retains the original header and dashboard props.
- Confirmed the compatibility fallback points to the non-dispatch body, and the isolated route has no path to that fallback module.
- Kept hidden export handlers as requested. ESLint reports their unused status; wiring them would change current UI behavior.
- The combined build retains its existing multiple-lockfile/workspace-root warning. No global bundler configuration was changed.
- This task extracts client orchestration only. Isolated API/auth/export route implementation and end-to-end live canonical-data/browser validation remain later runtime-isolation work; this report does not claim deployment readiness.
- No production deployment, reverse-proxy edit, database connection/write/migration, source API call, cron edit, secret change, Telegram send, or external operational action was performed.

## Task 3 review fix

### Status, files, and commit

Fixed the review finding in `af81f96d003be49abc291e2c1bf138f9152bc5e3` (`fix(zaruku): reject malformed dashboard payloads`).

- `apps/zaruku/src/components/ZarukuDashboardPage.tsx`: successful 200 bodies are structurally classified before any `period`, `language`, or Zaruku data dereference. `null`, `{}`, a non-Zaruku type, missing period/language, and missing Zaruku data now resolve to the existing technical-unavailable UI; the combined adapter receives its existing non-dispatch fallback once.
- `apps/zaruku/src/components/zaruku-dashboard-page.test.ts`: replaces the JSX-extraction boundary test with real execution of the response processor for `null`, `{}`, and a wrong-type payload missing period, plus direct rendering of the actual unavailable render path and its one-time fallback selection.

### RED

Before production changes, the focused page test failed as expected:

```text
node --import tsx --test apps/zaruku/src/components/zaruku-dashboard-page.test.ts
pass 7; fail 2; exit 1
Missing DashboardPayloadUnavailable
actual null; expected "Unexpected dashboard payload"
```

The second failure was the real existing response processor accepting a successful `null` body without an error classification. The old guard-only test was removed because it did not execute this path.

An independent review then found that the generic API-error branch preceded the fallback branch. The added render-state ordering regression was also RED before its production change:

```text
node --import tsx --test apps/zaruku/src/components/zaruku-dashboard-page.test.ts
pass 9; fail 1; exit 1
Missing selectDashboardRenderState
```

### GREEN and verification

```text
node --import tsx --test [page, Zaruku UI, date wiring, date range, health, middleware tests]
58 passed; 0 failed
npm run typecheck
exit 0
./node_modules/.bin/tsc --project apps/zaruku/tsconfig.json --noEmit
exit 0
npm run build
exit 0
npm --workspace apps/zaruku run build
exit 0
node --import tsx --test apps/zaruku/src/components/zaruku-dashboard-page.test.ts --test-name-pattern 'emitted dependency trace'
9 passed; 0 failed (includes the real esbuild dependency trace)
npm test
944 Node passed; 10 skipped; 13 Python passed; exit 0
git diff --check
exit 0
```

The first sandboxed full-suite attempt hit the pre-existing local `tsx` IPC `listen EPERM` restriction in the unrelated shared-password test; the authorized rerun above passed without code or test changes.

### Self-review

- The effect returns immediately on an unsupported successful payload, so no period hydration or later dashboard dereference runs; loading is cleared first.
- Auth, 404, network/error, loading, valid Zaruku date/query/export behavior, and the combined non-dispatch fallback remain separate paths.
- The fallback regression verifies both the actual unavailable component's one-time legacy-element selection and the page render-state ordering that prioritizes an unsupported successful payload above generic API-error rendering. The dispatcher characterization continues to verify that the supplied element is `CombinedDashboardByIdPage`, not the dispatcher itself.
- No production, proxy, database, cron, secret, Abbott/ad worktree, or unrelated files were touched.
