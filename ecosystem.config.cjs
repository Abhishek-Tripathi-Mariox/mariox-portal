module.exports = {
  apps: [
    {
      name: 'webapp',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=devtrack-pro-production --local --ip 0.0.0.0 --port 3000',
      cwd: __dirname,
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
        XDG_CONFIG_HOME: '/tmp',
        WRANGLER_SEND_METRICS: 'false',
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
