# Abbott and Zaruku Shared Password Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a protected admin form that rotates mandatory shared passwords for Abbott and Zaruku, stores only salted hashes, revokes old viewer sessions, and seeds Zaruku safely for production.

**Architecture:** A repeat-safe table stores one hashed shared credential and monotonically increasing version per dashboard. A focused store module owns DB access; auth sessions carry the version and protected requests compare it with current state. The admin API and seed CLI share one rotation function, while Abbott alone retains a version-0 environment fallback until its first DB rotation.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, MySQL 8, `mysql2/promise`, Node `crypto.scrypt`, Node test runner, Bash deployment checks.

## Global Constraints

- Abbott and Zaruku must never resolve to public or `email_password` access.
- Password plaintext and password hashes must never be returned by APIs, logged, committed, written to checkpoints, or passed as command-line arguments.
- Shared passwords are 10–256 characters and are stored only in the existing `scrypt:<salt>:<hash>` format.
- Password rotation must atomically increment `credential_version` and invalidate older manager viewer/export sessions.
- Abbott may use `ABBOTT_DASHBOARD_PASSWORD` only when no DB settings row exists; Zaruku without a DB row fails closed.
- Abbott `embed_key` access remains environment-backed and independent of password rotation.
- Existing email/password access behavior remains unchanged for dashboards other than Abbott and Zaruku.
- Production migration is explicit and precedes application cutover; deploy must not infer that migrations have run.
- Implementation starts from app repository `main` at or after `0c9e046`; root-repository changes are out of scope.

---

### Task 1: Shared-password schema and pure policy

**Files:**
- Create: `src/db/migrations/042_dashboard_shared_access_settings.sql`
- Create: `src/db/dashboard-shared-access-migration.test.ts`
- Modify: `src/lib/dashboard-access-policy.ts`
- Modify: `src/lib/dashboard-access-policy.test.ts`
- Create: `src/lib/shared-password-policy.ts`
- Create: `src/lib/shared-password-policy.test.ts`

**Interfaces:**
- Produces: `isSharedPasswordClient(clientId: string): boolean`
- Produces: `validateSharedPasswordChange(input: { new_password: unknown; confirm_password: unknown }): { ok: true; password: string } | { ok: false; error: string }`
- Produces: table `dashboard_shared_access_settings(dashboard_id, password_hash, credential_version, updated_by, created_at, updated_at)`.

- [ ] **Step 1: Write failing migration and policy tests**

```ts
test("migration 042 stores only versioned shared password hashes", () => {
  const sql = readFileSync(path.resolve("src/db/migrations/042_dashboard_shared_access_settings.sql"), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS dashboard_shared_access_settings/i);
  assert.match(sql, /dashboard_id INT NOT NULL/);
  assert.match(sql, /password_hash VARCHAR\(255\) NOT NULL/);
  assert.match(sql, /credential_version BIGINT UNSIGNED NOT NULL DEFAULT 1/);
  assert.match(sql, /FOREIGN KEY \(dashboard_id\) REFERENCES dashboards\(id\)/);
  assert.doesNotMatch(sql, /zaruku2026/i);
  assert.doesNotMatch(sql, /password_plain|plaintext/i);
});

test("Abbott and Zaruku always use shared password access", () => {
  for (const clientId of ["abbott", " ABBOTT ", "zaruku", "ZARUKU"]) {
    assert.equal(resolveDashboardAuthMode(clientId, 5, false), "password_only");
    assert.equal(isSharedPasswordClient(clientId), true);
  }
});

test("shared password validation is exact and bounded", () => {
  assert.deepEqual(validateSharedPasswordChange({ new_password: "0123456789", confirm_password: "0123456789" }), { ok: true, password: "0123456789" });
  assert.equal(validateSharedPasswordChange({ new_password: "short", confirm_password: "short" }).ok, false);
  assert.equal(validateSharedPasswordChange({ new_password: "0123456789", confirm_password: "012345678X" }).ok, false);
  assert.equal(validateSharedPasswordChange({ new_password: "x".repeat(257), confirm_password: "x".repeat(257) }).ok, false);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- src/db/dashboard-shared-access-migration.test.ts src/lib/dashboard-access-policy.test.ts src/lib/shared-password-policy.test.ts`

Expected: FAIL because migration 042 and shared-password policy exports do not exist and Zaruku currently resolves public/email mode.

- [ ] **Step 3: Implement the repeat-safe table and pure policy**

```sql
CREATE TABLE IF NOT EXISTS dashboard_shared_access_settings (
  dashboard_id INT NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  credential_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (dashboard_id),
  CONSTRAINT fk_dashboard_shared_access_dashboard
    FOREIGN KEY (dashboard_id) REFERENCES dashboards(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

```ts
const SHARED_PASSWORD_CLIENT_IDS = new Set(["abbott", "zaruku"]);
export const MIN_SHARED_PASSWORD_LENGTH = 10;
export const MAX_SHARED_PASSWORD_LENGTH = 256;

export function normalizeSharedPasswordClientId(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

export function isSharedPasswordClient(value: string) {
  return SHARED_PASSWORD_CLIENT_IDS.has(normalizeSharedPasswordClientId(value));
}

export function validateSharedPasswordChange(input: { new_password: unknown; confirm_password: unknown }) {
  const password = String(input.new_password ?? "");
  const confirmation = String(input.confirm_password ?? "");
  if (password !== confirmation) return { ok: false as const, error: "Пароли не совпадают" };
  if (password.length < MIN_SHARED_PASSWORD_LENGTH) return { ok: false as const, error: "Пароль должен содержать не менее 10 символов" };
  if (password.length > MAX_SHARED_PASSWORD_LENGTH) return { ok: false as const, error: "Пароль слишком длинный" };
  return { ok: true as const, password };
}
```

Change `resolveDashboardAuthMode` so `isSharedPasswordClient(clientId)` returns `password_only` before testing active users.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npm test -- src/db/dashboard-shared-access-migration.test.ts src/lib/dashboard-access-policy.test.ts src/lib/shared-password-policy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the schema and policy**

```bash
git add src/db/migrations/042_dashboard_shared_access_settings.sql src/db/dashboard-shared-access-migration.test.ts src/lib/dashboard-access-policy.ts src/lib/dashboard-access-policy.test.ts src/lib/shared-password-policy.ts src/lib/shared-password-policy.test.ts
git commit -m "feat: define shared dashboard password policy"
```

---

### Task 2: Transactional shared credential store

**Files:**
- Create: `src/lib/dashboard-shared-access.ts`
- Create: `src/lib/dashboard-shared-access.test.ts`

**Interfaces:**
- Consumes: `isSharedPasswordClient`, `hashPassword`, and `verifyPassword`.
- Produces: `loadSharedPasswordCredential(dashboardId: number, clientId: string): Promise<SharedPasswordCredential>`.
- Produces: `getSharedPasswordAdminState(dashboardId: number): Promise<SharedPasswordAdminState>`.
- Produces: `rotateSharedDashboardPassword(dashboardId: number, password: string, updatedBy: string, expectedClientId?: string): Promise<SharedPasswordAdminState>`.
- Produces: `verifySharedDashboardPassword(dashboardId: number, clientId: string, password: string): Promise<{ credentialVersion: number } | null>`.

- [ ] **Step 1: Write failing fake-database store tests**

```ts
test("Abbott uses version zero env fallback only when the DB row is absent", async () => {
  const store = createDashboardSharedAccessStore(fakeDatabase({ client_id: "abbott", setting: null }), { abbottLegacyPassword: "legacy-password" });
  assert.deepEqual(await store.verifySharedDashboardPassword(18, "abbott", "legacy-password"), { credentialVersion: 0 });
});

test("Zaruku without a DB row fails closed", async () => {
  const store = createDashboardSharedAccessStore(fakeDatabase({ client_id: "zaruku", setting: null }), { abbottLegacyPassword: "unused" });
  assert.equal(await store.verifySharedDashboardPassword(28, "zaruku", "anything-at-all"), null);
});

test("rotation hashes and atomically increments the credential version", async () => {
  const database = fakeDatabase({ client_id: "zaruku", setting: { password_hash: hashPassword("old-password"), credential_version: 4 } });
  const store = createDashboardSharedAccessStore(database, { abbottLegacyPassword: null });
  const state = await store.rotateSharedDashboardPassword(28, "new-password", "admin@example.test");
  assert.equal(state.credential_version, 5);
  assert.equal(database.commits, 1);
  assert.equal(database.rollbacks, 0);
  assert.equal(database.lastPasswordValue?.includes("new-password"), false);
  assert.equal(verifyPassword("new-password", database.lastPasswordValue ?? ""), true);
});
```

The fake records executed SQL and parameters, implements `beginTransaction`, `commit`, `rollback`, and `release`, and returns deterministic dashboard/settings rows.

- [ ] **Step 2: Run the store test and verify RED**

Run: `npm test -- src/lib/dashboard-shared-access.test.ts`

Expected: FAIL because the store module does not exist.

- [ ] **Step 3: Implement the injectable store**

```ts
export type SharedPasswordCredential = {
  source: "database" | "abbott_env_fallback" | "missing";
  password_hash: string | null;
  legacy_password: string | null;
  credential_version: number;
};

export type SharedPasswordAdminState = {
  supported: boolean;
  configured: boolean;
  client_id: string | null;
  credential_version: number;
  updated_at: string | null;
};

export function createDashboardSharedAccessStore(database = pool, options = {
  abbottLegacyPassword: process.env.ABBOTT_DASHBOARD_PASSWORD?.trim() || null,
}) {
  return {
    loadSharedPasswordCredential,
    getSharedPasswordAdminState,
    rotateSharedDashboardPassword,
    verifySharedDashboardPassword,
  };
}
```

Implementation requirements:

- Query settings only by numeric `dashboard_id`.
- Return DB hash/version when a row exists.
- Return the env fallback only for normalized `client_id=abbott` and only when no row exists.
- Return `missing` for Zaruku without a row.
- Rotation opens a transaction, locks `dashboards` and its optional settings row with `FOR UPDATE`, rejects unsupported clients, hashes before the upsert, writes `existing version + 1` or `1`, commits, and returns safe state.
- Every catch rolls back; every finally releases; no error string includes SQL parameters or passwords.

- [ ] **Step 4: Run store and policy tests and verify GREEN**

Run: `npm test -- src/lib/dashboard-shared-access.test.ts src/lib/shared-password-policy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the store**

```bash
git add src/lib/dashboard-shared-access.ts src/lib/dashboard-shared-access.test.ts
git commit -m "feat: store shared dashboard password hashes"
```

---

### Task 3: Versioned sessions and rate-limited login

**Files:**
- Modify: `src/lib/access-auth.ts`
- Modify: `src/lib/access-auth.test.ts`
- Modify: `src/lib/dashboard-access.ts`
- Create: `src/lib/dashboard-access-shared-password.test.ts`
- Modify: `src/app/api/dashboard-auth/login/route.ts`
- Modify: `src/app/api/dashboard/[id]/pdf/route.ts`

**Interfaces:**
- Consumes: Task 2 store functions.
- Changes: `createViewerSession(dashboardId, email, audience, credentialVersion?)`.
- Changes: `createViewerExportToken(dashboardId, audience, credentialVersion?)`.
- Adds: optional `credential_version` to manager viewer/export session payloads.
- Changes: successful shared-password credential verification returns access context with `credential_version`.

- [ ] **Step 1: Write failing session and auth integration tests**

```ts
test("shared password viewer sessions preserve credential version", () => {
  const token = createViewerSession(28, "shared-access+zaruku@dashboard.local", "manager", 3);
  assert.equal(verifyViewerSession(token, 28)?.credential_version, 3);
});

test("unversioned manager session cannot authorize a versioned shared dashboard", () => {
  assert.equal(sharedCredentialVersionMatches({ audience: "manager" }, 1), false);
  assert.equal(sharedCredentialVersionMatches({ audience: "manager", credential_version: 1 }, 1), true);
});
```

Add a source-contract test for `dashboard-auth/login/route.ts` that requires `checkRateLimit`, a key containing both client IP and dashboard identifier, status `429`, `Retry-After`, and forbids password logging.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/lib/access-auth.test.ts src/lib/dashboard-access-shared-password.test.ts`

Expected: FAIL because sessions and shared authorization do not carry/check a version.

- [ ] **Step 3: Implement version propagation and authorization**

```ts
type SessionPayload = {
  type: SessionType;
  email?: string;
  dashboard_id?: number;
  dashboard_ids?: number[];
  audience?: DashboardAudience;
  credential_version?: number;
  exp: number;
};

export function sharedCredentialVersionMatches(
  payload: { audience: DashboardAudience; credential_version?: number },
  currentVersion: number,
) {
  return payload.audience === "manager" && payload.credential_version === currentVersion;
}
```

In `verifyDashboardAccessCredentials`, use `verifySharedDashboardPassword` for Abbott/Zaruku and attach its version to the returned context. In `isDashboardAccessAuthorized`, keep embed-key authorization first; for manager tokens on shared-password clients, load current credential state and reject any missing/mismatched version. Public and ordinary email dashboards retain existing behavior.

In the login route, apply `checkRateLimit` before credential verification with 10 attempts per 15 minutes and a key `dashboard-login:<ip>:<normalized identifier>`. Pass the returned credential version into `createViewerSession`.

When PDF creates an export token after successful authorization, pass through the already-validated credential version:

```ts
createViewerExportToken(
  access.context.id,
  access.audience,
  access.credentialVersion,
)
```

- [ ] **Step 4: Run auth, API, projection, export, and policy tests**

Run: `npm test -- src/lib/access-auth.test.ts src/lib/dashboard-access-policy.test.ts src/lib/dashboard-access-shared-password.test.ts src/lib/abbott-data-projection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit auth integration**

```bash
git add src/lib/access-auth.ts src/lib/access-auth.test.ts src/lib/dashboard-access.ts src/lib/dashboard-access-shared-password.test.ts src/app/api/dashboard-auth/login/route.ts 'src/app/api/dashboard/[id]/pdf/route.ts'
git commit -m "feat: revoke shared dashboard sessions on rotation"
```

---

### Task 4: Protected admin API

**Files:**
- Create: `src/app/api/admin/dashboards/[id]/shared-password/route.ts`
- Create: `src/lib/shared-password-admin.ts`
- Create: `src/lib/shared-password-admin.test.ts`

**Interfaces:**
- Consumes: `validateSharedPasswordChange`, `getSharedPasswordAdminState`, `rotateSharedDashboardPassword`, `verifyAdminSession`, `parseCookieValue`, and `ADMIN_SESSION_COOKIE`.
- Produces: safe GET/PUT response models used by the UI.

- [ ] **Step 1: Write failing service tests**

```ts
test("admin password change derives actor from session and returns no secret fields", async () => {
  const result = await changeSharedPassword(
    { dashboardId: 28, body: { new_password: "zaruku-next", confirm_password: "zaruku-next" }, adminEmail: "ADMIN@example.test" },
    { rotate: async (_id, _password, actor) => ({ supported: true, configured: true, client_id: "zaruku", credential_version: 2, updated_at: "2026-07-22T10:00:00.000Z", actor }) },
  );
  assert.equal(result.status, 200);
  assert.equal(JSON.stringify(result.body).includes("password"), false);
  assert.equal(JSON.stringify(result.body).includes("hash"), false);
});

test("admin password change rejects mismatches before DB access", async () => {
  let called = false;
  const result = await changeSharedPassword(
    { dashboardId: 28, body: { new_password: "0123456789", confirm_password: "012345678X" }, adminEmail: "admin@example.test" },
    { rotate: async () => { called = true; throw new Error("unexpected"); } },
  );
  assert.equal(result.status, 400);
  assert.equal(called, false);
});
```

- [ ] **Step 2: Run service tests and verify RED**

Run: `npm test -- src/lib/shared-password-admin.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement service and route**

```ts
export type SharedPasswordAdminResponse = {
  status: number;
  body: { ok?: true; supported?: boolean; configured?: boolean; updated_at?: string | null; error?: string };
};
```

The route resolves async params, parses the signed admin cookie again for `updated_by`, returns `401` if absent, calls the service, and converts its response to `NextResponse.json` with `Cache-Control: private, no-store`. `GET` returns only `supported`, `configured`, and `updated_at`. Catch blocks log one fixed operation label plus dashboard ID, never `body`, and return `{ error: "Не удалось сохранить пароль" }`.

- [ ] **Step 4: Run service tests, typecheck, and verify GREEN**

Run: `npm test -- src/lib/shared-password-admin.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the admin API**

```bash
git add 'src/app/api/admin/dashboards/[id]/shared-password/route.ts' src/lib/shared-password-admin.ts src/lib/shared-password-admin.test.ts
git commit -m "feat: add shared password admin API"
```

---

### Task 5: Russian admin password form

**Files:**
- Create: `src/components/admin/SharedPasswordSettings.tsx`
- Create: `src/components/admin/SharedPasswordSettings.ui.test.ts`
- Modify: `src/components/admin/AdminAccessSettings.tsx`

**Interfaces:**
- Consumes: Task 4 GET/PUT route.
- Produces: `<SharedPasswordSettings dashboardId={number} dashboardName={string} />`.

- [ ] **Step 1: Write failing UI source-contract tests**

```ts
test("shared password form is secret-safe and Russian", () => {
  const source = readFileSync(path.resolve("src/components/admin/SharedPasswordSettings.tsx"), "utf8");
  assert.match(source, /Пароль доступа/);
  assert.match(source, /Новый пароль/);
  assert.match(source, /Повторите пароль/);
  assert.match(source, /Сменить пароль/);
  assert.match(source, /type="password"/);
  assert.doesNotMatch(source, /current_password|password_hash/);
});

test("settings selects shared form only for Abbott and Zaruku", () => {
  const source = readFileSync(path.resolve("src/components/admin/AdminAccessSettings.tsx"), "utf8");
  assert.match(source, /isSharedPasswordClient\(selectedDashboard\.client_id\)/);
  assert.match(source, /<SharedPasswordSettings/);
  assert.match(source, /Access users/);
});
```

- [ ] **Step 2: Run UI test and verify RED**

Run: `npm test -- src/components/admin/SharedPasswordSettings.ui.test.ts`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the client component and integration**

The component loads safe status on dashboard change, maintains only `newPassword` and `confirmation` state, validates matching/minimum length before PUT, clears both fields in `finally` after success, and renders:

```tsx
<section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
  <h2 className="text-base font-semibold text-slate-900">Пароль доступа</h2>
  <p className="mt-1 text-sm text-slate-600">{configured ? "Пароль установлен" : "Пароль ещё не перенесён в защищённое хранилище"}</p>
  <p className="mt-1 text-sm text-amber-700">После смены пароля ранее открытые пользовательские сессии будут закрыты.</p>
  <label className="mt-4 block text-sm text-slate-700">
    Новый пароль
    <input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
  </label>
  <label className="mt-3 block text-sm text-slate-700">
    Повторите пароль
    <input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
  </label>
  {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
  {message ? <p className="mt-3 text-sm text-emerald-600">{message}</p> : null}
  <button type="submit" disabled={saving || newPassword.length < 10 || newPassword !== confirmation} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
    {saving ? "Сохранение..." : "Сменить пароль"}
  </button>
</section>
```

In `AdminAccessSettings`, use `isSharedPasswordClient(selectedDashboard.client_id)` to render this component and hide the access-user editor for Abbott/Zaruku. Keep the existing editor byte-for-byte behavior for all other dashboards. Correct the page introduction so it no longer claims every dashboard is public when user rows are absent.

- [ ] **Step 4: Run UI tests, full component tests, and typecheck**

Run: `npm test -- src/components/admin/SharedPasswordSettings.ui.test.ts src/components/abbott-summary.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the admin UI**

```bash
git add src/components/admin/SharedPasswordSettings.tsx src/components/admin/SharedPasswordSettings.ui.test.ts src/components/admin/AdminAccessSettings.tsx
git commit -m "feat: add shared password settings form"
```

---

### Task 6: Safe seed CLI and deployment contracts

**Files:**
- Create: `scripts/set-dashboard-shared-password.ts`
- Create: `scripts/set-dashboard-shared-password.test.ts`
- Modify: `package.json`
- Modify: `scripts/render-production-env.test.sh`
- Modify: `scripts/validate-production-release.test.sh`

**Interfaces:**
- Consumes: `rotateSharedDashboardPassword`.
- Produces: `npm --silent run access:set-shared-password -- --client-id zaruku`, with password read only from stdin.

- [ ] **Step 1: Write failing CLI and env-contract tests**

```ts
test("seed CLI accepts only a client id argument and reads password from fd zero", () => {
  const source = readFileSync(path.resolve("scripts/set-dashboard-shared-password.ts"), "utf8");
  assert.match(source, /readFileSync\(0, "utf8"\)/);
  assert.match(source, /--client-id/);
  assert.doesNotMatch(source, /--password/);
  assert.doesNotMatch(source, /console\.log\([^)]*password/i);
});

test("seed CLI permits only Abbott and Zaruku", () => {
  assert.equal(parseSeedClientId(["--client-id", "zaruku"]), "zaruku");
  assert.throws(() => parseSeedClientId(["--client-id", "other"]));
});
```

Extend both Bash tests with `! grep -q 'ZARUKU_DASHBOARD_PASSWORD'` against rendered/required keys, while retaining the current required Abbott password fallback.

- [ ] **Step 2: Run CLI/Bash tests and verify RED**

Run: `npm test -- scripts/set-dashboard-shared-password.test.ts && bash scripts/render-production-env.test.sh && bash scripts/validate-production-release.test.sh`

Expected: FAIL because the CLI and package script do not exist.

- [ ] **Step 3: Implement the stdin-only CLI**

```ts
export function parseSeedClientId(args: string[]) {
  if (args.length !== 2 || args[0] !== "--client-id" || !isSharedPasswordClient(args[1])) {
    throw new Error("Usage: --client-id abbott|zaruku");
  }
  return normalizeSharedPasswordClientId(args[1]);
}

async function main() {
  const clientId = parseSeedClientId(process.argv.slice(2));
  const password = readFileSync(0, "utf8").replace(/[\r\n]+$/, "");
  const validation = validateSharedPasswordChange({ new_password: password, confirm_password: password });
  if (!validation.ok) throw new Error(validation.error);
  const dashboardId = await resolveActiveDashboardIdByClientId(clientId);
  await rotateSharedDashboardPassword(dashboardId, validation.password, "production-seed", clientId);
  process.stdout.write("Shared dashboard password configured.\n");
}
```

Add `"access:set-shared-password": "tsx scripts/set-dashboard-shared-password.ts"` to `package.json`. The success line contains no client ID, password, hash, or version.
The executable entrypoint compares canonical real paths, closes the module-level MySQL pool in `finally`, and leaves imports side-effect free.

- [ ] **Step 4: Run CLI/Bash tests and verify GREEN**

Run: `npm test -- scripts/set-dashboard-shared-password.test.ts && bash scripts/render-production-env.test.sh && bash scripts/validate-production-release.test.sh`

Expected: PASS.

- [ ] **Step 5: Commit seed and deploy contracts**

```bash
git add scripts/set-dashboard-shared-password.ts scripts/set-dashboard-shared-password.test.ts package.json scripts/render-production-env.test.sh scripts/validate-production-release.test.sh
git commit -m "feat: add safe shared password seed command"
```

---

### Task 7: Operational memory, full verification, and review

**Files:**
- Modify: `AGENTS.md`
- Modify: `DASHBOARDS-MEMORY.md`
- Create: `docs/SHARED-DASHBOARD-PASSWORD-ROLLOUT.md`

**Interfaces:**
- Documents: DB authority, Abbott fallback, Zaruku fail-closed behavior, session revocation, migration/seed/deploy order, and rollback.

- [ ] **Step 1: Update authoritative memory and rollout commands**

Document this production sequence without embedding a password:

```bash
set -a
. /var/www/dashboard/.env
set +a
npm run db:migrate
read -rsp "Zaruku password: " SHARED_PASSWORD
printf '%s' "$SHARED_PASSWORD" | npm --silent run access:set-shared-password -- --client-id zaruku
unset SHARED_PASSWORD
```

Document that `ABBOTT_DASHBOARD_PASSWORD` remains required only for the transitional fallback, that new admin rotations use the DB, and that rollback never deletes the credential table.

- [ ] **Step 2: Run the complete verification suite**

Run:

```bash
npm test -- --runInBand
bash scripts/render-production-env.test.sh
bash scripts/validate-production-release.test.sh
npm run security:public-assets
npm run lint
npm run typecheck
npm run build
```

Expected: 245 existing tests plus new tests pass, both Bash suites pass, asset scan is silent/successful, lint/typecheck/build exit `0`.

- [ ] **Step 3: Request two-stage code review**

First reviewer checks exact spec compliance. Second reviewer checks code quality, auth bypasses, secret leakage, transaction safety, rate limiting, session invalidation, and unrelated regressions. Resolve every Critical/Important finding with a new failing test before code changes.

- [ ] **Step 4: Commit documentation and review fixes**

```bash
git add AGENTS.md DASHBOARDS-MEMORY.md docs/SHARED-DASHBOARD-PASSWORD-ROLLOUT.md
git commit -m "docs: record shared dashboard password operations"
```

---

### Task 8: Production migration, seed, deploy, and smoke

**Files:**
- Production source checkout: `/root/reportingdash-rollout/dashboard-next`
- Production app: `/var/www/dashboard`
- Protected checkpoint: `/root/reportingdash-private/dashboard-shared-password/<UTC timestamp>/`

**Interfaces:**
- Consumes: reviewed branch head and all Task 7 evidence.
- Produces: active migrated app, Zaruku shared password hash, Abbott fallback continuity, protected deployment evidence.

- [ ] **Step 1: Push reviewed app commit and create protected production checkpoint**

Record only previous Git revision, active release target, schema presence/counts, and crontab/PM2 status. Set checkpoint directory `0700` and files `0600`; do not copy `.env`, session cookies, passwords, or password hashes.

- [ ] **Step 2: Update the production source checkout and apply migration before cutover**

Run `npm run db:migrate` from the reviewed production source with `/var/www/dashboard/.env` exported. Verify table columns and foreign key through `information_schema`; output only boolean/count assertions.

- [ ] **Step 3: Seed Zaruku through protected stdin**

Use a TTY with `read -rsp`, pipe the approved initial value to `npm --silent run access:set-shared-password -- --client-id zaruku`, immediately unset the variable, and verify only `configured=true` and `credential_version>=1`. Do not print or checkpoint the credential.

- [ ] **Step 4: Deploy atomically and smoke both dashboards**

Deploy the reviewed app release, then verify:

- `/api/health` returns `200` locally and publicly;
- admin Settings shows `Пароль доступа` for Abbott and Zaruku;
- Zaruku accepts the approved initial password and rejects an incorrect password;
- Abbott still accepts its current fallback password until an admin rotation occurs;
- static JS/CSS/font requests return `200` with zero browser page errors;
- former public Abbott assets remain `404`.

- [ ] **Step 5: Prove rotation revokes a prior Zaruku session**

Authenticate once, rotate Zaruku once more to the same intended password through the admin API/UI, verify the old session returns `401`, and verify a fresh login succeeds. Capture only HTTP status codes and credential versions, never cookies or credentials. Using the same password proves that credential versioning—not a password value mismatch—revoked the old session.

- [ ] **Step 6: Finish or rollback**

If migration, seed, deploy, or smoke fails, reactivate the prior app release while retaining the table and hash. If all checks pass, retain the protected checkpoint, report exact commit/release IDs and test counts, and merge/push the reviewed branch to `main`.
