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
