#!/usr/bin/env python3
"""Check last collection dates for all platforms."""

import os
import sys
from pathlib import Path
from datetime import datetime, timedelta

# Add parent dir to path
sys.path.insert(0, str(Path(__file__).parent))

from canonical_writer import get_db_connection

PLATFORMS = [
    'yandex_direct',
    'yandex_metrika', 
    'vk_ads_v2',
    'linkedin',
    'reddit',
    'hybrid',
    'getintent',
]

def get_last_run(source_key: str):
    """Get last successful collector run."""
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    try:
        cur.execute("""
            SELECT 
                run_id,
                run_type,
                run_mode,
                date_from,
                date_to,
                status,
                started_at,
                finished_at,
                rows_written,
                error_count
            FROM canonical_collector_runs
            WHERE source_key = %s
              AND status = 'success'
            ORDER BY started_at DESC
            LIMIT 1
        """, (source_key,))
        return cur.fetchone()
    finally:
        cur.close()
        conn.close()

def get_last_fact_date(source_key: str, table: str = 'canonical_fact_ads_daily'):
    """Get last date with facts in canonical table."""
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    try:
        # Try different date fields based on table
        date_field = 'report_date'
        if table == 'canonical_fact_site_analytics_daily':
            date_field = 'report_date'
        
        cur.execute(f"""
            SELECT MAX({date_field}) as last_date, COUNT(*) as total_rows
            FROM {table}
            WHERE source_key = %s
        """, (source_key,))
        return cur.fetchone()
    except Exception as e:
        return {'error': str(e)}
    finally:
        cur.close()
        conn.close()

def main():
    print("=" * 80)
    print("CRON STATUS CHECK - Platform Data Collection")
    print("=" * 80)
    print()
    
    now = datetime.now()
    
    for platform in PLATFORMS:
        print(f"\n{'─' * 80}")
        print(f"📊 {platform.upper()}")
        print('─' * 80)
        
        # Check collector runs
        last_run = get_last_run(platform)
        if last_run:
            started = last_run['started_at']
            age = now - started if started else None
            age_str = f"({age.days} days ago)" if age and age.days > 0 else f"({age.seconds // 3600}h ago)" if age else ""
            
            status_icon = "✅" if last_run['status'] == 'success' else "❌"
            print(f"  Last run:     {started} {age_str}")
            print(f"  Status:       {status_icon} {last_run['status']}")
            print(f"  Run type:     {last_run['run_type']}")
            print(f"  Date range:   {last_run['date_from']} to {last_run['date_to']}")
            print(f"  Rows written: {last_run['rows_written']}")
            print(f"  Errors:       {last_run['error_count']}")
        else:
            print(f"  ❌ No successful runs found")
        
        # Check facts in canonical tables
        if platform == 'yandex_metrika':
            last_fact = get_last_fact_date(platform, 'canonical_fact_site_analytics_daily')
        else:
            last_fact = get_last_fact_date(platform, 'canonical_fact_ads_daily')
        
        if last_fact and 'error' not in last_fact:
            last_date = last_fact['last_date']
            if last_date:
                if isinstance(last_date, str):
                    try:
                        last_date = datetime.strptime(last_date, '%Y-%m-%d')
                    except:
                        pass
                if isinstance(last_date, datetime):
                    age = (now - last_date).days
                    age_str = f"({age} days behind)" if age > 0 else "(today)"
                else:
                    age_str = ""
                print(f"  Last fact:    {last_date} {age_str}")
                print(f"  Total rows:   {last_fact['total_rows']}")
            else:
                print(f"  ⚠️  No facts in canonical table")
        elif 'error' in last_fact:
            print(f"  ⚠️  Error checking facts: {last_fact['error']}")
    
    print()
    print("=" * 80)

if __name__ == '__main__':
    main()
