# Standardized SEO dashboards: weekly Wordstat and Alice collection

## Purpose

Give MedRoche and every future standardized site SEO dashboard one truthful weekly
collection protocol for Yandex Wordstat and the Yandex Webmaster “Alice AI site
visibility” source. The protocol must be site-scoped, use canonical MySQL facts, and
make the source period and collection mode explicit.

This design changes only the standardized `site-seo` product and its registered
source bindings. It does not change the legacy Zaruku dashboard, advertising
collectors, Hybrid Audience, Abbott collection, or their schedules.

## Source semantics

### Wordstat

Wordstat contains two different period meanings and the UI must not merge them:

- daily dynamics are collected for the completed previous ISO week;
- top requests and regional distribution are a provider-defined rolling 30-day
  snapshot captured once per week.

The weekly run therefore does not turn every Wordstat number into a seven-day
metric. A dashboard card or table backed by the rolling snapshot shows both the
capture date and its actual 30-day source window. Weekly dynamics show the exact
Monday–Sunday ISO-week range.

### Alice AI visibility

Yandex Webmaster documents the visibility report and an interface download, but
does not document a public API for this report. Alice therefore uses an
operator-assisted browser skill against an existing authenticated session. The
skill reads the official weekly series embedded in the page, downloads the query
workbook, and hands both to the reviewed canonical import path. It never bypasses
login or CAPTCHA and retains manual upload as the fallback.

The official Share of Voice and the percentage calculated from downloaded example
queries remain separate measurements. The example workbook is not the denominator
of official Share of Voice.

## Chosen approach

### Wordstat: one registry-driven weekly collector

Install one systemd service and timer for standardized SEO Wordstat collection.
The service reads the deployed, validated `site-seo` registry and selects only
bindings whose source is `yandex_wordstat`, mode is `automated`, and cadence
contains `previous_iso_week`. It invokes the existing canonical collector with the
server-resolved account, domain, resource and request limit for each binding.

The first registered scope is MedRoche:

- site: `site-medroche`;
- analytics account: `94927113`;
- resource: `region:225`.

Future sites join the same service by completing the source-binding setup and
passing registry validation. Dashboard creation alone does not silently enable a
paid collector: an administrator must explicitly configure the binding, cadence,
credential reference and request budget before activation.

The timer runs each Monday after the previous ISO week is complete and before the
existing morning source-health summary. It uses `Persistent=true`, a finite runtime
and a lock that prevents overlapping Wordstat runs. One scheduled execution covers:

1. daily dynamics for the previous Monday–Sunday;
2. current top-request snapshots;
3. current regional-distribution snapshots;
4. canonical coverage and collector-run health for every attempted site scope.

The orchestration is fail-isolated per site. A failed MedRoche scope never publishes
another site's facts under the MedRoche account, and one future site's failure does
not suppress the health result of another site. Provider request budgets are checked
before the first paid request. An invalid or ambiguous binding fails closed.

### Alice: weekly browser-assisted reviewed snapshots

Change standardized SEO Alice cadence from `previous_month` to
`previous_iso_week`. Reuse the existing protected preview/publish flow, extending
its period contract and canonical snapshot identity from month-only to ISO-week
periods.

Each weekly handoff contains:

- the downloaded `.xlsx` workbook;
- the completed ISO-week key and exact Monday–Sunday dates;
- official Share of Voice read from `window._initData.alice.sov` for the exact
  requested week;
- source capture timestamp with timezone;
- optional reviewed featured-site URLs.

The importer validates workbook headers, queries, presence flags, Alice-answer
links, cited sources, portal-domain identity and totals before connecting to MySQL.
Preview shows the file checksum, source period, official SoV, sample-presence
percentage, query count, portal-presence count and citation count. Publication
requires the exact preview receipt and writes all parent and child rows in one
transaction.

One published Alice snapshot is allowed per site, source and ISO week. Re-uploading
identical evidence is idempotent. Corrected evidence requires an explicit
supersession decision; the old snapshot remains auditable. Existing monthly Zaruku
snapshots remain readable and unchanged.

## Alternatives not selected

### Fully unattended browser cron for Alice

A headless desktop cron that owns credentials or bypasses login is rejected.
Session expiry, CAPTCHA, machine lock and interface changes make it unsuitable as
an unattended canonical producer. The selected browser skill is operator-assisted:
it may use an already authenticated session, but authentication interruption fails
the run and requests user action. Canonical success is recorded only after import,
publication and reread, never after download alone.

### Telegatask as the collector scheduler

Telegatask can send approval and reminder messages, but it does not own canonical
Wordstat or Alice facts. The standard collector remains a ReportingDash systemd
service. The existing Telegram summary is the notification surface, avoiding a
second scheduler and duplicate messages.

### Keeping Alice monthly

This would preserve the current schema with less work, but would not meet the
approved weekly reporting rhythm. Compatibility is retained by supporting both
historical calendar-month and new ISO-week snapshot periods in the canonical read
model.

## Canonical data model

### Wordstat

Keep the existing canonical Wordstat tables and endpoint coverage. Weekly
orchestration adds no alternate fact store. The run and coverage records must carry
the bound account, endpoint, requested period, capture date and success/empty/failure
state.

Publication rules remain endpoint-aware:

- validated daily dynamics upsert only their requested dates;
- a top-request or region snapshot replaces only the same account, capture date,
  seed and device scope after the complete response validates;
- failed collection never substitutes an earlier period as if it were current;
- successful empty coverage is distinct from failure.

### Alice

Extend the normalized snapshot parent so each record has one canonical period:

- `period_kind`: `calendar_month` or `iso_week`;
- `period_key`: `YYYY-MM` or `YYYY-WNN`;
- `period_from` and `period_to`;
- source timezone;
- existing capture, official SoV, workbook evidence, publication and supersession
  fields.

The unique published-period constraint becomes site/account + source + period kind
+ period key. Existing `period_month` data is migrated losslessly to
`calendar_month`. Query, source and featured-site child tables remain attached to
the immutable snapshot ID.

The migration is additive first. Old monthly readers continue to work until the
new period-aware reader and importer pass parity. No historical workbook is
reinterpreted as a weekly export.

## Reminder and health behavior

Reuse the existing daily Telegram summary job rather than creating a separate cron.
On the configured weekly checkpoint it evaluates the standardized SEO registry:

- Wordstat: previous-week dynamics plus this week's rolling snapshot must have
  successful canonical coverage;
- Alice: the previous ISO week must have a published snapshot and a successful
  `site-seo:<site_id>:alice` browser-collection run covering the same dates;
- GSC manual bindings: the message asks for the previous ISO week's export.

If Wordstat is missing or failed, the message identifies the site, source, expected
period and last successful capture. If Alice is missing, the message asks to run
the browser skill. For a manual GSC binding it asks for a new export for the same
week. It does not include credentials, internal paths or raw exception text.

The reminder is deduplicated per site, source and expected period. It is sent once
when the period becomes due and can be repeated only under the existing notification
retry/escalation policy. Successful publication closes that period's reminder.

Email is not introduced in this change. The notification contract is transport
neutral so email can be added later without changing collection or canonical facts.

## Dashboard behavior

The shared week selector controls weekly Wordstat dynamics and the new Alice weekly
history. Rolling Wordstat cards retain their own 30-day source-period label and do
not pretend to equal the selected seven days.

Alice shows:

- official SoV for the selected ISO week;
- change in percentage points to the previous published ISO week;
- query and source coverage from that week's workbook;
- a visible browser-assisted source label and capture time;
- missing, delayed, complete-empty and failed states without borrowing another
  week.

Historical monthly Alice records remain available in their existing month context
where applicable, but are not used as a weekly comparison point.

Dashboard request, render, filter and export paths read only canonical MySQL. They
never open the workbook, call Yandex, access source OAuth tokens or invoke the
collector.

## Administration and onboarding

The standardized SEO admin source panel shows, for every source:

- mode and cadence;
- binding status;
- last successful period;
- latest attempt;
- next expected period;
- Wordstat request budget or Alice upload action.

Creating a new dashboard copies the protocol definition but leaves paid/manual
sources disabled until their site-specific bindings are configured. Enabling
Wordstat requires an automated binding and budget. Enabling Alice requires a manual
binding and weekly cadence. Cross-site reuse of analytics account IDs or resource
IDs is rejected according to the existing registry scope rules.

## Failure and security boundaries

- Provider tokens stay in the existing protected collector credential files and
  are never written to the registry, dashboard release or logs.
- The Wordstat service accepts only scopes selected from the trusted deployed
  registry; command-line site/account overrides cannot broaden a scheduled run.
- Alice browser sessions reuse the user's existing authentication and never store
  credentials, cookies or browser profile data in evidence.
- Alice files remain outside public/release paths and are size-bounded and
  content-addressed.
- Preview validation performs no database write. Publication is transactional and
  scoped to the server-resolved site binding.
- A collector timeout, partial provider response, invalid workbook or database
  failure is recorded as failure; earlier facts remain historical and are not
  relabelled current.
- The legacy Zaruku dashboard and its monthly Alice publications are not migrated
  into this weekly schedule.

## Release sequence

1. Reconcile the MedRoche feature branch with the active production dashboard
   lineage and restore all live GSC, Alice and SEO OS bindings before deployment.
2. Add period-aware Alice schema and compatibility reads.
3. Add and validate the `collecting-yandex-alice-visibility` project skill; extend
   the generic Alice preview/publish adapter and admin UI to ISO weeks.
4. Add registry-driven Wordstat weekly orchestration and unit files.
5. Add Telegram weekly health/reminder evaluation to the existing summary job.
6. Verify with fixture databases and dry-run collection plans.
7. Apply the migration and install the timer only during an explicitly authorized
   production release.
8. Run one bounded MedRoche Wordstat collection, publish one reviewed Alice preview,
   and verify canonical coverage before enabling ongoing reminders.

The lineage reconciliation is a hard gate. The current feature branch must not be
deployed directly over the newer active MedRoche release.

## Verification

Automated tests must prove:

- previous-ISO-week date calculation across year boundaries;
- Wordstat rolling snapshots retain their 30-day label;
- only configured automated Wordstat bindings are selected;
- duplicate/ambiguous/cross-site bindings fail before a provider request;
- paid-request budget and lock enforcement;
- per-site failures do not publish another site's data;
- successful-empty and failed coverage remain distinct;
- Alice monthly imports remain readable;
- Alice ISO-week previews reject mismatched dates, keys, account and domain;
- identical publication is idempotent and corrections require supersession;
- reminder deduplication and closure after successful publication;
- dashboard and export paths read canonical MySQL only;
- legacy Zaruku, advertising and Abbott tests remain unchanged.

Release evidence includes migration dry-run, unit/integration tests, typecheck,
build, systemd unit verification, timer dry-run, canonical row reconciliation,
Telegram preview without sending, and MedRoche desktop/mobile dashboard smoke.

## Out of scope

- A fully unattended browser cron, credential automation, CAPTCHA bypass or use of
  undocumented Yandex HTTP endpoints.
- A new Telegatask collector or second Telegram cron.
- Email notification delivery.
- Changes to legacy Zaruku collection and display.
- Production migration, timer installation, Telegram send, credential change or
  dashboard deployment without a separately authorized release step.
