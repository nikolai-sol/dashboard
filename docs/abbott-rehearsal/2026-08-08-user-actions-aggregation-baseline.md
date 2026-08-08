# Abbott user-actions aggregation control

- Captured: `2026-08-08T18:10:00Z`
- Verified after implementation: `2026-08-08T18:45:48Z`
- Canonical release: `13`
- Application baseline: `949d1ed82fe1d590b072b6fae4731369b98f7c00`
- Before: one row per Metrika visit.
- After: one row per displayed combination of User ID, traffic source, UTM Source, direction, and last page.
- Capture source: authenticated production manager read model after URL query/fragment sanitization.
- Verification source: read-only aggregation from the active canonical release. No source or database mutation.

| Period | Source rows | Group rows | Visits | Duration, sec | Pageviews | Avg duration, sec | Avg duration, min | Avg page depth | With ID | Without ID | With UTM | Without UTM |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-06-01..30 | 11,774 | 2,439 | 11,774 | 2,857,157 | 43,315 | 242.666638 | 4.044444 | 3.678869 | 1,879 | 9,895 | 5,137 | 6,637 |
| 2026-07-01..31 | 12,222 | 2,479 | 12,222 | 2,860,415 | 33,202 | 234.038210 | 3.900637 | 2.716577 | 1,950 | 10,272 | 5,039 | 7,183 |
| 2026-08-01..07 | 2,388 | 735 | 2,388 | 601,371 | 5,630 | 251.830402 | 4.197173 | 2.357621 | 490 | 1,898 | 951 | 1,437 |

## Root referral control group

This group has no User ID and no UTM and ends at the sanitized portal root.

| Period | Visits | Duration, sec | Pageviews | Avg duration, sec | Avg page depth |
| --- | ---: | ---: | ---: | ---: | ---: |
| June | 278 | 37,489 | 449 | 134.852518 | 1.615108 |
| July | 280 | 27,968 | 489 | 99.885714 | 1.746429 |
| August 1–7 | 130 | 8,532 | 193 | 65.630769 | 1.484615 |

## Publication invariants

- The sum of visits is unchanged.
- The sums of `average duration × visits` and `page depth × visits` are unchanged.
- Weighted average duration and page depth are unchanged.
- With/without User ID and with/without UTM visit totals are unchanged.
- Canonical MySQL visit rows are not updated, deleted, regrouped, or backfilled.
