# MedRoche implementation checkpoint

Updated: 2026-09-11 (Europe/Vienna)

## Active production

- Release commit: `552ed5513fd5e04b7eca2182c874600ebbf2c5fe`
- Template source commit: `622726fcb71c78605d276c8088e161d900ca306b`
- Release branch: `release/medroche`
- Active path: `/var/www/dashboard-medroche-releases/552ed5513fd5e04b7eca2182c874600ebbf2c5fe/standalone`
- Process: `dashboard-medroche`, online, loopback port 3003
- Public route: `/dashboard/medroche`
- Previous rollback release: `d875207d0eb588f181a887cb2a22267843c91bed`

## Visual correction

Root cause: the first generic implementation copied palette and individual cards but changed the Zaruku composition into two independent cards. The corrected template now uses the same visual structure as the isolated Zaruku dashboard: one rounded frame, a 240px white rail inside the frame, slate active navigation, profile identity in the rail, active-tab header, mobile tab strip, serif headings/KPI values, 16/20px responsive content padding, and subtle panel shadows. Generic source/data contracts remain independent of Zaruku.

The Overview page now follows the accepted Zaruku five-panel order and desktop geometry: north-star strip, traffic health, acquisition channels, search engines, and organic-search trend. The generic read model does not expose channel or search-engine breakdowns, so those two slots keep the accepted layout and show explicit unavailable states instead of invented rows. Metrika values are labelled as the canonical `search_engines / russia` slice; daily users are never summed. GSC and Webmaster retain their own actual periods and source states. Missing calendar dates break the trend line instead of being connected or filled with zeroes.

## Verification evidence

- Site SEO suite: 111 functional/contract tests passed; 27 artifact/build/isolation tests passed.
- Typecheck: passed.
- Local isolated Next production build: passed.
- Independent Overview review: no Critical, Important, or Minor findings after fixes; mobile state labels were browser-checked at 320, 390, and 767 px.
- Server artifact policy: PASS; site `site-medroche`, route `/dashboard/medroche`, asset prefix `/_next-medroche`, template `622726fc...`.
- Live health: HTTP 200, `siteId=site-medroche`.
- Public dashboard route: HTTP 200.
- Unauthenticated dashboard API: HTTP 401.
- Zaruku and the main dashboard processes were not restarted; both retained their pre-release PIDs.

No collector, canonical data, MySQL schema, source binding, GSC period rule, or Zaruku runtime was changed by this visual correction.
