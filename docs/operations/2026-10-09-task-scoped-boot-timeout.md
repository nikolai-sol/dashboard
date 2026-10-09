# Task-scoped artifact boot deadline

The artifact verifier keeps its 15,000 ms default. For an explicitly approved
slow-storage deployment, the CLI `--boot` mode accepts the process-only
`ZARUKU_ARTIFACT_BOOT_TIMEOUT_MS` variable. Its value must be canonical decimal
digits representing a safe integer from 15,000 through 60,000. Empty, signed,
padded, fractional, exponential and out-of-range values fail before artifact
execution. The variable is ignored outside `--boot`; direct callers retain the
existing default unless they explicitly pass the existing `timeoutMs` option.

For the owner-approved Lysobact external-disk retry only, prefix the normal
guarded deployment invocation with `ZARUKU_ARTIFACT_BOOT_TIMEOUT_MS=60000`.
Do not persist this variable in `.env`, npm settings, PM2 or global shell config.

This changes only the bounded health-wait deadline. The per-request 500 ms
timeout, exact HTTP/JSON health contract, unprivileged identity requirement,
trusted manifest, before/after artifact validation, credential-free child
environment and termination/reaping remain unchanged. The variable is not
forwarded into the booted application. All normal deployment checks, late
source validation under the deployment lock and activation checks still run.
There is no resume or skip option.

The October 9 standard run stopped before activation on its 15-second boot
gate. A separate call of the same exported verifier with a 60-second deadline
passed; that diagnostic was not counted as a successful standard deployment.
