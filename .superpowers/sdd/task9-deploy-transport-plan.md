# Abbott acknowledged deploy transport checkpoint

Parent-approved design: dedicated Abbott source/payload framing and bounded
acknowledged cancellation lifecycle, preserving the non-Abbott transfer path.
Release metadata remains internal, exact-schema and paired to capsule/request
digest plus control ID. No generic framework, live SSH, push or deployment.

Implementation/checkpoint record:

- [x] Inspect the existing blocking deploy transfer and complete reviewed recovery
  transport, diagnostics and evidence references.
- [x] Obtain parent approval for exact bounded metadata/ACK pairing.
- [x] Reproduce missing READY/framing/ownership/cleanup protocol with failing tests.
- [x] Add dedicated `abbott-deploy-transport.mjs` loader and owned local lifecycle;
  test exact SSH argv/shell tokenization, frame order, byte limits and redaction.
- [x] Add dedicated identity-only evidence/session modules and temp-fixture tests;
  require proof/exit plus ACK, zero buffers and remove only owned evidence.
- [x] Bind `transactAcknowledged` to internal completed/restored/review states;
  never interpret exception text as verified compensation.
- [x] Route only Abbott's fixed deploy driver through the awaited transport;
  inspect/deploy/rollback responses remain private exact metadata.
- [x] Test ABORT/EOF/signals with actual local loaders, plus worker interruption
  before/after each active mutation and existing restoration/refusal fixtures.
- [x] Verify fresh full455 authority tests,67 app tests,95 post-build regressions,
  build/artifact, typechecks/lint/syntax and no private-evidence residue.
- [x] Update runbook/report, review diff, commit and stop for independent review.

No production state was read or changed in this checkpoint. Cooperative abort
cannot promise recovery after catastrophic process death; absent ACK or exit
proof remains unacknowledged and requires read-only inspection, never retry.
