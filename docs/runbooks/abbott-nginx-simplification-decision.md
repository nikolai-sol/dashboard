# Abbott: Nginx dependency decision — 2026-09-15

## Goal and current state

Move the existing Abbott public URLs to its isolated runtime after visual and
data parity with the approved 2026-09-14 baseline. The public route has not been
switched as of this source checkpoint. No deployment or server edit was
performed while implementing the change below.

Work resumed with owner authorization at 22:22 Europe/Vienna. This continues
the existing migration; it is not a new task or a reset of its history.

## Finding from the actual configuration

Read-only inspection of `/etc/nginx/conf.d/dashboard-next.conf` establishes that
supporting `^~` alone cannot make the current deployment preflight succeed.
The selected HTTPS server also contains:

- static-file `root`, `alias`, `index`, and `try_files` directives;
- Coopervision `auth_request` and `error_page` directives;
- the named location `@coopervision_login_redirect`;
- Coopervision proxy targets on port 8093, including query variables.

The current Abbott validator rejects these normal foreign constructs. This is
a mismatch between validation scope and deployment ownership; it is not evidence
that the live Nginx configuration is invalid. Foreign include files were not read.

The earlier local redirect patch passed 531 tests but cannot unblock this
configuration. It remains uncommitted and undeployed. Do not publish it as a
completed fix or add foreign directive support one item at a time.

## Implemented scope change

Application deployment is now separated from public route cutover using the
existing deployment worker and existing Abbott route fragment:

1. During shadow deployment, preserve the main Nginx file's existing stable
   byte/metadata snapshot and drift checks. Replace the requirement to interpret
   all neighboring routing behavior with an Abbott-only ownership check.
   Retain current process, artifact, account, listener, and rollback checks.
2. Before public cutover, use native `nginx -t` to validate the full configuration;
   inspect effective routing for conflicts with the twelve exact Abbott paths
   and `/_next-abbott/`. Included routes must be considered at this stage; a
   single-file snapshot cannot establish effective routing correctness.
3. Keep `verify-abbott-nginx-routes.mjs` as the validator for the owned fragment.
   Preserve existing configuration bytes outside the marked Abbott insertion.
4. Require candidate screenshots and data comparison before insertion, then
   native syntax validation and Abbott/neighbor smoke. Roll back only the
   inserted Abbott block if cutover verification fails.

The production Abbott deployment wiring now uses the ownership-only check
explicitly. The reusable proof keeps the earlier strict validator as its default
for the existing parser/security fixtures. The new check accepts either no
Abbott locations or the complete validated fragment, rejects partial, nested,
modified, or duplicate Abbott ownership and any other port-3004 route, and keeps
the exact main-file byte/metadata snapshot through the transaction.

Local verification on 2026-09-16 passed `npm run test:abbott-runtime` with 849
tests and zero failures, including realistic foreign directives, exact cutover
ownership, nested/partial rejection, production wiring, and snapshot drift.
The source hash used by the bounded read-only transport was updated mechanically.

The first two shadow-deploy attempts then refused before mutation at
`preflight_neighbor_combined/proc_metadata`. A bounded read-only reproduction
showed that `/proc/1/net/tcp` changed only `mtime`/`ctime` while its open
descriptor identity, ownership, mode, link count, content bounds, protected
listeners, and repeated listener snapshot remained valid. Procfs reads now pin
structural descriptor metadata but do not treat those volatile timestamps as
file identity; ordinary files and process-directory identities retain the full
timestamp check. A red/green regression covers this exact churn while the
existing inode/PID/listener race refusals remain green.

## Remaining live gates

- Publish the reviewed Abbott branch and deploy only the port-3004 shadow.
- Re-run manager/embed comparison, candidate capture, and read-only smoke.
- Before route mutation, run native `nginx -t`, inspect the effective config for
  conflicting Abbott ownership, and validate the exact fragment.
- Cut over only after every shadow gate passes; then run Abbott and neighbor
  regression smoke and retain the route-only rollback checkpoint.
