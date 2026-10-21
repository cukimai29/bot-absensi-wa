module.exports = {
    apps: [
        {
            name: 'botwaku',
            script: 'index.js',
            cwd: __dirname,
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '650M',
            restart_delay: 5000,
            kill_timeout: 20000,
            time: true,
            env: {
                NODE_ENV: 'production'
            }
        }
    ]
};
