/* eslint-disable @typescript-eslint/no-require-imports -- PM2 launches this CommonJS entrypoint. */
const fs = require('node:fs');

const allowed = new Set([
  'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
  'NODE_ENV', 'HOSTNAME', 'PORT', 'DASHBOARD_AUTH_SECRET',
  'SITE_SEO_REGISTRATION_PATH', 'INTERNAL_BASE_URL', 'PUPPETEER_EXECUTABLE_PATH',
]);
const text = fs.readFileSync('/var/www/.dashboard-medroche-secrets/runtime.env', 'utf8');
const parsed = {};
if (text.length > 65536 || !text.endsWith('\n')) throw new Error('Invalid MedRoche runtime environment');
for (const line of text.slice(0, -1).split('\n')) {
  const match = /^([A-Z][A-Z0-9_]*)='([^'\r\n\u0000-\u001f\u007f]*)'$/.exec(line);
  if (!match || Object.hasOwn(parsed, match[1])) throw new Error('Invalid MedRoche runtime environment');
  parsed[match[1]] = match[2];
}
if (
  Object.keys(parsed).some((key) => !allowed.has(key)) ||
  parsed.HOSTNAME !== '127.0.0.1' ||
  parsed.PORT !== '3003' ||
  parsed.NODE_ENV !== 'production' ||
  parsed.SITE_SEO_REGISTRATION_PATH !== './site-registration.json' ||
  parsed.INTERNAL_BASE_URL !== 'http://127.0.0.1:3003'
) throw new Error('Invalid MedRoche runtime environment');
for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DASHBOARD_AUTH_SECRET']) {
  if (!parsed[key]) throw new Error('Incomplete MedRoche runtime environment');
}
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, parsed, {
  HOME: '/var/lib/dashboard-medroche',
  XDG_CACHE_HOME: '/var/lib/dashboard-medroche/cache',
  XDG_CONFIG_HOME: '/var/lib/dashboard-medroche/config',
  TMPDIR: '/var/lib/dashboard-medroche/tmp',
});
require('/var/www/dashboard-medroche/apps/site-seo/server.js');
