/* eslint-disable @typescript-eslint/no-require-imports -- PM2 launches this CommonJS standalone entrypoint. */
// PM2 can retain its own environment across reloads. Remove inherited values
// before loading application code; the privileged renderer owns this env file.
const fs = require('node:fs');
const allowed = new Set([
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "MYSQL_HOST",
  "MYSQL_PORT",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "MYSQL_DB",
  "ABBOTT_PRIVATE_DB_HOST",
  "ABBOTT_PRIVATE_DB_PORT",
  "ABBOTT_PRIVATE_DB_USER",
  "ABBOTT_PRIVATE_DB_PASSWORD",
  "ABBOTT_PRIVATE_DB_NAME",
  "ABBOTT_EMBED_DB_HOST",
  "ABBOTT_EMBED_DB_PORT",
  "ABBOTT_EMBED_DB_USER",
  "ABBOTT_EMBED_DB_PASSWORD",
  "ABBOTT_EMBED_DB_NAME",
  "NODE_ENV",
  "HOSTNAME",
  "PORT",
  "NEXT_PUBLIC_BASE_URL",
  "DASHBOARD_AUTH_SECRET",
  "INTERNAL_BASE_URL",
  "ABBOTT_DASHBOARD_EMBED_KEY",
  "PUPPETEER_EXECUTABLE_PATH"
]);
const text = fs.readFileSync('/var/www/dashboard-abbott/.env', 'utf8');
const parsed = {};
if (text.length > 65536 || !text.endsWith('\n')) throw new Error('Invalid Abbott runtime environment');
for (const line of text.slice(0, -1).split('\n')) {
  const match = /^([A-Z][A-Z0-9_]*)='([^'\r\n\u0000-\u001f\u007f]*)'$/.exec(line);
  if (!match || Object.hasOwn(parsed, match[1])) throw new Error('Invalid Abbott runtime environment');
  parsed[match[1]] = match[2];
}
if (Object.keys(parsed).some(key => !allowed.has(key)) || parsed.HOSTNAME !== '127.0.0.1' || parsed.PORT !== '3004' || parsed.NODE_ENV !== 'production') {
  throw new Error('Invalid Abbott runtime environment');
}
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, parsed);
require('/var/www/dashboard-abbott/apps/abbott/server.js');
