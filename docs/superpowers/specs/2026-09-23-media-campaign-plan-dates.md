# Campaign dates govern media plan allocation

Owner confirmed on 2026-09-23 that dashboard period_from/period_to always mean actual campaign dates. Owner requested that plans fit those dates: Gidrofuril ends September 15 but currently spreads September plan over 30 days.

Use each month's overlap with the configured campaign as the allocation interval. Preserve that month's allocation within the overlap. A selected reporting subrange receives its share of that interval. Dates outside the campaign receive zero. Without campaign bounds preserve existing calendar-month behavior. Do not infer dates from current wall clock or fact availability.

Formula: monthly_value * days(month ∩ campaign ∩ selected_range) / days(month ∩ campaign). For September plan 3000 and a campaign July 1–September 15: September 1–15 gets 3000; September 1–5 gets 1000; September 16–30 gets 0. July and August keep their full monthly values. The total-only fallback continues to prorate over the configured campaign.

Use the shared normalizer for channel summaries, monthly charts, and consistent platform/export plan projection. Keep raw inputs for calculations that need the original plan, so a selected range is never prorated twice. Actual metrics, stored plans, direct historical facts and collector data must not change.

This is a bounded app fix based on the live media release 8f389a28. Production/main integration is separately checked: main includes unrelated runtime work, and automatic merge produced conflicts. No deployment gate may be bypassed.
