# Task 3 Report: Target Intent Management Screen

## Status

Done. The administrator UI now manages the complete target-intent catalogue through the Task 2 APIs without accepting client-supplied site scope.

## Delivered

- Added the server page at `/admin/dashboards/[id]/target-intent`; it passes only `dashboardId` to the client screen.
- Added SEO-only navigation from dashboard editing. Capability is resolved through the protected target-intent endpoint, and unsupported dashboards show a clear disabled explanation.
- Added a configurable version label and mutually exclusive Excel/CSV upload and Google Sheets URL modes.
- Kept source inspection manual through `Проверить источник`; editing either source invalidates the old preview and does not auto-refresh.
- Added explicit source, validating, preview-ready, publishing, active, failed, and restore-confirmation states.
- Added preview totals, validation errors with row/column context, and sample imported rules. Publication remains disabled for invalid previews.
- Added the typed `ЗАМЕНИТЬ КАТАЛОГ` confirmation, explicitly warning that publication replaces the full active catalogue.
- Added audit history and restore-as-new-version confirmation.
- Preserved the last known active version across validation and rejected mutation failures. Ambiguous network/5xx mutation results are reported as unknown until the canonical state is refreshed.
- Reused one operation ID for ambiguous retries and allocated a new one when the user's intended publish/restore operation changes.
- Enforced the 5 MiB upload bound before reading a file; selected files are encoded to base64 only when the preview request is submitted.

## Files

- Added: `src/app/admin/dashboards/[id]/target-intent/page.tsx`
- Added: `src/components/admin/DashboardTargetIntentScreen.tsx`
- Added: `src/components/admin/DashboardTargetIntentScreen.test.tsx`
- Modified: `src/app/admin/dashboards/[id]/edit/page.tsx`
- Modified: `src/lib/admin-ui-types.ts`

## TDD Evidence

### RED

1. Initial focused render/source contract:

   ```sh
   node --import tsx --test src/components/admin/DashboardTargetIntentScreen.test.tsx
   ```

   Exit 1: `Cannot find module './DashboardTargetIntentScreen'`; 1 test failed.

2. Incremental tests failed before their implementation for:
   - history audit fields;
   - recent failed source checks;
   - locked controls while publishing;
   - truthful failed-initial-load state;
   - capability lookup through the Task 2 endpoint;
   - mutual exclusion of publish and restore confirmations;
   - canonical refresh after a successful mutation;
   - stable idempotency operation IDs;
   - exact preview payload builders;
   - honest source-rule sample labelling;
   - preview invalidation after source edits;
   - HTTP 5xx mutation ambiguity.

### GREEN

```sh
node --import tsx --test src/components/admin/DashboardTargetIntentScreen.test.tsx
```

Result: 14 passed, 0 failed.

```sh
node --import tsx './src/app/api/admin/dashboards/[id]/target-intent/route.test.ts'
```

Result: 10 passed, 0 failed.

```sh
node --import tsx --test \
  src/components/admin/SharedPasswordSettings.ui.test.ts \
  src/components/admin/SourceAccountCollectionSettings.test.ts \
  src/components/admin/WizardStepBinding.test.ts \
  src/components/admin/media-plan-source-selection.test.ts \
  src/lib/access-auth.test.ts \
  src/lib/shared-password-admin-route.test.ts \
  src/lib/shared-password-admin.test.ts \
  src/lib/admin-dashboards-canonical-bindings.test.ts \
  src/lib/dashboard-access-policy.test.ts \
  src/lib/dashboard-access-shared-password.test.ts
```

Result: 58 passed, 0 failed.

```sh
npx tsc --noEmit --allowImportingTsExtensions
npx eslint 'src/app/admin/dashboards/[id]/target-intent/page.tsx' \
  'src/app/admin/dashboards/[id]/edit/page.tsx' \
  src/components/admin/DashboardTargetIntentScreen.tsx \
  src/components/admin/DashboardTargetIntentScreen.test.tsx \
  src/lib/admin-ui-types.ts
git diff --check
```

Result: all exited 0.

## Independent Review

An independent code review found no remaining Critical or Important issues after follow-up fixes. The review specifically rechecked HTTP 5xx ambiguity, source-edit preview invalidation, stable operation IDs, capability scoping, confirmation mutual exclusion, and post-mutation refresh handling.

## Self-Review

- The client constructs only Task 2 payloads and URLs; it never sends site IDs, release IDs, artifact paths, or source credentials.
- Source controls are locked during load, validation, and publication to prevent overlapping state transitions.
- A successful mutation and the subsequent canonical reload are separate transitions, so a refresh failure cannot display stale state as current.
- The reducer keeps canonical active state on validation or rejected-operation errors.
- Upload size is checked before `arrayBuffer()`, and base64 content is not stored in component state.
- No migration, collector, scheduler, deployment, secret change, external API call, or production action was performed.
- Unrelated modified `.superpowers/sdd/task-1-report.md` and untracked `apps/site-seo/.next-medroche/` were left untouched and are excluded from the Task 3 commit.

## Residuals

- The Task 2 preview contract does not expose observed-query match samples or CSV delimiter/encoding metadata. The UI therefore labels the available preview rows accurately as source-rule examples and displays worksheet metadata when supplied. Adding those fields would change the Task 2 contract and is outside this Task 3-only assignment.
- No production/browser smoke was performed. This task's scoped verification is component/source-contract testing plus TypeScript and ESLint; integrated visual verification remains for the later integration task.

## Commit

Requested commit message: `feat(admin): add target intent management screen`.

## Root Review Follow-up

### Delivered

- Disabled restore cancellation during publication and added handler-level guards so synthetic or stale callbacks cannot clear the restore target or its stable operation ID while a mutation is running.
- Replaced the shared `mounted` boolean with a dashboard-scoped request coordinator. Changing `dashboardId` aborts the old scope, starts a new generation, and prevents late load, preview, publish, restore, and post-mutation refresh results from dispatching into the new dashboard.
- Cleared the previous dashboard's canonical and preview state immediately when the request scope changes, preventing old dashboard metadata from appearing under the new dashboard ID while its state loads.
- Added the authenticated, server-scoped `?view=capability` projection. The dashboard edit navigation now downloads only `{ supported: true }` and does not read the catalogue, history, previews, or rule rows.
- Trimmed `rows` from historical preview summaries returned by the management GET. The direct preview response retains current preview rows required by the management screen.
- Cleared both the selected `File` and inactive Google Sheets URL whenever source mode changes, releasing invisible cached source state.

### Focused RED Evidence

```sh
node --import tsx --test src/components/admin/DashboardTargetIntentScreen.test.tsx
```

Result before implementation: 12 passed, 4 failed. The new failures proved that:

- navigation still fetched the full management resource;
- restore cancellation remained enabled during publication;
- no dashboard-scoped request coordinator existed;
- source-mode changes retained the inactive source.

An additional scope-reset regression then failed 16 passed, 1 failed because the old dashboard's canonical state survived the new dashboard's loading transition.

```sh
node --import tsx './src/app/api/admin/dashboards/[id]/target-intent/route.test.ts'
```

Result before implementation: 10 passed, 2 failed. Capability GET returned the full state and called `readState`; management GET still returned all 10,000 historical preview rows.

### GREEN Evidence

- Task 3 UI tests: 17 passed, 0 failed.
- Task 2 target-intent route tests: 12 passed, 0 failed.
- Existing admin/auth regressions: 58 passed, 0 failed.
- `npx tsc --noEmit --allowImportingTsExtensions`: exit 0.
- focused ESLint over the Task 3 and adjacent API files: exit 0 with no warnings.
- `git diff --check`: exit 0.

### Follow-up Self-Review

- The request coordinator compares dashboard ID, monotonically increasing generation, and signal identity. Activating a new dashboard aborts the old signal before any old completion can be accepted.
- Every asynchronous management operation captures one scope and uses its abort signal for fetches; file reads are checked for staleness immediately after completion.
- Capability detection still passes through the same administrator authentication and server-side dashboard/site scope resolution as the management endpoint.
- The management projection removes only historical `rows`; validation errors, counters, source evidence, actor, and timestamp remain available for the audit table.
- No deployment, migration, external source call, scheduler change, secret change, or production action occurred.
