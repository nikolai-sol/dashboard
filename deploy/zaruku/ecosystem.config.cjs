// Prerequisite: privileged PM2 supervisor plus a separate, unprivileged account.
module.exports = {
  apps: [{
    name: 'dashboard-zaruku',
    script: '/usr/bin/env',
    interpreter: 'none',
    args: ['-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'node', '/var/www/.dashboard-zaruku-launcher.cjs'],
    cwd: '/var/www/dashboard-zaruku/apps/zaruku',
    uid: 'dashboard-zaruku',
    gid: 'dashboard-zaruku',
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: 3002 },
    max_restarts: 10,
    restart_delay: 3000,
    max_memory_restart: '800M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/var/log/dashboard-zaruku-error.log',
    out_file: '/var/log/dashboard-zaruku-out.log',
    merge_logs: true,
  }],
};
