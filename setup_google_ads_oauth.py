#!/usr/bin/env python3
"""Generate a Google Ads OAuth refresh token for collector .env setup."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from dotenv import dotenv_values, load_dotenv
from google_auth_oauthlib.flow import InstalledAppFlow

load_dotenv(Path(__file__).parent / '.env')
local_env = dotenv_values(Path(__file__).parent / '.env')

SCOPE = 'https://www.googleapis.com/auth/adwords'


def env_first(*keys: str, default: str = '') -> str:
    for key in keys:
        value = os.getenv(key)
        if value:
            return value.strip()
        value = local_env.get(key)
        if value:
            return str(value).strip()
    return default


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--client-secrets-file', default='')
    parser.add_argument('--client-id', default=env_first('GOOGLE_ADS_CLIENT_ID'))
    parser.add_argument('--client-secret', default=env_first('GOOGLE_ADS_CLIENT_SECRET'))
    parser.add_argument('--port', type=int, default=8080)
    return parser.parse_args()


def main():
    args = parse_args()
    if args.client_secrets_file:
        flow = InstalledAppFlow.from_client_secrets_file(args.client_secrets_file, scopes=[SCOPE])
    elif args.client_id and args.client_secret:
        client_config = {
            'installed': {
                'client_id': args.client_id,
                'client_secret': args.client_secret,
                'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
                'token_uri': 'https://oauth2.googleapis.com/token',
                'redirect_uris': [f'http://localhost:{args.port}/'],
            }
        }
        flow = InstalledAppFlow.from_client_config(client_config, scopes=[SCOPE])
    else:
        raise SystemExit('Missing --client-id/--client-secret or GOOGLE_ADS_CLIENT_ID/GOOGLE_ADS_CLIENT_SECRET in .env')
    credentials = flow.run_local_server(port=args.port, prompt='consent', access_type='offline')

    print('\nAdd this to .env:')
    print(f'GOOGLE_ADS_REFRESH_TOKEN={credentials.refresh_token}')


if __name__ == '__main__':
    main()
