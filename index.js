require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const cron = require('node-cron');
const { loadData, saveData } = require('./src/database');
const { checkPortal, intensiveCheckPortal, syncJadwalTugas } = require('./src/ethol-scraper');
const { handleMessage } = require('./src/commands');

async function sendPremiumAnnouncement(client, groupId, text) {
    if (!groupId) return;
    try {
        const fakeVerif = {
            key: { id: '12345678901234567890123456789012', fromMe: false, participant: '0@s.whatsapp.net', remoteJid: groupId },
            message: { conversation: "SMARTBOT by RzkyAds" }
        };
        let metadata = await client.groupMetadata(groupId);
        let mentions = metadata.participants.map(p => p.id);
        await client.sendMessage(groupId, { text: text, mentions: mentions }, { quoted: fakeVerif });
    } catch (err) {
        console.error('Gagal mengirim premium announcement:', err);
        try {
            await client.sendMessage(groupId, { text: text });
        } catch (e) {}
    }
}

let scheduledJobs = [];
let isBotStarted = false;

// Store to keep track of contacts
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) })

// Mencegah crash akibat unhandled promise rejection (termasuk Bad MAC dari libsignal)
process.on('unhandledRejection', (reason, promise) => {
    // Abaikan error Bad MAC dan decrypt message yang sering terjadi dari Channel/Newsletter WhatsApp
    if (String(reason).includes('Bad MAC') || String(reason).includes('decrypt message')) {
        return; 
    }
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
    if (String(err).includes('Bad MAC') || String(err).includes('decrypt message')) {
        return;
    }
    console.error('Uncaught Exception:', err);
});

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
            await handleMessage(client, msg, () => scheduleTodayClasses(client));
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

                let durationMs = 100 * 60 * 1000; // Default 100 menit jika tidak ada jam_selesai
                if (jadwal.jam_selesai) {
                    let endParts = jadwal.jam_selesai.split(':');
                    if (endParts.length >= 2) {
                        let endHour = parseInt(endParts[0]);
                        let endMinute = parseInt(endParts[1]);
                        let startTotalMins = hour * 60 + minute;
                        let endTotalMins = endHour * 60 + endMinute;
                        
                        if (endTotalMins > startTotalMins) {
                            durationMs = (endTotalMins - startTotalMins) * 60 * 1000;
                        }
                    }
                }

                let job = cron.schedule(`${minute} ${hour} * * *`, () => {
                    let durationMins = Math.round(durationMs / 60000);
                    console.log(`[ALARM] Waktu kuliah ${jadwal.matkul} tiba. Memulai pengecekan absen intensif (${durationMins} menit).`);
                    intensiveCheckPortal(client, jadwal.matkul, durationMs);
                }, {
                    scheduled: true,
                    timezone: "Asia/Jakarta"
                });
                scheduledJobs.push(job);

                let siagaTotalMins = hour * 60 + minute - 30;
                if (siagaTotalMins < 0) siagaTotalMins += 24 * 60;
                let siagaHour = Math.floor(siagaTotalMins / 60) % 24;
                let siagaMinute = siagaTotalMins % 60;

                let siagaJob = cron.schedule(`${siagaMinute} ${siagaHour} * * *`, () => {
                    let greeting = "Pagi";
                    if (hour >= 11 && hour < 15) greeting = "Siang";
                    else if (hour >= 15 && hour < 18) greeting = "Sore";
                    else if (hour >= 18) greeting = "Malam";

                    let msg = `🚨 *SIAGA 1: KELAS SEGERA DIMULAI!* 🚨\n\nSelamat ${greeting} rek! ☕\n30 menit lagi kelas *${jadwal.matkul}* (Jam ${jadwal.jam}) akan segera dimulai.\n\nJangan lupa cuci muka, prepare *device*, dan pantau grup buat absen ya! 🏃‍♂️💨`;
                    sendPremiumAnnouncement(client, process.env.TARGET_GROUP_ID, msg);
                }, {
                    scheduled: true,
                    timezone: "Asia/Jakarta"
                });
                scheduledJobs.push(siagaJob);
                console.log(`[JADWAL] -> ${jadwal.matkul} dijadwalkan pada ${jadwal.jam}.`);
            }
        });
    } else {
        console.log(`[JADWAL] Tidak ada kelas pada hari ${todayName}.`);
    }
}

function setupCronJobs(client) {
    scheduleTodayClasses(client);

    cron.schedule('1 0 * * *', async () => {
        console.log('[SISTEM] Memulai rutinitas tengah malam: Sinkronisasi ETHOL...');
        try {
            await syncJadwalTugas();
            console.log('[SISTEM] Sinkronisasi selesai. Membaca jadwal baru untuk hari ini...');
            scheduleTodayClasses(client);
        } catch (err) {
            console.error('Gagal menjalankan syncJadwalTugas cron:', err);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Jakarta"
    });

    cron.schedule('0 6 * * *', async () => {
        try {
            let data = loadData();
            const namaHari = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
            let todayStr = new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"});
            let todayName = namaHari[new Date(todayStr).getDay()];

            let jadwalHariIni = (data.daftar_jadwal && data.daftar_jadwal[todayName]) ? data.daftar_jadwal[todayName] : [];
            let tugasList = data.daftar_tugas || [];
            
            let msg = `🌅 *DAILY MORNING BRIEFING* 🌅\n\nSelamat pagi semuanya! Berikut adalah ringkasan hari ini (*${todayName.toUpperCase()}*):\n\n`;
            
            if (jadwalHariIni.length > 0) {
                msg += `📚 *JADWAL KULIAH HARI INI:*\n`;
                jadwalHariIni.forEach((j, i) => {
                    let jamStr = j.jam_selesai ? `${j.jam} - ${j.jam_selesai}` : j.jam;
                    let ruangStr = (j.ruangan && j.ruangan !== 'undefined') ? j.ruangan : 'Online/Belum ditentukan';
                    msg += `${i + 1}. *${j.matkul}*\n   ⏰ ${jamStr}\n   📍 ${ruangStr}\n`;
                });
                msg += `\n`;
            } else {
                msg += `🎉 *Tidak ada jadwal kuliah hari ini!* Waktunya healing atau ngerjain tugas.\n\n`;
            }

            let tugasBelum = tugasList.filter(t => t.status && typeof t.status === 'string' && t.status.toLowerCase().includes('belum'));
            if (tugasBelum.length > 0) {
                msg += `⚠️ *TUGAS BELUM DIKERJAKAN (${tugasBelum.length}):*\n`;
                tugasBelum.forEach((t, i) => {
                    msg += `${i + 1}. *${t.matkul}* - ${t.judul}\n   ⏳ Deadline: ${t.deadline}\n`;
                });
            } else {
                msg += `✅ *Tidak ada tugas yang belum dikerjakan!* Aman terkendali.\n`;
            }

            msg += `\nSemangat menjalani hari ini! 🔥`;
            sendPremiumAnnouncement(client, process.env.TARGET_GROUP_ID, msg);
        } catch (err) {
            console.error('Gagal mengirim Daily Morning Briefing:', err);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Jakarta"
    });

    // Jalankan satu kali setelah bot siap (delay 10 detik agar tidak bentrok dengan proses awal)
    setTimeout(() => {
        syncJadwalTugas().then(() => scheduleTodayClasses(client)).catch(console.error);
    }, 10000);

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

        sendPremiumAnnouncement(client, process.env.TARGET_GROUP_ID, pesan);
    }, {
        scheduled: true,
        timezone: "Asia/Jakarta"
    });

    cron.schedule('0 7 * * *', async () => {
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

        tugas.forEach(t => {
            let deadlineDateOnly = t.deadline ? t.deadline.substring(0, 10) : "";
            if (deadlineDateOnly === besokTgl || deadlineDateOnly === hrIniStr) {
                let sisa = deadlineDateOnly === hrIniStr ? "*(HARI INI! 😱)*" : "*(H-1 BESOK ⚠️)*";
                pesanReminder += `- *${t.matkul}*: ${t.judul || t.deskripsi} ${sisa}\n`;
                count++;
            }
        });

        if (count > 0) {
            let pesanAkhir = `🚨 *REMINDER TUGAS KELAS* 🚨\n\nPerhatian semuanya, ada ${count} tugas yang mendesak untuk segera diselesaikan:\n\n${pesanReminder}\nMohon segera dikerjakan ya! Ketik *.tugas* untuk melihat seluruh daftar tugas.`;
            
            try {
                let metadata = await client.groupMetadata(process.env.TARGET_GROUP_ID);
                let participants = metadata.participants.map(p => p.id);
                await client.sendMessage(process.env.TARGET_GROUP_ID, { text: `🔊 *PENGUMUMAN*\n\n${pesanAkhir}`, mentions: participants }, { quoted: fakeVerif });
            } catch (err) {
                console.error("Gagal get chat untuk hidetag reminder:", err);
                await client.sendMessage(process.env.TARGET_GROUP_ID, { text: pesanAkhir }, { quoted: fakeVerif }).catch(console.error);
            }
            console.log(`[Pengingat Tugas] Berhasil mengirim peringatan hidetag untuk ${count} tugas.`);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Jakarta"
    });

    const fakeVerif = {
        key: { id: '12345678901234567890123456789012', fromMe: false, participant: '0@s.whatsapp.net', remoteJid: process.env.TARGET_GROUP_ID },
        message: { conversation: "SMARTBOT by RzkyAds" }
    };

    cron.schedule('0 5 * * *', async () => {
        const pesanSubuh = `🌅 *SELAMAT PAGI SEMUANYA!* 🌅\n\nJangan lupa untuk segera bangun dan melaksanakan sholat subuh bagi yang menjalankan. Awali hari dengan doa agar dilancarkan segala urusannya!\n\n💸 *REMINDER KAS KELAS* 💸\nSekalian ngingetin buat teman-teman yang belum bayar uang kas kelas, yuk segera dilunasi ke bendahara agar keuangan kelas kita tetap sehat dan lancar!`;
        
        try {
            let metadata = await client.groupMetadata(process.env.TARGET_GROUP_ID);
            let participants = metadata.participants.map(p => p.id);
            await client.sendMessage(process.env.TARGET_GROUP_ID, { text: pesanSubuh, mentions: participants }, { quoted: fakeVerif });
        } catch (err) {
            console.error("Gagal get chat untuk hidetag subuh:", err);
            await client.sendMessage(process.env.TARGET_GROUP_ID, { text: pesanSubuh }, { quoted: fakeVerif }).catch(console.error);
        }
        console.log(`[Pengingat Pagi] Berhasil mengirim hidetag sholat subuh dan kas kelas.`);
    }, {
        scheduled: true,
        timezone: "Asia/Jakarta"
    });

    async function updateAutoBio() {
        try {
            let nowStr = new Date().toLocaleTimeString("id-ID", {timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit"});
            let bio = `🟢 Aktif | Mengawal Absensi Mahasiswa | Update: ${nowStr} WIB`;
            // Fitur ini dinonaktifkan sementara karena WhatsApp Business sering mendiskonek bot 
            // setiap kali profil diubah terlalu cepat.
            // await client.updateProfileStatus(bio);
            // console.log(`[Auto-Bio] Berhasil memperbarui Bio WhatsApp: ${bio}`);
        } catch(e) {
            console.error("Gagal update Bio:", e);
        }
    }

    // Panggil sekali saat pertama kali bot siap
    // updateAutoBio();

    // Jadwalkan setiap 10 menit agar update terlihat
    // cron.schedule('*/10 * * * *', updateAutoBio, {
    //     scheduled: true,
    //     timezone: "Asia/Jakarta"
    // });
}

startBot();
