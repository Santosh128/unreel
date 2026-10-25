// PM2 process config: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'unreel',
      script: 'index.js',
      cwd: __dirname,
      env: { NODE_ENV: 'production' },
      max_memory_restart: '200M',
    },
  ],
};
