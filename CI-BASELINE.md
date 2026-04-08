# CI Baseline

This repo is one half of the Reports delivery surface. The paired service repo is `nest-second/`, so branch safety and release readiness have to be treated as split-repo concerns.

## Required checks

- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Merge criteria

- No direct pushes to `main`; use pull requests so the `CI` workflow runs.
- Require the `CI` GitHub Action to pass before merge.
- If the change depends on `nest-second/`, keep the corresponding PR linked and release them in the same window.

## Release criteria

- Release only from a commit with a green `CI` run.
- Keep the working tree clean before deploy.
- Manual smoke validation is still required after deploy because automated test coverage is not in place yet.

## Current gaps

- The current tree fails `npm run lint` on an existing `no-explicit-any` violation.
- The current tree fails `npm run build` on the `/med` page during prerender.
- Branch protection in GitHub still needs to require the `CI` status check on `main`.
