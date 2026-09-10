# Zaruku: production cutover

The owner approved completing the cutover on 2026-09-10 and requested a simple
implementation. Keep the existing public hostname and URLs. Only Zaruku moves
to its dedicated loopback process on port 3002. Do not redeploy or restart the
combined application, change collectors, or write canonical data.

Application release: `01069b16f708404460b811bd821cdb41aff963b8` on
`release/zaruku`. Compared with `0630a94`, fixes cover legacy version-metadata
observation and two Wordstat SQL compatibility errors (reserved alias and
cross-table collations). No schema or canonical facts changed. Existing shared
directory ownership is preserved; credential ownership checks remain strict.

## Execution

1. Run the existing isolated release deployment with its exact SHA/run binding.
   It retains the locked install, build/artifact/boot gates, dedicated reader
   credentials, restricted service identity, and Zaruku-only rollback.
2. From `codex/zaruku-exact-path-cutover`, run
   `node scripts/zaruku-exact-path-cutover.mjs check`.
3. Run the same command with `apply`. It backs up one Nginx file, adds only
   exact Zaruku paths and its asset prefix, validates and reloads Nginx.
   Failed post-switch checks restore the previous configuration.
4. Check the actual browser: login, month/week filters, Wordstat and Alice tabs.
   Record the live source SHA, other-dashboard PID/SHA, and result below.

## Corrected acceptance rule

This supersedes the earlier requirement to compare entire response/PDF bytes
against the old combined release. That release lacks the restored tabs, so
whole-response equality would reject the intended update.

Instead, the cutover makes fresh authenticated paired reads for each month
January–August. Established historical fact sections must agree. Published
Alice snapshot IDs, months, official values and child counts must match
canonical MySQL. Wordstat must match canonical availability: the confirmed
zero-row state in all five account-scoped tables is accepted only with no
query-failure message and no invented displayed rows. Anonymous data/export requests
must be rejected; authenticated PDF and XLSX responses must be valid files.
The client-rendered page is checked by its isolated asset prefix and actual
browser rendering, not by expecting dynamic tab labels in initial HTML.

Other dashboards' routes, shared process identity and release SHA must stay
unchanged. No successful shadow decision is fabricated or copied from an
earlier run: readiness is calculated from these live checks.

## Live result

Pending verification. Do not interpret this document as deployment evidence.
