# reportingdash-canonical bootstrap

This is a versioned bootstrap skeleton for the future `reportingdash-canonical` repository.

It exists here temporarily so we can:

- define the target repo shape
- stage collector migration work in git
- keep rollout notes next to the dashboard repo until the separate collectors repo is created

## Important

This folder is not the live collector runtime.

Current live/runtime paths are still:

- local unversioned collector root: `/Users/nafanya/ReportingDash`
- server runtime: `/root/reportingdash-canonical`

## Current migration reality

The Yandex Direct cutover has already started.

Confirmed current state:

- legacy bridge collector still exists
- new API-first collector exists:
  - `fetch_yandex_direct_canonical_api.py`
- shadow source is already in use:
  - `source_key = yandex_direct_api_shadow`
- shadow cron has already been introduced on server
- current cutover readiness is monitored in:
  - `monitor_canonical_shadow.py`
  - `sources_health_dashboard.py`
  - `send_canonical_telegram_report.py`

This bootstrap therefore assumes:

- Yandex Direct is not a greenfield migration
- Yandex Direct should be treated as an in-progress cutover source
- first repo migration should preserve that shadow structure exactly

## Intended repo structure

```text
reportingdash-canonical/
  README.md
  requirements.txt
  .env.example
  collectors/
  lib/
  ops/
  docs/
  deploy/
```

See:

- [MIGRATION-MANIFEST.md](./MIGRATION-MANIFEST.md)
- [docs/YANDEX-DIRECT-CUTOVER-STATUS.md](./docs/YANDEX-DIRECT-CUTOVER-STATUS.md)
- [docs/BOOTSTRAP-ROLLOUT-CHECKLIST.md](./docs/BOOTSTRAP-ROLLOUT-CHECKLIST.md)

## Abbott runtime closure smoke test

The flat `runtime/` directory is intentionally self-contained for local Python
imports. From this bootstrap directory, verify it without reading a parent
checkout:

```bash
(cd runtime && PYTHONDONTWRITEBYTECODE=1 python3 -c \
  'import fetch_yandex_metrika_canonical, canonical_writer, metrika_logs_api, canonical_release_store, run_abbott_metrika_active_release, abbott_release_operator, probe_yandex_metrika_access, capture_abbott_canonical_baseline, compare_abbott_canonical_release, abbott_canonical_controls, metrika_pagination, backfill_abbott_metrika_2026, abbott_health_probe, send_canonical_telegram_report, sources_health_dashboard')
```

Then verify every `runtime/` digest against `MIGRATION-MANIFEST.md` before
packaging it into the private canonical repository.

## Copied, pinned runtime environment

From the installed canonical repository root, create the runtime venv with
copied executables and verify both its containment and exact dependency pins:

```bash
export CANONICAL_ROOT=/root/reportingdash-canonical
test ! -e "$CANONICAL_ROOT/venv"
python3 -m venv --copies "$CANONICAL_ROOT/venv"
"$CANONICAL_ROOT/venv/bin/python" -m pip install --disable-pip-version-check \
  --no-input --requirement "$CANONICAL_ROOT/requirements.txt"
"$CANONICAL_ROOT/venv/bin/python" - \
  "$CANONICAL_ROOT/venv" "$CANONICAL_ROOT/requirements.txt" <<'PY'
import importlib.metadata
from pathlib import Path
import re
import sys

venv, requirements = map(Path, sys.argv[1:])
for path in venv.rglob("*"):
    if path.is_symlink():
        resolved = path.resolve(strict=False)
        if resolved != venv and venv not in resolved.parents:
            raise SystemExit("runtime venv contains an external symlink")

pins = {}
for raw in requirements.read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    match = re.fullmatch(r"([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+!-]+)", line)
    if not match:
        raise SystemExit("runtime requirement is not exactly pinned")
    pins[match.group(1)] = match.group(2)

for name, expected in pins.items():
    try:
        actual = importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        raise SystemExit("required runtime distribution is missing") from None
    if actual != expected:
        raise SystemExit("required runtime distribution version differs")
PY
"$CANONICAL_ROOT/venv/bin/python" -m pip check
```

No package hashes are claimed by this requirements file. This checkpoint
verifies exact pins and dependency consistency; only separately reviewed real
package hashes may be used for a future hash-locked artifact. Stop if the host
Python cannot create the copied venv.
