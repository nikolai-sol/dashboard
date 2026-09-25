import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { apps: abbottApps } = require('./ecosystem.config.cjs');
const { apps: zarukuApps } = require('../zaruku/ecosystem.config.cjs');
const { apps: medrocheApps } = require('../medroche/ecosystem.config.cjs');

test('Abbott recipe uses the 2G guard without changing its launch contract', () => {
  assert.equal(abbottApps.length, 1);
  const [app] = abbottApps;

  assert.equal(app.max_memory_restart, '2G');
  assert.deepEqual(
    {
      name: app.name,
      script: app.script,
      interpreter: app.interpreter,
      args: app.args,
      cwd: app.cwd,
      uid: app.uid,
      gid: app.gid,
      instances: app.instances,
      exec_mode: app.exec_mode,
      max_restarts: app.max_restarts,
      restart_delay: app.restart_delay,
      env: app.env,
    },
    {
      name: 'dashboard-abbott',
      script: '/usr/bin/env',
      interpreter: 'none',
      args: [
        '-i',
        'PATH=/usr/local/bin:/usr/bin:/bin',
        '/usr/bin/node',
        '/var/www/.dashboard-abbott-launcher.cjs',
      ],
      cwd: '/var/www/dashboard-abbott/apps/abbott',
      uid: 'dashboard-abbott',
      gid: 'dashboard-abbott',
      instances: 1,
      exec_mode: 'fork',
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        PORT: 3004,
        HOSTNAME: '127.0.0.1',
      },
    },
  );
});

test('neighbor recipes retain their 800M guards', () => {
  assert.equal(zarukuApps[0].max_memory_restart, '800M');
  assert.equal(medrocheApps[0].max_memory_restart, '800M');
});
