module.exports = {
  apps: [
    {
      name: 'dashboard-next',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        HOSTNAME: '127.0.0.1',
        PORT: Number(process.env.PORT || 3001),
      },
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '800M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: `${process.env.DASHBOARD_LOG_DIR || '/var/log'}/dashboard-next-error.log`,
      out_file: `${process.env.DASHBOARD_LOG_DIR || '/var/log'}/dashboard-next-out.log`,
      merge_logs: true,
    },
  ],
};
