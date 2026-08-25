const puppeteer = require('puppeteer');
require('dotenv').config();

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    await page.goto('https://login.pens.ac.id/cas/login?service=https%3A%2F%2Fethol.pens.ac.id%2Fapi%2Fauth%2Fcas-callback', { waitUntil: 'networkidle2' });
    
    await page.type('#username', process.env.ETHOL_USERNAME_2);
    await page.type('#password', process.env.ETHOL_PASSWORD_2);
    
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.keyboard.press('Enter')
    ]);
    
    const html = await page.content();
    require('fs').writeFileSync('cas_failed.html', html);
    
    await browser.close();
})();
