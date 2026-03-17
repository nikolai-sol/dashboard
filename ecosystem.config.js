module.exports = {
  apps: [
    {
      name: 'dashboard-next',
      script: 'server.js',
      cwd: '/var/www/dashboard',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '800M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/dashboard-next-error.log',
      out_file: '/var/log/dashboard-next-out.log',
      merge_logs: true,
    },
  ],
};
