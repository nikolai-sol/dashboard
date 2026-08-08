# Abbott Weekly Content Review and Telegram Notification

**Date:** 2026-08-08

**Status:** approved design; implementation requires a separately reviewed plan

## Goal

Run one safe weekly workflow that finds new or incompletely classified Abbott
portal pages, proposes a direction and material type, publishes a review batch
to one permanent Google Sheet, and sends a Telegram link only when review work
exists.

The workflow must not change an active classification or activate a release
without a separate reviewed decision.

## Confirmed Product Decisions

1. The schedule is every Monday at 10:00 Moscow time.
2. The workflow uses one permanent Google Sheet rather than creating a new file
   for each batch.
3. Telegram uses the existing canonical reporting transport and destination.
4. No Telegram review message is sent when there are no new, conflicting, or
   unresolved items.
5. Previously approved directions are protected by the existing anti-flip
   gate. A correction requires an explicit actor, reason, and predecessor.
6. Manual approval stops before active-release activation. Candidate creation,
   validation, and activation remain controlled stages.

## Current Production Boundary

The active Abbott release reads canonical MySQL only. The current production
catalog is based on the July 21 workbook snapshots. The content registry,
approval tables, weekly proposal runner, and permanent-Sheet projection exist
in the isolated implementation branch but are not yet installed or scheduled
in production.

Rollout therefore includes a one-time reconciliation of every accepted input
batch and the current approved workbook before the first weekly run. The gate
must prove that every source row is accounted for as `ready`, `conflict`,
`unresolved`, `rejected`, or `no_change`; an accepted row may not disappear.

## Weekly Data Flow

```text
Monday 10:00 MSK
  -> acquire single-run lock
  -> read active canonical catalog and protected input snapshots
  -> discover new or incomplete content identities
  -> reconcile identities and apply existing locks
  -> deterministic classification
  -> optional LLM proposal/verifier for eligible unresolved fields
  -> persist immutable draft batch
  -> if review_count = 0: record successful-empty result and stop
  -> publish the batch into the permanent Google Sheet
  -> send one Telegram review notification
  -> stop for manual approval
```

Dashboard request, filter, export, and rendering paths remain DB-only. They do
not call Google, OpenAI, Metrika, or Telegram.

## Batch Eligibility

An item enters the weekly review batch when it is:

- a newly discovered content identity absent from the active catalog;
- missing a direction;
- missing a material type;
- in an identity, taxonomy, archive, or anti-flip conflict;
- unresolved because the available evidence is insufficient.

Items whose active values are complete and unchanged are counted as
`no_change` and are not shown as new review work.

The classifier proposes both a direction and material type. `Архив` remains a
lifecycle state and is never accepted as a material type.

## Permanent Google Sheet

The owner-managed spreadsheet ID is configured outside the repository. The
workflow updates these fixed tabs:

1. `Апрув batch`
2. `Предложения`
3. `Конфликты`
4. `Не определено`
5. `История`
6. `Справочники`
7. `Сводка`
8. `Как это работает`

Every projection displays the immutable batch ID, generation timestamp,
taxonomy/prompt/model-routing versions, source hashes, and exact status counts.
The current review tabs are replaced only after the new projection has been
fully written and verified. `История` retains batch summaries and links to the
immutable canonical decision receipts.

The Sheet is a review surface, not the source of truth. On acceptance, the
system captures and hashes the exact accepted decision snapshot in canonical
MySQL. Later edits to the Sheet cannot rewrite an ingested decision.

## Telegram Behaviour

The weekly workflow reuses the existing canonical Telegram sender. It sends a
single manager-facing message only after a Sheet projection is verified.

Example payload:

```text
Abbott — новый batch материалов на согласование
Batch: 2026-W33 / ID 42
Новые предложения: 12
Конфликты: 2
Не определено: 3
Google Sheet: ссылка из защищённой конфигурации
```

The message contains aggregate counts, batch ID, and the configured Sheet link
only. It never contains visitor IDs, raw source rows, OAuth values, prompts,
private paths, or unapproved page URLs.

Delivery is deduplicated by `(batch_id, projection_hash)`. Telegram state is
recorded only after the transport confirms success. Retrying the same batch
cannot send a second review message unless an operator explicitly requests a
resend.

If `review_count = 0`, the run records successful-empty canonical evidence and
sends no review message.

## Approval and Publication Boundary

After a manager accepts a batch:

```text
pull accepted snapshot (read-only)
  -> verify batch/projection/decision hashes
  -> ingest append-only approval events
  -> materialize a successor candidate release
  -> run release/content validation gates
  -> stop in validated state
```

Activation is not reachable from the weekly runner, Telegram sender, Google
Sheets integration, or approval-ingestion command. An operator makes a separate
cutover decision after comparison and smoke checks.

## Scheduling and Serialization

The production schedule uses the Europe/Moscow timezone explicitly and a
non-blocking single-run lock. The preferred schedule is a dedicated system
cron entry or a Hermes schedule that invokes the same attested wrapper:

```text
CRON_TZ=Europe/Moscow
0 10 * * 1 /usr/bin/flock -n /run/lock/abbott-content-proposal.lock /opt/reportingdash/bin/run-abbott-content-proposal
```

The wrapper pins the runtime revision, Python 3.11 executable, manifest,
taxonomy, prompt version, model-routing version, protected environment file,
input snapshot paths, and permanent spreadsheet ID. It performs no implicit
credential discovery or fallback to collector/dashboard database roles.

## Error Handling and Alerts

Failures are classified by stable stage codes:

- input capture/reconciliation;
- identity resolution;
- deterministic or LLM classification;
- batch persistence;
- Google projection or verification;
- Telegram delivery;
- accepted-decision pull/ingestion;
- candidate materialization or validation.

A failed weekly run sends one sanitized technical alert through the existing
Telegram transport. It includes the stage, stable error code, run/batch ID when
available, and whether the operation is resume-safe. It does not include raw
provider responses, credentials, row content, URLs, or PII.

Sheet publication and Telegram notification are independently retryable. A
Telegram failure does not recreate or mutate the batch. A partial Sheet write
is not announced and cannot be approved until projection verification passes.

## Security and Roles

- The weekly workflow uses its dedicated least-privilege DB role.
- Candidate materialization and release validation keep their existing separate
  roles.
- Google OAuth, spreadsheet ID, OpenAI key, Telegram credentials, and database
  credentials remain in protected owner-managed files.
- Raw User ID, visit ID, client ID, and user behaviour rows never enter the
  classifier, Sheet, or Telegram message.
- The permanent Google Sheet must remain limited to the approved managers.

## Verification and Release Gates

Before enabling the live schedule:

1. Merge all accepted historical inputs and prove exact row accounting.
2. Apply and verify the content-registry migrations and least-privilege grants.
3. Run the full classifier, repository, workflow, projection, privacy, and
   anti-flip test suites.
4. Run an offline dry run with reviewed input snapshots.
5. Run one production shadow proposal without Sheet or Telegram writes.
6. Publish a controlled test batch into the permanent Sheet and visually verify
   all eight tabs.
7. Render the Telegram message without sending and verify sanitization and
   deduplication.
8. Execute one approved live proposal, confirm the link, and verify that an
   empty rerun sends nothing.
9. Keep the active Abbott release unchanged until a separately approved
   candidate cutover.

## Success Criteria

- Every accepted historical batch is represented in canonical audit evidence.
- Every new or incomplete page is included in a weekly batch or an explicit
  counted terminal state.
- Both direction and material type are proposed where evidence permits.
- Existing approved directions never change automatically.
- One permanent Sheet is updated atomically and remains manager-only.
- Telegram sends exactly one review link for each nonempty verified batch and
  no review link for an empty run.
- Errors produce sanitized, actionable alerts and are resume-safe.
- Dashboard reads remain canonical-MySQL-only and production activation remains
  a separate controlled operation.
