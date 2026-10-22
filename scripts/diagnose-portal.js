const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const { diagnosePortal } = require('../src/ethol-scraper');

const account = (process.argv[2] || 'main').toLowerCase();

diagnosePortal(account)
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('[DIAG] Fatal:', err?.message || err);
        process.exit(1);
    });
