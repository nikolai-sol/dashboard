# Abbott and Zaruku Shared Password Admin Design

## Goal

Add an admin form that changes the mandatory shared viewer password for the
Abbott and Zaruku dashboards. The current password is never displayed, and the
change immediately invalidates the old password and all viewer sessions issued
with the previous password version.

## Scope

- Abbott and Zaruku use mandatory `password_only` viewer access.
- Neither dashboard can become public through this feature.
- The existing email/password user administration remains unchanged for every
  other dashboard.
- The Abbott embed key remains environment-managed and is not exposed in this
  UI.
- Zaruku receives the agreed initial password during the production rollout.
  The plaintext value is not committed to Git, embedded in SQL, or returned by
  an API.

## Persistence

Create `dashboard_shared_access_settings`, keyed by `dashboard_id`, with:

- `password_hash`: salted `scrypt` hash using the existing application format;
- `credential_version`: monotonically increasing unsigned integer;
- `updated_by`: normalized admin email for audit attribution;
- `created_at` and `updated_at` timestamps.

The table stores no plaintext password. A generic data-access module owns
reading and rotating settings. It accepts only dashboards whose normalized
`client_id` is `abbott` or `zaruku` and updates the hash and version in one
transaction.

During migration, Abbott keeps an environment fallback only while it has no DB
settings row. The fallback has credential version `0`. The first admin password
change creates the DB row and makes it authoritative. Zaruku is fail-closed
until its initial hash is seeded before the application cutover.

## Authentication and Session Revocation

The access policy treats both Abbott and Zaruku as protected shared-password
dashboards regardless of `dashboard_access_users` rows. Their auth mode is
always `password_only`.

Password verification uses the DB hash when a settings row exists. Only the
Abbott no-row transition path may compare the current environment password.
Zaruku has no plaintext environment fallback.

Password-authenticated manager viewer sessions include the dashboard's
`credential_version`. Every protected dashboard request checks the session
version against the current DB setting (or Abbott fallback version `0`). A
password rotation increments the version, so all older viewer cookies and
tokens fail and require re-login. Embed access remains independent and is not
revoked by a shared-password change.

The direct dashboard login route uses the existing in-process rate limiter,
keyed by client IP and dashboard identifier. Invalid credentials and rate-limit
responses never reveal whether a settings row exists.

## Admin API

Add a protected route scoped to one dashboard:

- `GET /api/admin/dashboards/:id/shared-password`
- `PUT /api/admin/dashboards/:id/shared-password`

`GET` returns only safe state: support flag, whether a password is configured,
and the last change timestamp. It returns neither the password hash nor the
credential version.

`PUT` accepts `new_password` and `confirm_password`. Server validation requires:

- the selected dashboard is Abbott or Zaruku;
- both fields match exactly;
- password length is at least 10 characters;
- password length is bounded to prevent excessive `scrypt` work.

The route derives `updated_by` from the signed admin session, not from request
JSON. Success returns only `{ ok: true, configured: true, updated_at }`.
Unexpected errors produce a generic sanitized response and server log without
request bodies, password values, hashes, or DSNs.

## Admin UI

The existing Settings screen keeps the dashboard selector. When Abbott or
Zaruku is selected, it shows a Russian-language card titled `Пароль доступа`:

- status `Пароль установлен` or transition status for Abbott;
- `Новый пароль` field;
- `Повторите пароль` field;
- `Сменить пароль` button;
- confirmation text explaining that existing viewer sessions will close.

The form never pre-fills a password. On success it clears both fields and shows
that the password changed and previous viewer sessions were revoked. Client
validation improves feedback, while the server remains authoritative. For all
other dashboards, the current access-user editor and behavior remain visible.

## Initial Zaruku Credential

Provide a one-purpose server-side seeding command that reads the password from
standard input without echoing it, resolves `client_id=zaruku`, hashes it, and
uses the same transactional rotation function as the admin API. It must refuse
command-line password arguments.

During production rollout, apply the migration, seed the user-approved initial
Zaruku password through protected standard input, and verify only that login
succeeds. No checkpoint, log, shell history entry, or deployment artifact may
contain the plaintext value.

## Deployment Order and Rollback

1. Build and test the application from the reviewed commit.
2. Back up schema metadata and apply the repeat-safe migration explicitly.
3. Seed the Zaruku password hash before cutover.
4. Deploy the application atomically and restart PM2.
5. Verify Abbott's existing password fallback, rotate Abbott through the admin
   form only when requested, and verify Zaruku password login.
6. Verify an old session is rejected after a test rotation, then restore the
   intended credential through the same form.

Application rollback keeps the new table and hashes. A predecessor application
continues using the Abbott environment password and treats Zaruku according to
its predecessor policy. Do not delete the table or restore plaintext secrets as
part of rollback.

## Tests and Acceptance Criteria

Automated tests must prove:

- the migration is repeat-safe and contains no plaintext bootstrap password;
- Abbott and Zaruku never resolve to public or email/password mode;
- other dashboards retain current auth-mode behavior;
- only supported dashboards can read or rotate shared password settings;
- passwords are stored as salted `scrypt` hashes and never returned;
- mismatched, short, and excessively long inputs are rejected;
- rotation increments `credential_version` atomically;
- old viewer sessions fail after rotation while current sessions and embed
  access work;
- Abbott fallback works only before its DB row exists;
- Zaruku without a DB row fails closed;
- direct login rate limiting is applied without credential disclosure;
- the admin form renders only for Abbott and Zaruku, clears secrets after save,
  and preserves the existing user editor for other dashboards;
- production env validation remains compatible with the Abbott transition and
  does not add a plaintext Zaruku password requirement.

Production acceptance requires successful health checks, browser smoke tests
for admin Settings plus both dashboard login gates, rejection of the previous
Zaruku session after rotation, and confirmation that no response or log contains
a password or password hash.
