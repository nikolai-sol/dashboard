# Production shadow Task 4 implementation report

Date: 2026-09-08. Worktree: `dashboard-next/.worktrees/three-dashboard-runtime-isolation`.

## Scope and status

Task 4 source/control tooling is implemented and the final focused, disposable Linux, and full predeploy gates passed. This report does **not** declare production shadow `GO`, authorize deployment, or authorize public cutover.

No production staging, deployment, apply, SSH mutation, MySQL operation, PM2 operation, Nginx operation, real manager parity, source API request, secret installation, release-ref update, or publication was performed. Tests use injected adapters and disposable source fixtures. Docker Desktop was started only under the controller's explicit local-fixture authorization; no sign-in, settings change, Kubernetes, port exposure, push, or publishing occurred.

Baseline: Tasks 1–3 through `1b341b61a8cf44fe764120f647ef38812b318ee7`; approved dedicated-image plan correction `21c6a992e55dba2abb3554cf8993734bea5b32a1`.

Image preparation commits:

- `9edaca4f132bcd0953d549ee909091d32af3f9dc` — reviewed immutable image inputs.
- `c4705f117d38380122d4a8ba298b98694767195b` — verified amd64 local-image lock.

The implementation/report commit follows these two preparatory commits. No dependency was added and `package-lock.json` is unchanged.

## Implemented boundaries

### Fixed control staging and runtime dependency closure

The stager accepts no path, host, inventory, or runtime override. It requires a clean named checkout, pins the exact reviewed 40-hex HEAD before and after reads, rejects links/non-regular/replaced sources, and sends a canonical manifest plus exact bytes with an outer SHA-256 digest. The Linux receiver checks that digest before parsing and can create only `/var/www/.dashboard-zaruku-shadow/control/<SHA>` and its fixed ancestors. It uses descriptor-anchored, no-follow, root-owned paths, exclusive creation, fsync, readback hashes, immutable permissions, and an inode journal. An existing bundle must have identical bytes and the same pinned inodes; extra files fail. Inspect-only mode cannot create a missing bundle.

The approved pure `zaruku-production-shadow-authority.mjs` supplies strict JSON/key/path/deep-freeze authority validation. The source contract imports/re-exports it while retaining its independent runtime-manifest/release cross-check and SQL owner scanner. No duplicated authority validation, TypeScript loader, npm dependency, opaque bundle, or borrowed application chunk is staged.

The fixed 15-file staged inventory is:

```text
deploy/zaruku/mysql-read-tables.json
deploy/zaruku/production-shadow.json
deploy/zaruku/release.json
scripts/install-zaruku-shadow-auth.mjs
scripts/install-zaruku-shadow-inventory.mjs
scripts/runtime-release-remote.mjs
scripts/verify-zaruku-shadow.sh
scripts/zaruku-production-shadow-authority.mjs
scripts/zaruku-production-shadow-preflight.mjs
scripts/zaruku-production-shadow-worker.mjs
scripts/zaruku-shadow-coverage.mjs
scripts/zaruku-shadow-db.mjs
scripts/zaruku-shadow-host.mjs
scripts/zaruku-shadow-mysql.py
scripts/zaruku-xlsx-semantic.py
```

Staging itself cannot touch app directories, PM2, Nginx, MySQL, secrets, identities, or release refs. Every production worker invocation first reattests the already staged bundle in inspect-only mode.

### Orchestration, read-only checks, parity and evidence

The no-argument production CLI implements the exact 14-step sequence in the brief. Linux proofs, host/35-table DB/secret/auth checks, full predeploy, reviewed source stability and read-only release authority precede the existing sealed Zaruku deployer. No implicit provisioning, image build, inventory install, release-ref mutation, or Nginx branch exists. Once deployment is attempted, a failure requests stop only for `dashboard-zaruku`.

The concrete worker checks the root socket MySQL identity, exact dedicated reader authority, host state, protected secret/auth files, active sealed artifact, kernel IDs, supplementary groups, cwd, PID and loopback listener ownership. It retains the combined PID, complete active Nginx include-graph hash and foreign SHA/file identity before and after parity.

The foreign inventory is source-pinned to exactly `combined-dashboard` at `/var/www/dashboard/.release-source-sha`. The explicit inventory installer/checker is separate from orchestration and publishes only the fixed root-owned `0600` TSV; extra/missing rows, alternative/secret paths, bad 40-hex contents, links, writable ancestry, or replaced identities fail closed. Production discovery was supplied by the controller as reviewed metadata, not performed here.

The fixed Python/MySQL bridge receives credentials through stdin, creates an anonymous sealed defaults memfd, and inherits only the defaults and attested executable descriptors. `/usr/bin/mysql` is checked against preflight device/inode/digest, then executed through that pinned descriptor. Credentials do not enter argv, environment, disk, output or evidence. Query output, input and deadlines are bounded and failures sanitized. The only attempted write remains the pre-existing zero-row denied UPDATE probe in one transaction/rollback connection; no apply mode exists.

Coverage uses exact schema-asserted metadata for the reviewed 25-table inventory. It emits only one digest derived from counts and maxima of identity, ingestion, timestamps or committed source hashes. Account is the fixed string `66624469` (avoiding numeric coercion of varchar account keys). Dated facts and published Alice months are scoped to January–August 2026. Current Wordstat coverage/snapshots/seeds/classifications and the seven SEO tables are account-scoped because the corresponding manager read models include that account history. No payload/business values or unrelated global collector runs enter the token or evidence. Exact `COLUMN_TYPE` mismatches, absent columns, malformed rows, errors and missing tokens fail closed.

The verifier performs one complete manager/JSON/PDF/XLSX pair. Only a differing pair plus a changed scoped coverage digest allows one retry. Stable mismatch, auth failure, missing/malformed coverage or second mismatch remains NO-GO. Retry history is preserved even when the second pair fails. XLSX semantics now use a fixed Python stdlib ZIP/XML helper via stdin, with only bounded counts/digest output; ZIP timestamps and core generation timestamps remain non-semantic while visible content stays significant. Malformed ZIP/XML, entities, zip bombs, excessive sizes/counts, duplicates, unsafe paths and NUL-truncated entry aliases fail with fixed redacted errors. Auth is consumed directly from an inherited FD; no auth temporary copy exists. The verifier runs in its own process group so timeout/output/protocol cleanup terminates descendants as well as the shell.

Evidence is a new root-owned `<SHA>-<UUID>` directory. Publication requires the pinned directory inode, whitelisted files, exclusive `decision.json`, fsync and final read-only permissions. It stores fixed labels, checks, scoped counters/digests, paired-read history, sanitized process/baseline attestation and evidence-file hashes only. No header, body, secret, DB row or arbitrary tool diagnostic is published. `GO` means shadow evidence only, never routing permission.

### Linux image and privilege/environment clarification

The approved dedicated image contains no repository, secrets, SSH material or production data. The build uses the official Node 22 Bookworm Slim **amd64** child manifest, one dated Debian snapshot and exact direct packages without recommends. Only explicit `--lock` can build/update the local-image authority; normal verification is read-only. Networked preparation is not called by predeploy or orchestration. Anonymous Docker configuration is fixed to `/var/empty`; no credentials are read by the Docker helper.

```text
base: docker.io/library/node@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96
platform: linux/amd64
snapshot: 20260825T000000Z
python3: 3.11.2-1+b1
util-linux: 2.38.1-5+deb12u3
passwd: 1:4.13+dfsg1-1+deb12u2
Dockerfile SHA-256: 639d06c96a31fa9c1092957a5cf9ff7f621907dc624e0987fdc62a21f1e9a61e
complete sorted dpkg manifest SHA-256: 1c85a5e7095e9e3164e96d7dc09339c2899e63db700625b180d346f636af8178
local image ID: sha256:510ace0a42c62640b67a09af9783e3fae03325e1b277794082ea9634ed0eebd6
```

The initial native arm64 resolution was not adopted as final authority. Both authority and independent Docker image inspection reject missing/wrong platform. Runtime uses only the locked local image ID, explicit `--platform linux/amd64`, `--pull never`, `--network none`, `--read-only`, read-only `/src`, disposable bounded tmpfs, `--rm`, and only added `SYS_PTRACE`. No host `/var/www` is mounted. The real container runs the original build-helper and privilege fixtures plus real Linux memfd/binary/deadline fixtures; no DB server is contacted.

The real amd64 fixture revealed deterministic `UV_USE_IO_URING=0` insertion even across the independently owned `setpriv` → `/usr/bin/env -i` → Node boundary. Node 22.23.2 under amd64 translation shows this in application environment and `/proc/self/environ`; the same Node version on native arm64 and amd64 Python do not. Read-only official Node/libuv source inspection found no insertion in Node startup and only getenv reads in libuv. This narrows the cause to the translated Node execution environment; it does not establish a native-production behavior claim. The controller approved normalizing **only** exact `UV_USE_IO_URING=0` immediately before app require. Other values and all unknown variables still fail, and the final exact `NODE_ENV`, `HOSTNAME`, `PORT` assertion is retained. Tests also prove parent-only variables cannot reach app code and a missing/unsafe env binary fails before app execution.

The sealed fixture proves full capability dropping and `no_new_privs`. Live PM2 attestation deliberately proves only the existing launch contract: exact identity/cwd/listener/artifact and zero effective, permitted, inheritable and ambient capabilities. It does not claim live `CapBnd=0` or `NoNewPrivs=1` and does not redesign PM2.

## RED → GREEN evidence

All commands below were run from this worktree. RED was observed before implementing each behavior, not inferred from an absent file. Follow-up negative regressions were added before the corresponding fixes.

| Exact command | Observed RED | Observed GREEN |
| --- | --- | --- |
| `node --test scripts/stage-zaruku-shadow-control.test.mjs scripts/run-zaruku-production-shadow.test.mjs` | Exit 1: missing control/orchestrator modules; later failures covered inspect-only staging, preparation export, failed-retry evidence and strict failure redaction. | Exit 0: 33 tests. |
| `bash scripts/run-zaruku-linux-fixtures.test.sh` | Exit 1: missing image policy/runner; later wrong observed platform and absent Linux descriptor fixture rejected. | Exit 0: 7 tests. |
| `bash scripts/verify-zaruku-shadow.test.sh` | Exit 1: missing canonical comparison/retry behavior, then unsupported token framing. | Exit 0: 3 positive and 22 negative cases. |
| `node --test scripts/runtime-boot-environment.test.mjs` | Exit 1: normalization export absent. | Exit 0: 2 tests; exact zero accepted, other values/keys rejected. |
| `node --test scripts/zaruku-production-shadow-contract.test.mjs` | Exit 1: foreign inventory/duplicate JSON rejection absent, later missing source-gate wiring. | Exit 0 in the 117-test source suite. |
| `node --test scripts/zaruku-shadow-coverage.test.mjs` | Exit 1: module absent; later numeric account literal failed the varchar-scope regression. | Exit 0: 3 tests. |
| `node --test scripts/zaruku-production-shadow-worker.test.mjs` | Exit 1: module absent; later auth temp-copy and process-group cleanup regressions failed. | Exit 0: 8 tests. |
| `node --test scripts/zaruku-production-shadow-remote.test.mjs` | Exit 1: fixed adapter module absent. | Exit 0: 4 tests. |
| `node --test scripts/install-zaruku-shadow-inventory.test.mjs` | Exit 1: explicit inventory CLI absent. | Exit 0: 3 tests. |
| `node --test scripts/zaruku-shadow-evidence.test.mjs` | Exit 1: exclusive publisher export absent. | Exit 0: 2 real-filesystem tests. |
| `python3 -I -B scripts/zaruku-shadow-mysql.test.py` | Exit 1: helper absent. | Exit 0: 5 tests. |
| `python3 -I -B scripts/zaruku-xlsx-semantic.test.py` | Exit 1: helper absent; final NUL-alias fixture reproduced an unsafe accepted ZIP before the original-name check. | Exit 0: 5 tests. |
| `bash scripts/run-zaruku-linux-fixtures.sh` | Initial real amd64 run failed exact env assertion; after scoped normalization the added real MySQL binary fixture exposed an atime-only identity change. | Exit 0: all three fixture groups; 4 build-helper, 3 privilege and 3 Linux descriptor tests. |

The MySQL binary identity regression was diagnosed with a real Linux descriptor read: reading the executable changed atime, not its contents or protected identity. The fix compares device/inode/owner/mode/link count/size/mtime/ctime, deliberately excluding access time; digest comparison remains mandatory.

Additional focused integration command:

```bash
node --test scripts/zaruku-production-shadow-worker.test.mjs scripts/zaruku-shadow-evidence.test.mjs scripts/zaruku-production-shadow-remote.test.mjs
```

Result: exit 0, 14 tests, including descendant cleanup, credential-only stdin, secret redaction, no apply/cutover action, and exclusive immutable evidence.

### Separately approved pre-existing test-clock correction

The first `npm run predeploy:verify` exited 1 in the untouched `Wordstat historical availability is separate from weekly current freshness` test: 945 pass, 1 fail, 10 skip. The exact focused reproduction was:

```bash
node --import tsx --test --test-name-pattern='Wordstat historical availability' src/lib/zaruku-wordstat.test.ts
```

It also exited 1 (`delayed` versus expected `healthy`). Inspection found no Task 4 diff in the Wordstat loader/test at that point. The fixture ends on September 1, the freshness limit is 168 hours, and that test omitted the existing optional `nowUtc` argument, so the September 8 wall clock legitimately made it stale. The controller authorized exactly one test-only change: pass `new Date("2026-09-02T12:00:00Z")`. No runtime logic, threshold or expectation changed. `node --import tsx --test src/lib/zaruku-wordstat.test.ts` then exited 0 with all 24 tests; the existing explicit stale-clock regression remains present.

### Final verification

The final `npm run predeploy:verify` exited **0** after the last implementation change. It preserved every existing gate in `scripts/predeploy-verify.sh`:

- Main Node suite: 956 discovered, 946 passed, 10 existing skips, zero failures; main Python: 13 passed; shared runtime contract: 4 passed.
- Deploy-source, lock, integration, metadata-bootstrap and predeploy-contract shell gates passed.
- Source production-shadow gate: **117 Node + 7 image-policy + 5 MySQL Python + 5 XLSX Python** passed.
- Standalone link normalization, release validation/rollback authority, isolated Zaruku build and sealed deploy tests passed (31 deploy tests).
- Isolated Zaruku contracts: 41 passed; artifact policy: 157 passed; artifact scan and real local standalone loopback boot/health passed.
- Shadow verifier: 3 positive + 22 negative cases passed; Abbott wiring and all 111 Abbott contract tests passed.
- Public-asset security, both TypeScript checks, lint, combined production build, and preview builder passed (preview Python 7 plus shell fixture).
- Lint reported zero errors and the same 12 warnings in existing files; no new Task 4 warning. The pre-existing Next workspace/multiple-lockfile warning remains.

After this full gate, the exact required focused commands were rerun: control/orchestrator **33/33**, image policy **7/7**, verifier **3 positive/22 negative**, all exit 0. `bash scripts/run-zaruku-linux-fixtures.sh` was also rerun against the locked amd64 image and exited 0 with exactly:

```text
linux-build-helper-fixture passed
linux-privilege-drop-fixture passed
linux-mysql-descriptor-fixture passed
```

Focused ESLint on the changed/new JavaScript boundary and test files reported no output and exit 0. `git diff --check` exited 0. Verification-before-completion was followed: successful command exits were observed before reporting implementation completion or committing.

## Files changed

- Image authority/build/run: `deploy/zaruku/linux-fixture.Dockerfile`, `deploy/zaruku/linux-fixture.json`, `scripts/build-zaruku-linux-fixture.sh`, `scripts/run-zaruku-linux-fixtures.sh`, `scripts/run-zaruku-linux-fixtures.test.sh`, `scripts/zaruku-linux-fixture-policy.mjs`, `scripts/zaruku-linux-fixture-policy.test.mjs`.
- Authorities/staging: `deploy/zaruku/production-shadow.json`, `scripts/zaruku-production-shadow-authority.mjs`, `scripts/zaruku-production-shadow-contract.mjs`, `scripts/zaruku-production-shadow-contract.test.mjs`, `scripts/stage-zaruku-shadow-control.mjs`, `scripts/stage-zaruku-shadow-control.test.mjs`; existing host/DB modules import the shared pure loader.
- Orchestration/worker: `scripts/run-zaruku-production-shadow.mjs`, `scripts/run-zaruku-production-shadow.test.mjs`, `scripts/zaruku-production-shadow-remote.mjs`, `scripts/zaruku-production-shadow-remote.test.mjs`, `scripts/zaruku-production-shadow-worker.mjs`, `scripts/zaruku-production-shadow-worker.test.mjs`, `scripts/zaruku-shadow-evidence.test.mjs`.
- Foreign inventory: `scripts/install-zaruku-shadow-inventory.mjs`, `scripts/install-zaruku-shadow-inventory.test.mjs`.
- Coverage/MySQL: `scripts/zaruku-shadow-coverage.mjs`, `scripts/zaruku-shadow-coverage.test.mjs`, `scripts/zaruku-shadow-mysql.py`, `scripts/zaruku-shadow-mysql.test.py`, `scripts/zaruku-shadow-mysql.linux.test.py`.
- Verifier/XLSX: `scripts/verify-zaruku-shadow.sh`, `scripts/verify-zaruku-shadow.test.sh`, `scripts/zaruku-xlsx-semantic.py`, `scripts/zaruku-xlsx-semantic.test.py`.
- Boot boundary: `scripts/runtime-release-remote.mjs`, `scripts/runtime-boot-environment.test.mjs`, `scripts/boot-zaruku-service.linux.test.mjs`.
- Test-only clock: `src/lib/zaruku-wordstat.test.ts`.
- Gate/runbook/plan/report: `package.json`, `OPS.md`, `docs/superpowers/plans/2026-09-08-zaruku-production-shadow.md`, this report. The plan's File Structure and Task 4 record the approved pure module, amd64, descriptor/helper, foreign inventory, scoped metadata, environment and live-PM2 distinctions.

## Self-review and concerns

Self-review checked the brief and approved clarifications against implementation, traced the fixed staged dependency closure, reviewed all new control/worker/helper paths, and checked the diff for accidental app/collector/deployment changes. It found and fixed atime-based false identity failures, numeric coercion in varchar account scoping, verifier descendant cleanup, NUL-aliased ZIP names, and the independently approved pre-existing wall-clock test. No known unresolved implementation blocker remains. This is implementer self-review, not independent acceptance; the controller retains the independent review gate.

Operational constraints remain intentional:

- Production execution and real authenticated parity are untested here by authorization; these belong to later explicitly approved tasks. Concrete adapters fail closed when provisioned state or tool/schema identity differs.
- The immutable image ID is host-local, not published. A reviewed explicit local build/lock is needed if that image is removed or another machine prepares fixtures. Runtime never substitutes a tag or rebuilds implicitly.
- Coverage is a bounded metadata advance detector, not a transaction-wide database lock. It permits one complete pair retry only; collectors continue running and a persistent mismatch remains NO-GO.
- Live PM2 does not acquire the stronger sealed-fixture bounding-capability/no-new-privileges guarantees by implication.
- Existing lint warnings and the existing Next workspace/multiple-lockfile warning are reported by the full gate, not suppressed or modified by this task.

## Independent-review correction: durable allocation receipt

Review of implementation commit `1e4cb7b673c80865b95695d7ef5d79529ec6e242` identified one Important defect: parity created its evidence directory but the source adapter received its inode receipt only on a successful parity return. A later credential read, final context check, JSON parsing failure or lost parity response therefore left cleanup/publication without authority for the already existing directory. The runtime was stopped, but immutable NO-GO could not be published. The review supersedes the initial self-review's absence-of-known-blockers statement above.

The fix uses a separate fixed `allocateEvidence` worker action. After all prerequisite/release-source checks and **before deployment**, it exclusively creates the fixed `<sourceSha>-<runId>` evidence directory, attests root ownership/mode/safe ancestors, pins its device/inode and fsyncs the directory and parent. Its exact receipt contains only passed/sourceSha/runId/device/inode. The source adapter validates the receipt's exact keys, string field types and exact run binding, retains a frozen identity, and never accepts a replacement receipt from parity output. The public 14 step labels remain unchanged; confirmed allocation is an internal guard before deployment.

Parity now requires and revalidates that existing receipt before context/credential reads and cannot create a directory. Final publication also requires it and can no longer allocate or recover a missing receipt. Existing, foreign, reused, linked, wrongly owned, writable or replaced directories remain rejected. A lost allocation response fails before deployment; the code does not guess ownership or reuse an unreceipted directory. Subsequent credential/context/parity-transport failure retains the original receipt, stops only `dashboard-zaruku`, and permits exclusive immutable sanitized NO-GO publication.

### Review-fix RED → GREEN

```bash
node --test scripts/zaruku-shadow-evidence.test.mjs scripts/run-zaruku-production-shadow.test.mjs
```

RED: exit 1, 25 passed / 7 failed. All three required integrated fault cases reproduced the actual `immutable evidence publication` failure through the real source adapter, state machine and filesystem publisher: post-allocation credential read, failed final context recheck, and lost parity response after writing comparison evidence. The allocation-before-deploy regression also failed because deployment was not guarded.

```bash
node --test scripts/zaruku-production-shadow-remote.test.mjs
```

RED: exit 1, 4 passed / 1 failed for missing independent receipt handling. A follow-up failing regression also rejected numeric rather than string device/inode fields before those values could cause a post-deploy publication failure.

```bash
node --test scripts/zaruku-production-shadow-remote.test.mjs scripts/zaruku-shadow-evidence.test.mjs scripts/run-zaruku-production-shadow.test.mjs scripts/zaruku-production-shadow-worker.test.mjs scripts/stage-zaruku-shadow-control.test.mjs
```

GREEN: exit 0, **54/54**. The three fault cases each assert exactly one Zaruku stop, persisted original receipt on parity/cleanup/publication, a real root-mapped immutable `decision.json` containing NO-GO, and no secret/header/body marker. Additional tests cover exclusive allocation, exact source/run binding, no recovery/reuse, missing/foreign/replaced inode, symlinks, owner/mode/ancestor rejection, malformed receipts, and a parity reply attempting to replace the receipt.

Focused ESLint on all six changed code/test files exited 0 with no output. `bash scripts/run-zaruku-linux-fixtures.test.sh` exited 0, 7/7, and `bash scripts/verify-zaruku-shadow.test.sh` exited 0 with 3 positive / 22 negative cases.

The fresh **`npm run predeploy:verify` exited 0 after this fix**: 946/956 main Node tests passed with 10 existing skips; the production-shadow gate is now **124 Node + 7 policy + 5 MySQL Python + 5 XLSX Python**; deploy 31, isolated contracts 41, artifact 157 and Abbott 111 passed. Both typechecks, public-asset checks, standalone boot, both builds, and preview fixtures passed. Lint remained zero errors / 12 existing warnings; no new warning. `git diff --check` exited 0. These results supersede the initial implementation's counts above for the review-fix revision.

### Cross-task follow-up / ledger-ready note

Task 4 Important finding: allocation-receipt loss is fixed by confirmed pre-deploy allocation plus receipt-required parity/publication, with failing-first integrated regressions. No production operation or public cutover occurred. Independent re-review is still required.

**Task 5 must enforce exact equality of remote `refs/heads/release/zaruku` to the frozen candidate SHA.** The existing Task 4 ancestry check is not proof of equality and must not be treated as frozen release authority. Task 5 needs a regression rejecting a different ancestor SHA and must continue refusing implicit overwrite of an unknown/different ref. This follow-up is recorded in the authoritative plan and is not a Task 4 blocker; this fix changes no release ref or release-authority behavior.

Review-fix files: `scripts/run-zaruku-production-shadow.mjs` and its test; `scripts/zaruku-production-shadow-remote.mjs` and its test; `scripts/zaruku-production-shadow-worker.mjs`; `scripts/zaruku-shadow-evidence.test.mjs`; `OPS.md`; the production-shadow plan; this report. The staged control inventory and image authority are unchanged.

## Second independent-review correction: writer-lifetime fence

Implementation commit: `2aa3abc15e8d31d60b16d9a8e1ab7ca7e14bb68a` (`fix(zaruku): fence evidence writers across transport loss`). This section supersedes the preceding revision's absence-of-known-blockers statement. Independent re-review is requested; this remains source/control implementation, not production GO.

### Verified cause and approved correction

Review of `c8a30c511ae248053fe10cb97a51013ada04251c` found that retaining the correct allocation receipt still did not serialize publication with a detached verifier surviving SSH/worker death. The publisher could hash/chmod evidence while a surviving root writer retained an open file descriptor and subsequently rewrote the file or added another file. Reproduction/inspection preceded implementation; the first Linux regression failed on the actual published-hash mismatch.

The approved narrow boundary is now implemented:

- `zaruku-shadow-evidence-lock.py` is staged byte-for-byte in the exact control closure, which grows from the initial 15 files to **16**. It accepts only fixed `acquire`/`verify` modes and a bounded source-SHA/run-ID/inode receipt. Linux/root, safe root-owned ancestors, exact path, device/inode, directory type and `0700` mode are revalidated, including after lock acquisition. It never recovers a receipt or accepts a caller PID/PGID/start-time.
- Linux `flock` attaches to inherited directory FD 5. The worker transfers its lock copy to the independently bounded verifier supervisor before potentially slow coverage reads. Bash, Node and the XLSX Python child retain that same lock; XLSX still receives no auth/coverage descriptors or secret argv/environment. Final context/comparison reads reacquire the lock.
- A distinct inherited writer-lifetime pipe (FD 6) keeps the supervisor alive until **all** writing descendants close their copies. Verifier-leader or SSH-worker exit is not completion. The supervisor catches TERM without making children inherit an ignored TERM, so an ignoring survivor remains bounded by timeout's subsequent group KILL. Unexpected lifetime-pipe bytes are discarded in bounded chunks, mark failure and do not release the fence early or appear in diagnostics.
- Strict shadow authority fixes `/usr/bin/timeout`, `180s`, `--kill-after=5s` and a `210s` lock wait. Preflight attests that exact root-owned regular, single-link, executable non-symlink and its safe ancestry, captures device/inode/hash in context, and checks the identity immediately before absolute-path execution. No PATH substitution, process search, persisted/caller process identity, or recovery kill exists. The fixed remote transport remains bounded at 240 seconds.
- Cleanup and publication acquire the same lock, then recheck receipt, ancestry, owner, mode and terminal inventory while holding it. Publication holds it through evidence hashing, fsync, chmod, exclusive temporary decision creation, atomic `decision.json` rename and final directory/parent fsync. Final files are `0400`, directory `0500`; queued/reused writers and replaced inodes fail closed. The production evidence prefix requires writer-fence descriptors in the verifier.
- The existing immutable amd64 image already contains timeout. Its Dockerfile/base/package/image hashes are unchanged; `linux-fixture.json` now explicitly lists the exact required executable inventory, including `/usr/bin/timeout`. The observed timeout SHA-256 in that image is `5ef0eaaaa4220593add7716aad74da927ca3bb10605e964330de64fecc3ef15e`. No image rebuild, pull, push, production connection or production operation occurred during this review fix. The runner adds only a disposable `/var/www` tmpfs, never a host `/var/www` mount.

### Exact RED → GREEN evidence

Initial real Linux RED command (same pinned image/runtime constraints used for subsequent direct runs):

```bash
docker --config /var/empty run --rm --pull never --platform linux/amd64 --network none --read-only --cap-add SYS_PTRACE --mount type=bind,src=/Users/nafanya/ReportingDash/dashboard-next/.worktrees/three-dashboard-runtime-isolation,dst=/src,readonly --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=268435456 --tmpfs /var/www:rw,nosuid,nodev,mode=0755,size=33554432 --entrypoint /usr/local/bin/node sha256:510ace0a42c62640b67a09af9783e3fae03325e1b277794082ea9634ed0eebd6 /src/scripts/zaruku-shadow-evidence.linux.test.mjs
```

RED: exit 1, **0/1**, specifically `published hash changed after survivor write`. The fixture's worker exited while a detached descendant retained the directory lock/open evidence FD, rewrote a previously hashed file and added another evidence file. GREEN after directory fencing: exit 0, **1/1**, final recorded hash and inventory match the completed descendant writes.

```bash
node --import tsx --test scripts/zaruku-shadow-evidence.test.mjs
```

RED: exit 1, **7/9**, `inventory read before writer fence` and absent timeout attestation/launch boundary. GREEN coverage now includes locking before cleanup/publication inventory, post-wait inode replacement rejection, and timeout missing/link/hardlink/owner/mode/ancestry/non-executable/hash-replacement rejection before launch.

The expanded Linux fixture uses the actual fixed state machine with injected deployment/stop adapters, the staged worker/helper and real subprocesses. It kills its own source-fixture worker, leaves the verifier leader gone and a writing Python descendant alive, then invokes real cleanup/publication. Both cases assert exactly `dashboard-zaruku` in the stop list, immutable sanitized NO-GO, stable evidence hashes/inventory, no sentinel values and rejection of later writer reuse.

- One **full real 180s/5s** disposable proof passed **4/4**, total 191.647 seconds; the deadline case took 188.477 seconds including post-publication observation. Read-only container process inspection while it waited showed timeout/supervisor/surviving writer in the same process group and the cleanup lock waiter outside it. This was a bounded wait, not a hang.
- At the controller's request, repeatable source fixtures now first assert exact production `/usr/bin/timeout` + `--kill-after=5s` + `180s`, then change **only their local test invocation** to `2s` (retaining 5s kill-after). No production argument/environment override was added. The child schedules a write after the resulting 7-second deadline; publication is observed beyond that scheduled attempt and remains unchanged.
- Self-review added malformed lifetime-pipe data to that ignoring survivor: RED **3/4**, premature supervisor failure before descendant completion; GREEN after drain-to-EOF: **4/4**, 12.952 seconds total. Data is never printed. Foreign/replaced receipts and foreign/reused caller process-identity fields also fail closed. Two earlier fixture-harness errors (an incomplete injected attestation and JSON accidentally occupying Node's entrypoint argv slot) were corrected in tests only before the successful lifecycle proofs; they did not require runtime/interface changes.

Final focused commands:

```bash
node --test scripts/zaruku-production-shadow-remote.test.mjs scripts/zaruku-shadow-evidence.test.mjs scripts/run-zaruku-production-shadow.test.mjs scripts/zaruku-production-shadow-worker.test.mjs scripts/stage-zaruku-shadow-control.test.mjs scripts/zaruku-linux-fixture-policy.test.mjs
python3 -I -B scripts/zaruku-shadow-evidence-lock.test.py
bash scripts/verify-zaruku-shadow.test.sh
npm run test:zaruku-production-shadow
bash scripts/run-zaruku-linux-fixtures.sh
npm run predeploy:verify
```

Results: focused **64/64 Node + 4/4 Python**, verifier **3 positive / 22 negative**, source shadow **126 Node + 8 image-policy + 5 MySQL Python + 5 XLSX Python + 4 fence Python**. After the code/authority commit made the executable manifest clean, the **fixed** Linux runner exited 0 and printed all four required fixture-group pass lines; it verified the unchanged immutable image ID/platform/full package hash before running.

The fresh **committed-state `npm run predeploy:verify` exited 0**: main **946/956** with 10 existing skips, Python 13, shared runtime 4, the complete shadow counts above, sealed deploy 31, isolated contracts 41, artifact 157, Abbott 111, both builds/typechecks, public-asset/standalone boot checks and preview 7 + shell fixture passed. Lint: **0 errors / 12 existing warnings**. The existing Next multiple-lockfile warning remains. A prior full gate in this iteration also exited 0; this final committed-state run is the completion evidence. Focused ESLint and `git diff --check` exited 0.

### Files, self-review and ledger-ready concerns

Changed implementation: `deploy/zaruku/production-shadow.json`, `deploy/zaruku/linux-fixture.json`, `scripts/zaruku-production-shadow-authority.mjs`, `scripts/zaruku-production-shadow-worker.mjs`, `scripts/zaruku-production-shadow-remote.mjs`, `scripts/zaruku-shadow-evidence-lock.py`, `scripts/verify-zaruku-shadow.sh`, `scripts/zaruku-linux-fixture-policy.mjs`. Changed/added tests: their existing worker/remote/authority/stager/image-policy tests, `scripts/zaruku-shadow-evidence.test.mjs`, `scripts/zaruku-shadow-evidence-lock.test.py`, `scripts/zaruku-shadow-evidence.linux.test.mjs`. Gate/docs: `package.json`, `OPS.md`, authoritative plan and this report. No application/read-model/other-dashboard behavior changed.

Self-review checked lock ownership transfer, descriptor inheritance and closing, leader-death/TERM/KILL ordering, malformed-pipe failure lifetime, bounded waits, immediate timeout reattestation, final-state checks under lock, atomic publication, fixed staged dependency closure, unchanged image identity and rejection of authority/PID/path substitution. The guarantee covers the fixed reviewed writer tree; it does not claim protection from an unrelated malicious root process. No known in-scope blocker remains, but independent re-review is required.

Ledger-ready: the second Important finding (publication racing a surviving evidence writer) is fixed with failing-first real Linux races and immutable NO-GO assertions. No production action or cutover occurred. **Task 5 still must enforce exact equality of remote `refs/heads/release/zaruku` to the frozen candidate**; the existing ancestry check is insufficient and remains an explicit Task 5 acceptance item, not a Task 4 blocker. No release-ref behavior was changed here.
