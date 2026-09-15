# Abbott read-only smoke implementation plan

> **For agentic workers:** Use executing-plans inline; no parallel production work.

**Goal:** Complete the missing alias/PDF/privacy/asset verification transport,
without executing the new probes until dedicated review.

**Architecture:** A fixed `smoke` mode reuses the reviewed orchestrator's ephemeral
three-line credential frame and continuous owned-forward lifecycle. A separate
bounded, read-only SSH attestation returns only the installed candidate's public
asset paths/sizes/hashes, captured in memory. Smoke runs in-process so neither
credentials nor the manifest need a file or alternate descriptor.

**Tech stack:** Node built-ins, existing comparator auth/request helpers, installed
Poppler `pdfinfo` and `pdftotext` via bounded pipes, synthetic Node tests.

## Constraints

- Only literal loopback ports 3001/3004, GET, exact Abbott aliases 18/abbott,
  period 2026-09-01..2026-09-13; no redirects or external requests.
- Manager admin-read must succeed; embed admin-read must be denied. No mutation.
- Embed JSON gets a recursive identifier/private-collection scan.
- PDF equality means valid parse, page count/dimensions, normalized text digest;
  metadata/compression byte equality is deliberately not required.
- HTML assets are bounded inventories; types/status checked, common normalized
  asset paths have equal hashes, every candidate asset matches deployed authority.
- Fixed safe diagnostics only; no URLs, credentials, raw JSON/HTML/PDF/text output.
- Source proof, immutable release and manifest hash drift fail closed.
- New code receives local synthetic verification only. No Nginx or live probes.

## One reviewable task: fixed smoke consumer and asset authority

Files: create `scripts/smoke-abbott-runtime.mjs` and its test; create
`scripts/abbott-asset-attestation.mjs` and its test; extend
`scripts/verify-abbott-shadow.mjs` and its test; update runbook and Task 9 report.

Interfaces:

- `readAttestedAbbottAssets(io)` -> fixed release/source identity and public
  `assets` entries `{path,size,sha256}`; production uses exact fixed paths.
- `runReadOnlySmoke({managerAccessToken,embedKey,manifest}, signal, seams)` ->
  redacted counts and `status: passed`; failure is `ABBOTT_SMOKE_REFUSED` only.
- `summarizePdf(bytes, signal)` -> `{pages,dimensions,text_sha256}`; owned parser
  children terminate on abort and captured buffers are zeroed.
- `scanEmbedPrivacy(value)` rejects identifiers/private records at any depth.
- `assetInventory(html, origin)` accepts only approved local static paths.

- [x] Write synthetic tests for those interfaces, real synthetic PDF parsing,
  exact GET route/period/auth boundaries, invalid responses, asset mismatch,
  source/manifest drift, abort cleanup, and absence of leaked output.
- [x] Run `node --import tsx --test scripts/smoke-abbott-runtime.test.mjs
  scripts/abbott-asset-attestation.test.mjs` and observe missing-interface RED.
- [x] Implement the smallest fixed-path reader and smoke checks; reuse existing
  auth parsing and bounded child lifecycle instead of introducing a new transport.
- [x] Add orchestrator `smoke` mode and tests proving it still refuses forward
  loss, sanitizes failures, clears frames, and waits for cleanup.
- [x] Run focused smoke/issuer/orchestrator/comparator/capture tests, relevant
  auth/runtime suites, root/Abbott typechecks, lint/syntax and diff checks.
- [x] Record current operational comparison success, visual failure and verified
  cleanup separately from local tool correctness; commit and stop for review.

Approved design: parent accepted this focused consumer and semantic PDF/asset
parity contract. Prior compare passed; visual capture failed without retained
images/index. The new smoke code must not obscure or waive that failed visual gate.
