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
    
    const url = page.url();
    console.log('Current URL after login:', url);
    
    if (url.includes('login.pens.ac.id/cas/login')) {
        const errorMsg = await page.$eval('#msg', el => el.textContent).catch(() => 'No error message found');
        console.log('CAS Error:', errorMsg.trim());
    }
    
    await browser.close();
})();
