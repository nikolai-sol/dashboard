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
