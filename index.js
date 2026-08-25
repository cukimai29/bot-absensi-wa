require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const cron = require('node-cron');
const { loadData, saveData } = require('./src/database');
const { checkPortal, intensiveCheckPortal } = require('./src/ethol-scraper');
const { handleMessage } = require('./src/commands');

let scheduledJobs = [];
let isBotStarted = false;

// Store to keep track of contacts
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) })

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    const client = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        auth: state,
        generateHighQualityLinkPreview: true,
        getMessage: async (key) => {
            if (store) {
                const msg = await store.loadMessage(key.remoteJid, key.id)
                return msg?.message || undefined
            }
            return { conversation: 'hello' }
        }
    });
    
    store.bind(client.ev);

    client.ev.on('creds.update', saveCreds);

    client.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus, reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            } else {
                console.log('Logged out dari WhatsApp, hapus folder session dan jalankan ulang untuk scan QR.');
            }
        } else if (connection === 'open') {
            console.log('Bot WhatsApp sudah siap dan terhubung!');
            if (!isBotStarted) {
                isBotStarted = true;
                setupCronJobs(client);
            }
        }
    });

    client.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        if (msg.key.fromMe) return; // Ignore bot's own messages
        
        // Cek pesan agar tidak memproses pesan basi (di atas 2 menit)
        const now = Math.floor(Date.now() / 1000);
        if (now - msg.messageTimestamp > 120) return;
        
        // Handle message
        try {
            await handleMessage(client, msg);
        } catch (err) {
            console.error("Error processing message:", err);
        }
    });

    return client;
}

function scheduleTodayClasses(client) {
    scheduledJobs.forEach(job => job.stop());
    scheduledJobs = [];

    const namaHari = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
    let todayStr = new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"});
    let todayName = namaHari[new Date(todayStr).getDay()];

    let data = loadData();
    if (data.daftar_jadwal && data.daftar_jadwal[todayName]) {
        let jadwalHariIni = data.daftar_jadwal[todayName];
        console.log(`[JADWAL] Menyiapkan ${jadwalHariIni.length} jadwal pengecekan intensif untuk hari ${todayName}.`);

        jadwalHariIni.forEach(jadwal => {
            let jamParts = jadwal.jam.split(':');
            if (jamParts.length >= 2) {
                let hour = parseInt(jamParts[0]);
                let minute = parseInt(jamParts[1]);

                let job = cron.schedule(`${minute} ${hour} * * *`, () => {
                    console.log(`[ALARM] Waktu kuliah ${jadwal.matkul} tiba. Memulai pengecekan absen intensif (10 menit).`);
                    intensiveCheckPortal(client, jadwal.matkul);
                }, {
                    scheduled: true,
                    timezone: "Asia/Jakarta"
                });
                
                scheduledJobs.push(job);
                console.log(`[JADWAL] -> ${jadwal.matkul} dijadwalkan pada ${jadwal.jam}.`);
            }
        });
    } else {
        console.log(`[JADWAL] Tidak ada kelas pada hari ${todayName}.`);
    }
}

function setupCronJobs(client) {
    scheduleTodayClasses(client);

    cron.schedule('1 0 * * *', () => {
        console.log('[SISTEM] Membaca jadwal baru untuk hari ini...');
        scheduleTodayClasses(client);
    }, {
        scheduled: true,
        timezone: "Asia/Jakarta"
    });

    function scheduleRandomCheck() {
        const now = new Date();
        const currentHour = now.getHours();

        if (currentHour >= 5 && currentHour <= 21) {
            console.log('Menjalankan pengecekan portal kampus secara acak...');
            checkPortal(client);
        } else {
            console.log(`[${now.toLocaleTimeString('id-ID')}] Di luar jam kerja (05:00 - 21:00). Pengecekan ditunda.`);
        }

        const minMs = 15 * 60 * 1000;
        const maxMs = 30 * 60 * 1000;
        const randomDelay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

        const nextRun = new Date(now.getTime() + randomDelay);
        console.log(`[Jadwal] Pengecekan berikutnya pada: ${nextRun.toLocaleTimeString('id-ID')} (Jeda: ${Math.round(randomDelay/60000)} menit)`);

        setTimeout(scheduleRandomCheck, randomDelay);
    }

    scheduleRandomCheck();

    cron.schedule('0 0 * * 1', () => {
        let data = loadData();
        let pesan = "";

        if (data.minggu_ke < 16) {
            data.minggu_ke += 1;
            pesan = `*Pemberitahuan Sistem*\n\nMinggu perkuliahan telah otomatis berganti ke *Minggu ke-${data.minggu_ke}*. Semangat belajar!`;
            console.log(`[Otomatis] Minggu berganti menjadi minggu ke-${data.minggu_ke}`);
        } else {
            data.minggu_ke = 1;
            data.semester = (data.semester || 1) + 1;
            data.jadwal = {}; 
            pesan = `*Pemberitahuan Sistem*\n\nSelamat datang di *Semester ${data.semester}*! Minggu perkuliahan telah direset kembali ke Minggu 1.`;
            console.log(`[Otomatis] Semester ${data.semester} baru dimulai! Reset ke minggu 1.`);
        }

        saveData(data);

        client.sendMessage(process.env.TARGET_GROUP_ID, { text: pesan }).catch(err => console.error("Gagal mengirim pengumuman ganti minggu:", err));
    }, {
        scheduled: true,
        timezone: "Asia/Jakarta"
    });

    cron.schedule('0 16 * * *', async () => {
        let data = loadData();
        let tugas = data.daftar_tugas || [];
        if (tugas.length === 0) return;

        let pesanReminder = "";
        let count = 0;
        
        let now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
        let hrIniStr = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2, '0') + "-" + String(now.getDate()).padStart(2, '0');
        
        let besok = new Date(now);
        besok.setDate(besok.getDate() + 1);
        let besokTgl = besok.getFullYear() + "-" + String(besok.getMonth()+1).padStart(2, '0') + "-" + String(besok.getDate()).padStart(2, '0');

        let lusa = new Date(now);
        lusa.setDate(lusa.getDate() + 2);
        let lusaTgl = lusa.getFullYear() + "-" + String(lusa.getMonth()+1).padStart(2, '0') + "-" + String(lusa.getDate()).padStart(2, '0');

        tugas.forEach(t => {
            if (t.deadline === lusaTgl || t.deadline === besokTgl || t.deadline === hrIniStr) {
                let sisa = t.deadline === hrIniStr ? "*(HARI INI!)*" : (t.deadline === besokTgl ? "*(H-1/BESOK)*" : "*(H-2)*");
                pesanReminder += `- *${t.matkul}*: ${t.deskripsi} ${sisa}\n`;
                count++;
            }
        });

        if (count > 0) {
            let pesanAkhir = `🚨 *REMINDER TUGAS KELAS* 🚨\n\nPerhatian semuanya, ada ${count} tugas yang mendesak untuk segera diselesaikan:\n\n${pesanReminder}\nMohon segera dikerjakan ya! Ketik *.tugas* untuk melihat seluruh daftar tugas.`;
            
            try {
                let metadata = await client.groupMetadata(process.env.TARGET_GROUP_ID);
                let participants = metadata.participants.map(p => p.id);
                await client.sendMessage(process.env.TARGET_GROUP_ID, { text: `🔊 *PENGUMUMAN*\n\n${pesanAkhir}`, mentions: participants });
            } catch (err) {
                console.error("Gagal get chat untuk hidetag reminder:", err);
                await client.sendMessage(process.env.TARGET_GROUP_ID, { text: pesanAkhir }).catch(console.error);
            }
            console.log(`[Pengingat Tugas] Berhasil mengirim peringatan hidetag untuk ${count} tugas.`);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Jakarta"
    });

    cron.schedule('0 5 * * *', async () => {
        const pesanSubuh = `🌅 *SELAMAT PAGI SEMUANYA!* 🌅\n\nJangan lupa untuk segera bangun dan melaksanakan sholat subuh bagi yang menjalankan. Awali hari dengan doa agar dilancarkan segala urusannya!\n\n💸 *REMINDER KAS KELAS* 💸\nSekalian ngingetin buat teman-teman yang belum bayar uang kas kelas, yuk segera dilunasi ke bendahara agar keuangan kelas kita tetap sehat dan lancar!`;
        
        try {
            let metadata = await client.groupMetadata(process.env.TARGET_GROUP_ID);
            let participants = metadata.participants.map(p => p.id);
            await client.sendMessage(process.env.TARGET_GROUP_ID, { text: pesanSubuh, mentions: participants });
        } catch (err) {
            console.error("Gagal get chat untuk hidetag subuh:", err);
            await client.sendMessage(process.env.TARGET_GROUP_ID, { text: pesanSubuh }).catch(console.error);
        }
        console.log(`[Pengingat Pagi] Berhasil mengirim hidetag sholat subuh dan kas kelas.`);
    }, {
        scheduled: true,
        timezone: "Asia/Jakarta"
    });
}

startBot();
