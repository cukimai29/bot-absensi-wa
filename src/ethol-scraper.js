const fs = require('fs');
const puppeteer = require('puppeteer');
const { catatAbsen } = require('./database');
const { capMentions, isBlockedGroup, isFatalSendError, isValidGroupJid } = require('./chat-guard');

const PUPPETEER_LAUNCH_TIMEOUT = Number(process.env.PUPPETEER_LAUNCH_TIMEOUT || 60000);
const PUPPETEER_PROTOCOL_TIMEOUT = Number(process.env.PUPPETEER_PROTOCOL_TIMEOUT || 120000);
const PUPPETEER_MEMORY_WAIT_MS = Number(process.env.PUPPETEER_MEMORY_WAIT_MS || 30000);
const MIN_FREE_MEMORY_MB = Number(process.env.MIN_FREE_MEMORY_MB || 300);

const activeBrowsers = new Set();
let scraperBusy = false;
let lastSyncAt = null;
let lastSyncOk = null;
let lastSyncError = null;

function recordSyncResult(ok, error = null) {
    lastSyncAt = Date.now();
    lastSyncOk = ok;
    lastSyncError = error ? String(error?.message || error) : null;
}

function getScraperStatus() {
    return {
        busy: scraperBusy,
        activeBrowsers: activeBrowsers.size,
        lastSyncAt,
        lastSyncOk,
        lastSyncError,
    };
}

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

async function acquireScraperLockWait(taskName, maxWaitMs = 5 * 60 * 1000) {
    const startedAt = Date.now();
    let logged = false;
    while (scraperBusy) {
        if (!logged) {
            console.log(`[SCRAPER] ${taskName} menunggu tugas scraping lain selesai...`);
            logged = true;
        }
        if (Date.now() - startedAt >= maxWaitMs) {
            console.log(`[SCRAPER] ${taskName} dilewati: menunggu ${Math.round(maxWaitMs / 60000)} menit, tugas scraping lain masih berjalan.`);
            return false;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
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
    const memoryWaitMs = Number.isFinite(PUPPETEER_MEMORY_WAIT_MS)
        ? Math.max(0, PUPPETEER_MEMORY_WAIT_MS)
        : 30000;
    const startedAt = Date.now();
    let availableMb = getAvailableMemoryMB();

    while (availableMb !== null && availableMb < MIN_FREE_MEMORY_MB) {
        const remainingMs = memoryWaitMs - (Date.now() - startedAt);
        if (remainingMs <= 0) {
            throw new Error(`RAM tersedia hanya ${availableMb} MB (minimum ${MIN_FREE_MEMORY_MB} MB). Chrome tidak diluncurkan agar tidak OOM.`);
        }

        const waitMs = Math.min(5000, remainingMs);
        console.log(`[BROWSER] RAM tersedia ${availableMb} MB < ${MIN_FREE_MEMORY_MB} MB; menunggu ${Math.ceil(waitMs / 1000)} detik...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        availableMb = getAvailableMemoryMB();
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
            '--disable-software-rasterizer',
            '--disable-extensions',
            '--disable-component-extensions-with-background-pages',
            '--disable-background-networking',
            '--disable-breakpad',
            '--disable-component-update',
            '--disable-default-apps',
            '--disable-sync',
            '--mute-audio',
            '--no-first-run',
            '--renderer-process-limit=1',
            '--js-flags=--max-old-space-size=128',
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

const NOTIF_WAIT_SELECTOR = [
    'button[aria-label="Notifikasi"]',
    'button[aria-label="Notifications"]',
    'button[aria-label*="notifikasi" i]',
    'button[aria-label*="notification" i]',
    '.mdi-bell',
    '.mdi-bell-outline',
    '.v-badge'
].join(', ');
const NOTIF_WAIT_TIMEOUT_MS = Number(process.env.PORTAL_NOTIF_TIMEOUT_MS || 15000);

async function isLoginPage(page) {
    try {
        if (String(page.url()).includes('login.pens.ac.id')) return true;
        const diag = await logPortalDiagnostics(page, '[LOGIN]');
        return Boolean(diag && diag.loginVisible);
    } catch (err) {
        return false;
    }
}

async function logPortalDiagnostics(page, label = '[PORTAL]') {
    try {
        const diag = await page.evaluate(() => {
            const text = document.body.innerText || '';
            const lower = text.toLowerCase();
            const idxPresensi = lower.indexOf('presensi');
            const idxAbsensi = lower.indexOf('absensi');
            const idx = idxPresensi >= 0 ? idxPresensi : idxAbsensi;
            const idxDosen = lower.indexOf('dosen');
            const loginInput = document.querySelector('#username');
            const loginVisible = loginInput
                ? Boolean(loginInput.offsetWidth || loginInput.offsetHeight || loginInput.getClientRects().length)
                : false;
            return {
                url: location.href,
                title: document.title,
                loginVisible,
                bellButtons: document.querySelectorAll('button[aria-label*="otifikasi" i], button[aria-label*="notification" i]').length,
                bellIcons: document.querySelectorAll('.mdi-bell, .mdi-bell-outline, .v-badge').length,
                bodyLength: text.length,
                snippet: idx >= 0 ? text.slice(Math.max(0, idx - 120), idx + 260).replace(/\s+/g, ' ').trim() : '',
                snippetDosen: idxDosen >= 0 ? text.slice(Math.max(0, idxDosen - 80), idxDosen + 220).replace(/\s+/g, ' ').trim() : ''
            };
        });
        console.log(`${label} [DIAG] url=${diag.url} title="${diag.title}" login=${diag.loginVisible} bellButtons=${diag.bellButtons} bellIcons=${diag.bellIcons} body=${diag.bodyLength}`);
        if (diag.snippet) console.log(`${label} [DIAG] snippet="${diag.snippet}"`);
        if (diag.snippetDosen) console.log(`${label} [DIAG] dosen="${diag.snippetDosen}"`);
        return diag;
    } catch (err) {
        console.log(`${label} [DIAG] gagal: ${err?.message || err}`);
        return null;
    }
}

async function openNotifications(page, label = '[PORTAL]') {
    const selectors = [
        'button[aria-label="Notifikasi"]',
        'button[aria-label="Notifications"]',
        'button[aria-label*="notifikasi" i]',
        'button[aria-label*="notification" i]',
        'button[aria-label*="bell" i]',
        'button:has(.mdi-bell)',
        'button:has(.mdi-bell-outline)',
        'button .mdi-bell',
        'button .mdi-bell-outline',
        '.mdi-bell',
        '.mdi-bell-outline',
        '.v-badge button'
    ];
    const seen = new Set();

    for (const selector of selectors) {
        let elements = [];
        try {
            elements = await page.$$(selector);
        } catch (err) {
            continue;
        }

        for (const el of elements) {
            try {
                const info = await el.evaluate((node) => {
                    const clickable = node.closest('button') || node;
                    const style = window.getComputedStyle(clickable);
                    const rect = clickable.getBoundingClientRect();
                    return {
                        visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
                        expanded: clickable.getAttribute('aria-expanded'),
                        label: clickable.getAttribute('aria-label') || '',
                        tag: clickable.tagName
                    };
                });
                if (!info.visible) continue;

                const key = `${selector}|${info.tag}|${info.label}`;
                if (seen.has(key)) continue;
                seen.add(key);

                if (info.expanded === 'true') {
                    console.log(`${label} Panel notifikasi sudah terbuka (${selector}).`);
                    return true;
                }

                const clickable = await el.evaluateHandle((node) => node.closest('button') || node);
                const clickableEl = clickable.asElement();
                if (!clickableEl) continue;

                await clickableEl.click();
                await new Promise(resolve => setTimeout(resolve, 2500));
                console.log(`${label} Klik notifikasi via ${selector} (${info.label || info.tag}).`);
                return true;
            } catch (err) {
                // Coba selector berikutnya.
            }
        }
    }

    console.log(`${label} Tombol notifikasi tidak ditemukan/dapat diklik.`);
    return false;
}

// Dipakai oleh checkPortal, intensiveCheckPortal, dan diagnosePortal supaya
// logika pembacaan notifikasi selalu sama.
async function bacaNotifikasiTerbuka(page) {
    return page.evaluate(() => {
        const hasil = [];
        const regex = /Dosen telah membuka (?:presensi|absensi) untuk mata\s*kuliah\s*([^\n\r]+)/i;
        const elements = Array.from(document.querySelectorAll('div, p, span, li, a, button, h1, h2, h3, h4, h5, h6'));

        for (let el of elements) {
            const raw = el.textContent || '';
            const match = raw.match(regex);
            if (!match) continue;

            const hasChildWithMatch = Array.from(el.children).some(child => regex.test(child.textContent || ''));
            if (hasChildWithMatch) continue;

            let teks = raw.replace(/\s+/g, ' ').trim();

            // Walk up the DOM untuk mencari teks waktu.
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

            // Abaikan notifikasi dari hari-hari sebelumnya.
            if (parentText.includes('hari yang lalu') || parentText.includes('kemarin') || parentText.includes('minggu yang lalu') || parentText.includes('bulan yang lalu') || parentText.includes('tahun yang lalu')) {
                continue;
            }

            let namaMatkul = (match[1] || '').replace(/\s+/g, ' ').trim();
            if (!namaMatkul) continue;
            let tanggalHariIni = new Date().toLocaleDateString('id-ID');
            if (!hasil.find(h => h.matkul === namaMatkul)) {
                hasil.push({ matkul: namaMatkul, tanggal: tanggalHariIni });
            }
        }
        return hasil;
    });
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

        if (await isLoginPage(page)) {
            console.error('[PORTAL] Login gagal: masih di halaman login. Periksa ETHOL_USERNAME/ETHOL_PASSWORD atau captcha.');
            await page.screenshot({ path: 'debug_portal_login.png' }).catch(() => {});
            return;
        }

        try {
            await page.waitForSelector(NOTIF_WAIT_SELECTOR, { timeout: NOTIF_WAIT_TIMEOUT_MS });
        } catch (e) {
            console.log(`[PORTAL] Tombol notifikasi tidak muncul dalam ${NOTIF_WAIT_TIMEOUT_MS / 1000}s (URL: ${page.url()}).`);
        }

        await new Promise(resolve => setTimeout(resolve, 5000));

        await openNotifications(page, '[PORTAL]');
        await logPortalDiagnostics(page, '[PORTAL]');

        await page.screenshot({ path: 'debug_portal.png' });
        console.log("Screenshot halaman saat ini telah disimpan sebagai debug_portal.png");

        const daftarAbsenTerbuka = await bacaNotifikasiTerbuka(page);

        if (daftarAbsenTerbuka && daftarAbsenTerbuka.length > 0) {
            const { loadData } = require('./database');
            let dbData = loadData();
            const namaHari = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
            let todayStr = new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"});
            let todayName = namaHari[new Date(todayStr).getDay()];
            let jadwalHariIni = dbData.daftar_jadwal ? (dbData.daftar_jadwal[todayName] || []) : [];
            let absenBaru = 0;
            let absenDuplikat = 0;

            for (let absen of daftarAbsenTerbuka) {
                const namaNotif = String(absen.matkul || '').toLowerCase();
                if (!namaNotif) continue;

                // Cocokkan nama dari notifikasi dengan jadwal hari ini, lalu
                // gunakan nama resmi dari jadwal agar konsisten dengan database.
                const jadwalMatch = jadwalHariIni.find(j => {
                    const namaJadwal = String(j.matkul || '').toLowerCase();
                    return namaNotif.includes(namaJadwal) || namaJadwal.includes(namaNotif);
                });
                if (!jadwalMatch) continue;

                const namaMatkul = jadwalMatch.matkul;
                let isBaru = catatAbsen(namaMatkul, absen.tanggal);
                if (isBaru) {
                    absenBaru++;
                    let sukses = await announceAbsen(client, process.env.TARGET_GROUP_ID, namaMatkul, absen.tanggal);
                    if (sukses) {
                        console.log(`Pengumuman absen ${namaMatkul} berhasil dikirim.`);
                    } else {
                        console.log(`Gagal total mengirim absen ${namaMatkul}, membatalkan pencatatan di database agar bisa dicoba lagi.`);
                        const { hapusAbsen } = require('./database');
                        hapusAbsen(namaMatkul);
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
    // Cek absensi lebih penting daripada cek portal acak. Kalau cek acak
    // sedang berjalan, tunggu sebentar agar absensi tidak terlewat.
    if (!(await acquireScraperLockWait('Cek absen intensif'))) return;

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

        if (await isLoginPage(page)) {
            console.log('[INTENSIF] Login pertama gagal, mencoba sekali lagi...');
            await page.goto('https://login.pens.ac.id/cas/login?service=https%3A%2F%2Fethol.pens.ac.id%2Fapi%2Fauth%2Fcas-callback', { waitUntil: 'networkidle2' });
            await page.type('#username', username);
            await page.type('#password', password);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
                page.keyboard.press('Enter')
            ]);
            await page.goto('https://ethol.pens.ac.id/mahasiswa/beranda', { waitUntil: 'networkidle2' });

            if (await isLoginPage(page)) {
                console.error('[INTENSIF] Login tetap gagal. Periksa ETHOL_USERNAME/ETHOL_PASSWORD atau captcha.');
                await page.screenshot({ path: 'debug_intensif_login.png' }).catch(() => {});
                return;
            }
            console.log('[INTENSIF] Login ulang berhasil.');
        }

        try {
            await page.waitForSelector(NOTIF_WAIT_SELECTOR, { timeout: NOTIF_WAIT_TIMEOUT_MS });
        } catch (e) {
            console.log(`[INTENSIF] Tombol notifikasi tidak muncul dalam ${NOTIF_WAIT_TIMEOUT_MS / 1000}s (URL: ${page.url()}).`);
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
        await logPortalDiagnostics(page, '[INTENSIF]');

        let startTime = Date.now();
        const MAX_DURATION = customDurationMs;
        let absenFound = false;
        let loginFailed = false;
        let iteration = 0;

        while (Date.now() - startTime < MAX_DURATION && !absenFound) {
            iteration++;
            console.log(`[INTENSIF] Me-refresh halaman portal... (iterasi ${iteration})`);
            try {
                await page.reload({ waitUntil: 'networkidle2' });
            } catch (err) {
                console.log(`[INTENSIF] Reload gagal: ${err?.message || err}. Mencoba lagi di refresh berikutnya.`);
                await new Promise(resolve => setTimeout(resolve, 52000));
                continue;
            }

            try {
                await page.waitForSelector(NOTIF_WAIT_SELECTOR, { timeout: NOTIF_WAIT_TIMEOUT_MS });
            } catch (e) {
                console.log(`[INTENSIF] Tombol notifikasi tidak muncul dalam ${NOTIF_WAIT_TIMEOUT_MS / 1000}s (URL: ${page.url()}).`);
            }

            await new Promise(resolve => setTimeout(resolve, 5000));
            await openNotifications(page, '[INTENSIF]');
            const diag = await logPortalDiagnostics(page, '[INTENSIF]');

            if (diag && (diag.loginVisible || String(diag.url).includes('login.pens.ac.id'))) {
                console.error('[INTENSIF] Sesi login habis / login gagal. Pengecekan dihentikan.');
                await page.screenshot({ path: 'debug_intensif_login.png' }).catch(() => {});
                loginFailed = true;
                break;
            }

            if (iteration === 1) {
                await page.screenshot({ path: 'debug_intensif.png' }).catch(() => {});
                console.log('[INTENSIF] Screenshot halaman disimpan: debug_intensif.png');
            }

            const daftarAbsenTerbuka = await bacaNotifikasiTerbuka(page);

            if (daftarAbsenTerbuka && daftarAbsenTerbuka.length > 0) {
                for (let absen of daftarAbsenTerbuka) {
                    const namaNotif = String(absen.matkul || '').toLowerCase();
                    if (!namaNotif) continue;

                    const target = String(targetMatkul || '').toLowerCase();
                    if (target && !namaNotif.includes(target) && !target.includes(namaNotif)) {
                        console.log(`[INTENSIF] Lewati absen "${absen.matkul}" karena bukan ${targetMatkul}.`);
                        continue;
                    }

                    const namaMatkul = targetMatkul || absen.matkul;
                    let isBaru = catatAbsen(namaMatkul, absen.tanggal);
                    if (isBaru) {
                        let sukses = await announceAbsen(client, process.env.TARGET_GROUP_ID, namaMatkul, absen.tanggal);
                        if (sukses) {
                            console.log(`[INTENSIF] Pengumuman absen ${namaMatkul} berhasil dikirim!`);
                            absenFound = true;
                        } else {
                            console.log(`[INTENSIF] Gagal total mengirim absen ${namaMatkul}, membatalkan pencatatan agar bisa dicoba lagi.`);
                            const { hapusAbsen } = require('./database');
                            hapusAbsen(namaMatkul);
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

        if (!absenFound && !loginFailed) {
            console.log(`[INTENSIF] Waktu ${durationMins} menit habis, absen untuk kelas ini belum dibuka.`);
            await page.screenshot({ path: 'debug_intensif_akhir.png' }).catch(() => {});
        }

    } catch (error) {
        console.error('[INTENSIF] Terjadi kesalahan saat mengecek portal:', error);
    } finally {
        await closeBrowser(browser);
        releaseScraperLock();
        console.log(`[INTENSIF] Pengecekan intensif selesai, browser ditutup.`);
    }
}

// Diagnosa manual tanpa mengirim WhatsApp dan tanpa mencatat absensi.
// Jalankan: npm run diagnose-portal
// Untuk akun kedua: npm run diagnose-portal -- second
async function diagnosePortal(account = 'main') {
    let browser;
    try {
        browser = await launchBrowser();
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(120000);

        await page.goto('https://login.pens.ac.id/cas/login?service=https%3A%2F%2Fethol.pens.ac.id%2Fapi%2Fauth%2Fcas-callback', { waitUntil: 'networkidle2' });

        const useSecond = account === 'second' && process.env.ETHOL_USERNAME_2 && process.env.ETHOL_PASSWORD_2;
        const username = (useSecond ? process.env.ETHOL_USERNAME_2 : process.env.ETHOL_USERNAME || '').trim();
        const password = (useSecond ? process.env.ETHOL_PASSWORD_2 : process.env.ETHOL_PASSWORD || '').trim();

        if (!username || !password) {
            console.error(`[DIAG] ${useSecond ? 'ETHOL_USERNAME_2/ETHOL_PASSWORD_2' : 'ETHOL_USERNAME/ETHOL_PASSWORD'} kosong.`);
            return;
        }

        console.log(`[DIAG] Login sebagai: ${username} (${useSecond ? 'akun kedua' : 'akun utama'})`);
        await page.type('#username', username);
        await page.type('#password', password);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
            page.keyboard.press('Enter')
        ]);

        await page.goto('https://ethol.pens.ac.id/mahasiswa/beranda', { waitUntil: 'networkidle2' });

        if (await isLoginPage(page)) {
            console.error('[DIAG] Login gagal: masih di halaman login. Periksa username/password atau captcha.');
            await page.screenshot({ path: 'debug_diag_login.png' }).catch(() => {});
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
        const opened = await openNotifications(page, '[DIAG]');
        const diag = await logPortalDiagnostics(page, '[DIAG]');

        const terdeteksi = await bacaNotifikasiTerbuka(page);
        if (terdeteksi.length > 0) {
            console.log('[DIAG] Notifikasi yang cocok dengan pola bot:');
            for (const item of terdeteksi) {
                console.log(`[DIAG]   - ${item.matkul}`);
            }
        } else {
            console.log('[DIAG] Tidak ada teks notifikasi yang cocok dengan pola bot.');
        }

        await page.screenshot({ path: 'debug_diag.png' }).catch(() => {});

        console.log(`[DIAG] Selesai. Panel notifikasi terbuka=${opened}. Screenshot: debug_diag.png`);
        if (diag?.snippetDosen) {
            console.log('[DIAG] Bandingkan teks "dosen" di atas dengan pola notifikasi yang dicari bot.');
        }
    } catch (err) {
        console.error('[DIAG] Gagal:', err?.message || err);
    } finally {
        await closeBrowser(browser);
    }
}

// --- AI EXTRACTOR: Sinkronisasi Jadwal & Tugas ---
const { GoogleGenAI } = require("@google/genai");

async function syncJadwalTugas() {
    if (!acquireScraperLock('Sinkronisasi ETHOL')) return;

    console.log("[ETHOL SYNC] Memulai sinkronisasi Jadwal & Tugas...");
    if (!process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEYS) {
        console.log("[ETHOL SYNC] Dibatalkan: API Key Gemini tidak ditemukan.");
        recordSyncResult(false, "API Key Gemini tidak ditemukan");
        releaseScraperLock();
        return;
    }

    let browser;
    try {
        browser = await launchBrowser();
    } catch (err) {
        console.error('[ETHOL SYNC] Gagal membuka browser:', err.message);
        recordSyncResult(false, err);
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
        recordSyncResult(true);
        console.log("[ETHOL SYNC] Sinkronisasi berhasil! Jadwal dan Tugas terbaru telah disimpan ke database.");

    } catch (err) {
        recordSyncResult(false, err);
        console.error("[ETHOL SYNC] Gagal melakukan sinkronisasi:", err);
    } finally {
        await closeBrowser(browser);
        releaseScraperLock();
    }
}

module.exports = { checkPortal, announceAbsen, getLastUsedAccount, intensiveCheckPortal, syncJadwalTugas, closeAllBrowsers, diagnosePortal, getScraperStatus };
