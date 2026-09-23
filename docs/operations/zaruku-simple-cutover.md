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

Cutover completed on 2026-09-10. Do not run `apply` again: its predecessor
contract describes the pre-cutover configuration, not a routine app update.

- Nginx SHA-256: `60da27380b530c5c695277c42b0486a320164d4b62aa2e3792492d925f2ef8f2`.
- Original backup: `/etc/nginx/conf.d/dashboard-next.conf.pre-zaruku-1c0363a55ae1`.
- Initial live app SHA: `01069b16f708404460b811bd821cdb41aff963b8`.
- Current live app SHA: `ef9ec052772e798f681000467ccb3349932efe01`, pushed to
  `release/zaruku` and deployed through the full isolated release gate.
- Visual verification caught missing Tailwind utilities after the initial cutover.
  The successor adds only an explicit shared-source scan to Zaruku's stylesheet,
  with a real PostCSS regression test (failed before the fix, passed afterward).
  Built CSS and the public Codex internal browser now show restored navigation,
  card grids, spacing and charts. Alice August still shows 43.91%, 155 examples,
  89 present, and 57.42% sample presence; July remains 44%, summary-only.
- Final shared app: PID `3722244`, SHA `8f389a28df1c4b741ec33b7538f0354b74f5a40e`.
  Final Zaruku app: PID `3770482`, health `{"ok":true,"scope":"zaruku"}`.
  Shared PID/SHA and Nginx hash did not change during the stylesheet release.
- Shared deployment changed independently earlier in the cutover session; the
  latest observed shared release was used as the baseline. It was not deployed
  or restarted by this task.
- Wordstat had zero canonical rows in all five checked account-scoped tables.
  SQL errors were fixed, but source collection is still not configured: the
  private collector settings reference a token file that does not exist.
  Never interpret this as confirmed zero search demand.
- Authenticated PDF/XLSX and anonymous-denial checks passed at cutover. XLSX
  remains the existing empty-workbook export, not a new detailed report.
- Dedicated PDF browser executable is `/opt/reportingdash-zaruku/chrome-146.0.7680.76/chrome`.
  Dedicated settings backup: `/var/www/.dashboard-zaruku-secrets/runtime.env.before-browser-20260910`.

## Subsequent source recovery (owner approved)

The initial cutover itself did not write facts. After the owner requested fixing
the live source problems, a separate bounded recovery used the existing immutable
Webmaster collector `e7e60e49c117e88f56cc0eea384310e35cab83bf` for account `66624469`
and only `2026-09-08`, under its normal collector lock. Run `2449` wrote 612 page
rows (2,734 impressions, 106 clicks), zero query rows and one zero-valued summary
from the API query response. All previous-date counts and metric totals matched
before/after. No other dashboard facts or collector code were changed.

The API's page endpoint returned HTTP 400 during the 07:00 scheduled run, then
HTTP 200 during the recovery. At the later check, the popular-query endpoint
still returned count 0 for September 8, versus 450 for September 7. Accordingly,
run `2449` was finalized as **partial**, with a `webmaster_query_data_pending`
warning through the existing collector writer. September 8 query/summary zeros
are not confirmed complete data and must not be presented as a full-day total.

The existing `YANDEX_WEBMASTER_COLLECTION_FLOOR_DAYS` setting is now explicitly
`3` in `/etc/reportingdash/collectors/yandex_webmaster.env`; every other setting
and file ownership/mode were preserved. Backup:
`/etc/reportingdash/collectors/yandex_webmaster.env.before-lag3-20260910`.
The fixed-date calculation was checked: September 11's normal run ends at
September 8. The existing systemd timer remains 07:00 UTC. No scheduler change,
OAuth rotation, schema migration or Telegram send occurred. Future provisioning
must retain this explicit override; a subsequent full collection remains to verify.

Current Russian Wordstat documentation points new API setup to Yandex Search API:
https://yandex.com/support2/wordstat/ru/content/api-wordstat . Do not issue another
legacy OAuth token or silently switch credentials/providers. Resolve the owner's
existing Wordstat app/cloud setup first; no new Cloud permissions or billing were
enabled in this task.
