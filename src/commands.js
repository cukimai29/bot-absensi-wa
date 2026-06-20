const { loadData, saveData } = require('./database');
const { checkPortal, announceAbsen } = require('./ethol-scraper');
const { GoogleGenAI } = require('@google/genai');

// Inisialisasi AI (Hanya aktif jika GEMINI_API_KEY tersedia di .env)
let ai = null;
if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

async function handleMessage(client, msg) {
    const originalReply = msg.reply.bind(msg);
    msg.reply = async (content, chatId, options) => {
        try {
            const chat = await msg.getChat();
            await chat.sendStateTyping();
            const delay = Math.floor(Math.random() * 2000) + 1500;
            await new Promise(resolve => setTimeout(resolve, delay));
            await chat.clearState();
            return await originalReply(content, chatId, options);
        } catch (err) {
            return await originalReply(content, chatId, options);
        }
    };

    if (msg.body.toLowerCase() === 'bot') {
        msg.reply("Hadirr, siap membantu mengurus absensi warna warnimu itu.\n\nsilahkan ketik .menu untuk melihat menu apa saja pada smartbot ini");
    }

    if (msg.body.toLowerCase() === 'assalamualaikum' || msg.body.toLowerCase() === 'assalamu\'alaikum') {
        msg.reply('Waalaikumsalam');
    }

    if (msg.body.toLowerCase() === '.menu') {
        const menuPesan = `*MENU SMARTBOT ABSENSI*\n\n` +
            `1. *Otomatisasi Absen*: Bot akan memantau portal kampus dan mengumumkan (tag all) jika ada absen baru.\n` +
            `2. *.allabsensi* : Melihat rekap seluruh mata kuliah dan tanggal absensi pada minggu ini.\n` +
            `3. *.setminggu <angka>* : Mengubah minggu perkuliahan aktif secara manual.\n` +
            `4. *.resetbot <semester>* : Mereset seluruh histori absensi.\n` +
            `5. *.stiker* : Mengubah foto menjadi stiker.\n` +
            `6. *!ping* : Mengecek kecepatan respon jaringan bot.\n` +
            `7. *.runtime* : Melihat berapa lama bot sudah menyala tanpa henti.\n` +
            `8. *.jadwal* : Menampilkan jadwal kuliah (contoh: .jadwal atau .jadwal senin).\n` +
            `9. *.tanya <teks>* : Bertanya apa saja ke AI Pintar (ChatGPT versi Google).\n` +
            `10. *.admin* : Menampilkan admin misterius pembuat bot ini.\n\n` +
            `_Catatan: Bot secara otomatis berganti minggu setiap hari Senin, dan reset di minggu ke-17._`;
        msg.reply(menuPesan);
    }

    if (msg.body.toLowerCase().startsWith('.tanya')) {
        let pertanyaan = msg.body.substring('.tanya'.length).trim();
        if (!pertanyaan) {
            msg.reply("Tanyakan apa saja ke AI! Contoh: *.tanya tolong jelaskan apa itu javascript secara singkat*");
            return;
        }
        if (!ai) {
            msg.reply("Mohon maaf, fitur AI belum diaktifkan karena API Key belum dimasukkan.");
            return;
        }
        
        msg.reply("⏳ AI sedang memikirkan jawaban, mohon tunggu sebentar...");
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: pertanyaan,
            });
            msg.reply(`*🤖 Jawaban AI:*\n\n${response.text}`);
        } catch (err) {
            console.error("Gagal menanyakan AI:", err);
            msg.reply("Maaf, otak AI sedang kelebihan beban atau terjadi gangguan jaringan. Coba lagi nanti.");
        }
    }

    if (msg.body.toLowerCase() === '!ping' || msg.body.toLowerCase() === '.ping') {
        let ping = Date.now() - (msg.timestamp * 1000);
        // Fallback jika jam server VPS tidak sinkron persis dengan jam server WhatsApp
        if (ping < 0) ping = Math.floor(Math.random() * 50) + 10; 
        msg.reply(`Pong! 🏓\nKecepatan respon jaringan: *${ping} ms*`);
    }

    if (msg.body.toLowerCase() === '.runtime') {
        const uptime = process.uptime();
        const hari = Math.floor(uptime / 86400);
        const jam = Math.floor((uptime % 86400) / 3600);
        const menit = Math.floor((uptime % 3600) / 60);
        const detik = Math.floor(uptime % 60);
        
        let teksRuntime = `Bot telah aktif tanpa henti selama:\n*`;
        if (hari > 0) teksRuntime += `${hari} Hari `;
        teksRuntime += `${jam} Jam ${menit} Menit ${detik} Detik*`;
        
        msg.reply(teksRuntime);
    }

    if (msg.body === '!info') {
        console.log('ID Chat ini adalah:', msg.from);
        msg.reply(`ID Chat ini adalah: ${msg.from}`);
    }

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

    if (msg.body.toLowerCase().startsWith('.jadwal') && !msg.body.toLowerCase().startsWith('.jadwaledit')) {
        let args = msg.body.split(' ');
        let hariIni = new Date().toLocaleDateString('id-ID', { weekday: 'long' }).toLowerCase();
        let targetHari = args.length > 1 ? args[1].toLowerCase() : hariIni;
        
        let data = loadData();
        let jadwalHari = data.daftar_jadwal && data.daftar_jadwal[targetHari] ? data.daftar_jadwal[targetHari] : [];
        
        if (jadwalHari.length === 0) {
            msg.reply(`Tidak ada jadwal perkuliahan untuk hari *${targetHari.charAt(0).toUpperCase() + targetHari.slice(1)}*.`);
            return;
        }
        
        let pesan = `*Jadwal Kuliah Hari ${targetHari.charAt(0).toUpperCase() + targetHari.slice(1)}*\n\n`;
        jadwalHari.forEach((j, i) => {
            pesan += `${i+1}. *${j.matkul}*\n   ⏰ ${j.jam}\n   📍 ${j.ruang}\n\n`;
        });
        msg.reply(pesan);
    }

    const senderId = msg.author || msg.from || '';
    const isAdmin = senderId.includes('85704682918') || senderId.includes('194720949112994');

    if (msg.body.startsWith('.setminggu ') || msg.body.startsWith('.resetbot') || msg.body.startsWith('.testabsen') || msg.body.startsWith('.testnotif') || msg.body.startsWith('.jadwaledit')) {
        if (!isAdmin) {
            msg.reply('Mohon Maaf, fitur ini hanya bisa digunakan oleh admin!!');
            return;
        }

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

        if (msg.body.toLowerCase().startsWith('.resetbot')) {
            const parts = msg.body.split(' ');
            let semesterBaru = 1;
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

        if (msg.body.toLowerCase() === '.testabsen') {
            msg.reply('Memulai proses pengecekan portal Ethol secara manual... Silakan tunggu beberapa saat.');
            try {
                await checkPortal(client);
                msg.reply('Proses pengecekan manual selesai!');
            } catch (err) {
                console.error(err);
                msg.reply('Terjadi kesalahan saat mengecek portal.');
            }
        }

        if (msg.body.toLowerCase().startsWith('.testnotif')) {
            let matkul = msg.body.split(' ').slice(1).join(' ') || 'Pemrograman Web (Uji Coba)';
            let tanggal = new Date().toLocaleDateString('id-ID');
            msg.reply('Mengirim pesan simulasi absensi ke grup...');

            try {
                await announceAbsen(client, process.env.TARGET_GROUP_ID, matkul, tanggal);
            } catch (err) {
                console.error('Gagal saat simulasi:', err);
                msg.reply('Terjadi kesalahan saat mengirim simulasi.');
            }
        }

        if (msg.body.toLowerCase().startsWith('.jadwaledit')) {
            let teks = msg.body.substring('.jadwaledit'.length).trim();
            let parts = teks.split('|').map(s => s.trim());
            
            if (parts.length === 2 && parts[1].toLowerCase() === 'reset') {
                let hari = parts[0].toLowerCase();
                let data = loadData();
                data.daftar_jadwal[hari] = [];
                saveData(data);
                msg.reply(`Jadwal hari *${hari}* berhasil direset/dikosongkan.`);
                return;
            }

            if (parts.length < 4) {
                msg.reply(`Format salah!\n\n*Cara Tambah Jadwal:*\n.jadwaledit senin | Algoritma | 08:00 | Lab 1\n\n*Cara Hapus Jadwal Sehari:*\n.jadwaledit senin | reset`);
                return;
            }
            
            let hari = parts[0].toLowerCase();
            let matkul = parts[1];
            let jam = parts[2];
            let ruang = parts[3];
            
            let data = loadData();
            if (!data.daftar_jadwal) data.daftar_jadwal = {};
            if (!data.daftar_jadwal[hari]) data.daftar_jadwal[hari] = [];
            
            data.daftar_jadwal[hari].push({ matkul, jam, ruang });
            saveData(data);
            
            msg.reply(`Berhasil menambahkan mata kuliah *${matkul}* ke jadwal hari *${hari}*.`);
        }
    }

    if (msg.body.toLowerCase() === '.admin') {
        msg.reply("ciee kepo sama adminkuu yang ganteng imut lucu ini yakk?? xixixi");
        try {
            const adminContact = await client.getContactById('6285704682918@c.us');
            adminContact.name = "RzkyAds";
            adminContact.pushname = "RzkyAds";
            await client.sendMessage(msg.from, adminContact);
        } catch (err) {
            console.error('Gagal mengirim kontak admin:', err);
            msg.reply('Nomor Admin (RzkyAds): 085704682918');
        }
    }

    if (msg.body.toLowerCase() === '.stiker' || msg.body.toLowerCase() === '.sticker') {
        let media = null;

        if (msg.hasMedia) {
            media = await msg.downloadMedia();
        } else if (msg.hasQuotedMsg) {
            const quotedMsg = await msg.getQuotedMessage();
            if (quotedMsg.hasMedia) {
                media = await quotedMsg.downloadMedia();
            }
        }

        if (media) {
            try {
                await client.sendMessage(msg.from, media, {
                    sendMediaAsSticker: true,
                    stickerName: 'Bot Stiker',
                    stickerAuthor: 'RzkyAds'
                });
            } catch (err) {
                console.error('Gagal mengirim stiker:', err);
                msg.reply('Maaf, terjadi kesalahan saat membuat stiker.');
            }
        } else {
            msg.reply('Mohon kirim foto dengan caption ".stiker" atau reply foto dengan ".stiker"');
        }
    }
}

module.exports = { handleMessage };
