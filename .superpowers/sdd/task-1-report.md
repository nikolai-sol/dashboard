# Task 1 report — integrate Abbott content-registry authority

## Status

Completed the prescribed no-ff merge of `codex/abbott-returning-registry-batch`
into `codex/abbott-url-identity-resolution`.  The merge commit is
`c02cfc4` (`merge: adopt Abbott content registry authority`).  The nested
dashboard is detached at the merged root gitlink
`52d7444d1c56afdbe7fdf0208ceb46f5a76f90bb`; `nest-second` remains
`1ef35ffd92bff6a60d95e329e4d41123e7bb5871`.

No production or external-source operation was performed.

## Commands and results

1. `git log --oneline main..codex/abbott-returning-registry-batch`
   listed the Abbott content-registry workflow commits through `d23519c`.
2. `git diff --name-status main...codex/abbott-returning-registry-batch`
   showed the expected Abbott registry/runtime/schema tests/docs and the
   `dashboard-next` gitlink; it did not include an unrelated dashboard.
3. `git -C dashboard-next merge-base --is-ancestor 02c57effa8d909d91bc68cc1ae74cf590753841c 52d7444d1c56afdbe7fdf0208ceb46f5a76f90bb`
   exited `0`.
4. `git merge --no-ff codex/abbott-returning-registry-batch -m "merge: adopt Abbott content registry authority"`
   succeeded, creating `c02cfc4`.
5. `git -C dashboard-next checkout --detach "$(git rev-parse HEAD:dashboard-next)"`
   succeeded; both values resolve to `52d7444d1c56afdbe7fdf0208ceb46f5a76f90bb`.
6. Baseline initially run exactly as specified with the host `python3`
   failed because it is Python 3.9.6, while the imported runtime requires
   Python 3.11, and its optional test dependencies were absent.
7. With the available `/Users/nafanya/.local/bin/python3.11` and locally
   isolated, ignored test dependencies, classifier discovery passed:
   `Ran 394 tests ... OK (skipped=1)`.
8. The requested root contract suite ran `84` tests and failed `5` runtime
   closure assertions.  The failures compare four root Abbott workflow files
   to the nested bootstrap copies and their `MIGRATION-MANIFEST.md` hashes.
   The nested copy/manifest records the older bytes while the merged root
   authority files are newer:
   `weekly_proposal.py`, `workflow.py`, `workflow_service.py`, and
   `workflow_repository.py`.

## Scope check and self-review

- Only the Abbott authority branch was merged. `abbott_release_retention.py`
  and `docs/superpowers/specs/2026-08-10-abbott-url-identity-resolution-design.md`
  remain present.
- `dashboard-next` was not edited; its HEAD equals the root gitlink after the
  merge. `nest-second` was unchanged.
- No Zaruku, Gidrofuril, `nest-second`, release-24, production-dashboard,
  deployment, DB/API/SSH, secret, cron, Google Sheets, or LLM action occurred.
- `git diff --check` was clean and the root worktree was clean before adding
  this report.

## Concern

The authority branch is internally inconsistent at this integration point:
the root content-runtime authority advanced without a matching nested bootstrap
runtime copy and bootstrap migration-manifest re-attestation. Resolving that
requires a deliberate nested-dashboard update and new root gitlink, which is
outside Task 1's explicit requirement to leave the nested dashboard at the
merged gitlink and not change the production dashboard. The imported
classifier pipeline is green, but the full prescribed baseline is not green
until that runtime-closure inconsistency is addressed in an authorized task.

---

## Review follow-up — runtime-closure attestation repair

### Root cause and scope

The runtime-closure failure was an attestation drift, not a bootstrap-source
drift. The four approved bootstrap runtime files were already byte-identical
to their root authorities. Their SHA-256 values in the nested
`reportingdash-canonical-bootstrap/MIGRATION-MANIFEST.md` were stale, as were
the corresponding four entries in the root
`ops/abbott-runtime-manifest.sha256`. The closure test explicitly validates
the root runtime manifest, so its four entries were updated as required by
the test.

Only these four authority paths were re-attested:

- `agents/abbott_page_classifier/weekly_proposal.py`
- `agents/abbott_page_classifier/workflow.py`
- `agents/abbott_page_classifier/workflow_service.py`
- `agents/abbott_page_classifier/workflow_repository.py`

The nested source copies were not rewritten because their bytes already
matched the root files. The nested dashboard change is limited to the four
manifest hashes; the root change is limited to the four runtime-manifest
hashes and the resulting `dashboard-next` gitlink.

### Commands and results

1. Reproduced the finding with:
   ```bash
   /Users/nafanya/.local/bin/python3.11 -m unittest tests.test_abbott_runtime_closure
   ```
   The closure assertions identified exactly the four stale nested-manifest
   hashes. The initial environment lacked optional test imports
   (`mysql.connector`, `openpyxl`), causing unrelated import errors.
2. Compared both sides with:
   ```bash
   shasum -a 256 agents/abbott_page_classifier/{weekly_proposal.py,workflow.py,workflow_service.py,workflow_repository.py}
   shasum -a 256 dashboard-next/reportingdash-canonical-bootstrap/runtime/agents/abbott_page_classifier/{weekly_proposal.py,workflow.py,workflow_service.py,workflow_repository.py}
   ```
   Each root/bootstrap pair had identical bytes. The authoritative digests
   are `b17d597a…fb2a5`, `c0e9e526…5b66`, `90d2cf1b…cff3`, and
   `bf23d9c1…b981`, respectively.
3. Installed only local, isolated Python 3.11 test dependencies under
   `/tmp/abbott-task1-deps`; no repository dependency, production, database,
   API, SSH, deployment, service, cron, Google Sheets, or LLM operation was
   performed.
4. Updated the four hashes in the nested bootstrap migration manifest and
   committed the nested dashboard:
   ```text
   ac97675 fix(abbott): refresh bootstrap runtime attestations
   ```
5. Updated the matching root runtime-manifest hashes and advanced the root
   `dashboard-next` gitlink to the nested commit.
6. Ran fresh verification with Python 3.11 and the isolated dependency path:
   ```bash
   env PYTHONPATH=/tmp/abbott-task1-deps /Users/nafanya/.local/bin/python3.11 -m unittest tests.test_abbott_runtime_closure
   env PYTHONPATH=/tmp/abbott-task1-deps /Users/nafanya/.local/bin/python3.11 -m unittest discover -s tests/abbott_page_classifier -p 'test_*.py'
   env PYTHONPATH=/tmp/abbott-task1-deps /Users/nafanya/.local/bin/python3.11 -m unittest tests.test_abbott_content_registry_schema tests.test_abbott_content_reconciliation_schema tests.test_abbott_runtime_closure tests.test_abbott_release_operator tests.test_canonical_release_store tests.test_abbott_release_retention
   ```
   Results: runtime closure `22` tests passed; classifier suite `394` tests
   passed with `1` expected skip; exact Task 1 root contract suite `84` tests
   passed.

### Follow-up scope check

No active release, including release 24, was modified. Zaruku, Gidrofuril,
`nest-second`, all other worktrees/dashboards, and the parallel sales
analytics work were untouched.
