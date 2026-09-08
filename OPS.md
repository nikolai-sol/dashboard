# OPS

Короткий operational runbook для production.

Важно:
- authoritative memory now lives in [AGENTS.md](/Users/nicko/ReportingDash/dashboard-next/AGENTS.md)
- если этот файл расходится с `AGENTS.md`, сначала верить `AGENTS.md`, потом чинить `OPS.md`

## Production runtime

`dashboard-next` сейчас работает так:

- runtime: `PM2`
- PM2 app: `dashboard-next`
- bind: `127.0.0.1:3001`
- app dir: `/var/www/dashboard`
- staged releases dir: `/var/www/dashboard-releases`
- rollback backups dir: `/var/www/dashboard-backups`
- public URL: `https://dashboards.adreports.ru`

Legacy runtime отдельно:

- `nest-analytics` остаётся в root PM2

## SSH

Подключение:

```bash
ssh beget
```

## Основные команды

### Статус приложения

```bash
pm2 status
pm2 describe dashboard-next
```

### Перезапуск приложения

```bash
pm2 restart dashboard-next
```

### Остановить

```bash
pm2 stop dashboard-next
```

### Запустить

```bash
cd /var/www/dashboard
pm2 start ecosystem.config.js --only dashboard-next
```

### Сохранить PM2 state

```bash
pm2 save
```

## Логи

### Live logs

```bash
tail -f /var/log/dashboard-next-out.log /var/log/dashboard-next-error.log
```

### Последние 200 строк

```bash
tail -n 200 /var/log/dashboard-next-out.log
tail -n 200 /var/log/dashboard-next-error.log
```

### Логи за сегодня

```bash
grep "$(date +%F)" /var/log/dashboard-next-out.log | tail -n 200
grep "$(date +%F)" /var/log/dashboard-next-error.log | tail -n 200
```

## Health checks

### Локально на VPS

```bash
curl -s http://127.0.0.1:3001/api/health
```

### Публичный health

```bash
curl -s https://dashboards.adreports.ru/api/health
```

### Проверка main routes

```bash
curl -I https://dashboards.adreports.ru/dashboard/rag_mp
curl -I https://dashboards.adreports.ru/admin/dashboards
```

## Nginx

### Проверить конфиг

```bash
nginx -t
```

### Перезагрузить nginx

```bash
systemctl reload nginx
```

### Конфиг dashboard

```text
/etc/nginx/conf.d/dashboard-next.conf
```

Важно:

- bootstrap script `scripts/setup-vps.sh` должен рендерить `dashboards.adreports.ru`
- TLS должен смотреть на реальный cert/key этого домена
- не возвращать старый `dashboard.bayesly.digital` или ISPmanager cert как default

## PM2 app

### PM2 config

```text
/var/www/dashboard/ecosystem.config.js
```

### App directory

```text
/var/www/dashboard
```

## Zaruku: read-only shadow verification (no cutover)

The isolated Zaruku runtime is a local/review artifact only. The public domain and all existing
routes still point to the combined runtime. Do not start a production shadow, add a PM2 process,
or edit the proxy from these commands.

Local build stamping requires Python 3 on macOS or Linux, including `dir_fd` support for
`open`, `stat`, `link`, and `replace`, plus descriptor-based directory listing. The build-only
`scripts/stamp-runtime-artifact.py` validates the whole tree and all output destinations before
writing, pins ancestor/destination directories without following links, and publishes new file
inodes without truncating an existing package inode. Run
`python3 -I -B scripts/stamp-runtime-artifact.test.py` for disposable publication/read-race checks;
the artifact-policy suite runs these too. Python is not required by deployed verification or the
runtime launcher. Direct `verify:boot` refuses UID or EUID 0; remote verification retains the
separate reviewed Linux `setpriv` path.

The isolated release worker accepts credentials only from the fixed
`/var/www/.dashboard-zaruku-secrets/runtime.env` file. Its directory and file must be root-owned
with no group/other permissions (provision as `0700` and `0600` respectively). The file must be
single-link, UTF-8, at most 65,536 bytes, and end
with a newline. Each nonempty/noncomment line is exactly `KEY='value'`; duplicates, unknown keys,
control characters, embedded quotes, backslashes, and backticks fail closed. Values are never
evaluated by a shell. There is no path override or fallback to the combined `.production.env`.

| Input key | Requirement |
| --- | --- |
| `ZARUKU_DB_HOST`, `ZARUKU_DB_PORT` | Required dedicated connection endpoint; port 1–65535 |
| `ZARUKU_DB_USER`, `ZARUKU_DB_PASSWORD`, `ZARUKU_DB_NAME` | Required dedicated Zaruku account/database; no generic `MYSQL_*` or `DB_*` input accepted |
| `DASHBOARD_AUTH_SECRET` | Required reviewed signed-session authority; must preserve session compatibility during shadow comparison |
| `NEXT_PUBLIC_BASE_URL` | Optional; defaults to `https://dashboards.adreports.ru` |
| `PUPPETEER_EXECUTABLE_PATH` | Optional Chromium executable path |

This is the complete input allowlist. The renderer maps only the dedicated DB values to runtime
`DB_*` and `MYSQL_*` aliases needed by existing canonical readers and sets the fixed loopback
host/port and internal export URL. Missing/unsafe files and invalid input errors contain no secret
values. Provisioning the dedicated account, verifying only the required canonical/shared-auth
read grants, installing this file, and validating the target filesystem/service permissions remain
cutover prerequisites; none is performed by these source changes.

Fixed provisioning uses `node scripts/provision-zaruku-shadow.mjs` with exactly one
fixed action: `host-check`, `host-apply`, `host-rollback`, `db-provision`, `auth-install`,
`inventory-check` or `inventory-install`. It requires clean named source and exact live
release-ref equality, then verifies the whole SHA-addressed staged closure before
entering the core-only dispatcher with an empty environment. Direct host/auth/inventory
mutation CLIs refuse. No host, path, identity, credential or journal override exists.
Production authorization remains separate; host/DB mutation requires real/effective root.

`apply` creates the `dashboard-zaruku` system group and user, with only that group, shell
`/usr/sbin/nologin`, home `/nonexistent`, and no home creation. Numeric GID lookup must resolve
back to `dashboard-zaruku`, and the NSS group listing must contain exactly one entry with that
GID. Numeric UID reverse lookup and full passwd enumeration enforce the same uniqueness;
aliases, malformed/incomplete/inconsistent NSS results fail before recording identity.
The release and backup roots `/var/www/dashboard-zaruku-releases` and
`/var/www/dashboard-zaruku-backups` are root:root `0711`: service traversal only,
no listing or writes. These roots are root:root `0700`:
`/var/www/.dashboard-zaruku-control`, `/var/www/.dashboard-zaruku-secrets`,
`/var/www/.dashboard-zaruku-shadow`, and its `evidence` child. Compliant complete state is an
idempotent no-op; only the exact immutable staged predecessor is an allowed partial state.
Other partial/foreign state, unsafe ancestry, and an occupied port `3002` fail
before mutation. The active app path and deploy lock are not created by provisioning.

Before its first host mutation, apply exclusively creates the root-owned, single-link `0600`
creation journal `/var/www/.dashboard-zaruku-host-creation.json`. It records the run identity,
absent or exact staged predecessor, and verified post-step account or device/inode/owner/group/mode metadata,
persisting each step atomically. The journal contains no credential values and remains after
success. `host-rollback` consumes only that fixed journal and validates every removal before
starting. Changed identities/inodes, foreign directory contents, and incomplete post-step
evidence stop rollback. A process crash between a mutation and recording its resulting identity
requires operator review; rollback never guesses ownership from a path name. Rollback preserves
the journal, marked `rolled-back`, and never removes a nonempty secret, auth, release, or evidence
directory. A subsequent fresh provisioning run therefore requires a separately reviewed journal
retention/recovery decision.

`db-provision` generates 48 cryptographic random bytes in memory, keeps one admin
MySQL process/session and fixed creation lock through account creation, all 35 grants,
permission probes and atomic runtime-secret installation. Reconnect is disabled;
every reply is fenced by random marker and unchanged CONNECTION_ID. The helper accepts
only exact account/table/query operations, with acknowledged CREATE ownership required
for grants/rollback. Reader credentials use an anonymous sealed memfd, never argv/env.
The runtime secret uses the same 96-hex password and reads only
`/var/www/www-root/data/.production.env`, requiring root:root
`0600`, a single regular-file link, safe root-owned ancestry, and a stable read of at most 65,536
bytes. Source syntax allows blank lines, full-line comments, and `KEY=value`, `KEY='value'`, or
`KEY="value"`. Duplicate names anywhere, controls, malformed UTF-8, `export`, interpolation,
escapes, multiline values, and inline comments are rejected without evaluation. Only
`DASHBOARD_AUTH_SECRET` and optional `PUPPETEER_EXECUTABLE_PATH` are copied. Dedicated DB values
are fixed to `127.0.0.1:3306`, `dashboard_zaruku_reader`, and `report_bd`; the public base URL is
`https://dashboards.adreports.ru`. The shared serializer preserves the existing exact single-quoted
reader grammar and rejects unsupported characters instead of escaping them.

Secret publication writes and fsyncs an anonymous Linux O_TMPFILE `0600` inode, links
its fixed inherited proc-FD directly to the final name, and fsyncs its directory,
then reopens without following links and validates through the release reader and renderer.
Every existing destination is rejected without replacement. The durable private
`/var/www/.dashboard-zaruku-shadow/db-provision.json` receipt records source/run/session,
acknowledged account creation and the exact secret inode. Failure removes only its
acknowledged DB account under the same live creation lock and its exact owned inode.
Unknown CREATE/session/DROP/release replies require review; never reconnect to guess
cleanup. No credential temp pathname, value or credential digest reaches diagnostics.

`node scripts/provision-zaruku-shadow.mjs auth-install` uses the exact-ref/closure
guard before the staged installer reads stdin. It accepts exactly
`{"headers":{"cookie":"..."}}`, with a nonempty cookie of at most
4096 characters and total input at most 65,536 bytes. Extra/duplicate keys, other headers
(including `authorization` and `host`), malformed UTF-8, and control characters fail closed.
Interactive input has terminal echo disabled before reading and restored in `finally`. It
atomically publishes root-owned single-link `0600`
`/var/www/.dashboard-zaruku-shadow/auth.json`; a preexisting nonempty descriptor is never replaced.
It prints only `status` and the SHA-256 of the exact descriptor bytes. The cookie-only contract is
a strict subset of the read-only verifier's accepted header descriptor. These tools have been
tested with injected identities and real locked Linux production-mode fixtures; this source change performs no
production provisioning, deployment, MySQL operation, proxy edit, or runtime start.

Local comparison requires two already-running loopback runtimes backed by the same canonical
MySQL snapshot and the same explicit historical range. Build the combined runtime and the isolated
artifact first, then start them in separate terminals with credentials loaded from private files or
the existing local environment. Never place passwords or tokens in command arguments.

```bash
npm run build
npm --workspace apps/zaruku run build

# terminal 1, after loading the existing private local runtime environment
npm start

# terminal 2, after loading the same canonical read-only environment
npm --workspace apps/zaruku start
```

Prepare a mode-`0600` JSON auth descriptor containing only the manager request headers and a TSV
inventory of the other runtimes' authoritative SHA files. Neither file belongs in Git or in the
evidence directory. Open the auth descriptor on a file descriptor so credential values never
appear in argv, logs, or evidence:

The standalone command below is an adapter/fixture interface, not the production entrypoint.
It additionally requires an inherited `ZARUKU_SHADOW_COVERAGE_FD` that provides a fresh bounded
`{"sha256":"<64 lowercase hex>"}` metadata token on each `observe` request. Never fabricate a
production token or reuse a saved one. Production supplies this descriptor through the fixed worker.

```bash
exec 9</private/path/zaruku-shadow-auth.json
export ZARUKU_SHADOW_AUTH_FD=9
# FD 8 must already be supplied by the reviewed live canonical metadata adapter.
export ZARUKU_SHADOW_COVERAGE_FD=8
export ZARUKU_SHADOW_ARTIFACT_ROOT="$PWD/apps/zaruku/.next-zaruku/standalone"
export ZARUKU_SHADOW_OTHER_RUNTIME_SHAS_FILE=/private/path/other-runtime-shas.tsv
export ZARUKU_SHADOW_CANONICAL_SNAPSHOT=reviewed-snapshot-label
export ZARUKU_SHADOW_FROM=2026-01-01
export ZARUKU_SHADOW_TO=2026-07-31
# Optional; default 15000, allowed range 100..30000. Covers headers and the complete body.
export ZARUKU_SHADOW_HTTP_TIMEOUT_MS=15000
bash scripts/verify-zaruku-shadow.sh \
  http://127.0.0.1:3001 \
  http://127.0.0.1:3002 \
  /private/path/new-zaruku-shadow-evidence
exec 9<&-
```

The verifier performs only HTTP `GET` requests. It compares the combined and isolated manager JSON,
authentication challenge metadata, PDF, and Excel responses; validates the distinct combined and
isolated health contracts; records SHA/scope/routes; scans the isolated artifact for cross-runtime
markers; and proves that every listed other-runtime SHA is unchanged before/after. It compares
semantic JSON exactly. PDF comparison masks only `CreationDate` and `ModDate` in the referenced
PDF Info object plus the generated trailer/XRef document ID; every other PDF byte remains part of
the comparison. A structural PDF token scan identifies those dictionaries and never treats text in
literal strings, comments, or content streams as a trailer, XRef, or Info reference. XLSX
comparison expands the package, compares every sorted entry by content, and
ignores only ZIP container order/compression/timestamps plus `created` and `modified` values in
`docProps/core.xml`. The only ignored response headers are
`connection`, `content-length`, `date`, `keep-alive`, `server-timing`, `transfer-encoding`, and
`x-response-time`; only combined-health `db_latency_ms`, `timestamp`, and `uptime_seconds` are
treated as volatile. Every request has one bounded deadline covering response headers and the full
body. Parser, assertion, HTTP, and descriptor failures emit only a fixed sanitized error; response
bodies, response headers, and authentication values are never written to stdout, stderr, or
evidence.

Before any production shadow start, all of these separate prerequisites are mandatory:

- execute `scripts/boot-zaruku-service.linux.test.mjs` in a reviewed, network-disabled Linux
  Node + util-linux image with the documented `SYS_PTRACE` fixture capability;
- provision and verify the fixed `dashboard-zaruku` service account/group, root-owned ancestry,
  release/control/environment permissions, `/usr/bin/setpriv`, `/proc`, `ss`, and PM2 UID/GID/cwd
  attestation on the target host;
- provision a separate Zaruku DB account with reviewed least-privilege grants and install/validate
  the fixed dedicated credential file above; record only key names and permission/grant outcomes;
- review the live loopback port/process plan, immutable runtime SHA inventory, canonical snapshot
  window, evidence retention path, and rollback/recovery procedure.

A public exact-path Zaruku route cutover requires a separate reviewed production plan after a real
production shadow passes. This runbook section does not authorize or perform that cutover.

### Fixed production-shadow tooling (separate authorization required)

Tasks 4–5 add source/control tooling only. No production command in this section was
executed during implementation. Public routing remains combined on `127.0.0.1:3001`.

Local preparation is explicit:

```bash
# The two image input files must already be reviewed and committed.
bash scripts/build-zaruku-linux-fixture.sh --lock
# Review/commit the resulting immutable image ID and complete package-manifest hash.
bash scripts/build-zaruku-linux-fixture.sh
bash scripts/run-zaruku-linux-fixtures.sh
npm run test:zaruku-production-shadow
```

The builder uses the pinned official Node 22 Bookworm Slim amd64 manifest, one dated Debian
snapshot and exact Python/util-linux/passwd versions, with no recommends. No repository or private
data enters the image. Normal verification cannot build/pull or alter the lock. Runtime uses only
the recorded local image ID with `--platform linux/amd64 --network none --read-only`, read-only
source, disposable tmpfs, `--rm` and only `SYS_PTRACE` added. Build/privilege and real memfd/process
fixtures and the real receipt-bound evidence-writer lifecycle fixture must all pass. The image
manifest explicitly requires `/usr/bin/timeout`; its pinned image/package hashes are unchanged.
Predeploy runs source tests only; it never builds or runs Docker.

After independent acceptance and explicit release-ref authorization, use
`node scripts/freeze-zaruku-shadow-release.mjs check`; only an explicitly approved
creation may use `create-if-absent`. OpenSSH ignores user/system SSH config with
`-F /dev/null`, fixes `git@github.com:22` and its host-key alias, and disables
proxies, local commands, forwarding and connection sharing. Strict verification
uses the existing account `~/.ssh/known_hosts`; default account keys or a validated
owned agent socket provide authentication only. No inherited routing environment
or known-host/key installation is accepted. `deploy/zaruku/repository.json` pins the literal
`git@github.com:nikolai-sol/dashboard.git` destination for check/push/readback and
child checks. Remote operations use a clean ownership-known temporary bare Git
repository, no checkout config/refs/tags/hooks, disabled system/global config,
one explicit refspec, no follow-tags/hooks/submodule recursion, and an atomic
expected-absent lease. Alternate/multiple URLs, pushurl and rewrite/include config
reject; the real CLI accepts no destination override. Only candidate-reachable
objects are imported; source config/refs remain unchanged. No unknown/different
existing ref can be overwritten.
Before each provisioning or child-deploy action the live ref must still equal HEAD.

After separately reviewed production authorization, `npm run shadow:zaruku:stage-control` stages
only the fixed 22-file manifest-covered bundle under
`/var/www/.dashboard-zaruku-shadow/control/<reviewed-40hex-SHA>`. It accepts no path/host/file-list
override and cannot provision accounts, secrets, DB grants, release refs, application files, PM2
or Nginx. Existing bundles must match bytes and pinned inodes exactly.
The deprecated host/auth CLI paths contain core-only refusal facades, with no
implementation import or re-export. The dispatcher imports the separate internal
host/auth libraries only after complete staged attestation. Their own direct CLI
and symlink-alias executions also refuse before loading any non-core dependency.

The authority now includes exactly one foreign SHA entry: `combined-dashboard` at
`/var/www/dashboard/.release-source-sha`. Run the source interface
`node scripts/provision-zaruku-shadow.mjs inventory-check` or `inventory-install` only in the
approved preparation step. It never overwrites a different inventory. Host/DB/secret/auth
provisioning and release-ref changes remain separate explicit operations.

With every prerequisite already provisioned, the sole production orchestration entrypoint is
`npm run shadow:zaruku:run` with no arguments or authority environment overrides. It reattests the
staged bundle read-only before every remote worker action, runs the fixed prerequisites and full
local gate, checks exact release authority, then invokes the sealed Zaruku deployer
once. Port `3002` must still be free: never manually deploy before orchestration.
The child receives the SHA/run ID through stdin and independently rechecks the live
ref before activation. It verifies the active artifact and exact process/kernel identity and loopback
listener, performs paired January–August manager/PDF/XLSX comparison, and rechecks the combined PID,
complete loaded Nginx hash and fixed foreign SHA/inode. No Nginx command or cutover branch exists.

Retry occurs once only if the exact schema-attested 25-family canonical metadata token changes
during the first differing pair. Dated facts/Alice months are period-scoped; the current Wordstat
and SEO histories remain account-scoped as in the read model. No tables are locked and collectors
are not paused. The MySQL bridge uses an attested executable FD and anonymous sealed defaults FD;
auth and XLSX bodies remain inherited pipe/descriptor data. Evidence contains assertions, counts,
hashes and fixed labels only. XLSX parsing uses the attested bounded Python stdlib helper, not a
dependency borrowed from any runtime.

Every completed run publishes a new root-owned immutable `<SHA>-<UUID>` evidence directory.
Failures request conditional receipt-owned cleanup and record `NO-GO`. A root-only
fsynced deployment receipt binds source/run, deployment-lock transaction UUID, exact
release/directory dev+ino, PID/kernel start ticks/boot ID, numeric PM2 ID, UID/GID/cwd
and listener. The existing Zaruku deploy lock serializes cleanup and deployment;
the receipt/current/process are revalidated immediately before stopping that numeric
PM2 ID. No receipt means no stop; a successor, PID reuse, or foreign identity requires
review and is never stopped by name. `GO` authorizes only later cutover planning.
The sealed boot fixture proves the full
setpriv/no-new-privileges contract; live PM2 checks do not claim an unimplemented bounding-capability
or `NoNewPrivs` guarantee. The exact amd64 `UV_USE_IO_URING=0` translation marker is normalized only
immediately before fixture application code; all other unexpected environment values still fail.

Before deployment, the orchestrator separately allocates and fsyncs its exact evidence directory
and confirms the source-SHA/run-ID/device/inode receipt. Parity cannot create or recover a directory
and cannot replace this stored receipt. A later credential/context failure or lost parity response
therefore still permits sanitized immutable `NO-GO` publication. Missing or replaced allocation
identity fails closed; a lost allocation response aborts before deployment. Exact
remote `refs/heads/release/zaruku` equality is now enforced; ancestry is insufficient.

Evidence writers, cleanup and publication share a Linux `flock` on the exact receipt-bound directory
FD. Cleanup/publication wait at most 210 seconds, recheck inode/owner/ancestry/mode and terminal
inventory under the lock, and publication retains it through hashing, fsync, chmod and atomic
`decision.json` rename. A finalized directory cannot accept another writer. SSH exit is not writer
completion: the staged Python supervisor retains the lock and waits for EOF of a separate inherited
writer-lifetime pipe passed through Bash, Node and the XLSX helper. Preflight pins the root-owned,
non-symlink `/usr/bin/timeout` inode/hash, rechecked immediately before fixed
`--kill-after=5s 180s` execution in its own process group. The supervisor survives TERM until all
writers exit so timeout can kill an ignoring descendant after five seconds. No caller PID, process
search, or recovery kill is accepted. The transport bound remains 240 seconds. The Linux regression
asserts these exact production arguments, then uses only a test-local 2s/5s deadline to keep repeated
fixtures short; a full 180s/5s disposable proof is recorded in the Task 4 report.

## Deploy

### Одноразовый bootstrap метаданных для первого guarded rollout

Эта процедура нужна только для перехода уже активного fixed-path приложения
`/var/www/dashboard`, созданного до появления `.release-source-sha`. Скрипт не определяет commit из имени `/var/www/dashboard`.
Сначала оператор независимо устанавливает точный полный SHA по
проверенному deployment record/release-артефакту и сохраняет это доказательство в журнале изменения.
Отдельно, read-only, оператор фиксирует точный Next.js build identity активного приложения:

```bash
ssh beget 'cat /var/www/dashboard/.next/BUILD_ID'
```

Из clean candidate checkout, история которого должна содержать установленный активный commit,
выполнить:

```bash
bash scripts/bootstrap-release-source-metadata.sh <full-source-sha> <exact-active-build-id>
```

Команда принимает только 40-символьный lowercase SHA и проверяет, что он является прямым локальным commit-объектом и предком candidate `HEAD`.
Затем она получает общий lock
`/var/www/.dashboard-next-deploy.lock`, затем повторно сверяет переданный build ID с активным
`/var/www/dashboard/.next/BUILD_ID`. Только после этих проверок она атомарно публикует ровно
переданный SHA, читает его обратно и оставляет `.release-source-sha` с mode `0600`. Существующие
конфликтующие или symlink-метаданные сохраняются, а команда останавливается. У команды нет режима
обхода или замены существующей аттестации.

Зафиксировать в audit log полный SHA, build ID и успешную строку команды. После перехода обычный
deploy остаётся fail-closed и повторный bootstrap не заменяет метаданные.

Локальный deploy с Mac:

```bash
cd dashboard-next
npm run deploy
```

Что делает deploy теперь:

- обновляет `origin/main` и отклоняет dirty worktree, commit без актуального `origin/main` или
  commit без полного активного production-релиза в своей истории
- локально выполняет `npm ci`, рекурсивные тесты, typecheck, lint, public-asset check и production build
- тянет production secrets из `/var/www/www-root/data/.production.env`
- валидирует обязательные env до upload
- атомарно получает dashboard-specific lock `/var/www/.dashboard-next-deploy.lock`, повторно читает
  активный production commit и ещё раз проверяет его происхождение
- всегда использует именно `origin/main`, `/usr/bin/ssh` для реального SSH-reader активного релиза и
  фиксированный lock; `DEPLOY_REMOTE`, `DEPLOY_BASE_BRANCH`, `DEPLOY_ACTIVE_RELEASE_READER`,
  `DEPLOY_LOCK_DIR`, `DASHBOARD_DEPLOY_LOCK_DIR`, `SSH_BIN`, `DEPLOY_SSH_BIN`, `GIT_SSH`,
  `GIT_SSH_COMMAND` и `RSYNC_RSH` запрещены для production-команды
- до построения remote paths проверяет `RELEASE_ID` и все передаваемые SSH параметры по ограниченным
  allowlist-контрактам; SSH shell получает значения как экранированные позиционные аргументы
- записывает полный Git SHA в `.release-source-sha`
- загружает сборку в staging release dir на VPS
- атомарно меняет `/var/www/dashboard` на новую release-папку
- автоматически откатывает релиз, если PM2 reload, local health, listener isolation или SHA attestation
  не проходят
- после активации сверяет `.release-source-sha` и снимает lock через cleanup trap при любом исходе

Нормальные защитные остановки и восстановление:

- `HEAD does not contain current origin/main` — объединить актуальный `origin/main` с release-веткой,
  заново пройти проверки и повторить deploy.
- `HEAD does not contain active production commit <sha>` — остановиться, получить названный commit,
  объединить его с release-веткой и пересобрать кандидат. Не использовать force/bypass.
- `active fixed release ... has no trusted full-SHA metadata` — выполнить описанную выше одноразовую
  audited bootstrap-процедуру с двумя независимыми доказательствами; не записывать metadata вручную
  и не выводить commit из fixed-path имени.
- `Deployment lock is already held` — дождаться владельца из owner metadata. Если процесса deploy уже
  точно нет, оператор вручную проверяет lock и только после этого удаляет его; скрипт неизвестный lock
  автоматически не удаляет.
- Ошибка SSH во время acquire считается неоднозначной: cleanup всегда пытается снять только lock с
  token текущего запуска. Lock другого или неизвестного владельца остаётся нетронутым.
- `mandatory deploy authority override` или `Invalid RELEASE_ID`/`Invalid *_DIR` — убрать запрещённую
  переменную или исправить значение. Проверка срабатывает до первого remote action.
- `Failed to release deployment lock` — активный релиз уже мог быть успешно включён; до следующего
  deploy вручную сверить owner metadata, активный `.release-source-sha` и отсутствие процесса-владельца.

После deploy проверить:

```bash
ssh beget 'pm2 status'
ssh beget 'curl -s http://127.0.0.1:3001/api/health'
curl -s https://dashboards.adreports.ru/api/health
```

Полный SHA активного приложения:

```bash
ssh beget 'cat /var/www/dashboard/.release-source-sha'
```

## Rollback

Обе части manual rollback используют тот же фиксированный lock
`/var/www/.dashboard-next-deploy.lock`, что и deploy. При неоднозначном результате SSH acquire cleanup
пытается снять только lock с token текущего запуска; чужой или неизвестный lock сохраняется. Target и
текущий release должны иметь regular `.release-source-sha` ровно с одним полным lowercase SHA.
Metadata-less legacy backup не активируется: его нужно пересобрать как проверенный release с доверенной
full-SHA metadata, а не восстанавливать SHA из имени каталога.

Откатить на последний backup-релиз:

```bash
cd dashboard-next
npm run deploy:rollback
```

Откатить на конкретный backup-директори:

```bash
cd dashboard-next
bash scripts/rollback-release.sh /var/www/dashboard-backups/<release-id>-previous
```

## Advertising canonical read-model gate

The advertising dashboard runtime must read actuals from canonical MySQL only. Before enabling
`AD_CANONICAL_READ_V2=1`, run the read-only comparison after migrations, import publication, and
binding preflight are complete:

```bash
cd /var/www/dashboard
npm run compare:advertising-read-model -- --from 2026-07-01 --to 2026-09-15
```

The default run checks Gidrofuril first and then every active advertising dashboard. A focused run is:

```bash
npm run compare:advertising-read-model -- --dashboard gidrofuril --from 2026-07-01 --to 2026-09-15
```

The JSON result is `ready` only when all plan, period fact, line/day fact, and dashboard/day metrics
match and no canonical campaign with facts is unbound. Each mismatch includes dashboard, line key,
date, metric, old/new values, and delta. Unbound campaign identity and account are reported separately.
The command performs no source API call, migration, write, feature-flag change, or deployment.

Cutover checklist:

1. Confirm import requests and canonical publications are successful for the requested dates.
2. Resolve binding diagnostics: no legacy binding, unbound campaign, or missing due coverage.
3. Archive the comparison JSON with `status: ready`.
4. Enable `AD_CANONICAL_READ_V2=1`, restart the app, and smoke-check screen plus Excel export.
5. Roll back by restoring the prior environment value and restarting the app if smoke differs.

## Advertising source cutover order

The app comparison is one input to the root collector's final gate. For every
source, save a sanitized comparison evidence file containing the publication
parity mismatch count and this dashboard comparison mismatch count, then run:

```bash
cd /root/reportingdash-canonical
python3 verify_advertising_rollout.py \
  --source <source-key> \
  --comparison-evidence /protected/advertising-rollout/<timestamp>/comparison-evidence.json \
  --json
```

The fixed order is Between, uploaded/Google Sheet sources, Hybrid, VK,
GetIntent, LinkedIn, Reddit, Yandex Direct, and Google Ads. Do not batch-enable
multiple source cutovers. A source is blocked by missing or failed due
coverage, parity mismatch, duplicate identity, unresolved or unbound campaign,
dashboard mismatch, missing comparison evidence, or a daily advertising
Telegram delivery not audited as `sent`.

For each ready source: enable only that source's publication cutover, enable
its V2 dashboard read, smoke Collection, Bindings, dashboard, and Excel/PDF
exports, then verify the next scheduled collector and next Telegram summary.
Only after those checks may its legacy writer/read path be disabled. The root
runbook is `docs/ADVERTISING-CANONICAL-INGESTION-RUNBOOK.md` in the collector
repository.

## SSL

Домен:

- `dashboards.adreports.ru`

Сертификат:

- Let's Encrypt

Проверка:

```bash
openssl s_client -connect dashboards.adreports.ru:443 -servername dashboards.adreports.ru </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates
```

Автообновление:

```bash
systemctl list-timers --all | grep certbot
```

## Что не трогать

Не трогать без отдельной задачи:

- root PM2 для `nest-analytics`
- cron legacy collector
- `/var/www/www-root/data/`

## Troubleshooting

### Приложение не стартует

Проверить:

```bash
pm2 status
pm2 describe dashboard-next
tail -n 200 /var/log/dashboard-next-error.log
```

### Health не отвечает

Проверить по цепочке:

```bash
curl -s http://127.0.0.1:3001/api/health
nginx -t
curl -I https://dashboards.adreports.ru/api/health
```

### После deploy открылся старый код

Проверить:

```bash
pm2 restart dashboard-next
curl -s http://127.0.0.1:3001/api/health
```

### Если кто-то снова смотрит только в systemd

Важно:

- `dashboard-next` живёт в `PM2`
- смотреть надо через `pm2`
