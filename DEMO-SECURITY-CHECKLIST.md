# Demo Security Checklist

Use this checklist before giving external demo access.

## 1) Secrets and environment

- Set `DASHBOARD_AUTH_SECRET` (min 32 chars, unique random value).
- Ensure there are no default/fallback shared passwords in use:
  - `ABBOTT_DASHBOARD_PASSWORD`
  - `ABBOTT_DASHBOARD_EMBED_KEY`
- Store production secrets only on server (`.env.production` on VPS), never in `NEXT_PUBLIC_*`.
- Rotate all API keys used for the demo:
  - `AI_SUMMARY_API_KEY`
  - Google Ads OAuth/client secrets
- Set strict quotas/limits for demo keys.

## 2) Access control

- Use dedicated demo admin credentials:
  - `DASHBOARD_ADMIN_EMAIL`
  - `DASHBOARD_ADMIN_PASSWORD` (long random)
- Confirm admin login and viewer portal login are rate-limited (429 on brute-force attempts).
- Disable write actions for demo if not required:
  - In Google Ads controls keep `control_enabled=false` and `apply_enabled=false` unless you explicitly demo apply flow.

## 3) Infrastructure

- SSH hardening:
  - key-based auth only
  - disable password auth
  - restrict by IP if feasible
- Enable HTTPS and valid TLS cert.
- Verify app is not publicly exposing non-demo admin routes.

## 4) Data and privacy

- Use demo-safe datasets (no personal/sensitive production data).
- Confirm logs do not expose secret values/tokens.
- Verify API error responses do not return internal stack traces or secret details.

## 5) After demo

- Rotate demo credentials and API keys again.
- Revoke temporary access accounts.
- Archive and review access logs for anomalies.

