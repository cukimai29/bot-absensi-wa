const puppeteer = require('puppeteer');
const { catatAbsen } = require('./database');

let useSecondAccount = false;

function getLastUsedAccount() {
    if (useSecondAccount) {
        return process.env.ETHOL_USERNAME;
    } else {
        return process.env.ETHOL_USERNAME_2 || process.env.ETHOL_USERNAME;
    }
}

async function announceAbsen(client, groupId, matkul, tanggal) {
    try {
        const chat = await client.getChatById(groupId);
        let text = `Absen Ethol *${matkul}* telah dibuka. Segera absen, jika tidak kamu akan alpha, jika alphamu banyak kamu akan diberikan SP!!!!!\n\ntanggal : ${tanggal}`;

        let mentions = chat.participants.map(p => p.id._serialized || p.id.$1 || p.id);

        // Hidetag: mengirim pesan dengan objek mentions tanpa memunculkan '@nomor' di dalam teks
        await chat.sendMessage(text, { mentions });
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
        await page.goto('https://login.pens.ac.id/cas/login?service=https%3A%2F%2Fethol.pens.ac.id%2Fapi%2Fauth%2Fcas-callback', { waitUntil: 'networkidle2' });

        let username = (process.env.ETHOL_USERNAME || '').trim();
        let password = (process.env.ETHOL_PASSWORD || '').trim();

        if (useSecondAccount && process.env.ETHOL_USERNAME_2 && process.env.ETHOL_PASSWORD_2) {
            username = process.env.ETHOL_USERNAME_2.trim();
            password = process.env.ETHOL_PASSWORD_2.trim();
        }

        console.log(`Mengecek menggunakan akun: ${username}`);
        useSecondAccount = !useSecondAccount; // Toggle untuk giliran berikutnya

        await page.type('#username', username);
        await page.type('#password', password);

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
                    const pola = "Dosen telah membuka presensi untuk matakuliah";
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

async function intensiveCheckPortal(client, targetMatkul) {
    console.log(`[INTENSIF] Memulai pengecekan intensif 10 menit untuk matkul: ${targetMatkul}`);
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
        await page.goto('https://login.pens.ac.id/cas/login?service=https%3A%2F%2Fethol.pens.ac.id%2Fapi%2Fauth%2Fcas-callback', { waitUntil: 'networkidle2' });

        // Menggunakan akun pertama sesuai konfirmasi
        let username = (process.env.ETHOL_USERNAME || '').trim();
        let password = (process.env.ETHOL_PASSWORD || '').trim();
        console.log(`[INTENSIF] Login menggunakan akun utama: ${username}`);

        await page.type('#username', username);
        await page.type('#password', password);

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('.btn-submit')
        ]);

        await page.goto('https://ethol.pens.ac.id/mahasiswa/beranda', { waitUntil: 'networkidle2' });
        await new Promise(resolve => setTimeout(resolve, 5000));

        let startTime = Date.now();
        const MAX_DURATION = 10 * 60 * 1000; // 10 menit
        let absenFound = false;

        while (Date.now() - startTime < MAX_DURATION && !absenFound) {
            console.log(`[INTENSIF] Me-refresh halaman portal...`);
            await page.reload({ waitUntil: 'networkidle2' });
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
                // Abaikan jika error lonceng
            }

            const daftarAbsenTerbuka = await page.evaluate(() => {
                let hasil = [];
                const elemenTeks = Array.from(document.querySelectorAll('*'));
                for (let el of elemenTeks) {
                    if (el.children.length === 0 && el.textContent) {
                        let teks = el.textContent.trim();
                        const pola = "Dosen telah membuka presensi untuk matakuliah";
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
                        console.log(`[INTENSIF] Pengumuman absen ${absen.matkul} berhasil dikirim!`);
                        absenFound = true; 
                    }
                }
            } else {
                console.log(`[INTENSIF] Belum ada absen baru... Menunggu 1 menit untuk refresh berikutnya.`);
            }

            if (!absenFound) {
                // Tunggu sekitar 1 menit sebelum me-refresh lagi (agar tidak memberatkan server Ethol)
                await new Promise(resolve => setTimeout(resolve, 52000));
            }
        }
        
        if (!absenFound) {
            console.log(`[INTENSIF] Waktu 10 menit habis, absen untuk kelas ini belum dibuka.`);
        }

    } catch (error) {
        console.error('[INTENSIF] Terjadi kesalahan saat mengecek portal:', error);
    } finally {
        await browser.close();
        console.log(`[INTENSIF] Pengecekan intensif selesai, browser ditutup.`);
    }
}

module.exports = { checkPortal, announceAbsen, getLastUsedAccount, intensiveCheckPortal };
