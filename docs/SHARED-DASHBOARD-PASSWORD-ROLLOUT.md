# Shared Dashboard Password Rollout

This is the production operator contract for the Abbott and Zaruku shared viewer passwords. It records
the required order and safe boundaries; it does not mean that a migration, seed, deployment, secret
change, or rollback has occurred.

## Authority and access invariants

- Abbott and Zaruku always resolve to mandatory `password_only` access. Rows in
  `dashboard_access_users` cannot make either dashboard public or switch it to `email_password`.
- A row in `dashboard_shared_access_settings` is authoritative. The table stores only a salted
  `scrypt` hash, monotonically increasing `credential_version`, audit actor, and timestamps.
- Abbott alone may use `ABBOTT_DASHBOARD_PASSWORD` as the version-`0` fallback, and only while no Abbott
  row exists. The current production env renderer and release validator still require the variable for
  this transition. The first Abbott seed or admin rotation creates the DB row; all later rotations use
  the DB and do not update or consult the env password.
- Zaruku has no environment-password fallback. A missing Zaruku settings row fails closed, which is why
  its hash must be seeded after migration and before application cutover.
- The admin form and seed command use the same transactional rotation path. A rotation locks the active
  dashboard and credential row, stores a new hash, and increments the version atomically.
- Password-authenticated manager viewer sessions and derived export tokens carry the credential version.
  Protected dashboard, Excel, and PDF requests compare it with current authority. Any rotation therefore
  revokes older manager sessions and exports, even when the replacement password text is unchanged.
- Abbott's `ABBOTT_DASHBOARD_EMBED_KEY` is an independent environment-managed credential. Embed access is
  audience-scoped and unversioned; a shared-password rotation neither changes nor revokes it.

## Preflight

Use the reviewed commit in `/root/reportingdash-rollout/dashboard-next` and a private interactive TTY.
Complete the full local verification suite before production work. Confirm that exactly one active
dashboard resolves for `client_id=zaruku` without displaying row contents.

Do not place a plaintext password or password hash in Git, a command-line argument, shell history, logs,
terminal capture, checkpoints, tickets, documentation, API responses, or deployment artifacts. Do not
print environment files, cookies, session/export tokens, hashes, or database connection strings.

## Mandatory production order

The order is migration -> silent stdin seed -> deploy. Run the following from the reviewed production
source checkout, not from an older deployed application bundle. The live application's environment is
exported only to give the reviewed migration and seed commands their existing database configuration.
The subshell scopes all exported environment values and guarantees temporary-password cleanup on both
success and failure. `set -euo pipefail` makes migration and seed separate gates.

```bash
cd /root/reportingdash-rollout/dashboard-next
(
  set -euo pipefail
  trap 'unset SHARED_PASSWORD' EXIT

  set -a
  . /var/www/dashboard/.env
  set +a
  npm run db:migrate
  read -rsp "Zaruku password: " SHARED_PASSWORD
  printf '%s' "$SHARED_PASSWORD" | npm --silent run access:set-shared-password -- --client-id zaruku
)
```

The seed command accepts only `--client-id abbott|zaruku` and reads the password from standard input.
It must never be invoked bare from a TTY: its direct fd-`0` read would echo typed input and wait for EOF.
Use it only as the right-hand side of the hidden `read -rsp` plus `printf` pipeline above. Never replace
stdin with a `--password` argument, command substitution, here-document, or literal value. The `EXIT` trap
unsets `SHARED_PASSWORD` whether the seed succeeds or fails, and leaving the subshell discards the sourced
environment. If migration or seed fails, do not deploy; correct the reviewed source or environment and
repeat the safe sequence without exposing inputs.

Only after migration `042` and a successful Zaruku seed may the reviewed application release be deployed
with the existing atomic `npm run deploy` workflow. The deploy command does not own this schema migration
or seed and must not be used to infer that either has happened.

## Safe verification

Before cutover, query only schema metadata and boolean/count assertions:

- migration `042` completed and `dashboard_shared_access_settings` has the reviewed columns, primary key,
  and foreign key;
- Zaruku is configured and its credential version is at least `1`;
- no password, hash, session/export token, cookie, environment value, or DSN appears in captured output.

After deploy, verify health locally and publicly, then smoke the Settings form and both login gates. Abbott
must accept its current version-`0` fallback until an Abbott DB row is created. Zaruku must accept the
approved password and reject an incorrect password without disclosing whether a settings row exists.

The application process must listen only on loopback, with nginx as the sole public entry point. Run the
packaged listener check from the reviewed source checkout after every deploy or compatible rollback; it
fails if port `3001` is absent, bound to a non-loopback address, or reachable directly through the public
host:

```bash
PUBLIC_APP_HOST=5.35.85.218 APP_PORT=3001 bash scripts/verify-loopback-listener.sh
curl -fsS https://dashboards.adreports.ru/api/health >/dev/null
```

Nginx must continue to overwrite `X-Real-IP` from `$remote_addr`. The login service ignores
`X-Forwarded-For`, applies a strict `10`-attempt/15-minute bucket to the resolved IP plus dashboard, and a
higher `100`-attempt/15-minute IP-wide abuse ceiling. Successful authentication resets both relevant
buckets; failures do not.

To prove version revocation, authenticate to Zaruku, rotate once more to the same approved password through
the admin form, confirm the old manager session is rejected, and confirm a fresh login succeeds. Capture
only status codes and non-secret boolean/version assertions; never capture cookies or credentials.

## Rollback

Rollback is application-only and may activate a predecessor only after verifying that the target release
keeps both Abbott and Zaruku mandatory `password_only` and authorizes manager viewer/export requests against
the retained DB hashes and credential versions. Base `0c9e046` is not compatible and is not an eligible
rollback target. Never allow Zaruku to become public during rollback.

Every compatible bundle contains the regular file `.shared-password-db-auth-v1`. Release validation rejects
a missing or symlinked marker and rejects any PM2 configuration that does not set `HOSTNAME=127.0.0.1`.
Manual rollback checks the marker before moving the current application. Automatic activation rollback
reactivates a predecessor only when that predecessor carries the marker; otherwise it stops PM2, keeps the
incompatible predecessor in its backup directory, and leaves the application fail-closed until a corrected
compatible release is deployed.

For an eligible rollback, reactivate the verified compatible release with `npm run deploy:rollback`, while
retaining migration `042`, the `dashboard_shared_access_settings` table, password hashes, and credential
versions. Never drop or truncate the table, delete a row, decrement a version, copy a hash into an env file,
or restore a plaintext password. The compatible predecessor must find the retained rows and must not
silently reseed or rewrite them.

If no compatible predecessor exists, do not reactivate an incompatible release. The automatic rollback
stops the application process; preserve that fail-closed state and deploy a corrected compatible release.
Preserve the table, hashes, and versions throughout this recovery path.

## Administrative rotations after rollout

Use the admin Settings card for normal Abbott and Zaruku rotations. The current password is never displayed,
and successful changes clear the form. A rotation writes the DB and revokes prior manager viewer/export
sessions by incrementing the credential version. It does not rotate Abbott's embed key.
