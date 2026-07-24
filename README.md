This is the `dashboard-next` app for public dashboards and admin configuration.

Operational admin/dashboard flow is documented in [ADMIN-FLOW.md](/Users/nicko/ReportingDash/dashboard-next/ADMIN-FLOW.md).
Separate leads-binding design is documented in [LEADS-BINDING-SPEC.md](/Users/nicko/ReportingDash/dashboard-next/LEADS-BINDING-SPEC.md).

Key production behaviors currently covered there:

- source roles: `actual`, `plan`, `custom_table`
- `manual_data` preview/data-check flow
- dashboard create/update detailed error handling
- media plan analyze/confirm review flow
- spend source selection and platform visibility rules
- dedicated future leads-binding flow; `custom_table` stays display-only

The rest of this README is still the default Next.js scaffold and should be treated as secondary.

## Zaruku SEO Tab: AI Visibility Source

The panel titled `AI-видимость (Яндекс Вебмастер / внешний источник)` does not read uploaded Excel files directly.

Runtime data path:

```text
ZarukuSeoDashboard.tsx
  -> data.seo_intelligence.ai.rows
  -> loadZarukuSeoIntelligenceData()
  -> SELECT engine, period, mentions, citations, presence_rate, provenance, captured_at, ingestion_run_id
     FROM seo_ai_visibility
```

The current production row is an aggregated manual/external Alisa snapshot:

```text
engine=alisa_ai
period=2026-07
mentions=89
citations=155
presence_rate=0.4400
provenance=wm_alisa_manual
ingestion_run_id=seo_os_ai_visibility_2026-07_alisa_ai
```

Manual workbook exports such as `neurostatistics-zaruku.ru-*.xlsx` are source evidence for this aggregate, not the dashboard source itself. The workbook should be reviewed weekly, then imported into `seo_ai_visibility` through the SEO OS import command:

```bash
SEO_MYSQL_DASHBOARD_EXPORT=1 npx ts-node --transpile-only scripts/runSeoAiVisibilityImport.ts \
  --engine alisa_ai \
  --period YYYY-MM \
  --presence-rate 0.574 \
  --mentions 89 \
  --citations 155 \
  --provenance wm_alisa_manual \
  --captured-at 2026-07-20T16:30:00.000Z \
  --note "Manual Alisa AI visibility workbook review" \
  --out reports/task-ai-visibility-import-YYYY-MM.json \
  --sql-out reports/task-ai-visibility-import-YYYY-MM.sql \
  --execute
```

Use `mentions = rows where Zaruku is present`, `citations = checked queries`, and `presence_rate = mentions / citations` as a 0..1 value. The dashboard converts this to a percentage for display. Re-imports are idempotent by `(analytics_account_id, engine, period, provenance)`.

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
