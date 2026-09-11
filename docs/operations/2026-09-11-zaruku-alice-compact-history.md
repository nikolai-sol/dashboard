# Zaruku Alice history: 2026-09-11

Owner approved the compact-history/table specification and implementation with «Делай».
Scope is Zaruku presentation and its isolated release only. No source data, password,
collector, schema, cron, or other dashboard modification is part of this release.

## Preflight evidence

- Live Zaruku and remote `release/zaruku`: `ef9ec052772e798f681000467ccb3349932efe01`.
- Shared app: `8f389a28df1c4b741ec33b7538f0354b74f5a40e`, PID `3722244`.
- Zaruku PID `3770482`; local health `{"ok":true,"scope":"zaruku"}`.
- Current Nginx SHA-256: `1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c`.
  This differs from September 10 due to other work. Preserve it; do not rerun cutover.
- Original Alice unit tests: 18/18 pass.
- Original component in the local long-URL browser fixture: 63 link boxes extend
  beyond their owning cells at 1280 px; document itself remains 1280 px wide.

## Exact successor pin

The existing one-shot successor mechanism still pins an older predecessor.
For this owner-approved release, its JSON policy, compiled authority and policy
test are advanced together to the freshly verified live/remote `ef9ec05` SHA.
No gate, destination, refspec, ancestry check, lease or remote-readback rule changes.
Only `advance-approved-successor` may advance the release ref after review.
The pin test failed with the old authority (14 pass / 1 fail), then all 15 tests
passed with the matching live predecessor. No remote ref was changed by those tests.

## Local disk constraint

The internal disk reached ENOSPC during local work. Only this worktree's previous
generated `.next` and `apps/zaruku/.next-zaruku` directories were moved, recoverably,
to `/Volumes/Elements/zaruku-build-backup-20260911.tNNGxP/{combined-next,zaruku-next}`.
Source and other projects were not removed. The release build workspace is
`/Volumes/Elements/zaruku-alice-release.UNFhQL/source`; use an external npm cache
for the full build so the internal disk does not fill again.

## Completion evidence

Task 1 implementation: `91d30e4`; 22 focused tests pass, targeted ESLint clean.
Independent task review approved: no Critical/Important findings. Minor: two
points are 128 px apart rather than the approximate 100–120 px target; they are
compact and their full labels are visible. Carry this to final review.

Browser fixture checks passed all 16 combinations of 430/768/1024/1440 px and
1/2/3/12 months: exact label counts, zero labels clipped by the chart canvas,
zero links outside their cells, and document width equal to viewport width.
Long unbroken query text and expanded source lists were included. Search,
presence filter and second-page navigation also passed. The fixture is explicitly
labelled as local test data and is never added to production routes or facts.

An additional attempt to move local dependencies to the same backup directory's
`local-node-modules` child was interrupted during copying. The original local
`node_modules` remains; that backup copy is incomplete and must not be used.
Dependencies for the release were independently installed successfully in the
external build workspace (932 packages), not shared with other projects.

Build verification and live publication are pending. Do not treat this note as
proof of deployment. The previous generic tracked task report is preserved byte
for byte; this task's report has a distinct dated operations filename.
