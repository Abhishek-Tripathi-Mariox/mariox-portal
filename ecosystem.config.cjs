module.exports = {
  apps: [
    {
      name: 'webapp',
      script: 'npm',
      args: 'run start',
      cwd: __dirname,
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
        HOST: '0.0.0.0',
        LOCAL_MONGO_DB: 'mongodb://localhost:27017/mariox-portal'
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
