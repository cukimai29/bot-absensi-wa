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
    const fakeVerif = {
        key: { id: '12345678901234567890123456789012', fromMe: false, participant: '0@s.whatsapp.net', remoteJid: groupId },
        message: { conversation: "SMARTBOT by RzkyAds" }
    };

    try {
        let text = `🚨 *ATTENTION PLEASE!* 🚨\n\nAbsensi untuk matkul *${matkul}* udah dibuka nih di ETHOL! 🔥\n\nBuruan diabsen yaa kawan-kawan, jangan sampai lupa apalagi nunggu mepet! Ingat, alpha menumpuk = SP di depan mata! 💀🏃‍♂️💨\n\n📅 Tanggal: ${tanggal}`;
        let metadata = await client.groupMetadata(groupId);
        let mentions = metadata.participants.map(p => p.id);

        await client.sendMessage(groupId, { text: text, mentions: mentions }, { quoted: fakeVerif });
    } catch (err) {
        console.error('Gagal mengirim pengumuman absen dengan mentions:', err);
        try {
            let text = `🚨 *ATTENTION PLEASE!* 🚨\n\nAbsensi untuk matkul *${matkul}* udah dibuka nih di ETHOL! 🔥\n\nBuruan diabsen yaa kawan-kawan, jangan sampai lupa apalagi nunggu mepet! Ingat, alpha menumpuk = SP di depan mata! 💀🏃‍♂️💨\n\n📅 Tanggal: ${tanggal}`;
            await client.sendMessage(groupId, { text: text }, { quoted: fakeVerif });
        } catch(e) {}
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
            page.keyboard.press('Enter')
        ]);

        await page.goto('https://ethol.pens.ac.id/mahasiswa/beranda', { waitUntil: 'networkidle2' });

        await new Promise(resolve => setTimeout(resolve, 5000));

        try {
            // Gunakan native Puppeteer click untuk semua tombol lonceng (menghindari error jika salah satu tersembunyi di mobile/desktop)
            const bellButtons = await page.$$('button[aria-label*="otifikasi" i]');
            if (bellButtons.length > 0) {
                for (let btn of bellButtons) {
                    try { await btn.click(); } catch(err) {}
                }
            } else {
                throw new Error("Lonceng tidak ditemukan");
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (e) {
            console.log("Gagal mengklik tombol notifikasi via puppeteer, mencoba fallback JS...");
            try {
                await page.evaluate(() => {
                    const lonceng = document.querySelector('.mdi-bell, .mdi-bell-outline, .v-badge, [class*="bell"], [aria-label*="notifikasi" i]');
                    if (lonceng) {
                        const tombol = lonceng.closest('button') || lonceng;
                        if (tombol) tombol.click();
                    }
                });
                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (err) {}
        }


        await page.screenshot({ path: 'debug_portal.png' });
        console.log("Screenshot halaman saat ini telah disimpan sebagai debug_portal.png");

        const daftarAbsenTerbuka = await page.evaluate(() => {
            let hasil = [];
            const pola = "Dosen telah membuka presensi untuk matakuliah";
            const elements = Array.from(document.querySelectorAll('div, p, span, li, a'));
            
            for (let el of elements) {
                if (el.textContent && el.textContent.includes(pola)) {
                    const hasChildWithPola = Array.from(el.children).some(child => child.textContent && child.textContent.includes(pola));
                    if (!hasChildWithPola) {
                        let teks = el.textContent.replace(/\s+/g, ' ').trim();
                        if (teks.includes(pola)) {
                            let namaMatkul = teks.split(pola)[1].trim();
                            let tanggalHariIni = new Date().toLocaleDateString('id-ID');
                            if (!hasil.find(h => h.matkul === namaMatkul)) {
                                hasil.push({ matkul: namaMatkul, tanggal: tanggalHariIni });
                            }
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
            page.keyboard.press('Enter')
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
                const bellButtons = await page.$$('button[aria-label*="otifikasi" i]');
                if (bellButtons.length > 0) {
                    for (let btn of bellButtons) {
                        try { await btn.click(); } catch(err) {}
                    }
                } else {
                    throw new Error("Lonceng tidak ditemukan");
                }
                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (e) {
                try {
                    await page.evaluate(() => {
                        const lonceng = document.querySelector('.mdi-bell, .mdi-bell-outline, .v-badge, [class*="bell"], [aria-label*="notifikasi" i]');
                        if (lonceng) {
                            const tombol = lonceng.closest('button') || lonceng;
                            if (tombol) tombol.click();
                        }
                    });
                    await new Promise(resolve => setTimeout(resolve, 3000));
                } catch (err) {}
            }

            const daftarAbsenTerbuka = await page.evaluate(() => {
                let hasil = [];
                const pola = "Dosen telah membuka presensi untuk matakuliah";
                const elements = Array.from(document.querySelectorAll('div, p, span, li, a'));
                
                for (let el of elements) {
                    if (el.textContent && el.textContent.includes(pola)) {
                        const hasChildWithPola = Array.from(el.children).some(child => child.textContent && child.textContent.includes(pola));
                        if (!hasChildWithPola) {
                            let teks = el.textContent.replace(/\s+/g, ' ').trim();
                            if (teks.includes(pola)) {
                                let namaMatkul = teks.split(pola)[1].trim();
                                let tanggalHariIni = new Date().toLocaleDateString('id-ID');
                                if (!hasil.find(h => h.matkul === namaMatkul)) {
                                    hasil.push({ matkul: namaMatkul, tanggal: tanggalHariIni });
                                }
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

// --- AI EXTRACTOR: Sinkronisasi Jadwal & Tugas ---
const { GoogleGenAI } = require("@google/genai");

async function syncJadwalTugas() {
    console.log("[ETHOL SYNC] Memulai sinkronisasi Jadwal & Tugas...");
    if (!process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEYS) {
        console.log("[ETHOL SYNC] Dibatalkan: API Key Gemini tidak ditemukan.");
        return;
    }

    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    try {
        const page = await browser.newPage();
        const username = getLastUsedAccount();
        const password = username === process.env.ETHOL_USERNAME ? process.env.ETHOL_PASSWORD : process.env.ETHOL_PASSWORD_2;
        
        await page.goto('https://login.pens.ac.id/cas/login?service=https%3A%2F%2Fethol.pens.ac.id%2Fapi%2Fauth%2Fcas-callback', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.type('#username', username);
        await page.type('#password', password);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log("Navigation timeout ignored")),
            page.keyboard.press('Enter')
        ]);
        
        // 1. Ekstrak Beranda
        await page.goto('https://ethol.pens.ac.id/mahasiswa/beranda', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log("Beranda timeout ignored"));
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {}); // Tunggu loading selesai
        let berandaText = await page.evaluate(() => document.body.innerText);

        // 2. Ekstrak Jadwal
        await page.goto('https://ethol.pens.ac.id/mahasiswa/jadwal', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => {}); // Lebih lama untuk jadwal karena data tabel
        let jadwalText = await page.evaluate(() => document.body.innerText);

        // 3. Ekstrak Tugas
        await page.goto('https://ethol.pens.ac.id/mahasiswa/tugas', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => {}); 
        let tugasText = await page.evaluate(() => document.body.innerText);

        console.log("[ETHOL SYNC] Data mentah berhasil diambil. Memproses menggunakan AI...");

        let apiKeys = [];
        if (process.env.GEMINI_API_KEYS) {
            apiKeys = process.env.GEMINI_API_KEYS.split(',').map(k => k.trim()).filter(k => k);
        } else if (process.env.GEMINI_API_KEY) {
            apiKeys = [process.env.GEMINI_API_KEY.trim()];
        }
        


        const prompt = `Anda adalah sistem parser JSON.
Berikut adalah teks kasar dari portal akademik ETHOL milik mahasiswa. Teks ini terbagi menjadi 3 bagian: Beranda, Jadwal Kuliah, dan Daftar Tugas.
Tugas Anda adalah mengekstrak informasi jadwal dan tugas (khususnya yang berstatus "Belum Dikerjakan" atau sejenisnya) dan memformatnya persis ke dalam format JSON berikut. Jangan output teks apa pun selain JSON murni (tanpa markdown).

Format JSON yang Diharapkan:
{
  "minggu_ke": 1,
  "daftar_jadwal": {
    "senin": [
      { "matkul": "Nama Matkul", "jam": "08:00", "jam_selesai": "09:40", "ruangan": "SAW-03.08", "dosen": "Nama Dosen" }
    ],
    "selasa": [
      { "matkul": "Nama Matkul", "jam": "10:00", "jam_selesai": "12:00", "ruangan": "Online", "dosen": "Nama Dosen" }
    ]
  },
  "daftar_tugas": [
    { "matkul": "Nama Matkul", "judul": "Judul Tugas", "deadline": "2026-08-30 23:59", "status": "Belum Dikerjakan" }
  ]
}

Jika informasi minggu_ke tidak ditemukan, asumsikan minggu 1. Ekstrak sebanyak mungkin tugas yang belum selesai. Untuk daftar_jadwal, gunakan nama hari dalam bahasa indonesia huruf kecil sebagai key (senin, selasa, rabu, dst) dan jam format HH:MM. Pastikan mengekstrak dosen, ruangan (jika ada, misal gedung/ruang), dan jam_selesai.

=== TEKS BERANDA ===
${berandaText.substring(0, 3000)}

=== TEKS JADWAL KULIAH ===
${jadwalText.substring(0, 5000)}

=== TEKS DAFTAR TUGAS ===
${tugasText.substring(0, 5000)}`;

        let response = null;
        let success = false;
        let lastError = null;

        for (let i = 0; i < apiKeys.length; i++) {
            try {
                const ai = new GoogleGenAI({ apiKey: apiKeys[i] });
                response = await ai.models.generateContent({
                    model: "gemini-3.6-flash",
                    contents: prompt,
                });
                success = true;
                break; // Berhasil, keluar dari loop
            } catch (err) {
                lastError = err;
                if (err.message && err.message.includes("429")) {
                    console.log("[AI] Kuota 429 Limit pada Key #" + (i+1) + "! " + (i+1 < apiKeys.length ? "Pindah ke API Key cadangan #" + (i+2) + "..." : "Semua API Key habis."));
                } else {
                    console.log(`[AI] Error tak terduga pada Key #${i+1}: ${err.message}. Mencoba key selanjutnya...`);
                }
            }
        }

        if (!success) {
            throw lastError || new Error("Semua API Key gagal memproses permintaan.");
        }

        let jsonText = response.text.replace(/```json/gi, '').replace(/```/gi, '').trim();
        const extractedData = JSON.parse(jsonText);

        const { loadData, saveData } = require('./database');
        let db = loadData();
        
        if (extractedData.daftar_jadwal) {
            db.daftar_jadwal = extractedData.daftar_jadwal;
        }
        if (extractedData.daftar_tugas) {
            db.daftar_tugas = extractedData.daftar_tugas;
        }
        if (extractedData.minggu_ke) {
            db.minggu_ke = extractedData.minggu_ke;
        }
        
        // PENTING: JANGAN PERNAH MENYENTUH db.jadwal KARENA ITU ADALAH REKAP ABSENSI!
        
        saveData(db);
        console.log("[ETHOL SYNC] Sinkronisasi berhasil! Jadwal dan Tugas terbaru telah disimpan ke database.");

    } catch (err) {
        console.error("[ETHOL SYNC] Gagal melakukan sinkronisasi:", err);
    } finally {
        await browser.close();
    }
}

module.exports = { checkPortal, announceAbsen, getLastUsedAccount, intensiveCheckPortal, syncJadwalTugas };
