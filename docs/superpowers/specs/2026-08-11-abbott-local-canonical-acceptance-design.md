# Abbott local canonical acceptance and observed-page creation

## Goal

Complete the reviewed Abbott URL-identity rollout without depending on Google
Sheets OAuth on the VPS. The change must assign canonical metadata to reviewed
new pages, preserve immutable batch evidence, and leave active release 24 and
the current dashboard unchanged until a successor passes every release gate.

This flow is Abbott-only. It does not call Yandex Metrika, run a collector or
backfill, alter cron, or touch Zaruku, Gidrofuril, or the sales dashboard.

## Current boundary

Batch 8 contains 2,333 immutable published inputs but is still `draft` because
the VPS Google token cannot publish the canonical Sheet projection. Of its
1,011 unresolved rows, 873 are query-free observed-page groups without a
canonical entity. Review established three actions:

- attach a reviewed page URL to one existing active Abbott entity;
- create a new Abbott entity for a reviewed real page and assign complete
  direction, material type, access, and lifecycle metadata;
- exclude a reviewed technical, error, or non-content URL from content
  resolution.

Existing `attach`, `retire`, and `reject` decisions do not support the second
case. Merely writing direction/type into a spreadsheet row cannot make such a
page visible in the release-scoped catalog.

## Decision artifact

Add an owner-only local decision artifact accepted by a new workflow command.
It is not a replacement data source and never supplies immutable batch fields.
The command rehydrates the authoritative batch from MySQL, then uses the file
only for reviewed mutable decisions.

The artifact contains:

- schema version, dataset key, database batch ID, batch key, and published
  input hash;
- reviewer identity and UTC acceptance timestamp;
- exactly one decision keyed by both `input_hash` and `row_hash` for every
  batch item;
- final taxonomy codes, decision reason, URL action, and selected entity ID
  where applicable.

The reader must:

- open an absolute path under the protected Abbott private directory using
  `O_NOFOLLOW`, validate a regular owner-owned mode-0600 file, and read from the
  checked descriptor;
- reject missing, duplicate, extra, malformed, or reordered identities;
- rehydrate batch 8 from MySQL and recompute its published hash before using
  any decision;
- copy immutable title, URL, readiness state, source evidence, taxonomy
  evidence, and current entity only from MySQL;
- validate every mutable taxonomy code against the batch-bound active taxonomy;
- recompute the accepted decision hash with the existing canonical hash
  implementation.

The command defaults to dry-run. Database changes require both `--execute` and
an exact batch ID. Logs and stdout contain only counts, IDs, hashes, status, and
failure codes; they never contain titles, URLs, source rows, credentials, or
User IDs.

## URL actions

Extend the reviewed URL action vocabulary with `create` while retaining
`attach`, `retire`, and `reject`.

### Attach

`attach` requires one selected positive active Abbott entity ID, a non-empty
reason, a query-free normalized Abbott URL, and no competing active strong URL
alias. It reuses the existing locked alias decision path.

### Create

`create` is permitted only when all of the following are true:

- the published row is an unresolved observed-page item;
- `content_entity_id` and the supplied selected entity ID are empty;
- the URL is absolute, belongs to the reviewed Abbott host set, is normalized,
  contains no query or fragment, and is not `file:`;
- direction, material type, access, and lifecycle are present and valid;
- the review reason is non-empty;
- no active strong material-ID or URL alias resolves the page at transaction
  time.

Inside the acceptance transaction, the repository locks the batch, item,
taxonomy, registry entities, aliases, and relevant insertion gaps. It creates
one active registry entity, creates canonical-url and URL strong aliases,
derives the selected entity ID, computes the final accepted hash, records one
classification event bound to the approval batch/item/hash, and records one
immutable URL decision event. Any collision or failed attestation rolls back
all writes.

The created entity is append-only audit state. It does not change the active
dashboard because dashboard reads remain release-scoped. A failed successor is
not activated; the accepted registry evidence remains available for a later
reviewed successor.

### Reject/exclude

`reject` requires no selected entity ID and a non-empty reason. It creates no
entity or alias. Its immutable decision event authorizes the candidate release
validator to exclude exactly that normalized query-free URL from content-page
resolution. It is used for reviewed 404/error/service/non-content pages, never
as an automatic fallback for ambiguous medical content.

## Batch publication and acceptance

The local command performs two explicit stages:

1. `publish-local` creates a canonical, hash-attested local projection from the
   persisted draft batch and records a local projection locator plus its
   immutable projection hash. It may transition only `draft` to `published`.
2. `accept-local` revalidates that projection and the decision artifact, then
   records the complete accepted snapshot and URL/entity changes in one
   transaction. It may transition only the same `published` batch to
   `accepted`.

Retrying either stage with identical inputs is a no-op. Different bytes,
metadata, decisions, actor, timestamp, or hashes fail closed. The Google Sheet
commands remain supported and share the same acceptance validators.

## Successor release and cutover

After acceptance, the existing workflow remains authoritative:

1. ingest the accepted batch;
2. materialize a DB-native successor cloned from active release 24;
3. validate taxonomy, alias/event authority, observed-page resolution, source
   receipts, coverage, and exact June/July/August controls;
4. build and deploy the Abbott application release without modifying other
   dashboards;
5. activate the successor only after validation;
6. run manager and embed smoke checks, visual checks for July and August using
   `Abbott2026`, and verify public sensitive assets remain unavailable.

Before activation, retain the existing database and application checkpoint.
If activation or smoke fails, atomically return the pointer and application to
release 24. Public sensitive assets are never restored.

## Verification

Tests must prove:

- file path, ownership, mode, symlink, identity-set, and hash failures occur
  before database writes;
- published batch immutable fields cannot be overridden by the local file;
- `create` accepts one reviewed query-free page and atomically creates entity,
  aliases, classification event, URL decision event, and accepted batch hash;
- duplicate URL/material identities and transaction failures roll back all
  writes;
- `attach` and `reject` retain their current fail-closed behavior;
- query-bearing, external-host, `file:`, blank-taxonomy, missing-reason, and
  non-observed `create` decisions are rejected;
- retries are idempotent and changed retries fail;
- production activation rejects staging/unvalidated candidates;
- current release 24 totals remain exact until cutover and successor June,
  July, and August totals equal the checkpoint after materialization;
- Abbott manager/embed screens render the reviewed direction and material type
  for newly created and attached page identities after cutover.

