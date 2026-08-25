require('dotenv').config();
const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    
    // Aktifkan interceptor untuk mengecek redirect chain
    page.on('response', response => {
        if ([301, 302].includes(response.status())) {
            console.log('Redirect:', response.url(), '->', response.headers()['location']);
        }
    });

    console.log("Navigating to login page...");
    await page.goto('https://login.pens.ac.id/cas/login?service=https%3A%2F%2Fethol.pens.ac.id%2Fapi%2Fauth%2Fcas-callback', { waitUntil: 'networkidle2' });

    let username = (process.env.ETHOL_USERNAME || '').trim();
    let password = (process.env.ETHOL_PASSWORD || '').trim();

    console.log("Typing credentials...");
    await page.type('#username', username);
    await page.type('#password', password);

    console.log("Clicking submit button and waiting for networkidle2...");
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
        page.click('.btn-submit')
    ]);

    let currentUrl = page.url();
    console.log("Current URL after click:", currentUrl);

    if (currentUrl.includes('cas-callback') || currentUrl.includes('login.pens.ac.id')) {
        console.log("Still not on beranda, waiting longer...");
        try {
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
            console.log("Final URL:", page.url());
        } catch(e) {
            console.log("Final URL (timeout):", page.url());
        }
    }

    await browser.close();
})();
