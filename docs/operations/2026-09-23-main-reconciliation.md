# Main reconciliation and runtime ownership — 2026-09-23

The owner prioritized cleaning main and checking completed work on other
dashboards. Gidrofuril-specific operational work is deferred. Its campaign-date
plan fix is retained as reusable behavior for future media campaigns.

## Verified production state

Read-only inspection of PM2, listeners, runtime metadata and Nginx on September
23 established:

| Dashboard | Running process/port | Source identity | Public routing |
| --- | --- | --- | --- |
| Media + Abbott | `dashboard-next`, loopback `3001` | `8f389a28df1c4b741ec33b7538f0354b74f5a40e` | Media and Abbott still share the combined runtime |
| Zaruku | `dashboard-zaruku`, loopback `3002` | `af1948c8b9a0f70d8696afb9c8abc254408a5daa` | Separate page/API/export routes and `/_next-zaruku/` |
| Site SEO / MedRoche | `dashboard-medroche`, loopback `3003` | Active directory resolves to `dashboard-medroche-releases/8fd6d122aca117b76d8bef5a145247cc232135fa/standalone` | Separate MedRoche page/API/assets |
| Abbott candidate | No running PM2 entry or port `3004` listener | Stored directory identifies `dfd6267a742d1c7d88ccac636b89661df9b96f9f` | Not cut over; Nginx still routes Abbott to `3001` |

No process, service, Nginx route, database or production release was changed by
this main cleanup. Zaruku and SEO have separate running artifacts. Source-level
sharing of auth/types/components is not the same as a shared live process.

## What was already complete

- Site SEO/MedRoche work was already on main `8fd6d122`; its release branch
  identified the same commit.
- Zaruku's production release was complete but 11 commits were absent from
  main: SQL alias/collation corrections, shared-component CSS coverage,
  compact Alice history, dedicated release transport and evidence. Merged the
  actual published `origin/release/zaruku` source, not dirty local worktrees.
- Completed Zaruku cutover operator `7059e7fb` and its evidence were also
  outside main. Merged it separately, preserving both site-SEO and cutover test
  scripts in the only package.json conflict. It is historical tooling:
  **do not rerun `apply` on the already switched production configuration**.
- Older Abbott MNN, User ID, URL-lookup and returning-filter changes were
  already represented in main. An old worktree is not evidence of pending work.

## Production lineage resolution

The earlier count of 189 main-only commits described divergent ancestry, not
189 missing production media features. The production-only feature commits
have counterparts already integrated into main:

| Production commit | Existing main counterpart |
| --- | --- |
| `52030906` | `b5ca8243` |
| `96f16c5d` | `1cdbe390` |
| `31e251db` | `0cd7ee77` |
| `a0fa018e` | `21ed9319` |

Every one of their nine changed files had identical Git blob IDs on main and
production: manual-data confirmation route/tests; WizardStep2 and its Google
Sheet source-purpose test; canonical-adapter and its sheet test;
canonical-import-request; dashboard-data-loader; frequency override test.
The production layer merge `8f389a28` itself had no first-parent tree changes.

Accordingly merge `a4105dbf` records both lineages while retaining main's
existing tree exactly. This deliberately rejects older packaging deletions,
not production functionality. It preserves all main apps/packages and current
deployment protections. Its first-parent tree diff is empty.

Normal merges then included the published Zaruku release (`faba686d`), the
seven-file media plan patch (`82dbfa9d`), and historical cutover source
(`012a38da`). No deployment gate or runtime authority was disabled.

## Reusable media plan behavior and isolation

Patch `772f3673` keeps monthly allocations within actual campaign dates and
returns zero planned amount outside those dates. It preserves original monthly
amounts and actual facts. It is general media behavior, not a Gidrofuril override.

The combined loader returns Abbott and Zaruku payloads before the advertising
projection. Isolated Zaruku's loader does not import the combined loader or
plan normalizer; its dependency-graph tests verify this boundary. Site SEO uses
its own app-local loader and imports neither media module.

The full lint check also found existing problems in site SEO: data fetching and
JSX were inside one try/catch, and its intentional CommonJS Next config loaded
`node:path`. A bounded behavior-preserving page refactor keeps data preparation
inside the catch boundary and rendering outside it. The ESLint config permits
only `node:` built-ins in app-local CommonJS Next configs; the rule remains on.
Auth, UI text, period selection, publication validation and data reads are kept.
The existing source-attestation mechanism required the MedRoche profile,
registry and release descriptor to name the reconciled template commit
`a5332eb5`. This updates repository build inputs only; the running profile and
`release/medroche` branch are unchanged.

## Explicitly unfinished: Abbott separation

`release/abbott` and `codex/abbott-runtime-isolation` contain an extracted app
and release tooling, but their runbook retains unresolved smoke/visual gates.
They diverge substantially from main and their older tree would remove accepted
Zaruku code if merged wholesale. They remain preserved, unmodified branches.
An independent Abbott integration and verified cutover is required before
claiming complete runtime independence from media.

Main's ownership rules now state this directly. Media-only releases must not
replace Abbott's serving bundle without a separately reviewed Abbott-safe
release. Port `3003` belongs to MedRoche; Abbott's candidate port is `3004`.

## Verification and integration record

Baseline node suite: 1,065 passed, 12 skipped, zero failed after installing the
worktree's own locked workspace dependencies. Initial shared node_modules lacked
the site-SEO workspace link; that was a local setup issue, not a code regression.

Final `npm run predeploy:verify` completed with exit 0 on the reconciled source.
It includes node tests (1,078 passed, 12 skipped), Python tests, deployment and
rollback contracts, Zaruku production-shadow fixtures, 19 cutover tests,
isolated Zaruku build/artifact/boot and 41 app tests, 157 artifact policy tests,
111 Abbott contract tests, public-asset checks, typechecks, lint, root production
build and preview-builder tests. Lint has zero errors and 22 nonblocking warnings.

Separately, `npm run test:site-seo` passed 226 TypeScript tests and 27 build/
isolation tests after source attestation, site-SEO typecheck passed, and the
isolated MedRoche build/artifact validation completed successfully.
Independent final review found no must-fix findings and ran 93 targeted tests.
The current root deploy script, source verifier and runtime manifest are
byte-identical to their original-main versions.

The last GitHub CI run on the old main, `35107109371`, had failed its Verify app
step. In addition to the lint cleanup, CI now fetches full Git history: the
template attestation points to a source commit before HEAD. A temporary
depth-one clone reproduced the missing-commit failure; fetching complete history
resolved it. The YAML was parsed and verification steps remain present.

Evidence is retained in the root repository's
`outputs/main-reconciliation-20260923/`. Repeated read-only server inspection
confirmed the original three process identities and ports; no production
application was restarted or replaced. No external API or database write was
needed. The verified source is ready to fast-forward main without deployment.

Done: source/runtime audit and fully verified integration candidate. Accepted: owner
authorized main cleanup and preserving separated dashboard ownership; final
result acceptance is pending. Reusable learning: compare feature trees before
treating divergent ancestry as missing functionality, and distinguish prepared
runtime directories from actual public routing. Skill action: operational memory
updated, no skill changed. Evidence: merge commits, source equality checks,
production read-only inspection and tests above. Budget stop: no; authorized
stage started 07:15 UTC with checkpoint due 08:15 UTC.
