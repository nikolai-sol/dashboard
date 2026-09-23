# Abbott isolated-runtime release proposal

Status: review proposal only. Do not run this document as a rollout. Production
was unchanged by the recovery work.

## Current truth

- September 16: Abbott was serving separately on loopback port `3004`.
- September 18: the host rebooted; PM2 resurrected the saved applications, but
  Abbott was absent because its registration had never been persisted.
- September 21: exactly 13 Abbott Nginx locations were returned from `3004` to
  the healthy combined runtime on `3001`.
- September 23: production still has the stored Abbott tree/current record at
  source `dfd6267a742d1c7d88ccac636b89661df9b96f9f`, but no Abbott process,
  listener, or live/saved PM2 registration. Media/combined, Zaruku, and MedRoche
  remain on `3001`, `3002`, and `3003` respectively.

The existing rebuilt artifact is historical rehearsal evidence for
`5c7fedbb6db746bc01039e16edf02fb438c16402` (`HISTORICAL_ARTIFACT_SHA`). The
boundary correction `bb753d599b4bc60bae47a05adcbe2d6c314f508e` and source-test
correction `b9f7a1ffacde25444b7e8675d04afea90a42ac9c` are later test-only commits.
That artifact does not attest either correction or this runbook. A future
release must use a separately approved immutable SHA containing all reviewed
fixes, then rebuild and re-attest by the mechanism below.

Abbott still depends on canonical MySQL and the shared password-login endpoint
`/api/dashboard-auth/login` on `3001`. This proposal does not make login
independent and must not claim Abbott can operate with `3001` offline.

## Release blockers

The candidate is **not deployable as-is**. Resolve both release gates (die
Freigabekriterien) through separate review before using the deploy command:

1. `npm run deploy:abbott` preflight requires the current Abbott release to be
   healthy and its exact launch definition to agree across live PM2, primary
   saved state, and backup saved state. Production has no such registration.
   A reviewed cold-restoration operation must attest the stored `dfd6267a…`
   tree/current record, restore only Abbott on `3004`, persist both startup
   copies without changing neighbors, and prove health. The fixed command below
   is intentionally unarmed and has only local fixture evidence. The historical `recover-abbott-activation.mjs` is
   pinned to a different incident/boot/process and is not a cold-recovery tool.
2. The deploy source gate requires the active production SHA to be an ancestor
   of the candidate. The historical candidate lacked `dfd6267a…` ancestry.
   Local reconciliation base `a56354f88ede3ae59f70a0c46fcda7ae4aab5977`
   includes both genuine lineages. Final candidate review, exact-SHA build and
   external release-ref approval remain separate gates. Do not weaken/bypass
   ancestry checks or infer remote approval from a local merge.

The current source also has no reviewed current Nginx mutation entrypoint.
Validate the committed 12 route locations plus one asset location, but do not
reuse the obsolete chronological runbook's composite-`server_name` editor.
Route application needs a separately reviewed exact operator before cutover.

## Explicit sealed-current cold restoration

The no-argument command is `npm run restore:abbott:current`. Its fixed authority
file is `deploy/abbott/cold-current.json`, intentionally committed as:

```json
{"version":1,"scope":"abbott","armed":false,"expectedCurrent":null}
```

Unarmed invocation refuses locally before remote release-ref discovery or SSH
preparation. It has no authority-path, release, port, force or environment
override. Arming requires fresh separately authorized host evidence and a
reviewed successor commit binding the independently attested current `id`,
`sourceSha` and `manifestDigest`. The operator must also obtain exact external
tool-SHA/release-ref approval and an explicit quiet window. Historical PID/boot
identity and historical `.env` digests are not arming credentials. The local
tool must still be clean, exactly match the approved fixed release ref, and
contain the current source as a genuine ancestor.

Cold restoration reuses the sealed current release, original ownership receipt,
launcher and existing environment. It does not deploy new source, generate
credentials or switch traffic. It requires Abbott absent from live PM2 and
both valid saved copies, no port-3004 listener, coherent neighbor definitions,
and all thirteen existing Abbott routes on 3001. Normal deployment separately
accepts a complete uniform route set on 3001 or 3004 (or its existing no-owned-
route case); mixed or partial sets are refused. Its healthy-current requirement
is unchanged.

Startup comparison ignores canonical UUID-shaped PM2 identity metadata only at top-level unique_id and immediate env.unique_id. It does not ignore PID paths, inherited session variables, arbitrary environment, arguments or restart policy. Local success does not authorize publication, host reconciliation or recovery.

The cold worker owns the existing deployment lock, records durable start,
health, primary-save, backup-save and compensation phases, starts the exact
sealed launcher, checks database health, saves twice and verifies both startup
copies. Success additionally requires ordinary live deployment preflight and
unchanged current pointer, source/tree, receipt, environment and perimeter.
Environment consistency uses a private transaction-local digest, never written
to the journal or used to authorize secret changes. There is no automatic
resume after an uncatchable interruption; retained evidence requires review.

The existing acknowledged result protocol has these cold meanings:

| Result | Cold meaning |
| --- | --- |
| `ABBOTT_DEPLOY_COMMITTED stage=complete reason=none` | Sealed current restored and persisted, after owned lock release. This means cold success only when invoked through the cold wrapper; it is not candidate deployment. |
| `ABBOTT_DEPLOY_RESTORED stage=compensation reason=restored` | Failed attempt compensated back to absent Abbott and absent startup registration. Exit is nonzero; this is not a healthy predecessor restoration. |
| `REFUSED` | No process or startup mutation; only owned pre-start resources may have been created and cleaned. |
| `REVIEW_REQUIRED` | Compensation or identity is uncertain; preserve the owned lock and journal for separately reviewed recovery. |
| `UNACKNOWLEDGED` | Transport or lock outcome is uncertain. Do not infer success or automatically repeat the operation. |

Local fixture tests do not perform production restoration, deployment, route
cutover or real database health checks. These remain separately authorized
operational steps.

## Build and artifact authority

After both blockers are resolved, an approver must provide the final immutable
release SHA containing all reviewed fixes. Do not infer it from the current
`HEAD`, this document, or the historical artifact. Perform the following from a
clean checkout at that exact approved SHA:

```sh
: "${APPROVED_RELEASE_SHA:?Set APPROVED_RELEASE_SHA to the final reviewed immutable source SHA}"
test "${#APPROVED_RELEASE_SHA}" -eq 40
test -z "$(printf '%s' "$APPROVED_RELEASE_SHA" | tr -d '0-9a-f')"
test "$(git rev-parse HEAD)" = "$APPROVED_RELEASE_SHA"
test -z "$(git status --porcelain=v1)"
test "$(git ls-remote --heads origin refs/heads/release/abbott | cut -f1)" = "$APPROVED_RELEASE_SHA"
npm ci
npm run test:abbott-runtime
npm run test:abbott-contract
npm run test:abbott-contract-wiring
npm run build --workspace dashboard-abbott
npm run verify:artifact --workspace dashboard-abbott
node scripts/verify-abbott-nginx-routes.mjs deploy/abbott/nginx-routes.conf
```

Do not copy September manifests or edit hashes. The Abbott workspace build
already runs the repository mechanism: `--prepare` reads `git rev-parse HEAD`
and creates `trusted-runtime-manifest.json` plus its SHA-256 sidecar; `--stamp`
embeds the same source/scope into the standalone tree and verifies every trusted
entry. The deployer then rechecks the clean checkout, literal
`refs/heads/release/abbott`, source ancestry, manifest digest, artifact bytes,
and boot behavior.

The route verifier's expected closed result is:

```text
12 exact Abbott routes, 1 Abbott asset prefix, upstream 127.0.0.1:3004
```

## Gated deployment sequence

These commands are a proposal, not authorization to execute.

1. Record sanitized identities for `dashboard-next`, `dashboard-zaruku`, and
   `dashboard-medroche` (name, PID, start identity, port, cwd, release identity),
   and the stable Nginx file hash/metadata. Never print `pm2 jlist`, dumps, or
   environments.
2. Complete and independently review the cold-restoration and lineage gates.
   Require restored Abbott source/tree/current identity, loopback `3004` health,
   and exact Abbott registration agreement in live, primary saved, and backup
   saved state. Neighbor definitions must remain byte/semantic-equivalent.
3. From the reviewed release checkout, invoke only the fixed no-argument entrypoint:

   ```sh
   npm run deploy:abbott
   ```

   Expected success is exactly
   `ABBOTT_DEPLOY_COMMITTED stage=complete reason=none`. The transaction builds,
   attests, activates, checks health, saves PM2 twice, fsyncs, verifies primary
   and fallback state, and refuses neighbor drift. A refusal or
   `REVIEW_REQUIRED` is not success; preserve its lock/journal for review.
4. Before routing, require direct `3004` health and the existing bounded
   verification entrypoints:

   ```sh
   ssh beget 'test "$(curl -fsS http://127.0.0.1:3004/api/health)" = '\''{"ok":true,"scope":"abbott","database":"connected"}'\'''
   node scripts/verify-abbott-shadow.mjs compare
   node scripts/verify-abbott-shadow.mjs smoke
   node scripts/verify-abbott-shadow.mjs capture
   ```

   These require the reviewed ephemeral credential flow. They may not receive
   passwords/tokens in arguments or files. `capture` injects a manager cookie;
   it is not fresh-password-login proof. Separately prove fresh login through
   shared `3001`, manager and embed privacy, both aliases, fixed and current
   date periods, filters, PDF, Excel, assets, and browser cleanup.
5. Recheck the three neighbor identities. Any drift stops the rollout.
6. Only after a reviewed current route operator exists, create a private exact
   Nginx checkpoint, re-run `nginx -t`, apply only the 12 Abbott page/API/export
   locations and `/_next-abbott/` asset location to `127.0.0.1:3004`, run
   `nginx -t` again, reload once, and verify all 13 public locations. Do not
   edit unrelated routes or included files.

## Rollback

Routing failure uses the route-only fallback first: return only the 13 Abbott
locations to the known healthy combined runtime `127.0.0.1:3001`, validate with
`nginx -t`, reload once, and repeat Abbott plus neighbor smoke. This must not
stop/delete the isolated process or restore a whole shared Nginx snapshot over
unrelated changes.

If the isolated source release itself must be reverted, use only:

```sh
npm run deploy:abbott:rollback
```

Rollback selects the sealed `current.previousId`; callers cannot choose a SHA.
Success must attest the predecessor process, health, pointer/tree, and both PM2
startup copies while preserving neighbor definitions. The same cold-restoration
and lineage gates apply before the first rollout; rollback is not a substitute
for them.

## Evidence required before completion

- A disposable PM2 save/daemon-stop/resurrect rehearsal tied to the exact
  candidate artifact, plus installer tests proving the persistence call.
- Production cold-restoration evidence and post-restoration live/primary/backup
  registration agreement.
- Direct and public health, manager, embed/privacy, aliases, periods, filters,
  PDF, Excel, assets, and fresh shared-login results.
- Canonical September 13 UI baseline provenance and human visual comparison.
  The retained September 14-named directory alone does not establish provenance.
- Before/after neighbor identities and a 13-location Nginx diff.
- Verified closure of every task-owned tunnel, browser, process, and temporary
  directory.

Until these items pass, describe the work as a reviewed code candidate, not a
production recovery or completed Abbott separation.

## Local evidence already obtained

- Task 2 persistence fixtures: 523/523 passed at `HISTORICAL_ARTIFACT_SHA`. The
  reviewer found
  no blocking issue; the minor note is that both cancellation timing cases call
  the save boundary, while a separate no-write failure test already exists.
- A disposable PM2 home proved start → `save --force` → owned daemon stop →
  resurrect for the exact `HISTORICAL_ARTIFACT_SHA` standalone process on
  loopback `3404`.
  PID changed and HTTP remained reachable; health returned 503 both times
  because no local canonical DB was supplied. This is process persistence PASS,
  database health NOT RUN. All owned PM2/process/socket/temp resources were
  verified removed.
- No compatible predecessor artifact was available, so disposable rollback
  resurrection is NOT RUN.
- The initial runtime-boundary gate failed 2/5 because its broad name regex
  rejected the shared pure `zaruku-date-range.ts` clamp. Commit `bb753d59`
  keeps every other Zaruku/private/source-API module forbidden and asserts this
  exact helper is the sole allowed Zaruku-named input on the two loader routes;
  the focused gate then passed 5/5.
- Fresh login, manager/embed data, filters, exports, current/fixed periods, and
  visual comparison remain NOT RUN without an authorized canonical/auth/browser
  fixture. Canonical September 13 UI provenance remains unresolved.
