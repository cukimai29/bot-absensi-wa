module.exports = {
    apps: [
        {
            name: 'botwaku',
            script: 'index.js',
            cwd: __dirname,
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            restart_delay: 5000,
            kill_timeout: 10000,
            time: true,
            env: {
                NODE_ENV: 'production'
            }
        }
    ]
};
