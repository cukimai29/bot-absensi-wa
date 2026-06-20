require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const { loadData, saveData } = require('./src/database');
const { checkPortal } = require('./src/ethol-scraper');
const { handleMessage } = require('./src/commands');

const client = new Client({
    authStrategy: new LocalAuth(),
    authTimeoutMs: 300000, 
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', 
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled' 
        ],
        timeout: 0,
        protocolTimeout: 300000 
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
});

client.on('qr', (qr) => {
    console.log('Silakan scan QR Code ini dengan WhatsApp Anda:');
    qrcode.generate(qr, { small: true });
});

let isBotStarted = false;

client.on('ready', () => {
    console.log('Bot WhatsApp sudah siap dan terhubung!');

    if (!isBotStarted) {
        isBotStarted = true;

        function scheduleRandomCheck() {
            const now = new Date();
            const currentHour = now.getHours();

            if (currentHour >= 5 && currentHour <= 21) {
                console.log('Menjalankan pengecekan portal kampus secara acak...');
                checkPortal(client);
            } else {
                console.log(`[${now.toLocaleTimeString('id-ID')}] Di luar jam kerja (05:00 - 21:00). Pengecekan ditunda.`);
            }

            const minMs = 20 * 60 * 1000;
            const maxMs = 70 * 60 * 1000;
            const randomDelay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

            const nextRun = new Date(now.getTime() + randomDelay);
            console.log(`[Jadwal] Pengecekan berikutnya pada: ${nextRun.toLocaleTimeString('id-ID')} (Jeda: ${Math.round(randomDelay/60000)} menit)`);

            setTimeout(scheduleRandomCheck, randomDelay);
        }

        scheduleRandomCheck();
    }

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

        client.sendMessage(process.env.TARGET_GROUP_ID, pesan).catch(err => console.error("Gagal mengirim pengumuman ganti minggu:", err));
    });

    // Cron job untuk pengingat tugas kelas setiap hari jam 16:00 WIB
    cron.schedule('0 16 * * *', () => {
        let data = loadData();
        let tugas = data.daftar_tugas || [];
        if (tugas.length === 0) return;

        let pesanReminder = "";
        let count = 0;
        
        // Buat tanggal hari ini dan besok dengan zona waktu Asia/Jakarta
        let now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
        let hrIniStr = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2, '0') + "-" + String(now.getDate()).padStart(2, '0');
        
        let besok = new Date(now);
        besok.setDate(besok.getDate() + 1);
        let besokTgl = besok.getFullYear() + "-" + String(besok.getMonth()+1).padStart(2, '0') + "-" + String(besok.getDate()).padStart(2, '0');

        tugas.forEach(t => {
            if (t.deadline === besokTgl || t.deadline === hrIniStr) {
                let sisa = t.deadline === hrIniStr ? "*(HARI INI!)*" : "*(BESOK)*";
                pesanReminder += `- *${t.matkul}*: ${t.deskripsi} ${sisa}\n`;
                count++;
            }
        });

        if (count > 0) {
            let pesanAkhir = `🚨 *REMINDER TUGAS KELAS* 🚨\n\nPerhatian semuanya, ada ${count} tugas yang mendesak untuk segera diselesaikan:\n\n${pesanReminder}\nMohon segera dikerjakan ya! Ketik *.tugas* untuk melihat seluruh daftar tugas.`;
            client.sendMessage(process.env.TARGET_GROUP_ID, pesanAkhir).catch(console.error);
            console.log(`[Pengingat Tugas] Berhasil mengirim peringatan untuk ${count} tugas.`);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Jakarta"
    });
});

client.on('message', async msg => {
    await handleMessage(client, msg);
});

client.initialize();
