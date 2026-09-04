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

Abbott direction coverage is documented in
[docs/2026-08-13-abbott-directions-and-disk-cleanup.md](docs/2026-08-13-abbott-directions-and-disk-cleanup.md):
canonical release `37`, the classifier runtime fixes behind it, how service pages are
labelled, and the hub-filter rule. Two facts save the most time when debugging an empty
`Направление` cell:

- tab 2 shows the **user's** direction (`portal_user_directions_private`); tabs 3/3.1/returning
  show the **page's** direction (`portal_content_catalog`). Classifying materials never changes
  tab 2 — that dictionary is a stale Bitrix export capped at `USER_ID 81311`.
- `reconcile --dry-run` is not a preview of a real run: it reports `ready 979` where an executed
  run reports `111`, because it never loads the canonical context. Measure with `--execute` only.

The rest of this README is still the default Next.js scaffold and should be treated as secondary.

### Historical Alice aggregate path (deprecated)

The former Zaruku SEO panel read an aggregated manual/external Alice row from
`seo_ai_visibility`. That path is retained only as historical context and must
not receive new Alice imports. In particular, the July `89/155` values have
unconfirmed definitions: they must not be presented as query, presence,
mention, or citation counts. New and corrected monthly Alice data uses the
normalized snapshot handoff below. This deprecation does not change the
unrelated legacy `.xls` import support elsewhere in the application.

### Zaruku Alice monthly snapshot handoff

Each detailed monthly handoff requires the absolute path to the reviewed `.xlsx`, the `YYYY-MM` period, the official Alice Share of Voice percentage, the source capture timestamp with timezone, and the approved featured-site URLs. The workbook must stay outside the repository and release bundle.

Run validation first; dry-run is also the default:

```bash
npm run import:zaruku-alice -- \
  --xlsx "/absolute/path/to/neurostatistics-zaruku.ru-YYYYMMDD-HHMMSS.xlsx" \
  --period YYYY-MM \
  --official-sov 43.91 \
  --captured-at 2026-09-04T13:28:14.000Z \
  --featured-site https://example.org \
  --dry-run
```

Only after the reported query, presence, source, featured-site, and validation totals reconcile, publish the same payload by changing the final flag:

```bash
npm run import:zaruku-alice -- \
  --xlsx "/absolute/path/to/neurostatistics-zaruku.ru-YYYYMMDD-HHMMSS.xlsx" \
  --period YYYY-MM \
  --official-sov 43.91 \
  --captured-at 2026-09-04T13:28:14.000Z \
  --featured-site https://example.org \
  --execute
```

The importer validates before connecting, writes the snapshot and child rows in one transaction, and reconciles the stored child counts before commit. Re-running the exact same source checksum is idempotent and returns `already_exists`. A different file for an already published month is rejected unless the operator explicitly supplies `--supersede-snapshot-id <current-published-id>`; that correction preserves the earlier snapshot as `superseded` instead of overwriting it.

The official Share of Voice is an externally supplied metric. Do not calculate or replace it from the Excel row count or the workbook sample-presence percentage.

#### Active release Alice import

The packaged importer does not load the application .env file. A dry-run needs no
credentials. For `--execute`, obtain the dedicated database values through the
approved secret channel and export only these five variables in the protected
operator shell:

```bash
export DB_HOST='<database host>'
export DB_PORT='<database port>'
export DB_USER='<database user>'
export DB_PASSWORD='<database password>'
export DB_NAME='<database name>'

cd /var/www/dashboard
npm run import:zaruku-alice -- \
  --xlsx "/absolute/path/outside-the-release/export.xlsx" \
  --period YYYY-MM \
  --official-sov 43.91 \
  --captured-at 2026-09-04T13:28:14.000Z \
  --execute

unset DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME
```

The release command accepts only the `DB_*` names above; it does not use the
legacy `MYSQL_*` aliases. Never put the source workbook in the release tree,
and never paste credential values into command arguments or logs.

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
