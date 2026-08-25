require('dotenv').config();
const puppeteer = require('whatsapp-web.js/node_modules/puppeteer');
const fs = require('fs');

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await page.goto('https://login.pens.ac.id/cas/login?service=https%3A%2F%2Fethol.pens.ac.id%2Fapi%2Fauth%2Fcas-callback', { waitUntil: 'networkidle2' });
        await page.type('#username', process.env.ETHOL_USERNAME);
        await page.type('#password', process.env.ETHOL_PASSWORD);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.keyboard.press('Enter')
        ]);
        
        await page.goto('https://ethol.pens.ac.id/mahasiswa/beranda', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 5000));
        
        const headerHTML = await page.evaluate(() => {
            const header = document.querySelector('header');
            return header ? header.outerHTML : document.body.innerHTML;
        });
        
        fs.writeFileSync('header_dump.html', headerHTML);
        console.log('DOM dumped to header_dump.html');
    } catch (e) {
        console.error(e);
    } finally {
        await browser.close();
    }
})();
