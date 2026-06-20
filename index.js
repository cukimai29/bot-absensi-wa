const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const puppeteer = require('puppeteer');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'absensi_data.json');

// Fungsi untuk memuat database absensi
function loadData() {
    if (!fs.existsSync(DB_PATH)) {
        // Default minggu ke-1 saat pertama kali dibuat
        return { minggu_ke: 1, jadwal: {} };
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

// Fungsi untuk menyimpan database absensi
function saveData(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Fungsi mencatat absen baru
function catatAbsen(matkul, tanggal) {
    let data = loadData();
    let mingguIni = `minggu_${data.minggu_ke}`;

    if (!data.jadwal[mingguIni]) {
        data.jadwal[mingguIni] = [];
    }

    // Cek duplikasi agar tidak dicatat/spam dua kali
    let sudahAda = data.jadwal[mingguIni].find(a => a.matkul === matkul && a.tanggal === tanggal);
    if (!sudahAda) {
        data.jadwal[mingguIni].push({ matkul, tanggal });
        saveData(data);
        return true; // Absen baru
    }
    return false; // Sudah pernah dicatat
}

// Fungsi mengirim pesan absen dengan tag semua orang
async function announceAbsen(client, groupId, matkul, tanggal) {
    try {
        const chat = await client.getChatById(groupId);
        let text = `Absen Ethol *${matkul}* telah dibuka. Segera absen, jika tidak kamu akan alpha, jika alphamu banyak kamu akan diberikan SP!!!!!\n\ntanggal : ${tanggal}`;

        let mentions = [];
        for (let participant of chat.participants) {
            const contact = await client.getContactById(participant.id._serialized);
            mentions.push(contact);
        }

        // whatsapp-web.js butuh tag @nomor di dalam pesan agar notif "mentions" ter-trigger
        let mentionsText = chat.participants.map(p => `@${p.id.user}`).join(' ');
        let fullText = `${text}\n\n${mentionsText}`;

        await chat.sendMessage(fullText, { mentions });
    } catch (err) {
        console.error('Gagal mengirim pengumuman absen:', err);
    }
}

// Inisialisasi WhatsApp Client
// Menggunakan LocalAuth agar Anda tidak perlu scan QR setiap kali bot dijalankan
const client = new Client({
    authStrategy: new LocalAuth(),
    authTimeoutMs: 300000, // Tambahan waktu tunggu hingga 5 menit
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Mencegah crash memori di VPS
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled' // FITUR ANTI-BLOKIR UTAMA: Sembunyikan identitas bot
        ],
        timeout: 0,
        protocolTimeout: 300000 // Menghindari error Runtime.callFunctionOn timed out
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
});

// Masukkan ID Grup WhatsApp target (biasanya diakhiri dengan @g.us)
// Anda bisa mendapatkan ID ini dengan melakukan console.log(message.from) saat ada pesan masuk di grup
const TARGET_GROUP_ID = '120363418765506558@g.us';

client.on('qr', (qr) => {
    console.log('Silakan scan QR Code ini dengan WhatsApp Anda:');
    qrcode.generate(qr, { small: true });
});

let isBotStarted = false;

client.on('ready', () => {
    console.log('Bot WhatsApp sudah siap dan terhubung!');

    // Cegah loop ganda jika bot terputus dan melakukan reconnect
    if (!isBotStarted) {
        isBotStarted = true;

        // Fungsi untuk menjadwalkan pengecekan dengan jeda waktu acak
        function scheduleRandomCheck() {
            const now = new Date();
            const currentHour = now.getHours();

            // Hanya jalankan jika waktu berada antara jam 05:00 dan 21:00 (5 pagi - 9 malam)
            if (currentHour >= 5 && currentHour <= 21) {
                console.log('Menjalankan pengecekan portal kampus secara acak...');
                checkPortal();
            } else {
                console.log(`[${now.toLocaleTimeString('id-ID')}] Di luar jam kerja (05:00 - 21:00). Pengecekan ditunda.`);
            }

            // Hitung jeda acak untuk pengecekan berikutnya (antara 45 menit sampai 90 menit)
            // 45 menit = 2700000 ms, 90 menit = 5400000 ms
            const minMs = 45 * 60 * 1000;
            const maxMs = 90 * 60 * 1000;
            const randomDelay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

            const nextRun = new Date(now.getTime() + randomDelay);
            console.log(`[Jadwal] Pengecekan berikutnya pada: ${nextRun.toLocaleTimeString('id-ID')} (Jeda: ${Math.round(randomDelay/60000)} menit)`);

            setTimeout(scheduleRandomCheck, randomDelay);
        }

        // Memulai penjadwalan acak untuk pertama kalinya
        scheduleRandomCheck();
    }

    // Menjadwalkan pergantian minggu otomatis setiap hari Senin jam 00:00
    cron.schedule('0 0 * * 1', () => {
        let data = loadData();
        let pesan = "";

        if (data.minggu_ke < 16) {
            data.minggu_ke += 1;
            pesan = `*Pemberitahuan Sistem*\n\nMinggu perkuliahan telah otomatis berganti ke *Minggu ke-${data.minggu_ke}*. Semangat belajar!`;
            console.log(`[Otomatis] Minggu berganti menjadi minggu ke-${data.minggu_ke}`);
        } else {
            // Reset semester jika sudah lewat minggu ke-16
            data.minggu_ke = 1;
            data.semester = (data.semester || 1) + 1;
            data.jadwal = {}; // Mengosongkan memori absensi semester lalu
            pesan = `*Pemberitahuan Sistem*\n\nSelamat datang di *Semester ${data.semester}*! Minggu perkuliahan telah direset kembali ke Minggu 1.`;
            console.log(`[Otomatis] Semester ${data.semester} baru dimulai! Reset ke minggu 1.`);
        }

        saveData(data);

        // Umumkan pergantian minggu ke grup
        client.sendMessage(TARGET_GROUP_ID, pesan).catch(err => console.error("Gagal mengirim pengumuman ganti minggu:", err));
    });
});

// Mendengarkan pesan masuk (berguna untuk mencari Group ID)
client.on('message', async msg => {
    // === FITUR ANTI-BLOKIR (Jeda & Mengetik) ===
    const originalReply = msg.reply.bind(msg);
    msg.reply = async (content, chatId, options) => {
        try {
            const chat = await msg.getChat();
            await chat.sendStateTyping();
            
            // Jeda acak antara 1,5 hingga 3,5 detik
            const delay = Math.floor(Math.random() * 2000) + 1500;
            await new Promise(resolve => setTimeout(resolve, delay));
            
            await chat.clearState();
            return await originalReply(content, chatId, options);
        } catch (err) {
            return await originalReply(content, chatId, options);
        }
    };
    // ============================================
    // Respons panggilan "bot"
    if (msg.body.toLowerCase() === 'bot') {
        msg.reply("Hadirr, siap membantu mengurus absensi warna warnimu itu.\n\nsilahkan ketik .menu untuk melihat menu apa saja pada smartbot ini");
    }

    // Respons salam
    if (msg.body.toLowerCase() === 'assalamualaikum' || msg.body.toLowerCase() === 'assalamu\'alaikum') {
        msg.reply('Waalaikumsalam');
    }

    // Fitur .menu
    if (msg.body.toLowerCase() === '.menu') {
        const menuPesan = `*MENU SMARTBOT ABSENSI*\n\n` +
            `1. *Otomatisasi Absen*: Bot akan memantau portal kampus dan mengumumkan (tag all) jika ada absen baru.\n` +
            `2. *.allabsensi* : Melihat rekap seluruh mata kuliah dan tanggal absensi pada minggu ini.\n` +
            `3. *.setminggu <angka>* : Mengubah minggu perkuliahan aktif secara manual (contoh: .setminggu 2).\n` +
            `4. *.resetbot <semester>* : Mereset seluruh histori absensi dan memulai dari minggu 1 untuk semester baru (contoh: .resetbot 3).\n` +
            `5. *.stiker* : Mengubah foto menjadi stiker (Kirim/reply foto dengan teks .stiker).\n` +
            `6. *.admin* : Menampilkan admin misterius pembuat bot ini.\n\n` +
            `_Catatan: Bot secara otomatis berganti minggu setiap hari Senin, dan reset di minggu ke-17._`;
        msg.reply(menuPesan);
    }

    if (msg.body === '!ping') {
        msg.reply('pang ping pang ping ae, SALAM POO!!');
    }

    // Jika Anda belum tahu ID Grup, ketik !info di grup tersebut
    if (msg.body === '!info') {
        console.log('ID Chat ini adalah:', msg.from);
        msg.reply(`ID Chat ini adalah: ${msg.from}`);
    }

    // Fitur .allabsensi
    if (msg.body === '.allabsensi') {
        let data = loadData();
        let mingguIni = `minggu_${data.minggu_ke}`;
        let jadwalMingguIni = data.jadwal[mingguIni] || [];

        if (jadwalMingguIni.length === 0) {
            msg.reply(`Belum ada data absensi untuk Minggu ke-${data.minggu_ke}.`);
            return;
        }

        let pesan = `*Rekap Absensi Minggu ke-${data.minggu_ke}*\n\n`;
        jadwalMingguIni.forEach((item, index) => {
            pesan += `${index + 1}. Matkul: ${item.matkul}\n   Tanggal: ${item.tanggal}\n\n`;
        });

        msg.reply(pesan);
    }

    // Pengecekan Admin (Mendukung nomor biasa dan format ID baru dari WhatsApp/@lid)
    const senderId = msg.author || msg.from || '';
    const isAdmin = senderId.includes('85704682918') || senderId.includes('194720949112994');

    // Fitur mengubah minggu semester yang aktif (maksimal 16)
    if (msg.body.startsWith('.setminggu ') || msg.body.startsWith('.resetbot') || msg.body.startsWith('.testabsen') || msg.body.startsWith('.testnotif')) {
        if (!isAdmin) {
            msg.reply('Mohon Maaf, fitur ini hanya bisa digunakan oleh admin!!');
            return;
        }

        // Fitur .setminggu (hanya admin)
        if (msg.body.toLowerCase().startsWith('.setminggu')) {
            const mingguBaru = parseInt(msg.body.split(' ')[1]);
            if (!isNaN(mingguBaru) && mingguBaru > 0 && mingguBaru <= 16) {
                let data = loadData();
                data.minggu_ke = mingguBaru;
                saveData(data);
                msg.reply(`Minggu semester berhasil diubah menjadi minggu ke-${mingguBaru}.`);
            } else {
                msg.reply('Format salah. Contoh penggunaan: .setminggu 2 (Maksimal 16)');
            }
        }

        // Fitur reset database (untuk memulai semester baru)
        if (msg.body.toLowerCase().startsWith('.resetbot')) {
            const parts = msg.body.split(' ');
            let semesterBaru = 1; // Default
            if (parts.length > 1 && !isNaN(parseInt(parts[1]))) {
                semesterBaru = parseInt(parts[1]);
            }

            let data = {
                minggu_ke: 1,
                semester: semesterBaru,
                jadwal: {}
            };
            saveData(data);
            msg.reply(`Database berhasil direset!\n\nSelamat datang di *Semester ${semesterBaru}*. Sistem telah dikembalikan ke *Minggu ke-1* dan seluruh histori absensi semester lama telah dihapus.`);
        }

        // Fitur .testabsen (hanya admin)
        if (msg.body.toLowerCase() === '.testabsen') {
            msg.reply('Memulai proses pengecekan portal Ethol secara manual... Silakan tunggu beberapa saat.');
            try {
                await checkPortal();
                msg.reply('Proses pengecekan manual selesai!');
            } catch (err) {
                console.error(err);
                msg.reply('Terjadi kesalahan saat mengecek portal.');
            }
        }

        // Fitur .testnotif (hanya admin) - Simulasi notifikasi untuk testimoni
        if (msg.body.toLowerCase().startsWith('.testnotif')) {
            let matkul = msg.body.split(' ').slice(1).join(' ') || 'Pemrograman Web (Uji Coba)';
            let tanggal = new Date().toLocaleDateString('id-ID');
            msg.reply('Mengirim pesan simulasi absensi ke grup...');
            
            try {
                await announceAbsen(client, TARGET_GROUP_ID, matkul, tanggal);
            } catch (err) {
                console.error('Gagal saat simulasi:', err);
                msg.reply('Terjadi kesalahan saat mengirim simulasi.');
            }
        }
    }

    // Fitur .admin
    if (msg.body.toLowerCase() === '.admin') {
        msg.reply("ciee kepo sama adminkuu yang ganteng imut lucu ini yakk?? xixixi");
        try {
            // Mengambil kontak admin dan mengirimkannya sebagai vCard (kontak)
            const adminContact = await client.getContactById('6285704682918@c.us');
            adminContact.name = "RzkyAds"; // Memberikan nama pada kontak
            adminContact.pushname = "RzkyAds";
            await client.sendMessage(msg.from, adminContact);
        } catch (err) {
            console.error('Gagal mengirim kontak admin:', err);
            msg.reply('Nomor Admin (RzkyAds): 085704682918');
        }
    }

    // Fitur Pembuat Stiker
    if (msg.body.toLowerCase() === '.stiker' || msg.body.toLowerCase() === '.sticker') {
        let media = null;

        // Cek jika pesan itu sendiri berisi media (foto dikirim dengan caption .stiker)
        if (msg.hasMedia) {
            media = await msg.downloadMedia();
        }
        // Cek jika pesan mereply sebuah pesan yang berisi media
        else if (msg.hasQuotedMsg) {
            const quotedMsg = await msg.getQuotedMessage();
            if (quotedMsg.hasMedia) {
                media = await quotedMsg.downloadMedia();
            }
        }

        // Jika ada media, kirimkan kembali sebagai stiker
        if (media) {
            try {
                await client.sendMessage(msg.from, media, {
                    sendMediaAsSticker: true,
                    stickerName: 'Bot Stiker', // Nama stiker
                    stickerAuthor: 'RzkyAds'   // Author stiker
                });
            } catch (err) {
                console.error('Gagal mengirim stiker:', err);
                msg.reply('Maaf, terjadi kesalahan saat membuat stiker.');
            }
        } else {
            msg.reply('Mohon kirim foto dengan caption ".stiker" atau reply foto dengan ".stiker"');
        }
    }
});

client.initialize();

// Fungsi untuk melakukan otomatisasi web
async function checkPortal() {
    // Jalankan browser secara tersembunyi (headless: true) dengan konfigurasi yang ramah VPS Linux
    const browser = await puppeteer.launch({ 
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Mencegah crash memori di VPS saat membuka Ethol
            '--disable-accelerated-2d-canvas',
            '--no-zygote',
            '--disable-gpu'
        ]
    });
    const page = await browser.newPage();
    
    // Perpanjang waktu tunggu (timeout) menjadi 2 menit agar VPS punya cukup waktu memuat web
    page.setDefaultNavigationTimeout(120000); 

    try {
        // 1. GANTI BAGIAN INI: URL Login Kampus
        await page.goto('https://login.pens.ac.id/cas/login?service=http%3A%2F%2Fethol.pens.ac.id%2Fcas%2F', { waitUntil: 'networkidle2' });

        // 2. GANTI BAGIAN INI: Selector CSS untuk input email/username dan password
        await page.type('#username', 'alfarizky@iet.student.pens.ac.id');
        await page.type('#password', 'Alfa2906_');

        // 3. GANTI BAGIAN INI: Selector CSS untuk tombol login
        // Menekan tombol LOGIN berdasarkan class .btn-submit yang terlihat di Inspect Element
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('.btn-submit')
        ]);

        // 4. NAVIGASI KE HALAMAN BERANDA/NOTIFIKASI
        await page.goto('https://ethol.pens.ac.id/mahasiswa/beranda', { waitUntil: 'networkidle2' });

        // Tunggu beberapa detik agar halaman vue.js selesai memuat komponennya
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Mencoba membuka panel notifikasi (biasanya berupa ikon lonceng pada aplikasi Vuetify)
        try {
            await page.evaluate(() => {
                const lonceng = document.querySelector('.mdi-bell, .mdi-bell-outline, .v-badge');
                if (lonceng) {
                    const tombol = lonceng.closest('button');
                    if (tombol) tombol.click();
                }
            });
            // Tunggu animasi panel notifikasi terbuka
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (e) {
            console.log("Gagal mengklik tombol notifikasi, mencoba membaca DOM secara langsung...");
        }

        // Simpan tangkapan layar (screenshot) untuk mempermudah perbaikan jika bot gagal membaca
        await page.screenshot({ path: 'debug_portal.png' });
        console.log("Screenshot halaman saat ini telah disimpan sebagai debug_portal.png");

        // 5. LOGIKA SCRAPING DATA ABSENSI
        const daftarAbsenTerbuka = await page.evaluate(() => {
            let hasil = [];

            // Mencari semua elemen teks di layar
            const elemenTeks = Array.from(document.querySelectorAll('*'));

            for (let el of elemenTeks) {
                // Hanya ambil elemen yang tidak punya anak elemen lain (elemen teks terdalam)
                if (el.children.length === 0 && el.textContent) {
                    let teks = el.textContent.trim();

                    // Mencocokkan dengan kalimat di screenshot notifikasi Anda
                    const pola = "Dosen telah melakukan presensi untuk matakuliah";
                    if (teks.includes(pola)) {
                        // Mengambil teks nama mata kuliah yang berada setelah pola kalimat
                        let namaMatkul = teks.split(pola)[1].trim();

                        // Gunakan tanggal hari ini sebagai penanda (karena bot mengecek tiap jam)
                        let tanggalHariIni = new Date().toLocaleDateString('id-ID');

                        // Cegah duplikasi di array hasil
                        if (!hasil.find(h => h.matkul === namaMatkul)) {
                            hasil.push({ matkul: namaMatkul, tanggal: tanggalHariIni });
                        }
                    }
                }
            }

            return hasil;
        });

        // Proses setiap absen yang ditemukan
        if (daftarAbsenTerbuka && daftarAbsenTerbuka.length > 0) {
            for (let absen of daftarAbsenTerbuka) {
                // catatAbsen mengembalikan true jika absen ini belum pernah dicatat di database
                let isBaru = catatAbsen(absen.matkul, absen.tanggal);

                if (isBaru) {
                    await announceAbsen(client, TARGET_GROUP_ID, absen.matkul, absen.tanggal);
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
