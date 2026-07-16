#!/usr/bin/env python3
"""Send Telegram alerts or daily summaries for canonical reporting health."""

from __future__ import annotations

import argparse
import html
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent
DASHBOARD_SCRIPT = ROOT / 'sources_health_dashboard.py'
ABBOTT_HEALTH_SCRIPT = ROOT / 'abbott_health_probe.py'
LEGACY_ENV_PATH = Path('/var/www/www-root/data/.production.env')
MANUAL_EXCEPTIONS_PATH = ROOT / 'MANUAL-LEGACY-EXCEPTIONS.md'
LOCAL_VENV_PYTHON = ROOT / 'venv' / 'bin' / 'python'
SUMMARY_SOURCE_ORDER = ['linkedin', 'reddit', 'vk_ads_v2', 'getintent', 'yandex_direct', 'hybrid', 'yandex_metrika']


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['alert', 'summary'], default='alert')
    return parser.parse_args()


def load_env_file(path: Path) -> Dict[str, str]:
    result: Dict[str, str] = {}
    if not path.exists():
        return result
    for raw_line in path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        result[key.strip()] = value.strip().strip('"').strip("'")
    return result


def resolve_telegram_credentials() -> Tuple[str, str]:
    token = os.environ.get('TG_TOKEN')
    chat_id = os.environ.get('TG_CHAT_ID')
    if token and chat_id:
        return token, chat_id

    legacy_env = load_env_file(LEGACY_ENV_PATH)
    token = token or legacy_env.get('TG_TOKEN')
    chat_id = chat_id or legacy_env.get('TG_CHAT_ID')
    if token and chat_id:
        return token, chat_id

    raise RuntimeError(
        'Missing Telegram credentials. Prefer TG_TOKEN/TG_CHAT_ID in canonical runtime env; '
        f'fallback file checked: {LEGACY_ENV_PATH}'
    )


def run_json_script(path: Path, accepted_codes: set[int]) -> Dict:
    python_exec = str(LOCAL_VENV_PYTHON) if LOCAL_VENV_PYTHON.exists() else sys.executable
    proc = subprocess.run(
        [python_exec, str(path), '--json'],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if proc.returncode not in accepted_codes:
        raise RuntimeError(
            '{} failed with exit code {}'.format(path.name, proc.returncode)
        )
    if not proc.stdout.strip():
        raise RuntimeError('{} returned empty stdout'.format(path.name))
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        raise RuntimeError('{} returned invalid JSON'.format(path.name)) from None


def run_dashboard_json() -> Dict:
    return run_json_script(DASHBOARD_SCRIPT, {0, 1})


def run_abbott_health_json() -> Dict:
    return run_json_script(ABBOTT_HEALTH_SCRIPT, {0, 1, 2})


def get_latest_collector_runs() -> List[Dict]:
    from canonical_writer import get_db_connection

    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    placeholders = ', '.join(['%s'] * len(SUMMARY_SOURCE_ORDER))
    field_placeholders = ', '.join(['%s'] * len(SUMMARY_SOURCE_ORDER))
    cur.execute(
        f"""
        SELECT
          t.source_key,
          t.id,
          t.status,
          t.run_type,
          t.rows_read,
          t.rows_written,
          t.rows_updated,
          t.error_count,
          t.error_summary,
          t.started_at,
          t.finished_at
        FROM canonical_collector_runs t
        JOIN (
          SELECT source_key, MAX(id) AS max_id
          FROM canonical_collector_runs
          WHERE source_key IN ({placeholders})
          GROUP BY source_key
        ) latest
          ON latest.source_key = t.source_key
         AND latest.max_id = t.id
        ORDER BY FIELD(t.source_key, {field_placeholders})
        """,
        tuple(SUMMARY_SOURCE_ORDER + SUMMARY_SOURCE_ORDER),
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return rows


def coverage_warning(source: Dict) -> bool:
    coverage = source.get('coverage') or {}
    legacy_only = int(coverage.get('legacy_only_rows') or 0)
    canonical_inside = int(coverage.get('canonical_only_in_legacy_window') or 0)
    return legacy_only > 0 or canonical_inside > 0


def parity_warning(source: Dict) -> bool:
    parity = source.get('parity') or {}
    return int(parity.get('total_mismatches') or 0) > 0


def fail_run(source: Dict) -> bool:
    collector = source.get('collector') or {}
    return collector.get('run_status') != 'success' or int(collector.get('error_count') or 0) > 0


def freshness_warning(source: Dict) -> bool:
    freshness = source.get('freshness') or {}
    lag = freshness.get('days_lag')
    return lag is None or int(lag) > 2


def yandex_shadow_warning(source: Dict) -> bool:
    shadow_cutover = source.get('shadow_cutover') or {}
    shadow_run = shadow_cutover.get('shadow_collector') or {}
    shadow_parity = shadow_cutover.get('parity') or {}
    shadow_coverage = shadow_cutover.get('coverage') or {}
    missing_critical = shadow_cutover.get('missing_critical_account_day_sample') or []
    return (
        (shadow_run.get('run_status') not in (None, 'success'))
        or int(shadow_parity.get('total_mismatches') or 0) > 0
        or int(shadow_coverage.get('prod_only_rows') or 0) > 0
        or int(shadow_coverage.get('shadow_only_rows') or 0) > 0
        or bool(missing_critical)
    )


def should_send_alert(payload: Dict, abbott: Dict) -> bool:
    if abbott.get('overall') == 'CRITICAL':
        return True
    for source in payload.get('sources', []):
        if not bool(source.get('governance', {}).get('blocking')):
            continue
        if source.get('status') in {'WARNING', 'CRITICAL'}:
            return True
        if fail_run(source):
            return True
        if parity_warning(source):
            return True
        if coverage_warning(source):
            return True
        if str(source.get('source_key')) == 'yandex_direct' and yandex_shadow_warning(source):
            return True
    return False


def read_manual_exception_note() -> Optional[str]:
    if not MANUAL_EXCEPTIONS_PATH.exists():
        return None
    text = MANUAL_EXCEPTIONS_PATH.read_text(encoding='utf-8').lower()
    if 'accepted as business-required data' in text:
        return 'hybrid accepted baseline alignment retained'
    if 'manual legacy' in text:
        return 'hybrid accepted legacy carry-over retained'
    return None


def build_collector_line(run: Dict) -> str:
    started_at = run.get('started_at')
    if hasattr(started_at, 'strftime'):
        started_text = started_at.strftime('%H:%M')
    else:
        started_text = str(started_at or '')[:16]
    status = str(run.get('status') or 'unknown').upper()
    return (
        f"- {html.escape(str(run.get('source_key') or 'unknown'))}: {html.escape(status)} "
        f"(read={int(run.get('rows_read') or 0)}, "
        f"write={int(run.get('rows_written') or 0)}, "
        f"update={int(run.get('rows_updated') or 0)}, "
        f"errors={int(run.get('error_count') or 0)}, "
        f"start={html.escape(started_text)})"
    )


def collect_monitor_notes(payload: Dict) -> Tuple[List[str], List[str], List[str]]:
    blocking_issues: List[str] = []
    non_blocking_notes: List[str] = []
    monitor_rows: List[str] = []

    for source in payload.get('sources', []):
        name = str(source['source_key'])
        blocking = bool(source.get('governance', {}).get('blocking'))
        freshness = source.get('freshness') or {}
        lag = freshness.get('days_lag')
        lag_text = '?' if lag is None else str(lag)
        monitor_rows.append(
            f"- {html.escape(name)}: {html.escape(str(source.get('status', 'UNKNOWN')))} (lag={html.escape(lag_text)})"
        )

        if fail_run(source):
            issue = f'{name} collector failure'
            (blocking_issues if blocking else non_blocking_notes).append(issue)
            continue
        if freshness_warning(source):
            issue = f'{name} freshness lag = {lag}'
            (blocking_issues if blocking else non_blocking_notes).append(issue)
        if parity_warning(source):
            total = int(source.get('parity', {}).get('total_mismatches') or 0)
            issue = f'{name} parity mismatches = {total}'
            (blocking_issues if blocking else non_blocking_notes).append(issue)
        if coverage_warning(source):
            coverage = source.get('coverage') or {}
            issue = (
                f"{name} coverage drift: legacy_only={int(coverage.get('legacy_only_rows') or 0)} "
                f"canonical_in_window={int(coverage.get('canonical_only_in_legacy_window') or 0)}"
            )
            (blocking_issues if blocking else non_blocking_notes).append(issue)
        if name == 'yandex_direct':
            shadow_cutover = source.get('shadow_cutover') or {}
            shadow_run = shadow_cutover.get('shadow_collector') or {}
            shadow_parity = shadow_cutover.get('parity') or {}
            shadow_coverage = shadow_cutover.get('coverage') or {}
            missing_critical = shadow_cutover.get('missing_critical_account_day_sample') or []
            if shadow_run.get('run_status') not in (None, 'success'):
                non_blocking_notes.append(
                    f"yandex_direct shadow run status = {shadow_run.get('run_status')}"
                )
            if int(shadow_parity.get('total_mismatches') or 0) > 0:
                non_blocking_notes.append(
                    f"yandex_direct shadow parity mismatches = {int(shadow_parity.get('total_mismatches') or 0)}"
                )
            if int(shadow_coverage.get('prod_only_rows') or 0) > 0 or int(shadow_coverage.get('shadow_only_rows') or 0) > 0:
                non_blocking_notes.append(
                    'yandex_direct shadow coverage drift: prod_only={} shadow_only={}'.format(
                        int(shadow_coverage.get('prod_only_rows') or 0),
                        int(shadow_coverage.get('shadow_only_rows') or 0),
                    )
                )
            if missing_critical:
                non_blocking_notes.append(
                    f'yandex_direct shadow missing critical account-days = {len(missing_critical)}'
                )

    manual_exception_note = read_manual_exception_note()
    if manual_exception_note:
        non_blocking_notes.append(manual_exception_note)

    deduped_notes: List[str] = []
    for note in non_blocking_notes:
        if note not in deduped_notes:
            deduped_notes.append(note)

    return blocking_issues, deduped_notes, monitor_rows


def build_abbott_lines(snapshot: Dict) -> List[str]:
    lines = [
        '<b>Abbott Metrika</b>',
        '- counter: {}'.format(html.escape(str(snapshot.get('counter_id') or 'unknown'))),
        '- overall: {}'.format(html.escape(str(snapshot.get('overall') or 'UNKNOWN'))),
    ]
    release = snapshot.get('release') or {}
    lines.append(
        '- release: {} ({})'.format(
            html.escape(str(release.get('id') if release.get('id') is not None else 'none')),
            html.escape(str(release.get('status') or 'unknown')),
        )
    )
    latest_run = snapshot.get('latest_run') or {}
    lines.append(
        '- run: {} counter={} finished_at={}'.format(
            html.escape(str(latest_run.get('status') or 'unknown').upper()),
            html.escape(str(latest_run.get('counter_id') or 'unknown')),
            html.escape(str(latest_run.get('finished_at') or 'none')),
        )
    )
    backfill = snapshot.get('backfill') or {}
    lines.append(
        '- coverage: {}/{} complete days'.format(
            int(backfill.get('complete_days') or 0),
            int(backfill.get('lookback_days') or 0),
        )
    )
    for scope in snapshot.get('scopes') or []:
        lines.append(
            '- {}: max={} rows={} missing={}'.format(
                html.escape(str(scope.get('scope') or 'unknown')),
                html.escape(str(scope.get('max_date') or 'none')),
                int(scope.get('rows') or 0),
                len(scope.get('missing_dates') or []),
            )
        )
    for incident in (snapshot.get('incidents') or [])[:8]:
        lines.append(
            '- incident {}: {}'.format(
                html.escape(str(incident.get('severity') or 'UNKNOWN')),
                html.escape(str(incident.get('check_id') or 'unknown')),
            )
        )
    return lines


def build_alert_message(payload: Dict, abbott: Dict) -> str:
    lines = ['<b>Canonical Reporting Alert</b>', '']
    for source in payload.get('sources', []):
        lines.append(f"{html.escape(source['source_key'])}: {html.escape(source['status'])}")

    blocking_issues, non_blocking_notes, _ = collect_monitor_notes(payload)

    if blocking_issues:
        lines.extend(['', '<b>Blocking issues:</b>'])
        lines.extend(f'- {html.escape(line)}' for line in blocking_issues[:6])

    if non_blocking_notes:
        lines.extend(['', '<b>Non-blocking notes:</b>'])
        lines.extend(f'- {html.escape(line)}' for line in non_blocking_notes[:6])

    lines.extend(['', *build_abbott_lines(abbott)])

    lines.extend(['', f"Exit code: {int(payload.get('summary', {}).get('exit_code') or 0)}"])
    return '\n'.join(lines)


def build_summary_message(payload: Dict, collector_runs: List[Dict], abbott: Dict) -> str:
    lines = [
        '<b>Canonical Daily Summary</b>',
        datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC'),
        '',
        '<b>Collectors</b>',
    ]

    runs_by_source = {str(row.get('source_key')): row for row in collector_runs}
    for source_key in SUMMARY_SOURCE_ORDER:
        row = runs_by_source.get(source_key)
        if row:
            lines.append(build_collector_line(row))
        else:
            lines.append(f'- {html.escape(source_key)}: no collector run found')
        if source_key == 'yandex_direct':
            yandex_source = next((item for item in payload.get('sources', []) if item.get('source_key') == 'yandex_direct'), None)
            shadow_run = ((yandex_source or {}).get('shadow_cutover') or {}).get('shadow_collector') or {}
            if shadow_run.get('run_status'):
                lines.append(
                    "- yandex_direct_api_shadow: {} (read={}, write={}, update={}, errors={})".format(
                        html.escape(str(shadow_run.get('run_status')).upper()),
                        int(shadow_run.get('rows_read') or 0),
                        int(shadow_run.get('rows_written') or 0),
                        int(shadow_run.get('rows_updated') or 0),
                        int(shadow_run.get('error_count') or 0),
                    )
                )

    blocking_issues, non_blocking_notes, monitor_rows = collect_monitor_notes(payload)
    lines.extend(['', '<b>Monitor</b>'])
    lines.extend(monitor_rows or ['- no monitor rows'])

    if blocking_issues:
        lines.extend(['', '<b>Blocking issues:</b>'])
        lines.extend(f'- {html.escape(line)}' for line in blocking_issues[:6])

    if non_blocking_notes:
        lines.extend(['', '<b>Notes</b>'])
        lines.extend(f'- {html.escape(line)}' for line in non_blocking_notes[:8])

    lines.extend(['', *build_abbott_lines(abbott)])

    lines.extend(['', f"Exit code: {int(payload.get('summary', {}).get('exit_code') or 0)}"])
    return '\n'.join(lines)


def send_telegram_message(token: str, chat_id: str, text: str) -> None:
    url = f'https://api.telegram.org/bot{token}/sendMessage'
    body = urllib.parse.urlencode({
        'chat_id': chat_id,
        'parse_mode': 'HTML',
        'text': text,
    }).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status != 200:
                raise RuntimeError(f'Telegram send failed with HTTP {resp.status}')
    except urllib.error.HTTPError as exc:
        exc.read()
        raise RuntimeError(f'Telegram HTTP error {exc.code}') from None
    except urllib.error.URLError:
        raise RuntimeError('Telegram transport error') from None


def main() -> int:
    args = parse_args()
    payload = run_dashboard_json()
    abbott = run_abbott_health_json()
    if args.mode == 'alert' and not should_send_alert(payload, abbott):
        return 0

    collector_runs = get_latest_collector_runs() if args.mode == 'summary' else []
    token, chat_id = resolve_telegram_credentials()
    message = (
        build_summary_message(payload, collector_runs, abbott)
        if args.mode == 'summary'
        else build_alert_message(payload, abbott)
    )
    send_telegram_message(token, chat_id, message)
    incident_keys = ','.join(
        str(item.get('incident_key') or 'unknown')
        for item in abbott.get('incidents') or []
    ) or 'none'
    print('{} mode={} incident_keys={}'.format(
        datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
        args.mode,
        incident_keys,
    ))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
