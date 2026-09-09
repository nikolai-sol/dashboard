# Zaruku Exact Release Successor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and use one fail-closed operation that advances `release/zaruku` from the exact approved predecessor to the clean, reviewed successor SHA without deleting the ref or touching another dashboard.

**Architecture:** Extend the existing isolated bare-repository release authority with one committed predecessor pin and one compare-and-swap successor operation. The operation proves strict ancestry locally, publishes one explicit refspec under an exact lease, and requires exact remote readback; all existing creation and check behavior remains unchanged.

**Tech Stack:** Node.js ESM, Node test runner, Git, OpenSSH, GitHub Actions.

## Global Constraints

- The only remote is `git@github.com:nikolai-sol/dashboard.git`.
- The only mutable ref is `refs/heads/release/zaruku`.
- The approved predecessor is `c3da2b96d3416711f6f06adc541e83b3a3b945f3`.
- The successor comes only from the clean current checkout through `reviewedSource`; it is never accepted from argv or environment.
- The predecessor must be a strict ancestor of the successor.
- Publication uses an exact predecessor lease, one explicit refspec, `--atomic`, disabled hooks, disabled tag following, and disabled submodule recursion.
- Never delete the release ref and never retry against a newly observed SHA.
- Do not deploy, connect to production, edit Nginx, operate PM2, access MySQL, rotate secrets, write canonical data, or update another dashboard/ref.
- Any failed, stale, raced, divergent, or ambiguous state fails closed with the existing sanitized refusal message.

---

## File Structure

- `deploy/zaruku/repository.json` — add the single approved predecessor to the committed repository authority.
- `scripts/freeze-zaruku-shadow-release.mjs` — add the strict successor operation and CLI verb.
- `scripts/freeze-zaruku-shadow-release.test.mjs` — prove success, refusal, exact lease, strict ancestry, and race behavior before implementation.
- `OPS.md` — document the one-time successor command and its non-repeatable boundary.
- `docs/superpowers/plans/2026-09-08-zaruku-production-shadow.md` — remove the contradiction with the original create-only rule.

---

### Task 1: Add the Exact Successor Contract with TDD

**Files:**
- Modify: `scripts/freeze-zaruku-shadow-release.test.mjs`
- Modify: `scripts/freeze-zaruku-shadow-release.mjs`
- Modify: `deploy/zaruku/repository.json`

**Interfaces:**
- Consumes: `adapter.source(): {sha:string, branch:string, clean:boolean}`
- Consumes: `adapter.open(source)` returning the existing isolated adapter plus `verifyAncestor(ancestor:string, descendant:string): void`
- Produces: `advanceApprovedSuccessor(adapter): Promise<{ref:string, predecessorSha:string, successorSha:string, advanced:true}>`
- Produces CLI: `node scripts/freeze-zaruku-shadow-release.mjs advance-approved-successor`

- [ ] **Step 1: Write the failing exact-transition test**

Import `advanceApprovedSuccessor` and add:

```js
const predecessorSha = REPOSITORY_AUTHORITY.approvedPredecessor;
const successorSha = 'c'.repeat(40);

test('approved successor uses strict ancestry, an exact lease, and exact readback', async () => {
  let remote = predecessorSha;
  const commands = [], ancestry = [];
  const source = {sha:successorSha, branch:'codex/candidate', clean:true};
  const adapter = {
    source: () => source,
    destination: REPOSITORY_AUTHORITY.url,
    verifyBase: () => {},
    verifyAncestor: (ancestor, descendant) => ancestry.push([ancestor, descendant]),
    command: args => {
      commands.push(args);
      if (args[0] === 'push') {
        remote = successorSha;
        return {status:0, stdout:'', stderr:''};
      }
      return {status:0, stdout:`${remote}\t${ref}\n`, stderr:''};
    },
  };
  assert.deepEqual(await advanceApprovedSuccessor(adapter), {
    ref, predecessorSha, successorSha, advanced:true,
  });
  assert.deepEqual(ancestry, [[predecessorSha, successorSha]]);
  assert.deepEqual(commands.find(args => args[0] === 'push'), [
    'push', '--no-verify', '--no-follow-tags', '--recurse-submodules=no',
    '--atomic', `--force-with-lease=${ref}:${predecessorSha}`, '--',
    REPOSITORY_AUTHORITY.url, `${successorSha}:${ref}`,
  ]);
  assert.equal(commands.filter(args => args[0] === 'ls-remote').length, 2);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern='approved successor uses strict ancestry' scripts/freeze-zaruku-shadow-release.test.mjs
```

Expected: FAIL because `advanceApprovedSuccessor` is not exported.

- [ ] **Step 3: Add failing refusal tests**

Add table-driven cases for an absent ref, a different ref, an already-advanced ref, a dirty source, a changing source, an equal predecessor/successor, and failed ancestry:

```js
test('approved successor refuses every non-exact or non-fast-forward state', async () => {
  const result = value => value === null
    ? {status:2, stdout:'', stderr:''}
    : {status:0, stdout:`${value}\t${ref}\n`, stderr:''};
  for (const observed of [null, 'd'.repeat(40), successorSha]) {
    const adapter = {
      source: () => ({sha:successorSha, branch:'codex/candidate', clean:true}),
      verifyBase: () => {}, verifyAncestor: () => {},
      command: () => result(observed),
    };
    await assert.rejects(advanceApprovedSuccessor(adapter), /release authority/);
  }
  await assert.rejects(advanceApprovedSuccessor({
    source: () => ({sha:successorSha, branch:'codex/candidate', clean:false}),
  }), /release authority/);
  await assert.rejects(advanceApprovedSuccessor({
    source: () => ({sha:successorSha, branch:'codex/candidate', clean:true}),
    verifyBase: () => {},
    verifyAncestor: () => { throw new Error('not ancestor'); },
    command: () => result(predecessorSha),
  }), /release authority/);
});
```

- [ ] **Step 4: Run the refusal test and verify RED**

Run:

```bash
node --test --test-name-pattern='approved successor refuses' scripts/freeze-zaruku-shadow-release.test.mjs
```

Expected: FAIL because the successor operation does not exist.

- [ ] **Step 5: Implement the minimal authority and operation**

Change `deploy/zaruku/repository.json` and `REPOSITORY_AUTHORITY` to this exact object:

```json
{
  "version": 2,
  "url": "git@github.com:nikolai-sol/dashboard.git",
  "ref": "refs/heads/release/zaruku",
  "base": "ee950f3917d0f8616b6229d4049410a0afb7e380",
  "approvedPredecessor": "c3da2b96d3416711f6f06adc541e83b3a3b945f3"
}
```

Add the operation using the existing `validSource`, `withRepository`, `inspect`, and `fail` boundaries:

```js
export async function advanceApprovedSuccessor(adapter) {
  const before = validSource(await adapter.source());
  const predecessorSha = REPOSITORY_AUTHORITY.approvedPredecessor;
  if (before.sha === predecessorSha) fail();
  return withRepository(adapter, before, async isolated => {
    await isolated.verifyBase(before.sha);
    await isolated.verifyAncestor(predecessorSha, before.sha);
    if (await inspect(isolated) !== predecessorSha ||
        !isDeepStrictEqual(await adapter.source(), before)) fail();
    const result = await isolated.command([
      'push', '--no-verify', '--no-follow-tags', '--recurse-submodules=no',
      '--atomic', `--force-with-lease=${REF}:${predecessorSha}`, '--',
      isolated.destination ?? REPOSITORY_AUTHORITY.url,
      `${before.sha}:${REF}`,
    ]);
    if (result.status !== 0 || result.signal || result.error) fail();
    if (await inspect(isolated) !== before.sha ||
        !isDeepStrictEqual(await adapter.source(), before)) fail();
    return {ref:REF, predecessorSha, successorSha:before.sha, advanced:true};
  });
}
```

Add this isolated-adapter method:

```js
verifyAncestor: (ancestor, descendant) => {
  checked(command(['merge-base', '--is-ancestor', ancestor, descendant]));
},
```

Permit exactly the additional CLI verb `advance-approved-successor`, dispatch it to
`advanceApprovedSuccessor(createReleaseAuthorityAdapter())`, and continue rejecting extra arguments.

- [ ] **Step 6: Run the focused suite and verify GREEN**

Run:

```bash
node --test scripts/freeze-zaruku-shadow-release.test.mjs
```

Expected: all tests PASS with no call to the real origin.

- [ ] **Step 7: Add and verify the real-Git lease-race regression**

Using the existing mktemp bare-repository fixture pattern, create predecessor,
successor, and racing commits. Publish the predecessor, move the remote to the
racing commit immediately before the candidate push, and assert:

```js
await assert.rejects(advanceApprovedSuccessor(adapter), /release authority/);
assert.equal(git(remote, ['rev-parse', ref]).stdout.trim(), racingSha);
assert.equal(git(remote, ['for-each-ref', '--format=%(refname)']).stdout, ref + '\n');
```

Run:

```bash
node --test --test-name-pattern='successor lease refuses a racing ref' scripts/freeze-zaruku-shadow-release.test.mjs
```

Expected: PASS; the racing SHA remains installed and no ref is deleted.

- [ ] **Step 8: Commit the tested implementation**

Run:

```bash
git add deploy/zaruku/repository.json scripts/freeze-zaruku-shadow-release.mjs scripts/freeze-zaruku-shadow-release.test.mjs
git commit -m "feat(zaruku): add exact release successor"
```

Expected: one commit containing only the three Zaruku release-control files.

---

### Task 2: Align Operations Documentation and the Parent Plan

**Files:**
- Modify: `OPS.md`
- Modify: `docs/superpowers/plans/2026-09-08-zaruku-production-shadow.md`

**Interfaces:**
- Consumes CLI: `node scripts/freeze-zaruku-shadow-release.mjs advance-approved-successor`
- Produces: one documented exception for the exact committed predecessor only

- [ ] **Step 1: Add the approved recovery wording to both documents**

Retain `check` and `create-if-absent`, then add:

```text
The separately approved recovery command `advance-approved-successor` may run
only while the remote ref equals the full `approvedPredecessor` recorded in
`deploy/zaruku/repository.json`. It proves that predecessor is a strict ancestor
of the clean reviewed candidate, publishes one explicit refspec under an exact
atomic lease, and requires exact readback. It cannot delete the ref, accept an
argv/environment SHA, retry against a changed ref, or run successfully twice.
No other ordinary or forced update is allowed.
```

- [ ] **Step 2: Run documentation and source checks**

Run:

```bash
rg -n "advance-approved-successor|approvedPredecessor|No other ordinary" OPS.md docs/superpowers/plans/2026-09-08-zaruku-production-shadow.md
git diff --check
```

Expected: both documents contain the rule and `git diff --check` is silent.

- [ ] **Step 3: Commit the documentation alignment**

Run:

```bash
git add OPS.md docs/superpowers/plans/2026-09-08-zaruku-production-shadow.md
git commit -m "docs(zaruku): document approved release successor"
```

Expected: one documentation-only commit.

---

### Task 3: Verify, Publish, and Advance the Exact Release

**Files:**
- Verify only: repository worktree and GitHub Actions results
- Mutate only: `refs/heads/codex/three-dashboard-runtime-isolation`, `refs/heads/main`, then `refs/heads/release/zaruku`

**Interfaces:**
- Consumes: clean reviewed candidate SHA and green GitHub CI
- Produces: exact equality among candidate SHA, `main`, and `release/zaruku`

- [ ] **Step 1: Run focused and full local verification**

Run:

```bash
node --test scripts/freeze-zaruku-shadow-release.test.mjs
npm run test:zaruku-production-shadow
npm run ci:verify
```

Expected: every command exits `0`; existing lint warnings may remain but no test or build failure is accepted.

- [ ] **Step 2: Confirm scope and clean state**

Run:

```bash
git status --short
git diff --name-only origin/main...HEAD
git rev-parse HEAD
git merge-base --is-ancestor c3da2b96d3416711f6f06adc541e83b3a3b945f3 HEAD
```

Expected: clean worktree; changed paths are limited to approved Zaruku control/spec/plan/operations files; ancestry exits `0`.

- [ ] **Step 3: Push the isolated branch and main without rewriting either**

Run:

```bash
git push origin HEAD:refs/heads/codex/three-dashboard-runtime-isolation
git push origin HEAD:refs/heads/main
```

Expected: both are fast-forward updates to the same candidate SHA.

- [ ] **Step 4: Require green GitHub CI for the candidate SHA**

Run:

```bash
candidate_sha=$(git rev-parse HEAD)
gh run list --workflow=ci.yml --commit="$candidate_sha" --limit=1
run_id=$(gh run list --workflow=ci.yml --commit="$candidate_sha" --limit=1 --json databaseId --jq '.[0].databaseId')
gh run watch "$run_id" --exit-status
```

Expected: the exact candidate run concludes `success`. Do not advance the release ref on a missing, stale, cancelled, or failed run.

- [ ] **Step 5: Run the one-time protected successor operation**

Run:

```bash
node scripts/freeze-zaruku-shadow-release.mjs advance-approved-successor
```

Expected: sanitized JSON reports `advanced:true`, the approved predecessor, and a successor equal to `git rev-parse HEAD`.

- [ ] **Step 6: Prove exact readback and non-repeatability**

Run:

```bash
node scripts/freeze-zaruku-shadow-release.mjs check
git ls-remote --heads origin refs/heads/main refs/heads/release/zaruku
node scripts/freeze-zaruku-shadow-release.mjs advance-approved-successor
```

Expected: `check` succeeds; `main` and `release/zaruku` show the same full SHA; the second successor command refuses without changing the ref.

- [ ] **Step 7: Record the checkpoint for the parent shadow plan**

Record the candidate SHA, GitHub CI URL, exact release readback, and expected second-run refusal in the working notes. Do not create a production readiness report yet because no production shadow action has occurred.

---

## Completion Boundary

This plan is complete when local verification and exact-candidate GitHub CI are green, `release/zaruku` equals the clean candidate SHA through the approved predecessor lease, ordinary `check` succeeds, and a second successor attempt refuses. The next action is Task 6 of `docs/superpowers/plans/2026-09-08-zaruku-production-shadow.md`; it remains separately bounded by production preflight and the owner's hidden manager-cookie input.
