# Zaruku Exact Release Successor Design

**Date:** 2026-09-09

## Purpose

Advance the already-created immutable `release/zaruku` ref from the exact
previously approved commit
`c3da2b96d3416711f6f06adc541e83b3a3b945f3` to one newly reviewed successor
commit without deleting the ref, opening a general update path, or touching any
other dashboard runtime.

## Scope

The change extends the existing Zaruku release-authority command with one
explicit successor operation. It changes only the Git release-ref control used
before the Zaruku loopback shadow deployment. It does not deploy an application,
connect to production, change Nginx, start or stop PM2, access MySQL, rotate a
secret, write dashboard data, or update another Git ref.

## Chosen Interface

Add a no-argument command named `advance-approved-successor` to
`scripts/freeze-zaruku-shadow-release.mjs`.

The approved predecessor is stored as a full 40-character SHA in the committed
Zaruku repository authority. The successor is the full SHA of the clean current
checkout, using the existing `reviewedSource` boundary. Neither SHA, repository,
remote, nor ref may be supplied through command-line arguments or environment
variables.

## Preconditions

The command refuses before mutation unless all of these conditions hold:

1. The checkout is clean, its branch is known, and its full SHA matches the
   candidate being reviewed.
2. The repository URL is exactly `git@github.com:nikolai-sol/dashboard.git` and
   the only target ref is `refs/heads/release/zaruku`.
3. A clean temporary bare repository contains only the candidate's reachable
   object closure and uses the existing isolated SSH/Git authority.
4. The remote ref equals the committed approved predecessor exactly.
5. The predecessor is an ancestor of the candidate, so the transition is a
   strict fast-forward.
6. The candidate differs from the predecessor.
7. The local source identity remains unchanged immediately before publication.

## Publication and Verification

Publication uses one explicit refspec, `--atomic`, disabled hooks, disabled tag
following, disabled submodule recursion, and an exact
`--force-with-lease=<ref>:<approved-predecessor>` comparison. The lease provides
compare-and-swap behavior: if the remote ref changes after inspection, the
operation fails without overwriting it.

After publication, the command reads the ref again from the same literal remote
through the same isolated authority and requires exact equality with the
candidate SHA. It also rechecks that the source checkout has not changed. Output
contains only the ref, predecessor SHA, successor SHA, and a success flag.

Once the transition succeeds, the ordinary `check` command remains the normal
interface. Re-running `advance-approved-successor` refuses because the remote no
longer equals the approved predecessor. Future release movement requires a new
reviewed design and a newly committed exact predecessor; this interface is not a
general branch updater.

## Failure Handling

Every missing, malformed, unexpected, divergent, stale, or ambiguous state fails
closed with the existing sanitized refusal message. There is no delete-and-create
fallback, force-without-lease fallback, retry against a newly observed SHA, or
rollback that could overwrite a later valid release. A failed or uncertain
publication is followed only by an exact read-only check and operator review.

## Tests

Tests must prove the following before implementation is accepted:

- exact approved predecessor advances to a strict descendant;
- absent, different, already-advanced, and divergent refs refuse;
- a race between inspection and push loses the exact lease and refuses;
- only the fixed remote, fixed ref, and explicit candidate refspec are used;
- deletion and force-without-lease are never emitted;
- dirty or changing source state refuses;
- the existing `check` and `create-if-absent` behavior remains unchanged;
- source-only verification and the full CI workflow pass on Linux and macOS.

## Completion Boundary

This design is complete when the protected successor command and regression
tests are committed, independently reviewed, green in GitHub CI, used once to
advance `release/zaruku`, and followed by a successful exact `check`. Production
shadow provisioning remains the next, separate phase of the existing approved
Zaruku production-shadow plan.
