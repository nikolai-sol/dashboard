#!/usr/bin/env python3
"""OpenWeather morning observations. Source calls exist only in this collector."""
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request
try:
    from zoneinfo import ZoneInfo
except ImportError:  # Installed production Python 3.8 runtime.
    from pytz import timezone as ZoneInfo

UTC = dt.timezone.utc
TABLE = 'canonical_fact_lyzobact_weather_daily'


def due_centres(centres, now):
    unique = {}
    for centre in centres:
        local = now.astimezone(ZoneInfo(centre['timeZone']))
        if local.hour == 9 and local.minute < 15:
            unique[centre['centreId']] = centre
    return list(unique.values())


def parse_observation(payload, centre, retrieved):
    try:
        temp = payload['main']['temp']
        stamp = payload['dt']
        if isinstance(temp, bool) or not isinstance(temp, (int, float)) or not math.isfinite(temp):
            raise ValueError()
        if isinstance(stamp, bool) or not isinstance(stamp, (int, float)) or not math.isfinite(stamp):
            raise ValueError()
        observed = dt.datetime.fromtimestamp(stamp, UTC)
        local = retrieved.astimezone(ZoneInfo(centre['timeZone']))
        age = (retrieved - observed).total_seconds()
        if not due_centres([centre], retrieved) or not -300 <= age <= 10800 or observed.astimezone(ZoneInfo(centre['timeZone'])).date() != local.date():
            raise ValueError()
    except (KeyError, TypeError, ValueError, OverflowError, OSError):
        raise ValueError('invalid_observation') from None
    return {'centre_id': centre['centreId'], 'local_date': local.date().isoformat(),
            'status': 'valid', 'temperature_c': temp, 'observed_at': observed,
            'retrieved_at': retrieved, 'error_code': None,
            'raw_sha256': hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}


def collect(centres, fetch, exists, save, clock=lambda: dt.datetime.now(UTC)):
    started = clock()
    counts = {'valid': 0, 'error': 0, 'already_valid': 0}
    for centre in due_centres(centres, started):
        date = started.astimezone(ZoneInfo(centre['timeZone'])).date().isoformat()
        if exists(centre['centreId'], date):
            counts['already_valid'] += 1
            continue
        try:
            payload = fetch(centre)
            row = parse_observation(payload, centre, clock())
        except Exception as error:
            # Never log exception strings: HTTP exceptions can contain the credential URL.
            code = 'http_' + str(error.code) if isinstance(error, urllib.error.HTTPError) else 'collection_failed'
            row = {'centre_id': centre['centreId'], 'local_date': date, 'status': 'error',
                   'temperature_c': None, 'observed_at': None, 'retrieved_at': started,
                   'error_code': code, 'raw_sha256': None}
        save(row)
        counts[row['status']] += 1
        if row['error_code'] in ('http_401', 'http_403', 'http_429'):
            counts['account_blocked'] = 1
            break
    return counts


def main():
    key = os.environ.get('OPENWEATHER_API_KEY', '').strip()
    if not key:
        print(json.dumps({'error': 'credential_missing'}))
        return 1
    import mysql.connector
    centres = json.loads(Path(os.environ.get('WEATHER_CENTRES_FILE', str(Path(__file__).with_name('centres.json')))).read_text())
    conn = mysql.connector.connect(host=os.environ['DB_HOST'], port=int(os.environ.get('DB_PORT', '3306')),
                                   user=os.environ['DB_USER'], password=os.environ['DB_PASSWORD'],
                                   database=os.environ.get('DB_NAME', 'report_bd'))
    last_request = [0.0]
    try:
        cursor = conn.cursor()
        cursor.execute("SET time_zone = '+00:00'")
        def exists(cid, date):
            cursor.execute('SELECT status FROM ' + TABLE + ' WHERE centre_id=%s AND local_date=%s', (cid, date))
            row = cursor.fetchone()
            return row is not None and row[0] == 'valid'
        def save(row):
            # Success is append-only for a centre/date. Failed attempts can be repaired in-window.
            fields = ['centre_id', 'local_date', 'status', 'temperature_c', 'observed_at', 'retrieved_at', 'error_code', 'raw_sha256']
            updates = ','.join(f"{f}=IF(status='valid',{f},VALUES({f}))" for f in fields[3:]) + ",status=IF(status='valid',status,VALUES(status))"
            values = [row[f].astimezone(UTC).replace(tzinfo=None) if isinstance(row[f], dt.datetime) else row[f] for f in fields]
            cursor.execute('INSERT INTO ' + TABLE + ' (' + ','.join(fields) + ') VALUES (' + ','.join(['%s']*len(fields)) + ') ON DUPLICATE KEY UPDATE ' + updates, values)
            conn.commit()
        def fetch(centre):
            time.sleep(max(0, 1.1 - (time.monotonic() - last_request[0])))
            # Recheck the deadline before each network call, including throttling time.
            if not due_centres([centre], dt.datetime.now(UTC)):
                raise ValueError('morning_window_closed')
            query = urllib.parse.urlencode({'lat': centre['latitude'], 'lon': centre['longitude'], 'units': 'metric', 'appid': key})
            last_request[0] = time.monotonic()
            with urllib.request.urlopen('https://api.openweathermap.org/data/2.5/weather?' + query, timeout=20) as response:
                return json.loads(response.read(1048576))
        counts = collect(centres, fetch, exists, save)
        print(json.dumps(counts))
        return 2 if counts.get('account_blocked') else (1 if counts['error'] else 0)
    finally:
        conn.close()


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print(json.dumps({'error': 'collector_failed'}))
        raise SystemExit(1) from None
