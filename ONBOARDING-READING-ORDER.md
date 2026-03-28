# ONBOARDING READING ORDER

Required reading order for any new agent starting work in `/Users/nicko/ReportingDash`.

The goal is:
- do not rediscover infrastructure from chat history
- do not load unnecessary context
- read only the segment that matches the task

## Global entry point

Always read first:
- [AGENTS.md](/Users/nicko/ReportingDash/dashboard-next/AGENTS.md)

This file tells the agent:
- workspace structure
- production runtime
- where the memory files are
- which file is the current source of truth

## Segment 1: Dashboards / Admin / Viewer Access / Exports

Read in this order:

1. [DASHBOARDS-MEMORY.md](/Users/nicko/ReportingDash/dashboard-next/DASHBOARDS-MEMORY.md)
2. [dashboard-next/src/lib/dashboard-data-loader.ts](src/lib/dashboard-data-loader.ts)
3. [dashboard-next/src/app/dashboard/[id]/page.tsx](src/app/dashboard/[id]/page.tsx)
4. [dashboard-next/src/components/admin/DashboardWizard.tsx](src/components/admin/DashboardWizard.tsx)
5. If export-related:
   - [dashboard-next/src/app/api/dashboard/[id]/excel/route.ts](src/app/api/dashboard/[id]/excel/route.ts)
   - [dashboard-next/src/app/api/dashboard/[id]/pdf/route.ts](src/app/api/dashboard/[id]/pdf/route.ts)
6. If auth-related:
   - [dashboard-next/src/app/page.tsx](src/app/page.tsx)
   - [dashboard-next/src/app/api/dashboard-auth/login/route.ts](src/app/api/dashboard-auth/login/route.ts)
   - [dashboard-next/src/app/api/viewer-portal/login/route.ts](src/app/api/viewer-portal/login/route.ts)

## Segment 2: Cron / Collectors / Platform API Access

Read in this order:

1. [PLATFORMS-ACCESS-MEMORY.md](/Users/nicko/ReportingDash/dashboard-next/PLATFORMS-ACCESS-MEMORY.md)
2. [OPS.md](/Users/nicko/ReportingDash/dashboard-next/OPS.md)
3. [CURRENT-COLLECTION-MODEL.md](/Users/nicko/ReportingDash/CURRENT-COLLECTION-MODEL.md)
4. [CANONICAL-V1-TRACKER.md](/Users/nicko/ReportingDash/CANONICAL-V1-TRACKER.md)
5. Then the relevant collector:
   - [fetch_linkedin_canonical.py](/Users/nicko/ReportingDash/fetch_linkedin_canonical.py)
   - [fetch_reddit_canonical.py](/Users/nicko/ReportingDash/fetch_reddit_canonical.py)
   - [fetch_getintent_canonical.py](/Users/nicko/ReportingDash/fetch_getintent_canonical.py)
   - [fetch_vk_ads_v2_canonical.py](/Users/nicko/ReportingDash/fetch_vk_ads_v2_canonical.py)
   - [fetch_hybrid_canonical.py](/Users/nicko/ReportingDash/fetch_hybrid_canonical.py)
   - [fetch_yandex_direct_canonical.py](/Users/nicko/ReportingDash/fetch_yandex_direct_canonical.py)
   - [fetch_yandex_metrika_canonical.py](/Users/nicko/ReportingDash/fetch_yandex_metrika_canonical.py)

## Segment 3: Canonical migration / parity / rollout

Read in this order:

1. [CANONICAL-ENTITIES-MEMORY.md](/Users/nicko/ReportingDash/dashboard-next/CANONICAL-ENTITIES-MEMORY.md)
2. [CANONICAL-V1-TRACKER.md](/Users/nicko/ReportingDash/CANONICAL-V1-TRACKER.md)
3. [CANONICAL-ROLLING-VERIFICATION-CHECKLIST.md](/Users/nicko/ReportingDash/CANONICAL-ROLLING-VERIFICATION-CHECKLIST.md)
4. [MANUAL-LEGACY-EXCEPTIONS.md](/Users/nicko/ReportingDash/MANUAL-LEGACY-EXCEPTIONS.md)
5. [MIGRATION-PLAN.md](/Users/nicko/ReportingDash/MIGRATION-PLAN.md)
6. [SHADOW-CRON-POLICY.md](/Users/nicko/ReportingDash/SHADOW-CRON-POLICY.md)

## Segment 4: Platform-specific onboarding

Read the relevant onboarding doc:

- Hybrid:
  - [HYBRID-REPORTING-ONBOARDING.md](/Users/nicko/ReportingDash/HYBRID-REPORTING-ONBOARDING.md)
- GetIntent:
  - [GETINTENT-REPORTING-ONBOARDING.md](/Users/nicko/ReportingDash/GETINTENT-REPORTING-ONBOARDING.md)
- Yandex Direct:
  - [YANDEX-DIRECT-REPORTING-ONBOARDING.md](/Users/nicko/ReportingDash/YANDEX-DIRECT-REPORTING-ONBOARDING.md)

## Segment 5: Schema / metrics / field mapping

Read in this order:

1. [CANONICAL-ENTITIES-MEMORY.md](/Users/nicko/ReportingDash/dashboard-next/CANONICAL-ENTITIES-MEMORY.md)
2. [FIELD-MAPPING.md](/Users/nicko/ReportingDash/FIELD-MAPPING.md)
3. [METRICS-MATRIX.md](/Users/nicko/ReportingDash/METRICS-MATRIX.md)
4. [CANONICAL-DB-DESIGN.md](/Users/nicko/ReportingDash/CANONICAL-DB-DESIGN.md)

## Segment 6: Legacy Nest integration

Read:

1. [NEST-SECOND-AUDIT.md](/Users/nicko/ReportingDash/NEST-SECOND-AUDIT.md)
2. then inspect `/Users/nicko/ReportingDash/nest-second`

## Segment 7: Planning / roadmap / future work

Read:

1. [TODO.md](/Users/nicko/ReportingDash/TODO.md)
2. [PLANNING-TODO.md](/Users/nicko/ReportingDash/PLANNING-TODO.md)
3. [PLANNING-INTELLIGENCE-LAYER.md](/Users/nicko/ReportingDash/PLANNING-INTELLIGENCE-LAYER.md)
4. [API-CLUSTER-PLAN.md](/Users/nicko/ReportingDash/API-CLUSTER-PLAN.md)

## Memory maintenance rule

Memory files are not archives. They are operational working memory.

Every agent must follow these rules:

1. When important information is discovered or changed, update the relevant memory file in the same turn.
2. If old information is no longer valid, remove or rewrite it immediately.
3. If a process, access model, runtime path, cron rule, or dashboard rule changes, do not leave the old version in memory beside the new one unless the distinction is explicitly needed.
4. Prefer short, current, actionable memory over long historical memory.
5. If a task changes the dashboard contour, update:
   - [DASHBOARDS-MEMORY.md](/Users/nicko/ReportingDash/dashboard-next/DASHBOARDS-MEMORY.md)
6. If a task changes collectors / cron / platform access, update:
   - [PLATFORMS-ACCESS-MEMORY.md](/Users/nicko/ReportingDash/dashboard-next/PLATFORMS-ACCESS-MEMORY.md)
7. If a task changes canonical entities / fact grain / lineage rules, update:
   - [CANONICAL-ENTITIES-MEMORY.md](/Users/nicko/ReportingDash/dashboard-next/CANONICAL-ENTITIES-MEMORY.md)

## Default practical rule

For a new task:

1. Read [AGENTS.md](/Users/nicko/ReportingDash/dashboard-next/AGENTS.md)
2. Read the segment memory file
3. Read only the relevant docs for that segment
4. Then inspect code and runtime state
