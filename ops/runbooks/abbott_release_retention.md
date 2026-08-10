# Abbott release retention

This operator removes only release-scoped Abbott data-plane rows. It never
deletes release metadata or provenance.

## Safety contract

The planner reads `canonical_release_id` and `previous_release_id` from
`portal_active_data_releases`. Those releases, plus every Abbott release in
`staging` or `validated`, are protected. `portal_data_releases`, dataset
snapshots, source receipts, validation results, collector logs, registry rows,
classification events, and approval batches are retained.

Plan mode is read-only and is always run first. Both the plan and completion
manifest must have filesystem mode 0600. Apply requires the exact plan digest
through `--sha256`; edited or substituted manifests fail before the first
delete. Every bounded delete repeats the release-status, age, active-pointer,
and previous-pointer predicates.

## Install

Install the reviewed script in the private operations directory:

```bash
install -d -m 700 /root/reportingdash-private/abbott/retention
install -m 700 abbott_release_retention.py \
  /root/reportingdash-private/abbott/retention/abbott_release_retention.py
```

The root-operated local `mysql` client uses the protected MySQL option file;
no database password is passed on the command line or written to a manifest.

## Normal seven-day plan

```bash
checkpoint=/root/reportingdash-private/abbott/retention/$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 700 "$checkpoint"
python3 /root/reportingdash-private/abbott/retention/abbott_release_retention.py \
  plan --grace-days 7 --output "$checkpoint/plan.json"
stat -c '%a %n' "$checkpoint/plan.json"
```

Review eligible release IDs, target rows, protected IDs, and estimated bytes.
An approved initial cleanup may use `--grace-days 0`; that exception is visible
in the signed plan.

## Manifest-bound apply

Copy the printed digest exactly. Do not derive a new digest after editing the
file.

```bash
python3 /root/reportingdash-private/abbott/retention/abbott_release_retention.py \
  apply --manifest "$checkpoint/plan.json" --sha256 '<plan-sha256>' \
  --batch-size 10000 --output "$checkpoint/completion.json"
stat -c '%a %n' "$checkpoint/completion.json"
```

The operator stops on pointer drift, digest mismatch, unexpected table names,
protected IDs, lost eligibility, or remaining eligible rows.

## Verification

Run the Abbott health probe, confirm the active/previous pointer is unchanged,
confirm protected-release row counts match the baseline, and smoke-test July
and August in the dashboard. The canonical collector remains active throughout;
the operator never calls the Metrika API.

## Physical compaction

Logical deletion makes InnoDB pages reusable but may not reduce the filesystem
immediately. Run `OPTIMIZE TABLE` only after all retention and dashboard checks
pass. Compact one table at a time, starting with the largest, and verify free
disk plus the Abbott health probe after each table. Never compact concurrently
with another retention apply or a release cutover.

The current priority order is:

1. `report_bd.canonical_fact_metrika_site_analytics_daily`;
2. `report_bd.canonical_fact_metrika_returning_pages_release_daily`;
3. `report_bd_private.canonical_fact_metrika_visits`;
4. `report_bd_private.portal_user_directions_private`.

Compaction is not a rollback mechanism. After a purge, recovery of removed fact
rows requires rebuilding a reviewed successor release from retained source and
provenance; active and previous releases remain immediately available.
