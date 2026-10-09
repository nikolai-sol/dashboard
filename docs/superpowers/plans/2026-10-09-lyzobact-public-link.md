# Lysobact public regional link implementation plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans task-by-task; independent review before deployment.

**Goal:** Open /dashboard/lyzobact/regions anonymously without weakening admin, write or other dashboard access.
**Architecture:** Reuse the existing regional GET/page and canonical published-snapshot reader. Allow public responses only for active dashboard49/client lyzobact with enabled and public_read both literal true. Project an explicit public payload; manager/admin responses remain unchanged.
**Tech Stack:** Next.js, TypeScript, node:test, existing MySQL JSON configuration.

## Constraints
- No shared auth/middleware/schema/data-history changes, new route, service or source API.
- Public allowlist excludes evidenceRef and source diagnostics; preserve clinical and Wordstat numbers, periods, public URLs and hashes.
- Existing published-only snapshot selection and private/no-store cache policy remain.
- Existing mobile selector overflow is outside scope.
- All heavy artifacts/TMP/cache on verified physical Elements.

## Task: Scoped public read
Files: src/lib/lyzobact-regions-http.ts and .test.ts; src/lib/lyzobact-regions-store.ts and .test.ts; src/lib/lyzobact-regions-types.ts; src/app/api/dashboard/[id]/regions/route.ts.
- [x] RED: tests call existing HTTP factory with optional publicRead dependency; opt-in49 expects200 and projected fields, default/wrongidentity disabled expects403/404. Store tests exercise exact49/client/active/config booleans.
- [x] GREEN: add isRegionalModulePublicReadEnabled(id,run), which returns false unless id49 and SELECT active exactlyzo row has both true flags. Wire dependency only in regional API. Public branch requires id49/clientlyzobact/canonical requested id before load.
- [x] Projection: explicit top-level/snapshot/row/source/Wordstat field allowlists, never mutate source object. Internal source fields optional in shared transport type; original manager response remains full.
- [x] Run node --import tsx --test src/lib/lyzobact-regions-http.test.ts src/lib/lyzobact-regions-store.test.ts src/lib/lyzobact-regions-admin.test.ts; TypeScript and scoped ESLint.
- [ ] Seal scoped commit/diff and read-only config CAS proposal: JSON_SET only $.lyzobact_regions.public_read=true on id49/clientlyzobact with original SHA2(config,256). No apply until reviewer/root gate.
- [ ] After gate run unchanged standard guarded deploy; enable exact flag using fresh before-hash; verify anonymous85/83/2, published-only history, admin401/otherdashboard restrictions and no data mutation; close owned browser.
