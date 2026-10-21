const puppeteer = require('puppeteer');

(async () => {
    console.log('[TEST] Meluncurkan Chromium...');
    const started = Date.now();

    const browser = await puppeteer.launch({
        headless: true,
        timeout: Number(process.env.PUPPETEER_LAUNCH_TIMEOUT || 60000),
        protocolTimeout: Number(process.env.PUPPETEER_PROTOCOL_TIMEOUT || 120000),
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });

    console.log(`[TEST] Chromium berhasil dibuka dalam ${Date.now() - started} ms`);

    const page = await browser.newPage();
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('[TEST] Judul halaman:', await page.title());

    await browser.close();
    console.log('[TEST] Selesai. Chromium dan jaringan normal.');
})().catch((err) => {
    console.error('[TEST] Gagal:', err);
    process.exit(1);
});
