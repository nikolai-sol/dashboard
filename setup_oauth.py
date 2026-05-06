#!/usr/bin/env python3
"""
LinkedIn OAuth2 Setup Helper
Run this ONCE to complete the OAuth2 flow and obtain refresh + access tokens.

Usage:
  python setup_oauth.py

It starts a local web server, opens LinkedIn auth page in your browser,
and captures the callback to exchange the code for tokens.
"""

import json
import os
import sys
import time
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

CLIENT_ID = os.getenv("LINKEDIN_CLIENT_ID")
CLIENT_SECRET = os.getenv("LINKEDIN_CLIENT_SECRET")
REDIRECT_PORT = 8585
REDIRECT_URI = f"http://localhost:{REDIRECT_PORT}/callback"

# Scopes needed for Advertising API
SCOPES = "r_ads,r_ads_reporting,r_organization_social"

auth_code = None


class OAuthCallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if "code" in params:
            auth_code = params["code"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(
                b"<html><body><h2>Authorization successful!</h2>"
                b"<p>You can close this tab and return to the terminal.</p>"
                b"</body></html>"
            )
        elif "error" in params:
            self.send_response(400)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            error = params.get("error_description", params.get("error", ["unknown"]))[0]
            self.wfile.write(f"<html><body><h2>Error: {error}</h2></body></html>".encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress server logs


def main():
    if not CLIENT_ID or not CLIENT_SECRET:
        print("ERROR: Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in .env first!")
        sys.exit(1)

    # Build authorization URL
    auth_url = (
        "https://www.linkedin.com/oauth/v2/authorization"
        f"?response_type=code"
        f"&client_id={CLIENT_ID}"
        f"&redirect_uri={REDIRECT_URI}"
        f"&scope={SCOPES}"
        f"&state=solgoood_linkedin_etl"
    )

    print("\n" + "=" * 60)
    print("LinkedIn OAuth2 Setup")
    print("=" * 60)
    print(f"\n1. Make sure your LinkedIn App has redirect URL:\n   {REDIRECT_URI}")
    print(f"\n2. Opening browser for authorization...")
    print(f"   (If browser doesn't open, go to this URL):\n   {auth_url}\n")

    webbrowser.open(auth_url)

    # Start local server to capture callback
    server = HTTPServer(("localhost", REDIRECT_PORT), OAuthCallbackHandler)
    server.timeout = 120  # 2 minutes to complete auth

    print("Waiting for callback...")
    while auth_code is None:
        server.handle_request()

    server.server_close()

    print(f"\n3. Exchanging code for tokens...")

    # Exchange auth code for tokens
    resp = requests.post(
        "https://www.linkedin.com/oauth/v2/accessToken",
        data={
            "grant_type": "authorization_code",
            "code": auth_code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    if resp.status_code != 200:
        print(f"ERROR: Token exchange failed: {resp.status_code}")
        print(resp.text)
        sys.exit(1)

    result = resp.json()
    token_dir = Path(__file__).parent

    # Save access token
    access_data = {
        "access_token": result["access_token"],
        "expires_at": time.time() + result["expires_in"],
        "obtained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    access_path = token_dir / ".access_token"
    access_path.write_text(json.dumps(access_data, indent=2))
    access_path.chmod(0o600)

    # Save refresh token (if present — requires MDP partner approval)
    if "refresh_token" in result:
        refresh_data = {
            "refresh_token": result["refresh_token"],
            "obtained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        refresh_path = token_dir / ".refresh_token"
        refresh_path.write_text(json.dumps(refresh_data, indent=2))
        refresh_path.chmod(0o600)
        print("\n   Refresh token saved! (valid ~12 months)")
    else:
        print("\n   WARNING: No refresh token returned.")
        print("   This means your app is NOT approved for programmatic refresh tokens.")
        print("   The access token expires in ~60 days. You'll need to re-run this script.")
        print("   To get refresh tokens, apply for Marketing Developer Platform (MDP) access.")

    # Verify token works
    print("\n4. Verifying token...")
    verify = requests.get(
        "https://api.linkedin.com/v2/me",
        headers={"Authorization": f"Bearer {result['access_token']}"},
    )
    if verify.status_code == 200:
        me = verify.json()
        name = f"{me.get('localizedFirstName', '')} {me.get('localizedLastName', '')}"
        print(f"   Authenticated as: {name}")
    else:
        print(f"   Profile verify returned {verify.status_code} (token may still work for ads)")

    print("\n" + "=" * 60)
    print("Setup complete! You can now run: python fetch_linkedin_ads.py")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
