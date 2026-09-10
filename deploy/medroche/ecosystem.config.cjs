// This PM2 app owns only the MedRoche site. It is not part of the Zaruku app.
module.exports = {
  apps: [{
    name: 'dashboard-medroche',
    script: '/var/www/dashboard-medroche/apps/site-seo/server.js',
    cwd: '/var/www/dashboard-medroche/apps/site-seo',
    uid: 'dashboard-medroche',
    gid: 'dashboard-medroche',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: 3003,
      SITE_SEO_REGISTRATION_PATH: './site-registration.json',
    },
    max_restarts: 10,
    restart_delay: 3000,
    max_memory_restart: '800M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/var/log/dashboard-medroche-error.log',
    out_file: '/var/log/dashboard-medroche-out.log',
    merge_logs: true,
  }],
};
