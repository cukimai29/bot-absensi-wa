const puppeteer = require('puppeteer');
const { loadData, saveData } = require('../core/database');

/**
 * Service untuk Sinkronisasi Jadwal Perkuliahan dari Ethol PENS ke Database Lokal (JSON)
 */
class EtholSyncService {
    /**
     * Menyinkronkan jadwal perkuliahan dari Ethol PENS ke absensi_data.json
     */
    static async syncScheduleFromEthol() {
        console.log("🌐 Membuka browser Puppeteer untuk Sinkronisasi Jadwal Ethol...");
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
        page.setDefaultNavigationTimeout(60000); 

        const username = (process.env.ETHOL_USERNAME || '').trim();
        const password = (process.env.ETHOL_PASSWORD || '').trim();

        if (!username || !password) {
            await browser.close();
            throw new Error('Kredensial ETHOL_USERNAME atau ETHOL_PASSWORD belum dikonfigurasi di file .env');
        }

        console.log(`🔑 Menggunakan Akun CAS PENS: ${username}`);

        try {
            console.log("🚀 Navigasi ke Halaman Login CAS PENS...");
            await page.goto('https://login.pens.ac.id/cas/login?service=https%3A%2F%2Fethol.pens.ac.id%2Fapi%2Fauth%2Fcas-callback', { waitUntil: 'domcontentloaded' });

            await page.type('#username', username);
            await page.type('#password', password);

            console.log("🔓 Mengirim Form Login & Menunggu Redirect...");
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                page.keyboard.press('Enter')
            ]);

            console.log("📅 Menuju Beranda / Jadwal Kuliah Ethol PENS...");
            await page.goto('https://ethol.pens.ac.id/mahasiswa/beranda', { waitUntil: 'domcontentloaded' });
            await new Promise(resolve => setTimeout(resolve, 4000));

            await page.screenshot({ path: 'debug_sync_jadwal.png' });

            console.log("📋 Mengekstraksi Data Jadwal Perkuliahan dari Portal...");
            const scpResult = await page.evaluate(() => {
                const hasilJadwal = {
                    senin: [],
                    selasa: [],
                    rabu: [],
                    kamis: [],
                    jumat: [],
                    sabtu: []
                };
                let totalMatkul = 0;

                const bodyText = document.body.innerText;
                const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);

                const ignoredPhrases = ['akses', 'matakuliah', 'lihat', '→', 'item', 'semester', 'presensi', 'mahasiswa', 'beranda'];

                // Pola pencocokan hari & jam: "Senin, 08:00 – 09:40" atau "Selasa, 10:30 - 13:00"
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const hariJamMatch = line.match(/(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu)\s*,\s*([0-2]?[0-9][:\.][0-5][0-9]\s*[-–—]\s*[0-2]?[0-9][:\.][0-5][0-9])/i);

                    if (hariJamMatch) {
                        const hariFound = hariJamMatch[1].toLowerCase();
                        const jamFound = hariJamMatch[2].replace('–', '-').replace('—', '-');

                        let matkulFound = '';
                        let dosenFound = '';
                        let ruangFound = 'D4-301';

                        // Mundur ke belakang untuk mencari nama matkul & dosen
                        for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
                            const prevLine = lines[j];
                            const isIgnored = ignoredPhrases.some(p => prevLine.toLowerCase().includes(p));

                            if ((prevLine.includes(',') || prevLine.includes('.') || prevLine.toLowerCase().includes('dr') || prevLine.toLowerCase().includes('st')) && !dosenFound) {
                                dosenFound = prevLine;
                            } else if (prevLine.length > 3 && !isIgnored && !matkulFound) {
                                matkulFound = prevLine;
                            }
                        }

                        // Maju ke depan untuk mencari ruang (misal SAW-03.08, HH-101, PS-03.13)
                        if (i + 1 < lines.length) {
                            const nextLine = lines[i + 1];
                            if (nextLine.match(/^[A-Z0-9]{2,5}-[0-9]{2}\.[0-9]{2}/) || nextLine.match(/HH-|PS-|SAW-|D3-|D4-|Lab/i)) {
                                ruangFound = nextLine;
                            }
                        }

                        if (matkulFound && !hasilJadwal[hariFound].some(m => m.matkul === matkulFound)) {
                            hasilJadwal[hariFound].push({
                                matkul: matkulFound,
                                jam: `${jamFound} WIB`,
                                ruang: ruangFound,
                                dosen: dosenFound
                            });
                            totalMatkul++;
                        }
                    }
                }

                return { hasilJadwal, totalMatkul };
            });

            if (scpResult.totalMatkul > 0) {
                let dbData = loadData();
                dbData.daftar_jadwal = scpResult.hasilJadwal;
                dbData.last_jadwal_sync = new Date().toISOString();
                saveData(dbData);

                console.log(`✅ Sinkronisasi Selesai! Berhasil menyimpan ${scpResult.totalMatkul} mata kuliah ke absensi_data.json.`);
            } else {
                console.log("⚠️ Tidak ada mata kuliah yang terekstrak dari DOM.");
            }

            return {
                success: scpResult.totalMatkul > 0,
                accountUsed: username,
                syncedScheduleCount: scpResult.totalMatkul,
                updatedJadwal: scpResult.hasilJadwal,
                message: scpResult.totalMatkul > 0 
                    ? `Berhasil menyinkronkan ${scpResult.totalMatkul} mata kuliah dari Ethol PENS ke database JSON lokal!`
                    : 'Gagal mengekstraksi data jadwal dari portal Ethol PENS.'
            };

        } catch (err) {
            console.error('❌ Terjadi kesalahan saat sinkronisasi jadwal:', err);
            return {
                success: false,
                accountUsed: username,
                error: err.message
            };
        } finally {
            await browser.close();
        }
    }
}

module.exports = EtholSyncService;
