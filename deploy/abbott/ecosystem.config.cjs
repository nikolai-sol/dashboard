// Prerequisite: privileged PM2 supervisor plus a separate, unprivileged account.
module.exports = {
  apps: [{
    name: 'dashboard-abbott',
    script: '/usr/bin/env',
    interpreter: 'none',
    args: ['-i', 'PATH=/usr/local/bin:/usr/bin:/bin', '/usr/bin/node', '/var/www/.dashboard-abbott-launcher.cjs'],
    cwd: '/var/www/dashboard-abbott/apps/abbott',
    uid: 'dashboard-abbott',
    gid: 'dashboard-abbott',
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: 3004 },
    max_restarts: 10,
    restart_delay: 3000,
    max_memory_restart: '800M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/var/log/dashboard-abbott-error.log',
    out_file: '/var/log/dashboard-abbott-out.log',
    merge_logs: true,
  }],
};
