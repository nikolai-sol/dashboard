# ReportingDash UTC Cron Rebalance Design

**Date:** 2026-07-29

**Goal:** Disable the LinkedIn and Reddit collectors, move the remaining daily ReportingDash collectors four hours earlier, preserve the three documented Yandex Direct paths, and finish the health/report chain at `05:00 UTC` (`07:00 Europe/Vienna` during CEST).

## Confirmed pre-change gate

The existing 2026-07-29 scheduled gate completed before any cron change:

- Yandex Webmaster run `1711` started at `06:50:01 UTC`, finished with `status=success` and `error_count=0`.
- Google Search Console run `1712` started at `06:55:02 UTC`, finished with `status=success` and `error_count=0`.
- Webmaster query/page maxima advanced to `2026-07-27`; GSC core advanced to `2026-07-26`.
- The SELECT-only July recovery scopes remain unchanged: full Webmaster absence on `2026-07-01..09`, page-only absence on `2026-07-10..12`, and 1,698 rows owned by failed Webmaster runs on `2026-07-14..17`.
- No collector, backfill, optional-only GSC run, Telegram send, schema change, or secret change was executed for the gate.

## Scheduler semantics

The production cron daemon schedules against `Etc/UTC`. The existing `CRON_TZ=Europe/Vienna` assignment does not change trigger times on this host, as confirmed by the 2026-07-29 Metrika runs starting at the literal UTC cron times `06:12` and `06:18`.

All new times are therefore explicit UTC times. During CEST, `05:00 UTC` is `07:00 Europe/Vienna`. The schedule intentionally remains UTC after seasonal clock changes.

## Approved schedule

| UTC | Job | Change |
| --- | --- | --- |
| disabled | LinkedIn canonical | Comment out and retain the original command for recovery. |
| disabled | Reddit canonical | Comment out and retain the original command for recovery. |
| `01:40` | Between Email | Move from `05:40 UTC`. |
| `02:00` | Legacy Yandex Direct `/direct` safety/backfill | Move from `06:00 UTC`. |
| `02:12` | Generic Yandex Metrika canonical | Move from `06:12 UTC`. |
| `02:12` | Abbott active-release Metrika | Move from `06:12 UTC`. |
| `02:18` | Yandex Metrika returning content | Move from `06:18 UTC`. |
| `02:32` | GetIntent canonical | Move from `06:32 UTC`. |
| `02:34` | Yandex Direct canonical API-first | Move from `06:34 UTC`. |
| `02:35` | VK Ads canonical | Move from `06:35 UTC`. |
| `02:36` | Yandex PromoPages canonical | Move from `06:36 UTC`. |
| `02:37` | Hybrid canonical | Move from `06:37 UTC`. |
| `02:50` | Yandex Webmaster canonical | Move from `06:50 UTC`. |
| `02:55` | Google Search Console canonical | Move from `06:55 UTC`. |
| `04:30` | Yandex Direct latest-closed-day retry | Preserve as a late catch-up before health checks. |
| `04:40` | Canonical shadow/collector health | Run after all scheduled collectors. |
| `04:50` | Abbott health | Run after canonical health. |
| `05:00` | Canonical Telegram summary | Finish the chain; do not send during rollout. |

The weekly SEO rhythm and all ispmanager/system jobs remain unchanged.

## Yandex Direct rationale

Three Direct paths are intentionally preserved:

1. The legacy `/direct` cron is the documented temporary safety/backfill path while API-first stability is still incomplete.
2. The main canonical API-first cron collects a two-day window.
3. The late canonical retry re-requests only the latest closed day for late-arriving data and large accounts.

Recent API-first runs remain `partial`, so removing the legacy rollback path is outside this change.

## Safety and rollback

- Capture the current root crontab in a timestamped mode-`0600` backup before installation.
- Transform only uniquely matched ReportingDash lines; abort if any expected line is missing, duplicated, or has an unexpected original schedule.
- Preserve complete commands and arguments byte-for-byte; change only the five schedule fields or prefix LinkedIn/Reddit with a dated disabled comment.
- Never print the legacy Direct URL query or any environment/secret value.
- Install with `crontab -` only after all preconditions pass.
- Verify the installed schedule through a sanitized parser that prints only times and script labels.
- Verify LinkedIn and Reddit have no active entries and all unrelated active lines are unchanged.
- Roll back with the timestamped backup using `crontab <backup-path>` if verification fails.
- Do not execute collectors, backfills, health probes, or Telegram during the rollout.

