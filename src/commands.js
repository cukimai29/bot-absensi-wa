const { loadData, saveData } = require('./database');
const { checkPortal, announceAbsen } = require('./ethol-scraper');
const { GoogleGenAI } = require('@google/genai');
const googleTTS = require('google-tts-api');
const { MessageMedia } = require('whatsapp-web.js');

// Inisialisasi AI (Hanya aktif jika GEMINI_API_KEY tersedia di .env)
let ai = null;
if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

// State untuk menyimpan sesi game grup
const activeGames = {};

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

    const chatId = msg.from;

    if (activeGames[chatId]) {
        let game = activeGames[chatId];
        if (msg.body.toLowerCase() === game.jawaban) {
            msg.reply(`🎉 BENAR SEKALI!\n\nSelamat, tebakan kata *${game.jawaban.toUpperCase()}* sangat tepat!\n(Game Selesai)`);
            delete activeGames[chatId];
        }
    }

    if (msg.body.toLowerCase() === 'bot') {
        msg.reply("Hadirr, siap membantu mengurus absensi warna warnimu itu.\n\n👇 *SILAKAN KETIK TEKS DI BAWAH INI* 👇\n\n👉 *.menu* 👈\n\n_(Catatan: Fitur tombol interaktif resmi diblokir oleh pihak WhatsApp/Meta untuk keamanan, jadi harus diketik manual ya!)_");
    }

    if (msg.body.toLowerCase() === 'assalamualaikum' || msg.body.toLowerCase() === 'assalamu\'alaikum') {
        msg.reply('Waalaikumsalam');
    }

    if (msg.body.toLowerCase() === '.menu') {
        const menuPesan = `*MENU SMARTBOT ABSENSI*\n\n` +
            `*📚 PRODUKTIVITAS & HIBURAN*\n` +
            `1. *.jadwal* : Menampilkan jadwal kuliah.\n` +
            `2. *.tugas* : Menampilkan daftar tugas.\n` +
            `3. *.tanya <teks>* : Bertanya ke AI Pintar.\n` +
            `4. *.cuaca <kota>* : Mengecek kondisi cuaca.\n` +
            `5. *.suara <teks>* : Teks jadi Voice Note.\n` +
            `6. *.ringkas* : (Reply pesan) Ringkas teks panjang.\n` +
            `7. *.tl <id/en>* : (Reply pesan) Translate teks.\n` +
            `8. *.susunkata* : Main tebak kata acak di grup.\n` +
            `9. *.khodam <nama>* : Cek khodam pendamping.\n` +
            `10. *.truth* / *.dare* : Main Truth or Dare.\n` +
            `11. *.jodoh @tag1 @tag2* : Ramal kecocokan jodoh.\n\n` +
            `*🔧 FITUR UTAMA*\n` +
            `12. *Otomatisasi Absen*: Bot otomatis tag all jika ada absen.\n` +
            `13. *.allabsensi* : Rekap absen minggu ini.\n` +
            `14. *.stiker* : Mengubah foto menjadi stiker.\n` +
            `15. *!ping* : Mengecek kecepatan respon bot.\n` +
            `16. *.runtime* : Melihat uptime bot.\n` +
            `17. *.owner* : Menampilkan info owner bot.\n\n` +
            `*👑 KHUSUS ADMIN GRUP*\n` +
            `18. *.tambah_tugas <Matkul> | <Deskripsi> | <YYYY-MM-DD>*\n` +
            `19. *.hapus_tugas <Nomor>*\n` +
            `20. *.jadwaledit <Hari> | <Matkul> | <Jam> | <Ruang>*\n` +
            `21. *.hidetag <Pesan>*\n` +
            `22. *.setminggu <Angka>*\n\n` +
            `*👑 KHUSUS OWNER*\n` +
            `23. *.resetbot <Semester>*\n\n` +
            `_Catatan: Bot otomatis ganti minggu setiap Senin, dan punya sistem auto-reminder tugas setiap sore!_`;
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
            pesan += `${i + 1}. *${j.matkul}*\n   ⏰ ${j.jam}\n   📍 ${j.ruang}\n\n`;
        });
        msg.reply(pesan);
    }

    if (msg.body.toLowerCase().startsWith('.cuaca')) {
        let kota = msg.body.substring('.cuaca'.length).trim() || 'Surabaya';
        msg.reply(`☁️ Mengecek cuaca untuk *${kota}*...`);
        try {
            // Menggunakan API wttr.in gratis tanpa key
            const fetch = require('node-fetch');
            const response = await fetch(`https://wttr.in/${encodeURIComponent(kota)}?format=%l:+%c+%C,+Suhu:+%t,+Angin:+%w`);
            const data = await response.text();
            if (data.includes('Unknown location')) {
                msg.reply(`Maaf, kota *${kota}* tidak ditemukan.`);
            } else {
                msg.reply(`*Info Cuaca:*\n${data}`);
            }
        } catch (err) {
            msg.reply('Terjadi kesalahan saat mengambil data cuaca.');
        }
    }

    if (msg.body.toLowerCase() === '.tugas') {
        let data = loadData();
        let tugas = data.daftar_tugas || [];
        
        if (tugas.length === 0) {
            msg.reply("🎉 Yeay! Tidak ada tugas kelas yang perlu dikerjakan saat ini.");
            return;
        }

        let pesan = `*📚 DAFTAR TUGAS KELAS*\n\n`;
        // Urutkan berdasarkan deadline terdekat
        tugas.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
        
        let nowWIB = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
        nowWIB.setHours(0,0,0,0);
        
        tugas.forEach((t, i) => {
            // Hitung sisa hari dengan timezone yang benar
            let targetDate = new Date(t.deadline);
            targetDate.setHours(0,0,0,0);
            let sisaHari = Math.round((targetDate - nowWIB) / (1000 * 60 * 60 * 24));
            let sisaTeks = sisaHari < 0 ? "*(TERLEWAT)*" : sisaHari === 0 ? "*(HARI INI)*" : sisaHari === 1 ? "*(H-1/BESOK)*" : sisaHari === 2 ? "*(H-2)*" : `(${sisaHari} hari lagi)`;
            pesan += `${i+1}. *${t.matkul}*\n   📝 ${t.deskripsi}\n   📅 Deadline: ${t.deadline} ${sisaTeks}\n\n`;
        });
        msg.reply(pesan);
    }

    const senderId = msg.author || msg.from || '';
    const isOwner = senderId.includes('85704682918') || senderId.includes('194720949112994') || senderId.includes('85233724944');

    const adminCommands = ['.setminggu', '.testabsen', '.testnotif', '.jadwaledit', '.tambah_tugas', '.hapus_tugas', '.hidetag'];
    const isCmdAdmin = adminCommands.some(cmd => msg.body.toLowerCase().startsWith(cmd));
    const isCmdOwner = msg.body.toLowerCase().startsWith('.resetbot');

    if (isCmdAdmin || isCmdOwner) {
        let isGroupAdmin = false;
        try {
            const chat = await msg.getChat();
            if (chat.isGroup) {
                const participant = chat.participants.find(p => p.id._serialized === senderId);
                if (participant && (participant.isAdmin || participant.isSuperAdmin)) {
                    isGroupAdmin = true;
                }
            }
        } catch (e) {}

        const hasAdminAccess = isOwner || isGroupAdmin;

        if (isCmdOwner && !isOwner) {
            msg.reply('Mohon Maaf, fitur ini khusus untuk *Owner* bot!');
            return;
        }

        if (isCmdAdmin && !hasAdminAccess) {
            msg.reply('Mohon Maaf, fitur ini khusus untuk *Admin Grup* atau *Owner* bot!');
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

        if (msg.body.toLowerCase().startsWith('.tambah_tugas')) {
            let teks = msg.body.substring('.tambah_tugas'.length).trim();
            let parts = teks.split('|').map(s => s.trim());
            
            if (parts.length < 3) {
                msg.reply(`Format salah!\nCara penggunaan:\n.tambah_tugas <Matkul> | <Deskripsi> | <YYYY-MM-DD>\n\nContoh:\n.tambah_tugas PWEB | Membuat makalah bab 1 | 2026-06-25`);
                return;
            }
            
            let data = loadData();
            if (!data.daftar_tugas) data.daftar_tugas = [];
            
            data.daftar_tugas.push({ matkul: parts[0], deskripsi: parts[1], deadline: parts[2] });
            saveData(data);
            
            msg.reply(`✅ Tugas *${parts[0]}* berhasil dicatat dengan deadline ${parts[2]}.`);
        }

        if (msg.body.toLowerCase().startsWith('.hapus_tugas')) {
            let nomor = parseInt(msg.body.split(' ')[1]);
            let data = loadData();
            if (!data.daftar_tugas || data.daftar_tugas.length === 0) {
                msg.reply("Daftar tugas sedang kosong.");
                return;
            }
            if (isNaN(nomor) || nomor < 1 || nomor > data.daftar_tugas.length) {
                msg.reply(`Format salah atau nomor tugas tidak ditemukan. Gunakan: .hapus_tugas <nomor>`);
                return;
            }
            
            // Hapus tugas berdasarkan urutan deadline
            data.daftar_tugas.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
            let tugasDihapus = data.daftar_tugas.splice(nomor - 1, 1)[0];
            saveData(data);
            
            msg.reply(`✅ Tugas *${tugasDihapus.matkul}* telah berhasil dihapus dari daftar.`);
        }

        if (msg.body.toLowerCase().startsWith('.hidetag')) {
            let pesanTeks = msg.body.substring('.hidetag'.length).trim();
            if (!pesanTeks) pesanTeks = "Perhatian seluruh anggota grup!";
            
            const chat = await msg.getChat();
            if (!chat.isGroup) {
                msg.reply("Perintah ini hanya bisa digunakan di dalam grup!");
                return;
            }
            
            let participants = chat.participants.map(p => p.id._serialized);
            await chat.sendMessage(`🔊 *PENGUMUMAN*\n\n${pesanTeks}`, { mentions: participants });
        }
    }

    if (msg.body.toLowerCase().startsWith('.suara')) {
        let teks = msg.body.substring('.suara'.length).trim();
        let lang = 'id';
        if (teks.startsWith('id ') || teks.startsWith('en ') || teks.startsWith('ja ') || teks.startsWith('ko ')) {
            lang = teks.substring(0, 2);
            teks = teks.substring(3).trim();
        }
        if (!teks) {
            msg.reply('Kirim perintah dengan format *.suara <teks>* atau *.suara en <teks>*');
            return;
        }
        if (teks.length > 200) {
            msg.reply('Teks terlalu panjang! Maksimal 200 karakter.');
            return;
        }
        try {
            const url = googleTTS.getAudioUrl(teks, { lang: lang, slow: false, host: 'https://translate.google.com' });
            const media = await MessageMedia.fromUrl(url, { unsafeMime: true });
            await client.sendMessage(msg.from, media, { sendAudioAsVoice: true });
        } catch (err) {
            console.error(err);
            msg.reply('Terjadi kesalahan saat membuat voice note.');
        }
    }

    if (msg.body.toLowerCase() === '.ringkas' && msg.hasQuotedMsg) {
        if (!ai) {
            msg.reply('Fitur AI belum aktif.');
            return;
        }
        const quotedMsg = await msg.getQuotedMessage();
        msg.reply('⏳ AI sedang meringkas pesan ini, mohon tunggu...');
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `Buatkan ringkasan singkat dalam bentuk poin-poin dari teks ini:\n\n${quotedMsg.body}`,
            });
            msg.reply(`*🤖 Ringkasan AI:*\n\n${response.text}`);
        } catch (err) {
            msg.reply('Maaf, AI gagal meringkas teks tersebut.');
        }
    }

    if (msg.body.toLowerCase().startsWith('.tl ') && msg.hasQuotedMsg) {
        if (!ai) {
            msg.reply('Fitur AI belum aktif.');
            return;
        }
        let lang = msg.body.substring('.tl '.length).trim() || 'indonesia';
        const quotedMsg = await msg.getQuotedMessage();
        msg.reply(`⏳ AI sedang menerjemahkan pesan ini ke bahasa *${lang}*...`);
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `Terjemahkan teks berikut secara natural ke bahasa ${lang}:\n\n${quotedMsg.body}`,
            });
            msg.reply(`*🤖 Terjemahan AI:*\n\n${response.text}`);
        } catch (err) {
            msg.reply('Maaf, AI gagal menerjemahkan teks tersebut.');
        }
    }

    if (msg.body.toLowerCase() === '.susunkata') {
        const chatId = msg.from;
        if (activeGames[chatId]) {
            msg.reply('Masih ada permainan yang belum diselesaikan di obrolan ini!\nSusun huruf ini: *' + activeGames[chatId].acak + '*');
            return;
        }
        const words = ['javascript', 'database', 'pemrograman', 'komputer', 'internet', 'algoritma', 'jaringan', 'server', 'aplikasi', 'framework', 'skripsi', 'mahasiswa', 'dosen', 'kampus'];
        let word = words[Math.floor(Math.random() * words.length)];
        let acak = word.split('').sort(() => 0.5 - Math.random()).join(' ').toUpperCase();
        
        activeGames[chatId] = { jawaban: word, acak: acak };
        msg.reply(`🎮 *MINI GAME SUSUN KATA* 🎮\n\nSusunlah huruf-huruf acak berikut menjadi sebuah kata terkait dunia kampus/IT:\n\n👉 *${acak}* 👈\n\nSiapa cepat dia dapat! Silakan langsung ketik jawabannya di sini.`);
    }

    if (msg.body.toLowerCase().startsWith('.khodam')) {
        let nama = msg.body.substring('.khodam'.length).trim();
        if (!nama) {
            msg.reply('Ketik namanya! Contoh: *.khodam Budi*');
            return;
        }
        const khodamList = ['Kipas Angin Cosmos', 'Naga Sakti', 'Tutup Termos', 'Maung Bandung', 'Kucing Oren', 'Seblak Ceker', 'Sapu Lidi', 'Ksatria Bergitar', 'Panci Gosong', 'Biawak Sungai', 'Knalpot Racing', 'Nyamuk Kebon', 'Jin Penglaris', 'Sendok Nasi', 'Cacing Tanah'];
        let khodam = khodamList[Math.floor(Math.random() * khodamList.length)];
        msg.reply(`🔮 Setelah diterawang oleh bot...\n\nKhodam pendamping *${nama}* adalah: **${khodam}**`);
    }

    if (msg.body.toLowerCase() === '.truth') {
        const truthList = ['Sebutkan inisial orang yang pernah kamu stalking minggu ini!', 'Apa kebohongan terbesar yang pernah kamu buat ke dosen?', 'Siapa orang di kelas ini yang menurutmu paling menarik?', 'Apa rahasia memalukanmu waktu ospek?', 'Pernah naksir pacar teman gak?'];
        let truth = truthList[Math.floor(Math.random() * truthList.length)];
        msg.reply(`🤫 *TRUTH*\n\n${truth}\n\n(Ayo jawab jujur di grup ini!)`);
    }

    if (msg.body.toLowerCase() === '.dare') {
        const dareList = ['Kirim VN nyanyi lagu Balonku Ada Lima ke grup ini sekarang!', 'Ganti foto profil WA pakai foto aib teman sebelahmu selama 1 jam.', 'Chat kating random bilang "Halo kak, boleh kenalan?" lalu screenshot ke sini.', 'Ketik "Aku sayang kalian semua" di grup keluarga lalu screenshot.', 'Kirim selfie paling jelek kamu ke grup ini!'];
        let dare = dareList[Math.floor(Math.random() * dareList.length)];
        msg.reply(`🔥 *DARE*\n\n${dare}\n\n(Lakukan sekarang atau traktir es teh satu kelas!)`);
    }

    if (msg.body.toLowerCase().startsWith('.jodoh')) {
        if (!ai) {
            msg.reply('Fitur AI belum aktif.');
            return;
        }
        let target = msg.body.substring('.jodoh'.length).trim();
        if (!target) {
            msg.reply('Sebutkan dua nama yang mau diramal! Contoh: *.jodoh @udin dan @siti*');
            return;
        }
        msg.reply('🔮 AI sedang menghitung kecocokan jodoh mereka...');
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `Buatkan ramalan lucu dan absurd ala anak kuliahan tentang kecocokan jodoh untuk dua orang ini: ${target}. Maksimal 3 kalimat pendek yang bikin ngakak.`,
            });
            msg.reply(`*💘 RAMALAN JODOH AI 💘*\n\n${response.text}`);
        } catch (err) {
            msg.reply('Maaf, dukun AI sedang kehabisan menyan.');
        }
    }

    if (msg.body.toLowerCase() === '.owner') {
        msg.reply("ciee kepo sama ownerkuu yang ganteng imut lucu ini yakk?? xixixi");
        try {
            const ownerContact = await client.getContactById('6285704682918@c.us');
            ownerContact.name = "RzkyAds";
            ownerContact.pushname = "RzkyAds";
            await client.sendMessage(msg.from, ownerContact);
        } catch (err) {
            console.error('Gagal mengirim kontak owner:', err);
            msg.reply('Nomor Owner (RzkyAds): 085704682918');
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
