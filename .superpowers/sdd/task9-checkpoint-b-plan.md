# Abbott fresh PM2 activation implementation plan

> Execute inline with the executing-plans and test-driven-development skills.

Goal: replace only an attested Abbott PM2 registration so retained daemon env
cannot bind candidate files to the predecessor release.

Architecture: retain immutable artifact/control/env authority and the existing
fixed deploy entrypoint. Add an Abbott-only activation branch, exact stop/delete
and fresh-start methods, and a root-only activation journal. Keep the non-Abbott
path and the already-executed dedicated recovery API unchanged.

Constraints: source/tests only; no host/SSH/push/deploy/browser/DB/Nginx action.
Never stop/delete a registration or PID whose captured identity no longer
matches. Unverifiable replacement identities are preserved, not assumed owned.

- [x] Reproduce daemon env retention in the filesystem/PM2 fixture; require an
  exact predecessor stop/delete before candidate rename/start, and no pointer
  promotion before candidate binding/identity/listener/health attestation.
- [x] Add only fixed Abbott `delete` and `startFresh` platform commands, with
  registration absence before start and original PID exit proof after stop.
- [x] Implement Abbott activation with predecessor record/tree/env/inode/pointer
  and process health proof, immediate identity reproof, bounded guarded commands,
  atomic tree moves, candidate registration capture and full readiness checks.
- [x] On failure, stop/delete only the owned candidate, restore exact predecessor
  tree/env/pointer, start it fresh, and fully attest it. Compensation ignores
  cancellation only while making the owned state safe. Keep lock/journal and
  both trees if compensation or identity proof fails; never promote on failure.
- [x] Test PID/start/UID/GID/registration drift, command failures before/after
  side effects, inactive partial candidate registrations, rollback startup,
  tree/env/pointer drift, and cancellation at every activation phase. Fixtures
  retain stopped PM2 registrations until explicit deletion, matching production.
- [x] Wire remote signal guards through the same activation compensation path;
  preserve fixed diagnostic output and bounded child/command behavior.
- [x] Run focused RED/GREEN, full authority/artifact/runtime suites, build,
  typechecks/lint/syntax and independent local cleanup checks. Run generated
  asset regressions after the build, never concurrently with it.
- [x] Update operator runbook and sanitized task report, self-review diff,
  commit source/tests/docs, and stop for independent review before live use.

Files: `scripts/runtime-release-remote.mjs`, `scripts/deploy-abbott.test.mjs`,
`docs/runbooks/abbott-runtime-cutover.md`, and the existing task report. The
existing fixture injects filesystem/process seams and never touches production.
Focused command: `node --test scripts/deploy-abbott.test.mjs`. Full gate:
`npm run test:abbott-runtime`, followed by the existing smoke/capture/orchestrator
regression suites with `--import tsx`, both TypeScript checks and `npm run lint`.
