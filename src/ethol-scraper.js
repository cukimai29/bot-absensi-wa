const fs = require('fs');
const puppeteer = require('puppeteer');
const { catatAbsen } = require('./database');
const { capMentions, isBlockedGroup, isFatalSendError, isValidGroupJid } = require('./chat-guard');

const PUPPETEER_LAUNCH_TIMEOUT = Number(process.env.PUPPETEER_LAUNCH_TIMEOUT || 60000);
const PUPPETEER_PROTOCOL_TIMEOUT = Number(process.env.PUPPETEER_PROTOCOL_TIMEOUT || 120000);
const MIN_FREE_MEMORY_MB = Number(process.env.MIN_FREE_MEMORY_MB || 300);

const activeBrowsers = new Set();
let scraperBusy = false;

function getAvailableMemoryMB() {
    try {
        const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
        const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m);
        return match ? Math.floor(Number(match[1]) / 1024) : null;
    } catch (err) {
        return null;
    }
}

function acquireScraperLock(taskName) {
    if (scraperBusy) {
        console.log(`[SCRAPER] ${taskName} dilewati: tugas scraping lain masih berjalan.`);
        return false;
    }
    scraperBusy = true;
    return true;
}

function releaseScraperLock() {
    scraperBusy = false;
}

async function closeBrowser(browser) {
    if (!browser) return;
    activeBrowsers.delete(browser);

    try {
        await Promise.race([
            browser.close(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout menutup browser')), 15000))
        ]);
    } catch (err) {
        console.error('[BROWSER] Gagal menutup browser:', err.message);
    }
}

async function closeAllBrowsers() {
    const browsers = Array.from(activeBrowsers);
    activeBrowsers.clear();
    await Promise.allSettled(browsers.map((browser) => closeBrowser(browser)));
}

async function launchBrowser(overrides = {}) {
    const availableMb = getAvailableMemoryMB();
    if (availableMb !== null && availableMb < MIN_FREE_MEMORY_MB) {
        throw new Error(`RAM tersedia hanya ${availableMb} MB (minimum ${MIN_FREE_MEMORY_MB} MB). Chrome tidak diluncurkan agar tidak OOM.`);
    }

    const launchOptions = {
        headless: true,
        timeout: PUPPETEER_LAUNCH_TIMEOUT,
        protocolTimeout: PUPPETEER_PROTOCOL_TIMEOUT,
        defaultViewport: { width: 800, height: 600 },
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-breakpad',
            '--disable-component-update',
            '--disable-default-apps',
            '--disable-sync',
            '--mute-audio',
            '--no-first-run',
            '--renderer-process-limit=2',
            '--blink-settings=imagesEnabled=false',
            '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints'
        ],
        ...overrides
    };

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    const browser = await puppeteer.launch(launchOptions);
    activeBrowsers.add(browser);
    browser.on('disconnected', () => activeBrowsers.delete(browser));
    return browser;
}

let useSecondAccount = false;

function getLastUsedAccount() {
    if (useSecondAccount) {
        return process.env.ETHOL_USERNAME;
    } else {
        return process.env.ETHOL_USERNAME_2 || process.env.ETHOL_USERNAME;
    }
}

const announceLocks = new Set();
const announceCooldownUntil = new Map();
const ANNOUNCE_FATAL_COOLDOWN_MS = 5 * 60 * 1000;

async function announceAbsen(client, groupId, matkul, tanggal) {
    const targetGroupId = String(groupId || '').trim();
    if (!isValidGroupJid(targetGroupId)) {
        console.error(`[announceAbsen] TARGET_GROUP_ID tidak valid: "${targetGroupId || '(kosong)'}". Pengumuman dibatalkan.`);
        return false;
    }
    if (isBlockedGroup(targetGroupId)) {
        console.error(`[announceAbsen] Grup ${targetGroupId} ada di daftar blokir. Pengumuman dibatalkan.`);
        return false;
    }
    const cooldownUntil = announceCooldownUntil.get(targetGroupId) || 0;
    if (Date.now() < cooldownUntil) {
        console.warn(`[announceAbsen] Cooldown setelah error fatal masih aktif untuk ${targetGroupId}; pengumuman dilewati.`);
        return false;
    }
    if (announceLocks.has(targetGroupId)) {
        console.warn(`[announceAbsen] Pengumuman ke ${targetGroupId} masih berjalan; permintaan duplikat dilewati.`);
        return false;
    }
    announceLocks.add(targetGroupId);

    const fakeVerif = {
        key: { id: '12345678901234567890123456789012', fromMe: false, participant: '0@s.whatsapp.net', remoteJid: targetGroupId },
        message: { conversation: "SMARTBOT by RzkyAds" }
    };

    let text = `🚨 *ATTENTION PLEASE!* 🚨\n\nAbsensi untuk matkul *${matkul}* udah dibuka nih di ETHOL! 🔥\n\nBuruan diabsen yaa kawan-kawan, jangan sampai lupa apalagi nunggu mepet! Ingat, alpha menumpuk = SP di depan mata! 💀🏃‍♂️💨\n\n📅 Tanggal: ${tanggal}`;

    // Retry lebih sedikit + berhenti total kalau writer/koneksi sudah bermasalah.
    // Retry berulang saat writer macet hanya memperpanjang antrean dan memicu disconnect.
    let maxRetries = 3;
    try {
        for (let i = 0; i < maxRetries; i++) {
            try {
                let metadata = await client.groupMetadata(targetGroupId);
                let mentions = capMentions(metadata.participants.map(p => p.id));
                await client.sendMessage(targetGroupId, { text: text, mentions: mentions }, { quoted: fakeVerif });
                return true; // Berhasil
            } catch (err) {
                const message = err?.message || String(err);
                console.error(`[announceAbsen] Gagal mengirim pengumuman absen (Attempt ${i+1}/${maxRetries}):`, message);
                if (isFatalSendError(err)) {
                    announceCooldownUntil.set(targetGroupId, Date.now() + ANNOUNCE_FATAL_COOLDOWN_MS);
                    console.error('[announceAbsen] Writer/koneksi bermasalah. Retry dihentikan agar tidak memperparah timeout.');
                    return false;
                }
                if (i === maxRetries - 1) {
                    console.log("[announceAbsen] Mencoba kirim absen tanpa hidetag sebagai fallback...");
                    try {
                        await client.sendMessage(targetGroupId, { text: text }, { quoted: fakeVerif });
                        return true;
                    } catch(e) {
                        console.error("[announceAbsen] Gagal total mengirim absen:", e?.message || e);
                        return false;
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 15000)); // Tunggu 15 detik sebelum retry
            }
        }
        return false;
    } finally {
        announceLocks.delete(targetGroupId);
    }
}

async function checkPortal(client) {
    if (!acquireScraperLock('Cek portal')) return;

    let browser;
    try {
        browser = await launchBrowser();
    } catch (err) {
        console.error('[PORTAL] Gagal membuka browser:', err.message);
        releaseScraperLock();
        return;
    }

    let page;
    try {
        page = await browser.newPage();
        page.setDefaultNavigationTimeout(120000);
    } catch (err) {
        console.error('[PORTAL] Gagal membuka halaman browser:', err.message);
        await closeBrowser(browser);
        releaseScraperLock();
        return;
    }

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
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {
                console.log("Login form lambat merespons, mencoba memaksa masuk ke dashboard...");
            }),
            page.keyboard.press('Enter')
        ]);

        await page.goto('https://ethol.pens.ac.id/mahasiswa/beranda', { waitUntil: 'networkidle2' });

        try {
            // Tunggu secara eksplisit hingga tombol lonceng muncul (maksimal 30 detik)
            await page.waitForSelector('button[aria-label*="otifikasi" i]', { timeout: 30000 });
        } catch (e) {
            console.log("Tombol lonceng tidak kunjung muncul, mungkin gagal login atau server lag.");
        }

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
                            // Walk up the DOM untuk mencari teks waktu (menghindari struktur DOM yang memisahkan teks dan waktu)
                            let currentEl = el;
                            let parentText = teks.toLowerCase();
                            let attempts = 0;
                            while (currentEl && currentEl !== document.body && attempts < 6) {
                                let txt = currentEl.textContent.toLowerCase();
                                if (txt.includes('lalu') || txt.includes('kemarin') || txt.includes('hari') || txt.includes('jam') || txt.includes('menit')) {
                                    parentText = txt;
                                    break;
                                }
                                currentEl = currentEl.parentElement;
                                attempts++;
                            }
                            
                            // Abaikan notifikasi dari hari-hari sebelumnya
                            if (parentText.includes('hari yang lalu') || parentText.includes('kemarin') || parentText.includes('minggu yang lalu') || parentText.includes('bulan yang lalu') || parentText.includes('tahun yang lalu')) {
                                continue;
                            }

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
            const { loadData } = require('./database');
            let dbData = loadData();
            const namaHari = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
            let todayStr = new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"});
            let todayName = namaHari[new Date(todayStr).getDay()];
            let jadwalHariIni = dbData.daftar_jadwal ? (dbData.daftar_jadwal[todayName] || []) : [];
            let matkulHariIni = jadwalHariIni.map(j => j.matkul.toLowerCase());
            let absenBaru = 0;
            let absenDuplikat = 0;

            for (let absen of daftarAbsenTerbuka) {
                // Filter: Hanya proses jika matkul ada di jadwal hari ini (mencegah spam notif lama dari minggu lalu)
                if (!matkulHariIni.some(m => absen.matkul.toLowerCase().includes(m) || m.includes(absen.matkul.toLowerCase()))) {
                    continue;
                }
                
                let isBaru = catatAbsen(absen.matkul, absen.tanggal);
                if (isBaru) {
                    absenBaru++;
                    let sukses = await announceAbsen(client, process.env.TARGET_GROUP_ID, absen.matkul, absen.tanggal);
                    if (sukses) {
                        console.log(`Pengumuman absen ${absen.matkul} berhasil dikirim.`);
                    } else {
                        console.log(`Gagal total mengirim absen ${absen.matkul}, membatalkan pencatatan di database agar bisa dicoba lagi.`);
                        const { hapusAbsen } = require('./database');
                        hapusAbsen(absen.matkul);
                    }
                } else {
                    absenDuplikat++;
                }
            }

            if (absenBaru === 0) {
                console.log(`Tidak ada absensi baru untuk jadwal hari ini (${absenDuplikat} absensi sudah pernah dicatat).`);
            }
        } else {
            console.log('Tidak ada absensi baru saat ini.');
        }

    } catch (error) {
        console.error('Terjadi kesalahan saat mengecek portal:', error);
    } finally {
        await closeBrowser(browser);
        releaseScraperLock();
    }
}

async function intensiveCheckPortal(client, targetMatkul, customDurationMs = 10 * 60 * 1000) {
    if (!acquireScraperLock('Cek absen intensif')) return;

    let durationMins = Math.round(customDurationMs / 60000);
    console.log(`[INTENSIF] Memulai pengecekan intensif ${durationMins} menit untuk matkul: ${targetMatkul}`);

    let browser;
    try {
        browser = await launchBrowser();
    } catch (err) {
        console.error('[INTENSIF] Gagal membuka browser:', err.message);
        releaseScraperLock();
        return;
    }

    let page;
    try {
        page = await browser.newPage();
        page.setDefaultNavigationTimeout(120000);
    } catch (err) {
        console.error('[INTENSIF] Gagal membuka halaman browser:', err.message);
        await closeBrowser(browser);
        releaseScraperLock();
        return;
    }

    try {
        await page.goto('https://login.pens.ac.id/cas/login?service=https%3A%2F%2Fethol.pens.ac.id%2Fapi%2Fauth%2Fcas-callback', { waitUntil: 'networkidle2' });

        // Menggunakan akun pertama sesuai konfirmasi
        let username = (process.env.ETHOL_USERNAME || '').trim();
        let password = (process.env.ETHOL_PASSWORD || '').trim();
        console.log(`[INTENSIF] Login menggunakan akun utama: ${username}`);

        await page.type('#username', username);
        await page.type('#password', password);

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {
                console.log("[INTENSIF] Login form lambat merespons, mencoba memaksa masuk ke dashboard...");
            }),
            page.keyboard.press('Enter')
        ]);

        await page.goto('https://ethol.pens.ac.id/mahasiswa/beranda', { waitUntil: 'networkidle2' });
        
        try {
            await page.waitForSelector('button[aria-label*="otifikasi" i]', { timeout: 30000 });
        } catch(e) {}
        
        await new Promise(resolve => setTimeout(resolve, 5000));

        let startTime = Date.now();
        const MAX_DURATION = customDurationMs;
        let absenFound = false;

        while (Date.now() - startTime < MAX_DURATION && !absenFound) {
            console.log(`[INTENSIF] Me-refresh halaman portal...`);
            await page.reload({ waitUntil: 'networkidle2' });
            
            try {
                await page.waitForSelector('button[aria-label*="otifikasi" i]', { timeout: 30000 });
            } catch(e) {}
            
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
                                // Walk up the DOM untuk mencari teks waktu
                                let currentEl = el;
                                let parentText = teks.toLowerCase();
                                let attempts = 0;
                                while (currentEl && currentEl !== document.body && attempts < 6) {
                                    let txt = currentEl.textContent.toLowerCase();
                                    if (txt.includes('lalu') || txt.includes('kemarin') || txt.includes('hari') || txt.includes('jam') || txt.includes('menit')) {
                                        parentText = txt;
                                        break;
                                    }
                                    currentEl = currentEl.parentElement;
                                    attempts++;
                                }

                                // Abaikan notifikasi dari hari-hari sebelumnya
                                if (parentText.includes('hari yang lalu') || parentText.includes('kemarin') || parentText.includes('minggu yang lalu') || parentText.includes('bulan yang lalu') || parentText.includes('tahun yang lalu')) {
                                    continue;
                                }

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
                        let sukses = await announceAbsen(client, process.env.TARGET_GROUP_ID, absen.matkul, absen.tanggal);
                        if (sukses) {
                            console.log(`[INTENSIF] Pengumuman absen ${absen.matkul} berhasil dikirim!`);
                            absenFound = true; 
                        } else {
                            console.log(`[INTENSIF] Gagal total mengirim absen ${absen.matkul}, membatalkan pencatatan agar bisa dicoba lagi.`);
                            const { hapusAbsen } = require('./database');
                            hapusAbsen(absen.matkul);
                        }
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
        await closeBrowser(browser);
        releaseScraperLock();
        console.log(`[INTENSIF] Pengecekan intensif selesai, browser ditutup.`);
    }
}

// --- AI EXTRACTOR: Sinkronisasi Jadwal & Tugas ---
const { GoogleGenAI } = require("@google/genai");

async function syncJadwalTugas() {
    if (!acquireScraperLock('Sinkronisasi ETHOL')) return;

    console.log("[ETHOL SYNC] Memulai sinkronisasi Jadwal & Tugas...");
    if (!process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEYS) {
        console.log("[ETHOL SYNC] Dibatalkan: API Key Gemini tidak ditemukan.");
        releaseScraperLock();
        return;
    }

    let browser;
    try {
        browser = await launchBrowser();
    } catch (err) {
        console.error('[ETHOL SYNC] Gagal membuka browser:', err.message);
        releaseScraperLock();
        return;
    }

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
    { "matkul": "Nama Matkul", "deskripsi": "Deskripsi/Judul Tugas", "deadline": "2026-08-30 23:59", "status": "Belum Dikerjakan" }
  ]
}

Jika informasi minggu_ke tidak ditemukan, asumsikan minggu 1. Ekstrak sebanyak mungkin tugas yang belum selesai. Untuk daftar_jadwal, gunakan nama hari dalam bahasa indonesia huruf kecil sebagai key (senin, selasa, rabu, dst) dan jam format HH:MM. Pastikan mengekstrak dosen, ruangan (jika ada, misal gedung/ruang), dan jam_selesai.

=== TEKS BERANDA ===
${berandaText.substring(0, 3000)}

=== TEKS JADWAL KULIAH ===
${jadwalText.substring(0, 5000)}

=== TEKS DAFTAR TUGAS ===
${tugasText.substring(0, 5000)}`;

        const models = [process.env.GEMINI_MODEL || "gemini-3.6-flash"];
        const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash";
        if (fallbackModel && !models.includes(fallbackModel)) {
            models.push(fallbackModel);
        }

        let response = null;
        let success = false;
        let lastError = null;

        for (const model of models) {
            for (let round = 0; round < 3 && !success; round++) {
                for (let i = 0; i < apiKeys.length && !success; i++) {
                    try {
                        const ai = new GoogleGenAI({ apiKey: apiKeys[i] });
                        response = await ai.models.generateContent({
                            model,
                            contents: prompt,
                        });
                        success = true;
                    } catch (err) {
                        lastError = err;
                        const message = String(err?.message || err);

                        if (message.includes("429")) {
                            console.log(`[AI] Kuota 429 pada ${model} Key #${i + 1}. ${i + 1 < apiKeys.length ? "Pindah ke key berikutnya..." : "Semua key sudah dicoba."}`);
                        } else if (message.includes("503") || message.includes("UNAVAILABLE") || message.includes("high demand")) {
                            console.log(`[AI] ${model} sedang sibuk (503). Percobaan ${round + 1}/3 dengan Key #${i + 1}...`);
                        } else {
                            console.log(`[AI] Error pada ${model} Key #${i + 1}: ${message}. Mencoba key berikutnya...`);
                        }
                    }
                }

                if (!success) {
                    const delay = 3000 * (round + 1);
                    console.log(`[AI] Menunggu ${delay / 1000} detik sebelum mengulang...`);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }

            if (success) break;
        }

        if (!success) {
            throw lastError || new Error("Semua API Key dan model gagal memproses permintaan.");
        }

        let jsonText = response.text.replace(/```json/gi, '').replace(/```/gi, '').trim();
        const extractedData = JSON.parse(jsonText);

        const { loadData, saveData } = require('./database');
        let db = loadData();
        
        if (extractedData.daftar_jadwal && Object.keys(extractedData.daftar_jadwal).length > 0) {
            db.daftar_jadwal = extractedData.daftar_jadwal;
        } else {
            console.log("[ETHOL SYNC] Peringatan: AI tidak menemukan jadwal apa pun. Jadwal lama dipertahankan agar aman.");
        }
        
        if (Array.isArray(extractedData.daftar_tugas)) {
            db.daftar_tugas = extractedData.daftar_tugas
                .map((t) => ({
                    matkul: String(t.matkul || t.mata_kuliah || "").trim(),
                    deskripsi: String(t.deskripsi || t.judul || t.nama_tugas || "").trim(),
                    deadline: String(t.deadline || "").trim(),
                    status: String(t.status || "").trim(),
                }))
                .filter((t) => t.matkul || t.deskripsi || t.deadline);
        }

        // PENTING: JANGAN PERNAH MENYENTUH db.jadwal KARENA ITU ADALAH REKAP ABSENSI!
        
        saveData(db);
        console.log("[ETHOL SYNC] Sinkronisasi berhasil! Jadwal dan Tugas terbaru telah disimpan ke database.");

    } catch (err) {
        console.error("[ETHOL SYNC] Gagal melakukan sinkronisasi:", err);
    } finally {
        await closeBrowser(browser);
        releaseScraperLock();
    }
}

module.exports = { checkPortal, announceAbsen, getLastUsedAccount, intensiveCheckPortal, syncJadwalTugas, closeAllBrowsers };
