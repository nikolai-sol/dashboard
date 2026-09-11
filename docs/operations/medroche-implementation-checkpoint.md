# MedRoche implementation checkpoint

Updated: 2026-09-11 (Europe/Vienna)

## Active production

- Release commit: `d875207d0eb588f181a887cb2a22267843c91bed`
- Template source commit: `a562e4d4b3c922e381d57f2b3f8444e30b462df6`
- Release branch: `release/medroche`
- Active path: `/var/www/dashboard-medroche-releases/d875207d0eb588f181a887cb2a22267843c91bed/standalone`
- Process: `dashboard-medroche`, online, loopback port 3003
- Public route: `/dashboard/medroche`
- Previous rollback release: `03b2a1602f27e301652b778e5a43b87d89df0f89`

## Visual correction

Root cause: the first generic implementation copied palette and individual cards but changed the Zaruku composition into two independent cards. The corrected template now uses the same visual structure as the isolated Zaruku dashboard: one rounded frame, a 240px white rail inside the frame, slate active navigation, profile identity in the rail, active-tab header, mobile tab strip, serif headings/KPI values, 16/20px responsive content padding, and subtle panel shadows. Generic source/data contracts remain independent of Zaruku.

## Verification evidence

- Site SEO suite: 105 functional/contract tests passed; 27 artifact/build/isolation tests passed.
- Typecheck: passed.
- Local isolated Next production build: passed.
- Independent visual review: no Critical or Important findings; two mobile Minor findings fixed and covered by a regression test.
- Server artifact: site `site-medroche`, route `/dashboard/medroche`, asset prefix `/_next-medroche`, template `a562e4d4...`.
- Live health: HTTP 200, `siteId=site-medroche`.
- Public dashboard route: HTTP 200.
- Unauthenticated dashboard API: HTTP 401.
- Zaruku and the main dashboard processes were not restarted.

No collector, canonical data, MySQL schema, source binding, GSC period rule, or Zaruku runtime was changed by this visual correction.

