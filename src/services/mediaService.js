const puppeteer = require('puppeteer');
const googleTTS = require('google-tts-api');

/**
 * Service untuk pembuatan media (Meme, TTS Audio, Nulis)
 */
class MediaService {
    /**
     * Membuat meme dari gambar base64
     */
    static async createMeme(base64Image, mimetype, topText, bottomText) {
        const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
        const page = await browser.newPage();
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@700&display=swap');
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { display: flex; justify-content: center; align-items: center; background: transparent; }
                .container { position: relative; display: inline-block; }
                img { display: block; max-width: 800px; max-height: 800px; width: auto; height: auto; }
                .text {
                    position: absolute; left: 50%; transform: translateX(-50%); width: 90%;
                    text-align: center; font-family: 'Oswald', impact, sans-serif; font-size: 48px; font-weight: 700;
                    color: white; text-transform: uppercase; line-height: 1.1;
                    text-shadow: 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 2px 0 #000, 2px 0 0 #000, 0 -2px 0 #000, -2px 0 0 #000;
                    word-wrap: break-word;
                }
                .top { top: 15px; }
                .bottom { bottom: 15px; }
            </style>
        </head>
        <body>
            <div class="container" id="capture">
                <img src="data:${mimetype};base64,${base64Image}" />
                <div class="text top">${topText}</div>
                <div class="text bottom">${bottomText}</div>
            </div>
        </body>
        </html>
        `;
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const element = await page.$('#capture');
        const screenshot = await element.screenshot({ encoding: 'base64' });
        await browser.close();
        return screenshot;
    }

    /**
     * Membuat gambar nulis di buku dari teks
     */
    static async createNulis(teks) {
        const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
        const page = await browser.newPage();
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@600&display=swap');
                body {
                    margin: 0; padding: 40px; background-color: #fcf5e5;
                    font-family: 'Caveat', cursive; font-size: 28px; line-height: 1.5; color: #1a237e;
                    background-image: repeating-linear-gradient(#fcf5e5, #fcf5e5 40px, #90caf9 41px);
                    width: 700px; min-height: 900px; box-sizing: border-box;
                    border-left: 2px solid #ef5350; padding-left: 50px;
                }
                .content { white-space: pre-wrap; word-wrap: break-word; }
            </style>
        </head>
        <body>
            <div class="content">${teks}</div>
        </body>
        </html>
        `;
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const element = await page.$('body');
        const screenshot = await element.screenshot({ encoding: 'base64' });
        await browser.close();
        return screenshot;
    }

    /**
     * Mengonversi teks ke audio base64 (Google TTS)
     */
    static async generateTTS(teks, lang = 'id') {
        if (teks.length > 200) {
            throw new Error('Teks terlalu panjang! Maksimal 200 karakter.');
        }
        return await googleTTS.getAudioBase64(teks, {
            lang: lang,
            slow: false,
            host: 'https://translate.google.com'
        });
    }
}

module.exports = MediaService;
