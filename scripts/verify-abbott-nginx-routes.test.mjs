import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const configuration = new URL('../deploy/abbott/nginx-routes.conf', import.meta.url);
const validator = new URL('./verify-abbott-nginx-routes.mjs', import.meta.url);

test('exact route validator accepts only the twelve aliases and one asset prefix', async () => {
  assert.ok(fs.existsSync(validator), 'Abbott Nginx validator is missing');
  const { validateAbbottNginxRoutes } = await import(validator);
  assert.equal(validateAbbottNginxRoutes(fs.readFileSync(configuration, 'utf8')), '12 exact Abbott routes, 1 Abbott asset prefix, upstream 127.0.0.1:3004');
});

test('route validator fails closed for missing, duplicate, broad, health, auth and other-owner routes', async () => {
  assert.ok(fs.existsSync(validator), 'Abbott Nginx validator is missing');
  const { validateAbbottNginxRoutes } = await import(validator);
  const source = fs.readFileSync(configuration, 'utf8');
  for (const changed of [
    source.replace('location = /dashboard/18', 'location /dashboard/18'),
    source.replace('127.0.0.1:3004', '127.0.0.1:3001'),
    source.replace('location = /dashboard/18', 'location = /api/health'),
    source.replace('location = /dashboard/18', 'location = /api/dashboard-auth/login'),
    source.replace('location = /dashboard/18', 'location = /admin'),
    source.replace('location = /dashboard/18', 'location ~ /dashboard/.*'),
    source.replace('location = /dashboard/18', 'location = /dashboard/zaruku'),
    source.replace('location = /dashboard/18', 'location = /dashboard/medroche'),
    source.replace('location ^~ /_next-abbott/', 'location /_next/'),
    source.replace(/location = \/dashboard\/18 \{[^}]+\}/, ''),
    source + '\nlocation = /dashboard/18 { proxy_pass http://127.0.0.1:3004; }',
    source + '\ninclude arbitrary.conf;',
    source.replace('proxy_pass', 'rewrite ^ /admin last; proxy_pass'),
    source.replace('proxy_pass', 'proxy_pass http://127.0.0.1:3001; proxy_pass'),
  ]) assert.throws(() => validateAbbottNginxRoutes(changed));
});
