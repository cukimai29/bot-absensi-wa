const puppeteer = require('puppeteer');
const { catatAbsen } = require('./database');

async function announceAbsen(client, groupId, matkul, tanggal) {
    try {
        const chat = await client.getChatById(groupId);
        let text = `Absen Ethol *${matkul}* telah dibuka. Segera absen, jika tidak kamu akan alpha, jika alphamu banyak kamu akan diberikan SP!!!!!\n\ntanggal : ${tanggal}`;

        let mentions = [];
        for (let participant of chat.participants) {
            const contact = await client.getContactById(participant.id._serialized);
            mentions.push(contact);
        }

        let mentionsText = chat.participants.map(p => `@${p.id.user}`).join(' ');
        let fullText = `${text}\n\n${mentionsText}`;

        await chat.sendMessage(fullText, { mentions });
    } catch (err) {
        console.error('Gagal mengirim pengumuman absen:', err);
    }
}

async function checkPortal(client) {
    const browser = await puppeteer.launch({ 
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', 
            '--disable-accelerated-2d-canvas',
            '--no-zygote',
            '--disable-gpu'
        ]
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(120000); 

    try {
        await page.goto('https://login.pens.ac.id/cas/login?service=http%3A%2F%2Fethol.pens.ac.id%2Fcas%2F', { waitUntil: 'networkidle2' });

        await page.type('#username', process.env.ETHOL_USERNAME);
        await page.type('#password', process.env.ETHOL_PASSWORD);

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('.btn-submit')
        ]);

        await page.goto('https://ethol.pens.ac.id/mahasiswa/beranda', { waitUntil: 'networkidle2' });

        await new Promise(resolve => setTimeout(resolve, 5000));

        try {
            await page.evaluate(() => {
                const lonceng = document.querySelector('.mdi-bell, .mdi-bell-outline, .v-badge');
                if (lonceng) {
                    const tombol = lonceng.closest('button');
                    if (tombol) tombol.click();
                }
            });
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (e) {
            console.log("Gagal mengklik tombol notifikasi, mencoba membaca DOM secara langsung...");
        }

        await page.screenshot({ path: 'debug_portal.png' });
        console.log("Screenshot halaman saat ini telah disimpan sebagai debug_portal.png");

        const daftarAbsenTerbuka = await page.evaluate(() => {
            let hasil = [];
            const elemenTeks = Array.from(document.querySelectorAll('*'));
            for (let el of elemenTeks) {
                if (el.children.length === 0 && el.textContent) {
                    let teks = el.textContent.trim();
                    const pola = "Dosen telah melakukan presensi untuk matakuliah";
                    if (teks.includes(pola)) {
                        let namaMatkul = teks.split(pola)[1].trim();
                        let tanggalHariIni = new Date().toLocaleDateString('id-ID');
                        if (!hasil.find(h => h.matkul === namaMatkul)) {
                            hasil.push({ matkul: namaMatkul, tanggal: tanggalHariIni });
                        }
                    }
                }
            }
            return hasil;
        });

        if (daftarAbsenTerbuka && daftarAbsenTerbuka.length > 0) {
            for (let absen of daftarAbsenTerbuka) {
                let isBaru = catatAbsen(absen.matkul, absen.tanggal);
                if (isBaru) {
                    await announceAbsen(client, process.env.TARGET_GROUP_ID, absen.matkul, absen.tanggal);
                    console.log(`Pengumuman absen ${absen.matkul} berhasil dikirim.`);
                }
            }
        } else {
            console.log('Tidak ada absensi baru saat ini.');
        }

    } catch (error) {
        console.error('Terjadi kesalahan saat mengecek portal:', error);
    } finally {
        await browser.close();
    }
}

module.exports = { checkPortal, announceAbsen };
