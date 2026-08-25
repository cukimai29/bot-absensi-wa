const { loadData, saveData } = require("./database");
const {
  checkPortal,
  announceAbsen,
  getLastUsedAccount,
} = require("./ethol-scraper");
const { GoogleGenAI } = require("@google/genai");
const googleTTS = require("google-tts-api");
const { downloadMediaMessage, generateWAMessageFromContent } = require("@whiskeysockets/baileys");
const { checkKasAndSend } = require("./kas-tricendes/kas-checker");

async function createMeme(base64Image, mimetype, topText, bottomText) {
  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@700&display=swap');
            body { margin: 0; display: inline-block; background: transparent; }
            .container { position: relative; display: inline-block; }
            img { max-width: 800px; display: block; }
            .text {
                position: absolute;
                left: 50%;
                transform: translateX(-50%);
                font-family: 'Impact', 'Oswald', sans-serif;
                font-size: 40px;
                font-weight: bold;
                color: white;
                text-align: center;
                text-transform: uppercase;
                text-shadow: 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 2px 0 #000, 2px 0 0 #000, 0 -2px 0 #000, -2px 0 0 #000;
                width: 90%;
                word-wrap: break-word;
            }
            .top { top: 10px; }
            .bottom { bottom: 10px; }
        </style>
    </head>
    <body>
        <div class="container" id="capture">
            <img src="data:${mimetype};base64,${base64Image}">
            <div class="text top">${topText}</div>
            <div class="text bottom">${bottomText}</div>
        </div>
    </body>
    </html>
    `;
  await page.setContent(html, { waitUntil: "networkidle0" });
  const element = await page.$("#capture");
  const screenshot = await element.screenshot({ encoding: "base64" });
  await browser.close();
  return screenshot;
}

async function createNulis(teks) {
  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@600&display=swap');
            body {
                margin: 0;
                padding: 0;
                background-color: #fdfdfd;
                width: 600px;
                height: 800px;
                position: relative;
            }
            .paper {
                width: 100%;
                height: 100%;
                background-image: linear-gradient(#999 1px, transparent 1px);
                background-size: 100% 30px;
                background-position: 0 40px;
            }
            .margin-line {
                position: absolute;
                top: 0;
                bottom: 0;
                left: 60px;
                width: 2px;
                background-color: #ffaaaa;
            }
            .content {
                position: absolute;
                top: 40px;
                left: 75px;
                right: 20px;
                font-family: 'Caveat', cursive;
                font-size: 26px;
                line-height: 30px;
                color: #1a237e; /* Ink blue */
                white-space: pre-wrap;
                word-wrap: break-word;
                letter-spacing: 1px;
            }
        </style>
    </head>
    <body>
        <div class="paper" id="capture">
            <div class="margin-line"></div>
            <div class="content">${teks.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
        </div>
    </body>
    </html>
    `;
  await page.setContent(html, { waitUntil: "networkidle0" });
  const element = await page.$("body");
  const screenshot = await element.screenshot({ encoding: "base64" });
  await browser.close();
  return screenshot;
}

// Inisialisasi AI (Hanya aktif jika GEMINI_API_KEY tersedia di .env)
let ai = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

// State untuk menyimpan sesi game grup
const activeGames = {};

// State untuk anti-spam
const userCooldowns = new Map();
const COOLDOWN_MS = 3000; // 3 detik

async function handleMessage(client, rawMsg) {
  if (!rawMsg.message) return;
  const _chatId = rawMsg.key.remoteJid;
  const _senderId = rawMsg.key.participant || rawMsg.key.remoteJid;
  const _isGroup = _chatId.endsWith('@g.us');

  let bodyText = '';
  if (rawMsg.message) {
    if (rawMsg.message.conversation) bodyText = rawMsg.message.conversation;
    else if (rawMsg.message.extendedTextMessage) bodyText = rawMsg.message.extendedTextMessage.text;
    else if (rawMsg.message.imageMessage) bodyText = rawMsg.message.imageMessage.caption || '';
    else if (rawMsg.message.videoMessage) bodyText = rawMsg.message.videoMessage.caption || '';
    else if (rawMsg.message.buttonsResponseMessage) bodyText = rawMsg.message.buttonsResponseMessage.selectedButtonId;
    else if (rawMsg.message.listResponseMessage) bodyText = rawMsg.message.listResponseMessage.singleSelectReply.selectedRowId;
    else if (rawMsg.message.templateButtonReplyMessage) bodyText = rawMsg.message.templateButtonReplyMessage.selectedId;
    else if (rawMsg.message.interactiveResponseMessage) {
      const paramsJson = rawMsg.message.interactiveResponseMessage.nativeFlowResponseMessage?.paramsJson;
      if (paramsJson) {
        try { bodyText = JSON.parse(paramsJson).id; } catch (e) { }
      }
    }
  }

  // Cek apakah ini sebuah perintah (dimulai dengan . atau kata kunci khusus)
  const isCommand = bodyText.startsWith('.') || bodyText.toLowerCase() === 'bot' || bodyText.toLowerCase().includes("assalamu");
  
  // Anti-Spam Check
  if (isCommand) {
    const now = Date.now();
    const lastTime = userCooldowns.get(_senderId) || 0;
    
    if (now - lastTime < COOLDOWN_MS) {
      // Jika jarak spam lebih dari 500ms (untuk menghindari loop peringatan berkali-kali)
      if (now - lastTime > 500) {
        await client.sendMessage(_chatId, { text: "⏳ *Woah, pelan-pelan!* Sistem mendeteksi Spam. Silakan tunggu 3 detik sebelum menggunakan perintah bot lagi." }, { quoted: rawMsg });
        // Reset waktu agar hukuman bertambah jika dia nge-spam lagi
        userCooldowns.set(_senderId, now); 
      }
      return; // Abaikan pesannya
    }
    userCooldowns.set(_senderId, now);
    
    // Smart React: Tanda Sedang Diproses (Hanya di Grup untuk menghindari error E2E)
    if (_isGroup) {
      await client.sendMessage(_chatId, { react: { text: "⏳", key: rawMsg.key } }).catch(()=>{});
    }
  }

  const fakeVerif = {
    key: {
      id: '12345678901234567890123456789012',
      fromMe: false,
      participant: '0@s.whatsapp.net',
      ...(rawMsg.key.remoteJid ? { remoteJid: rawMsg.key.remoteJid } : {})
    },
    message: {
      conversation: "SMARTBOT by RzkyAds"
    }
  };

  const msg = {
    from: _chatId,
    author: _senderId,
    body: bodyText,
    timestamp: rawMsg.messageTimestamp,
    hasMedia: !!(rawMsg.message && (rawMsg.message.imageMessage || rawMsg.message.videoMessage || rawMsg.message.documentMessage)),
    hasQuotedMsg: !!(rawMsg.message?.extendedTextMessage?.contextInfo?.quotedMessage),

    reply: async (content) => {
      const options = _isGroup ? { quoted: fakeVerif } : {};
      if (typeof content === 'string') {
        return await client.sendMessage(_chatId, { text: content }, options);
      } else {
        return await client.sendMessage(_chatId, content, options);
      }
    },

    react: async (emoji) => {
      return await client.sendMessage(_chatId, { react: { text: emoji, key: rawMsg.key } });
    },

    getChat: async () => {
      return {
        isGroup: _isGroup,
        sendStateTyping: async () => {
          await client.sendPresenceUpdate('available', _chatId).catch(()=>{});
          await client.sendPresenceUpdate('composing', _chatId).catch(()=>{});
        },
        sendStateRecording: async () => {
          await client.sendPresenceUpdate('available', _chatId).catch(()=>{});
          await client.sendPresenceUpdate('recording', _chatId).catch(()=>{});
        },
        clearState: async () => await client.sendPresenceUpdate('paused', _chatId).catch(()=>{}),
        participants: _isGroup ? (await client.groupMetadata(_chatId)).participants : []
      };
    },

    downloadMedia: async () => {
      const buffer = await downloadMediaMessage(rawMsg, 'buffer', {}, { logger: require('pino')({ level: 'silent' }) });
      let mimetype = rawMsg.message?.imageMessage?.mimetype || rawMsg.message?.videoMessage?.mimetype || rawMsg.message?.documentMessage?.mimetype;
      return { data: buffer.toString('base64'), mimetype: mimetype };
    },

    getQuotedMessage: async () => {
      if (!msg.hasQuotedMsg) return null;
      const quoted = rawMsg.message.extendedTextMessage.contextInfo.quotedMessage;
      return {
        body: quoted.conversation || quoted.extendedTextMessage?.text || quoted.imageMessage?.caption || '',
        hasMedia: !!(quoted.imageMessage || quoted.videoMessage || quoted.documentMessage),
        downloadMedia: async () => {
          const fakeMsg = { message: quoted };
          const buffer = await downloadMediaMessage(fakeMsg, 'buffer', {}, { logger: require('pino')({ level: 'silent' }) });
          let mimetype = quoted.imageMessage?.mimetype || quoted.videoMessage?.mimetype || quoted.documentMessage?.mimetype;
          return { data: buffer.toString('base64'), mimetype: mimetype };
        }
      };
    }
  };

  const originalReply = msg.reply.bind(msg);
  msg.reply = async (content, chatId, options) => {
    try {
      const chat = await msg.getChat();
      await chat.sendStateTyping();
      const delay = Math.floor(Math.random() * 2000) + 1500;
      await new Promise((resolve) => setTimeout(resolve, delay));
      await chat.clearState();
      if (_isGroup) await msg.react('✅').catch(()=>{});
      return await originalReply(content, chatId, options);
    } catch (err) {
      if (_isGroup) await msg.react('❌').catch(()=>{});
      return await originalReply(content, chatId, options);
    }
  };

  const chatId = msg.from;

  if (activeGames[chatId]) {
    let game = activeGames[chatId];
    let pJawaban = msg.body.toLowerCase().trim();

    if (pJawaban === "nyerah") {
      if (game.type === "caklontong") {
        msg.reply(
          `Wooo dasar lemah!\n\nJawaban: *${game.jawaban.toUpperCase()}*\nAlasan: ${game.alasan}`,
        );
        delete activeGames[chatId];
        return;
      } else if (game.type === "tebaklagu") {
        msg.reply(
          `Wooo nyerah!\n\nJudul lagunya adalah: *${game.jawaban.toUpperCase()}*`,
        );
        delete activeGames[chatId];
        return;
      }
    }

    if (pJawaban === game.jawaban) {
      if (game.type === "caklontong") {
        msg.reply(
          `🎉 BENAR SEKALI!\n\nJawaban: *${game.jawaban.toUpperCase()}*\nAlasan: ${game.alasan}`,
        );
      } else if (game.type === "tebaklagu") {
        msg.reply(
          `🎵 YUHUUU BENAR SEKALI!\n\nJudul lagunya adalah: *${game.jawaban.toUpperCase()}* 🎤`,
        );
      } else {
        msg.reply(
          `🎉 BENAR SEKALI!\n\nSelamat, tebakan kata *${game.jawaban.toUpperCase()}* sangat tepat!\n(Game Selesai)`,
        );
      }
      delete activeGames[chatId];
      return;
    }
  }

  if (msg.body.toLowerCase() === "bot") {
    const menuPesan = `🤖 *SMARTBOT HADIR* 🤖

    Silahkan ketik .menu untuk menampilkan fitur bot!!`;
    await msg.reply(menuPesan);
  }
  if (msg.body.toLowerCase() === ".testkas") {
    msg.reply(
      "⏳ Memulai pengecekan data kas dari Google Sheets... Silakan tunggu.",
    );
    try {
      const result = await checkKasAndSend(
        client,
        process.env.TARGET_GROUP_ID,
        true,
      );
      if (result) {
        msg.reply(result);
      }
    } catch (err) {
      console.error(err);
      msg.reply(`❌ Gagal memproses kas: ${err.message}`);
    }
  }

  if (
    msg.body.toLowerCase() === "assalamualaikum" ||
    msg.body.toLowerCase() === "assalamu'alaikum"
  ) {
    msg.reply("Waalaikumsalam");
  }

  if (msg.body.toLowerCase() === ".menu" || msg.body.toLowerCase() === ".help") {
    const menuPesan = `🤖 *MENU SMARTBOT ABSENSI* 🤖

*📚 PRODUKTIVITAS & HIBURAN*
1. *.jadwal* : Menampilkan jadwal kuliah.
2. *.tugas* : Menampilkan daftar tugas.
3. *.tanya <teks>* : Bertanya ke AI Pintar / AI Vision.
4. *.cuaca <kota>* : Mengecek kondisi cuaca.
5. *.suara <teks>* : Teks jadi Voice Note.
6. *.ringkas* : (Reply pesan) Ringkas teks panjang.
7. *.tl <id/en>* : (Reply pesan) Translate teks.
8. *.susunkata* : Main tebak kata acak di grup.
9. *.khodam <nama>* : Cek khodam pendamping.
10. *.truth* / *.dare* : Main Truth or Dare.
11. *.jodoh @tag1 @tag2* : Ramal kecocokan jodoh.
12. *.roasting @tag* : Roasting temanmu.
13. *.gombal @tag* : Kirim gombalan maut.
14. *.caklontong* : Tebak-tebakan logika ala WIB.
15. *.cekhoki* : Cek persentase hoki harian.
16. *.meme <atas>|<bawah>* : Bikin meme dari gambar.
17. *.nulis <teks>* : Nulis otomatis di buku.
18. *.tebaklagu* : Main tebak judul lagu.

*🔧 FITUR UTAMA*
19. *Otomatisasi Absen*: Bot otomatis tag all jika ada absen.
20. *.allabsensi* : Rekap absen minggu ini.
21. *.cekjadwal* : Cek jadwal aktif hari ini.
22. *.stiker* : Mengubah foto menjadi stiker.
23. *!ping* : Mengecek kecepatan respon bot.
24. *.runtime* : Melihat uptime bot.
25. *.owner* : Menampilkan info owner bot.

*👑 KHUSUS ADMIN GRUP*
26. *.tambah_tugas <Matkul> | <Deskripsi> | <YYYY-MM-DD>*
27. *.hapus_tugas <Nomor>*
28. *.jadwaledit <Hari> | <Matkul> | <Jam> | <Ruang>*
29. *.hapusjadwal <Hari> | <Matkul>*
30. *.hidetag <Pesan>*
31. *.setminggu <Angka>*
32. *.hapusrekap <Tanggal>*

*👑 KHUSUS OWNER*
33. *.resetbot <Semester>*

_Catatan: Bot otomatis ganti minggu setiap Senin, dan punya sistem auto-reminder tugas setiap sore!_`;
    await msg.reply(menuPesan);
  }

  if (msg.body.toLowerCase().startsWith(".tanya")) {
    let pertanyaan = msg.body.substring(".tanya".length).trim();
    if (!pertanyaan && !msg.hasMedia && !msg.hasQuotedMsg) {
      msg.reply(
        "Tanyakan apa saja ke AI! Contoh: *.tanya tolong jelaskan apa itu javascript secara singkat*\nAtau kirim/reply gambar dengan caption *.tanya <pertanyaan>*.",
      );
      return;
    }
    if (!ai) {
      msg.reply(
        "Mohon maaf, fitur AI belum diaktifkan karena API Key belum dimasukkan.",
      );
      return;
    }

    let media = null;
    try {
      if (msg.hasMedia) {
        media = await msg.downloadMedia();
      } else if (msg.hasQuotedMsg) {
        const quotedMsg = await msg.getQuotedMessage();
        if (quotedMsg && quotedMsg.hasMedia) {
          media = await quotedMsg.downloadMedia();
        }
      }
    } catch (err) {
      console.error("Gagal mengambil media/quote:", err);
      msg.reply(
        "Maaf, terjadi kesalahan sistem pada WhatsApp saat mengambil gambar. Sistem WhatsApp versi terbaru membatasi fitur ini.",
      );
      return;
    }

    msg.reply("⏳ AI sedang memikirkan jawaban, mohon tunggu sebentar...");
    try {
      let contents = [];
      if (pertanyaan) contents.push(pertanyaan);
      else if (media)
        contents.push(
          "Tolong jelaskan apa yang ada di gambar ini secara singkat.",
        );

      if (media && media.mimetype.includes("image")) {
        contents.push({
          inlineData: {
            data: media.data,
            mimeType: media.mimetype,
          },
        });
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: contents,
      });
      msg.reply(`*🤖 Jawaban AI:*\n\n${response.text}`);
    } catch (err) {
      console.error("Gagal menanyakan AI:", err);
      msg.reply(
        "Maaf, otak AI sedang kelebihan beban atau terjadi gangguan jaringan. Coba lagi nanti.",
      );
    }
  }

  if (
    msg.body.toLowerCase() === "!ping" ||
    msg.body.toLowerCase() === ".ping"
  ) {
    let ping = Date.now() - msg.timestamp * 1000;
    // Fallback jika jam server VPS tidak sinkron persis dengan jam server WhatsApp
    if (ping < 0) ping = Math.floor(Math.random() * 50) + 10;
    msg.reply(`Pong! 🏓\nKecepatan respon jaringan: *${ping} ms*`);
  }

  if (msg.body.toLowerCase() === ".runtime") {
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

  if (msg.body === "!info") {
    console.log("ID Chat ini adalah:", msg.from);
    msg.reply(`ID Chat ini adalah: ${msg.from}`);
  }

  if (msg.body === ".allabsensi") {
    let data = loadData();
    let mingguIni = `minggu_${data.minggu_ke}`;
    let jadwalMingguIni = data.jadwal[mingguIni] || [];

    if (jadwalMingguIni.length === 0) {
      msg.reply(`Belum ada data absensi untuk Minggu ke-${data.minggu_ke}.`);
      return;
    }

    let pesan = `REKAP ABSENSI MINGGU KE-${data.minggu_ke}\n\n`;
    jadwalMingguIni.forEach((item, index) => {
      pesan += `${index + 1}. Matkul: ${item.matkul}\n   Tanggal: ${item.tanggal}\n\n`;
    });

    const fs = require("fs");
    const path = require("path");
    const fileName = `Rekap_Absensi_Minggu_${data.minggu_ke}.txt`;
    const filePath = path.join(__dirname, "..", fileName);

    fs.writeFileSync(filePath, pesan);

    try {
      const media = { 
        document: require("fs").readFileSync(filePath), 
        mimetype: "text/plain", 
        fileName: fileName,
        caption: `📄 Berikut adalah file rekap absensi untuk *Minggu ke-${data.minggu_ke}*.`
      };
      const options = _isGroup ? { quoted: fakeVerif } : {};
      await client.sendMessage(msg.from, media, options);
    } catch (err) {
      console.error("Gagal mengirim file:", err);
      msg.reply("Maaf, terjadi kesalahan saat mengirim file rekap absensi.");
    } finally {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }

  if (
    msg.body.toLowerCase().startsWith(".jadwal") &&
    !msg.body.toLowerCase().startsWith(".jadwaledit")
  ) {
    let args = msg.body.split(" ");
    let hariIni = new Date()
      .toLocaleDateString("id-ID", { weekday: "long" })
      .toLowerCase();
    let targetHari = args.length > 1 ? args[1].toLowerCase() : hariIni;

    let data = loadData();
    let jadwalHari =
      data.daftar_jadwal && data.daftar_jadwal[targetHari]
        ? data.daftar_jadwal[targetHari]
        : [];

    if (jadwalHari.length === 0) {
      msg.reply(
        `Tidak ada jadwal perkuliahan untuk hari *${targetHari.charAt(0).toUpperCase() + targetHari.slice(1)}*.`,
      );
      return;
    }

    let pesan = `*Jadwal Kuliah Hari ${targetHari.charAt(0).toUpperCase() + targetHari.slice(1)}*\n\n`;
    jadwalHari.forEach((j, i) => {
      pesan += `${i + 1}. *${j.matkul}*\n   ⏰ ${j.jam}\n   📍 ${j.ruang}\n\n`;
    });
    msg.reply(pesan);
  }

  if (msg.body.toLowerCase() === ".cekjadwal") {
    const namaHari = [
      "minggu",
      "senin",
      "selasa",
      "rabu",
      "kamis",
      "jumat",
      "sabtu",
    ];
    let todayStr = new Date().toLocaleString("en-US", {
      timeZone: "Asia/Jakarta",
    });
    let todayName = namaHari[new Date(todayStr).getDay()];

    let data = loadData();
    let jadwalHariIni =
      data.daftar_jadwal && data.daftar_jadwal[todayName]
        ? data.daftar_jadwal[todayName]
        : [];

    if (jadwalHariIni.length === 0) {
      msg.reply(
        `Sistem aktif ✅\n\nNamun, tidak ada jadwal kelas untuk hari ini (*${todayName}*). Pengecekan absen intensif sedang beristirahat.`,
      );
    } else {
      let pesan = `Sistem aktif ✅\n\nBot telah menyiapkan *${jadwalHariIni.length} alarm pengecekan intensif* untuk jadwal kelas hari ini (*${todayName}*):\n\n`;
      jadwalHariIni.forEach((j, i) => {
        pesan += `${i + 1}. *${j.matkul}*\n   ⏰ Alarm diset pada: ${j.jam} WIB\n\n`;
      });
      pesan += `_Bot akan otomatis mengecek portal tanpa henti selama 10 menit saat alarm berbunyi!_`;
      msg.reply(pesan);
    }
  }

  if (msg.body.toLowerCase().startsWith(".cuaca")) {
    let kota = msg.body.substring(".cuaca".length).trim() || "Surabaya";
    msg.reply(`☁️ Mengecek cuaca untuk *${kota}*...`);
    try {
      // Menggunakan API wttr.in gratis tanpa key
      const fetch = require("node-fetch");
      const response = await fetch(
        `https://wttr.in/${encodeURIComponent(kota)}?format=%l:+%c+%C,+Suhu:+%t,+Angin:+%w`,
      );
      const data = await response.text();
      if (data.includes("Unknown location")) {
        msg.reply(`Maaf, kota *${kota}* tidak ditemukan.`);
      } else {
        msg.reply(`*Info Cuaca:*\n${data}`);
      }
    } catch (err) {
      msg.reply("Terjadi kesalahan saat mengambil data cuaca.");
    }
  }

  if (msg.body.toLowerCase() === ".tugas") {
    let data = loadData();
    let tugas = data.daftar_tugas || [];

    if (tugas.length === 0) {
      msg.reply(
        "🎉 Yeay! Tidak ada tugas kelas yang perlu dikerjakan saat ini.",
      );
      return;
    }

    let pesan = `*📚 DAFTAR TUGAS KELAS*\n\n`;
    // Urutkan berdasarkan deadline terdekat
    tugas.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

    let nowWIB = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }),
    );
    nowWIB.setHours(0, 0, 0, 0);

    tugas.forEach((t, i) => {
      // Hitung sisa hari dengan timezone yang benar
      let targetDate = new Date(t.deadline);
      targetDate.setHours(0, 0, 0, 0);
      let sisaHari = Math.round((targetDate - nowWIB) / (1000 * 60 * 60 * 24));
      let sisaTeks =
        sisaHari < 0
          ? "*(TERLEWAT)*"
          : sisaHari === 0
            ? "*(HARI INI)*"
            : sisaHari === 1
              ? "*(H-1/BESOK)*"
              : sisaHari === 2
                ? "*(H-2)*"
                : `(${sisaHari} hari lagi)`;
      pesan += `${i + 1}. *${t.matkul}*\n   📝 ${t.deskripsi}\n   📅 Deadline: ${t.deadline} ${sisaTeks}\n\n`;
    });
    msg.reply(pesan);
  }

  const senderId = msg.author || msg.from || "";
  const isOwner =
    senderId.includes("85704682918") ||
    senderId.includes("194720949112994") ||
    senderId.includes("85233724944") ||
    senderId.includes("70523564343409");

  const adminCommands = [
    ".setminggu",
    ".testabsen",
    ".jadwaledit",
    ".hapusjadwal",
    ".tambah_tugas",
    ".hapus_tugas",
    ".hidetag",
    ".hapusrekap",
  ];
  const isCmdAdmin = adminCommands.some((cmd) =>
    msg.body.toLowerCase().startsWith(cmd),
  );
  const isCmdOwner =
    msg.body.toLowerCase().startsWith(".resetbot") ||
    msg.body.toLowerCase() === ".cekportal" ||
    msg.body.toLowerCase() === ".testnotif";

  if (isCmdAdmin || isCmdOwner) {
    let isGroupAdmin = false;
    try {
      const chat = await msg.getChat();
      if (chat.isGroup) {
        const participant = chat.participants.find(
          (p) => p.id._serialized === senderId,
        );
        if (participant && (participant.isAdmin || participant.isSuperAdmin)) {
          isGroupAdmin = true;
        }
      }
    } catch (e) { }

    const hasAdminAccess = isOwner || isGroupAdmin;

    if (isCmdOwner && !isOwner) {
      msg.reply("Mohon Maaf, fitur ini khusus untuk *Owner* bot!");
      return;
    }

    if (isCmdAdmin && !hasAdminAccess) {
      msg.reply(
        "Mohon Maaf, fitur ini khusus untuk *Admin Grup* atau *Owner* bot!",
      );
      return;
    }

    if (msg.body.toLowerCase() === ".cekportal") {
      const fs = require("fs");
      const path = require("path");
      const portalPath = path.join(__dirname, "..", "debug_portal.png");
      const targetGroup = "120363424800769453@g.us";

      if (fs.existsSync(portalPath)) {
        const akun = getLastUsedAccount() || "Belum diketahui";
        const media = { 
          image: require("fs").readFileSync(portalPath),
          caption: `📸 *Layar Portal ETHOL Saat Ini*\n\nAkun yang aktif terakhir: *${akun}*`
        };
        const options = targetGroup.endsWith('@g.us') ? { quoted: fakeVerif } : {};
        client.sendMessage(targetGroup, media, options);
        if (msg.from !== targetGroup) {
          msg.reply("✅ Screenshot portal telah dikirim ke grup testing.");
        }
      } else {
        msg.reply(
          "Belum ada screenshot portal. Tunggu bot mengecek portal terlebih dahulu.",
        );
      }
    }

    if (msg.body.toLowerCase() === ".testnotif") {
      const tanggalHariIni = new Date().toLocaleDateString("id-ID");
      const targetGroup = "120363424800769453@g.us";
      announceAbsen(
        client,
        targetGroup,
        "MATKUL TESTING (INI CUMA TEST YAA)",
        tanggalHariIni,
      );
      if (msg.from !== targetGroup) {
        msg.reply("✅ Notifikasi test absen telah dikirim ke grup testing.");
      }
    }

    if (msg.body.toLowerCase().startsWith(".setminggu")) {
      const mingguBaru = parseInt(msg.body.split(" ")[1]);
      if (!isNaN(mingguBaru) && mingguBaru > 0 && mingguBaru <= 16) {
        let data = loadData();
        data.minggu_ke = mingguBaru;
        saveData(data);
        msg.reply(
          `Minggu semester berhasil diubah menjadi minggu ke-${mingguBaru}.`,
        );
      } else {
        msg.reply(
          "Format salah. Contoh penggunaan: .setminggu 2 (Maksimal 16)",
        );
      }
    }

    if (msg.body.toLowerCase().startsWith(".hapusrekap")) {
      const tanggalHapus = msg.body.substring(".hapusrekap".length).trim();
      if (!tanggalHapus) {
        msg.reply("Format salah! Contoh penggunaan: *.hapusrekap 25/8/2026*");
        return;
      }

      let data = loadData();
      let mingguIni = `minggu_${data.minggu_ke}`;

      if (!data.jadwal[mingguIni] || data.jadwal[mingguIni].length === 0) {
        msg.reply(
          `Belum ada data rekapan absen di minggu ke-${data.minggu_ke}.`,
        );
        return;
      }

      const jumlahAwal = data.jadwal[mingguIni].length;
      data.jadwal[mingguIni] = data.jadwal[mingguIni].filter(
        (a) => a.tanggal !== tanggalHapus,
      );
      const jumlahAkhir = data.jadwal[mingguIni].length;
      const terhapus = jumlahAwal - jumlahAkhir;

      if (terhapus > 0) {
        saveData(data);
        msg.reply(
          `✅ Berhasil menghapus *${terhapus}* rekapan absensi yang tercatat pada tanggal *${tanggalHapus}*.`,
        );
      } else {
        msg.reply(
          `❌ Tidak ditemukan rekapan absensi pada tanggal *${tanggalHapus}*. Pastikan format tanggal sama persis seperti di .allabsensi`,
        );
      }
    }

    if (msg.body.toLowerCase().startsWith(".resetbot")) {
      const parts = msg.body.split(" ");
      let semesterBaru = 1;
      if (parts.length > 1 && !isNaN(parseInt(parts[1]))) {
        semesterBaru = parseInt(parts[1]);
      }

      let data = {
        minggu_ke: 1,
        semester: semesterBaru,
        jadwal: {},
      };
      saveData(data);
      msg.reply(
        `Database berhasil direset!\n\nSelamat datang di *Semester ${semesterBaru}*. Sistem telah dikembalikan ke *Minggu ke-1* dan seluruh histori absensi semester lama telah dihapus.`,
      );
    }

    if (msg.body.toLowerCase() === ".testabsen") {
      msg.reply(
        "Memulai proses pengecekan portal Ethol secara manual... Silakan tunggu beberapa saat.",
      );
      try {
        await checkPortal(client);
        msg.reply("Proses pengecekan manual selesai!");
      } catch (err) {
        console.error(err);
        msg.reply("Terjadi kesalahan saat mengecek portal.");
      }
    }

    if (msg.body.toLowerCase().startsWith(".jadwaledit")) {
      let teks = msg.body.substring(".jadwaledit".length).trim();
      let parts = teks.split("|").map((s) => s.trim());

      if (parts.length === 2 && parts[1].toLowerCase() === "reset") {
        let hari = parts[0].toLowerCase();
        let data = loadData();
        data.daftar_jadwal[hari] = [];
        saveData(data);
        msg.reply(`Jadwal hari *${hari}* berhasil direset/dikosongkan.`);
        return;
      }

      if (parts.length < 4) {
        msg.reply(
          `Format salah!\n\n*Cara Tambah Jadwal:*\n.jadwaledit senin | Algoritma | 08:00 | Lab 1\n\n*Cara Hapus Jadwal Sehari:*\n.jadwaledit senin | reset`,
        );
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

      msg.reply(
        `Berhasil menambahkan mata kuliah *${matkul}* ke jadwal hari *${hari}*.`,
      );
    }

    if (msg.body.toLowerCase().startsWith(".hapusjadwal")) {
      let teks = msg.body.substring(".hapusjadwal".length).trim();
      let parts = teks.split("|").map((s) => s.trim());

      if (parts.length < 2) {
        msg.reply(
          `Format salah!\nCara penggunaan:\n.hapusjadwal <Hari> | <Matkul>\n\nContoh:\n.hapusjadwal senin | Algoritma`,
        );
        return;
      }

      let hari = parts[0].toLowerCase();
      let matkul = parts[1].toLowerCase();

      let data = loadData();
      if (!data.daftar_jadwal || !data.daftar_jadwal[hari]) {
        msg.reply(`Tidak ada jadwal untuk hari *${hari}*.`);
        return;
      }

      let jadwalHari = data.daftar_jadwal[hari];
      let index = jadwalHari.findIndex(
        (j) => j.matkul.toLowerCase() === matkul,
      );

      if (index !== -1) {
        let deletedMatkul = jadwalHari[index].matkul;
        jadwalHari.splice(index, 1);
        saveData(data);
        msg.reply(
          `Berhasil menghapus mata kuliah *${deletedMatkul}* dari jadwal hari *${hari}*.`,
        );
      } else {
        msg.reply(
          `Mata kuliah *${parts[1]}* tidak ditemukan pada jadwal hari *${hari}*.`,
        );
      }
    }

    if (msg.body.toLowerCase().startsWith(".tambah_tugas")) {
      let teks = msg.body.substring(".tambah_tugas".length).trim();
      let parts = teks.split("|").map((s) => s.trim());

      if (parts.length < 3) {
        msg.reply(
          `Format salah!\nCara penggunaan:\n.tambah_tugas <Matkul> | <Deskripsi> | <YYYY-MM-DD>\n\nContoh:\n.tambah_tugas PWEB | Membuat makalah bab 1 | 2026-06-25`,
        );
        return;
      }

      let data = loadData();
      if (!data.daftar_tugas) data.daftar_tugas = [];

      data.daftar_tugas.push({
        matkul: parts[0],
        deskripsi: parts[1],
        deadline: parts[2],
      });
      saveData(data);

      msg.reply(
        `✅ Tugas *${parts[0]}* berhasil dicatat dengan deadline ${parts[2]}.`,
      );
    }

    if (msg.body.toLowerCase().startsWith(".hapus_tugas")) {
      let nomor = parseInt(msg.body.split(" ")[1]);
      let data = loadData();
      if (!data.daftar_tugas || data.daftar_tugas.length === 0) {
        msg.reply("Daftar tugas sedang kosong.");
        return;
      }
      if (isNaN(nomor) || nomor < 1 || nomor > data.daftar_tugas.length) {
        msg.reply(
          `Format salah atau nomor tugas tidak ditemukan. Gunakan: .hapus_tugas <nomor>`,
        );
        return;
      }

      // Hapus tugas berdasarkan urutan deadline
      data.daftar_tugas.sort(
        (a, b) => new Date(a.deadline) - new Date(b.deadline),
      );
      let tugasDihapus = data.daftar_tugas.splice(nomor - 1, 1)[0];
      saveData(data);

      msg.reply(
        `✅ Tugas *${tugasDihapus.matkul}* telah berhasil dihapus dari daftar.`,
      );
    }

    if (msg.body.toLowerCase().startsWith(".hidetag")) {
      let pesanTeks = msg.body.substring(".hidetag".length).trim();
      if (!pesanTeks) pesanTeks = "Perhatian seluruh anggota grup!";

      const chat = await msg.getChat();
      if (!chat.isGroup) {
        msg.reply("Perintah ini hanya bisa digunakan di dalam grup!");
        return;
      }

      let participants = chat.participants.map((p) => p.id);
      await client.sendMessage(msg.from, {
        text: `🔊 *PENGUMUMAN*\n\n${pesanTeks}`,
        mentions: participants,
      }, { quoted: fakeVerif });
    }
  }

  if (msg.body.toLowerCase().startsWith(".suara")) {
    let teks = msg.body.substring(".suara".length).trim();
    let lang = "id";
    if (
      teks.startsWith("id ") ||
      teks.startsWith("en ") ||
      teks.startsWith("ja ") ||
      teks.startsWith("ko ")
    ) {
      lang = teks.substring(0, 2);
      teks = teks.substring(3).trim();
    }
    if (!teks) {
      msg.reply(
        "Kirim perintah dengan format *.suara <teks>* atau *.suara en <teks>*",
      );
      return;
    }
    if (teks.length > 200) {
      msg.reply("Teks terlalu panjang! Maksimal 200 karakter.");
      return;
    }
    try {
      const chat = await msg.getChat();
      await chat.sendStateRecording();
      
      const delay = Math.floor(Math.random() * 2000) + 2000;
      await new Promise((resolve) => setTimeout(resolve, delay));

      const url = googleTTS.getAudioUrl(teks, {
        lang: lang,
        slow: false,
        host: "https://translate.google.com",
      });

      const axios = require('axios');
      const { data } = await axios.get(url, { responseType: "arraybuffer" });
      const base64 = Buffer.from(data, "binary").toString("base64");
      
      const fs = require('fs');
      const { execSync } = require('child_process');
      const path = require('path');
      
      const userId = (msg.author || msg.from).replace(/[^0-9]/g, '');
      const tempMp3 = path.join(__dirname, '..', `temp_${userId}.mp3`);
      const tempMp4 = path.join(__dirname, '..', `temp_${userId}.m4a`);
      
      fs.writeFileSync(tempMp3, Buffer.from(base64, "base64"));
      
      try {
        execSync(`ffmpeg -i "${tempMp3}" -c:a aac -b:a 64k -vn "${tempMp4}" -y`, { stdio: 'ignore' });
        const mp4Buffer = fs.readFileSync(tempMp4);
        
        const media = { 
          audio: mp4Buffer, 
          mimetype: "audio/mp4", 
          ptt: true 
        };
        const options = _isGroup ? { quoted: fakeVerif } : {};
        await client.sendMessage(msg.from, media, options);
        await msg.react('✅');
      } catch (e) {
         console.error("FFMPEG conversion failed, falling back to MP3:", e);
         const media = { 
            audio: Buffer.from(base64, "base64"), 
            mimetype: "audio/mp4", 
            ptt: false 
         };
         const options = _isGroup ? { quoted: fakeVerif } : {};
         await client.sendMessage(msg.from, media, options);
         await msg.react('✅');
      } finally {
         if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
         if (fs.existsSync(tempMp4)) fs.unlinkSync(tempMp4);
         await chat.clearState();
      }
    } catch (err) {
      console.error(err);
      msg.reply("Maaf, terjadi kesalahan saat memproses teks ke suara.");
      await msg.react('❌');
    }
  }

  if (msg.body.toLowerCase() === ".ringkas" && msg.hasQuotedMsg) {
    if (!ai) {
      msg.reply("Fitur AI belum aktif.");
      return;
    }
    const quotedMsg = await msg.getQuotedMessage();
    msg.reply("⏳ AI sedang meringkas pesan ini, mohon tunggu...");
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Buatkan ringkasan singkat dalam bentuk poin-poin dari teks ini:\n\n${quotedMsg.body}`,
      });
      msg.reply(`*🤖 Ringkasan AI:*\n\n${response.text}`);
    } catch (err) {
      msg.reply("Maaf, AI gagal meringkas teks tersebut.");
    }
  }

  if (msg.body.toLowerCase().startsWith(".tl ") && msg.hasQuotedMsg) {
    if (!ai) {
      msg.reply("Fitur AI belum aktif.");
      return;
    }
    let lang = msg.body.substring(".tl ".length).trim() || "indonesia";
    const quotedMsg = await msg.getQuotedMessage();
    msg.reply(`⏳ AI sedang menerjemahkan pesan ini ke bahasa *${lang}*...`);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Terjemahkan teks berikut secara natural ke bahasa ${lang}:\n\n${quotedMsg.body}`,
      });
      msg.reply(`*🤖 Terjemahan AI:*\n\n${response.text}`);
    } catch (err) {
      msg.reply("Maaf, AI gagal menerjemahkan teks tersebut.");
    }
  }

  if (msg.body.toLowerCase() === ".susunkata") {
    const chatId = msg.from;
    if (activeGames[chatId]) {
      msg.reply(
        "Masih ada permainan yang belum diselesaikan di obrolan ini!\nSusun huruf ini: *" +
        activeGames[chatId].acak +
        "*",
      );
      return;
    }
    const words = [
      "javascript",
      "database",
      "pemrograman",
      "komputer",
      "internet",
      "algoritma",
      "jaringan",
      "server",
      "aplikasi",
      "framework",
      "skripsi",
      "mahasiswa",
      "dosen",
      "kampus",
    ];
    let word = words[Math.floor(Math.random() * words.length)];
    let acak = word
      .split("")
      .sort(() => 0.5 - Math.random())
      .join(" ")
      .toUpperCase();

    activeGames[chatId] = { jawaban: word, acak: acak };
    msg.reply(
      `🎮 *MINI GAME SUSUN KATA* 🎮\n\nSusunlah huruf-huruf acak berikut menjadi sebuah kata terkait dunia kampus/IT:\n\n👉 *${acak}* 👈\n\nSiapa cepat dia dapat! Silakan langsung ketik jawabannya di sini.`,
    );
  }

  if (msg.body.toLowerCase().startsWith(".khodam")) {
    let nama = msg.body.substring(".khodam".length).trim();
    if (!nama) {
      msg.reply("Ketik namanya! Contoh: *.khodam Budi*");
      return;
    }
    const khodamList = [
      "Kipas Angin Cosmos",
      "Naga Sakti",
      "Tutup Termos",
      "Maung Bandung",
      "Kucing Oren",
      "Seblak Ceker",
      "Sapu Lidi",
      "Ksatria Bergitar",
      "Panci Gosong",
      "Biawak Sungai",
      "Knalpot Racing",
      "Nyamuk Kebon",
      "Jin Penglaris",
      "Sendok Nasi",
      "Cacing Tanah",
    ];
    let khodam = khodamList[Math.floor(Math.random() * khodamList.length)];
    msg.reply(
      `🔮 Setelah diterawang oleh bot...\n\nKhodam pendamping *${nama}* adalah: **${khodam}**`,
    );
  }

  if (msg.body.toLowerCase() === ".truth") {
    const truthList = [
      "Sebutkan inisial orang yang pernah kamu stalking minggu ini!",
      "Apa kebohongan terbesar yang pernah kamu buat ke dosen?",
      "Siapa orang di kelas ini yang menurutmu paling menarik?",
      "Apa rahasia memalukanmu waktu ospek?",
      "Pernah naksir pacar teman gak?",
    ];
    let truth = truthList[Math.floor(Math.random() * truthList.length)];
    msg.reply(`🤫 *TRUTH*\n\n${truth}\n\n(Ayo jawab jujur di grup ini!)`);
  }

  if (msg.body.toLowerCase() === ".dare") {
    const dareList = [
      "Kirim VN nyanyi lagu Balonku Ada Lima ke grup ini sekarang!",
      "Ganti foto profil WA pakai foto aib teman sebelahmu selama 1 jam.",
      'Chat kating random bilang "Halo kak, boleh kenalan?" lalu screenshot ke sini.',
      'Ketik "Aku sayang kalian semua" di grup keluarga lalu screenshot.',
      "Kirim selfie paling jelek kamu ke grup ini!",
    ];
    let dare = dareList[Math.floor(Math.random() * dareList.length)];
    msg.reply(
      `🔥 *DARE*\n\n${dare}\n\n(Lakukan sekarang atau traktir es teh satu kelas!)`,
    );
  }

  if (msg.body.toLowerCase().startsWith(".jodoh")) {
    if (!ai) {
      msg.reply("Fitur AI belum aktif.");
      return;
    }
    let target = msg.body.substring(".jodoh".length).trim();
    if (!target) {
      msg.reply(
        "Sebutkan dua nama yang mau diramal! Contoh: *.jodoh @udin dan @siti*",
      );
      return;
    }
    msg.reply("🔮 AI sedang menghitung kecocokan jodoh mereka...");
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Buatkan ramalan lucu dan absurd ala anak kuliahan tentang kecocokan jodoh untuk dua orang ini: ${target}. Maksimal 3 kalimat pendek yang bikin ngakak.`,
      });
      msg.reply(`*💘 RAMALAN JODOH AI 💘*\n\n${response.text}`);
    } catch (err) {
      msg.reply("Maaf, dukun AI sedang kehabisan menyan.");
    }
  }

  if (msg.body.toLowerCase().startsWith(".roasting")) {
    if (!ai) return msg.reply("Fitur AI belum aktif.");
    let target = msg.body.substring(".roasting".length).trim();
    if (msg.hasQuotedMsg) {
      const quotedMsg = await msg.getQuotedMessage();
      target += ` (Dia bilang: "${quotedMsg.body}")`;
    }
    if (!target.trim())
      return msg.reply(
        "Sebutkan nama atau tag orang yang mau di-roasting! Atau reply pesannya.",
      );

    msg.reply("🔥 Mempersiapkan bahan roasting...");
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Buatkan roasting-an pedas, lucu, dan menohok ala stand-up comedy bahasa indonesia untuk target berikut: ${target}. Jangan terlalu kasar sampai bawa SARA, tapi cukup bikin malu. Maksimal 3 kalimat.`,
      });
      msg.reply(`*🔥 ROASTING TIME 🔥*\n\n${response.text}`);
    } catch (err) {
      msg.reply("Maaf, AI lagi mager ngeroasting.");
    }
  }

  if (msg.body.toLowerCase().startsWith(".gombal")) {
    if (!ai) return msg.reply("Fitur AI belum aktif.");
    let target = msg.body.substring(".gombal".length).trim() || "kamu";
    msg.reply("😘 Sedang merangkai kata-kata manis...");
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Buatkan satu kalimat gombalan maut yang sangat lucu, receh, dan agak cringe bahasa indonesia untuk: ${target}.`,
      });
      msg.reply(`*💖 GOMBALAN AI 💖*\n\n${response.text}`);
    } catch (err) {
      msg.reply("Maaf, AI lagi nggak mood gombal.");
    }
  }

  if (msg.body.toLowerCase() === ".cekhoki") {
    const persen = Math.floor(Math.random() * 101);
    const saranList = [
      "Mending tidur aja seharian.",
      "Coba minta traktir temen sebelahmu.",
      "Jangan lupa napas hari ini.",
      "Hati-hati kalau jalan, awas kesandung semut.",
      "Aman, hari ini kamu bisa ngerjain tugas tanpa ketahuan copas.",
      "Siap-siap dapet kejutan (entah baik atau buruk).",
      "Coba dengerin lagu galau, siapa tau makin galau.",
    ];
    const saran = saranList[Math.floor(Math.random() * saranList.length)];
    let emot = persen > 70 ? "🌟" : persen > 30 ? "👍" : "💀";
    msg.reply(
      `*📊 CEK HOKI HARI INI 📊*\n\nTingkat Hoki kamu: *${persen}%* ${emot}\n\n💡 *Saran AI:* ${saran}`,
    );
  }

  if (msg.body.toLowerCase() === ".caklontong") {
    const chatId = msg.from;
    if (activeGames[chatId] && activeGames[chatId].type === "caklontong") {
      msg.reply(
        `Masih ada soal Cak Lontong yang belum dijawab!\n\nSoal: *${activeGames[chatId].soal}*\n\n(Ketik *nyerah* kalau udah pusing)`,
      );
      return;
    }

    const soalLontong = [
      {
        soal: "Matahari terbenam di sebelah...",
        jawaban: "bawah",
        alasan: "Masa di sebelah warung, kan matahari turun ke bawah.",
      },
      {
        soal: "Yang sering mendapat nilai 100 saat ujian...",
        jawaban: "kertas",
        alasan: "Kan kertasnya yang ditulisin nilai 100, bukan muridnya.",
      },
      {
        soal: "Sebelum terbang, burung biasanya...",
        jawaban: "merem",
        alasan: "Coba aja kamu kepakkan tangan, pasti sambil merem.",
      },
      {
        soal: "Kendaraan yang punya roda 3...",
        jawaban: "sepeda",
        alasan: "Sepeda anak kecil kan rodanya 3.",
      },
      {
        soal: "Bisa ditarik tapi tidak bisa dilihat...",
        jawaban: "napas",
        alasan: "Napas ditarik setiap saat tapi wujudnya ga ada.",
      },
    ];

    let randomSoal =
      soalLontong[Math.floor(Math.random() * soalLontong.length)];
    activeGames[chatId] = {
      type: "caklontong",
      jawaban: randomSoal.jawaban,
      soal: randomSoal.soal,
      alasan: randomSoal.alasan,
    };

    msg.reply(
      `🧠 *KUIS CAK LONTONG* 🧠\n\nSoal: *${randomSoal.soal}*\n\nSilakan jawab langsung di grup ini. Hati-hati, jawabannya di luar nalar!`,
    );
  }

  if (msg.body.toLowerCase().startsWith(".meme")) {
    let teks = msg.body.substring(".meme".length).trim();
    let parts = teks.split("|").map((s) => s.trim());
    let topText = parts[0] || "";
    let bottomText = parts[1] || "";

    let media = null;
    if (msg.hasMedia) {
      media = await msg.downloadMedia();
    } else if (msg.hasQuotedMsg) {
      const quotedMsg = await msg.getQuotedMessage();
      if (quotedMsg.hasMedia) {
        media = await quotedMsg.downloadMedia();
      }
    }

    if (!media || !media.mimetype.includes("image")) {
      msg.reply(
        "Kirim/reply gambar dengan format: *.meme teks atas | teks bawah*",
      );
      return;
    }

    msg.reply("⏳ Sedang meracik meme...");
    try {
      const memeBase64 = await createMeme(
        media.data,
        media.mimetype,
        topText,
        bottomText,
      );
      const memeMedia = { image: Buffer.from(memeBase64, "base64") };
      await client.sendMessage(msg.from, memeMedia);
    } catch (err) {
      console.error("Gagal membuat meme:", err);
      msg.reply("Terjadi kesalahan saat membuat meme.");
    }
  }

  if (msg.body.toLowerCase().startsWith(".nulis")) {
    let teks = msg.body.substring(".nulis".length).trim();
    if (!teks)
      return msg.reply("Teksnya mana? Contoh: *.nulis aku rajin banget nugas*");

    msg.reply("✍️ Sedang menulis di buku...");
    try {
      const nulisBase64 = await createNulis(teks);
      const nulisMedia = { image: Buffer.from(nulisBase64, "base64") };
      await client.sendMessage(msg.from, nulisMedia);
    } catch (err) {
      console.error("Gagal nulis:", err);
      msg.reply("Maaf, tintanya habis (terjadi kesalahan sistem).");
    }
  }

  if (msg.body.toLowerCase() === ".tebaklagu") {
    const chatId = msg.from;
    if (activeGames[chatId] && activeGames[chatId].type === "tebaklagu") {
      msg.reply(
        `Masih ada lagu yang belum ditebak!\n\n(Ketik *nyerah* kalau nyerah)`,
      );
      return;
    }

    const laguList = [
      {
        lirik:
          "Dan bila esok, datang kembali. Seperti sedia kala dimana kau bisa bercanda",
        jawaban: "dan",
      },
      {
        lirik: "Separuh nafasku terbang, bersama dirimu",
        jawaban: "separuh nafas",
      },
      { lirik: "Cinta ini membunuhku", jawaban: "cinta ini membunuhku" },
      {
        lirik:
          "Mungkin suatu saat nanti, kau temukan bahagia meski tak bersamaku",
        jawaban: "monokrom",
      },
      {
        lirik: "Ku menangis membayangkan betapa kejamnya dirimu atas diriku",
        jawaban: "hati yang kau sakiti",
      },
      { lirik: "Cobalah mengerti keadaan ini", jawaban: "cobalah mengerti" },
      {
        lirik: "Kini sendiri di sini mencarimu tak tahu di mana",
        jawaban: "bintang di surga",
      },
    ];

    let randomLagu = laguList[Math.floor(Math.random() * laguList.length)];
    activeGames[chatId] = {
      type: "tebaklagu",
      jawaban: randomLagu.jawaban,
      lirik: randomLagu.lirik,
    };

    msg.reply(
      `🎵 *TEBAK LAGU* 🎵\n\nDengarkan voice note berikut dan tebak *judul lagunya*!`,
    );
    try {
      const base64 = await googleTTS.getAudioBase64(randomLagu.lirik, {
        lang: "id",
        slow: false,
        host: "https://translate.google.com",
      });
      const media = { audio: Buffer.from(base64, "base64"), ptt: true };
      await client.sendMessage(msg.from, media);
    } catch (err) {
      console.error(err);
      msg.reply("Yah, speakernya rusak (gagal memutar lirik).");
      delete activeGames[chatId];
    }
  }

  if (msg.body.toLowerCase() === ".owner") {
    msg.reply(
      "ciee kepo sama ownerkuu yang ganteng imut lucu ini yakk?? xixixi",
    );
    try {
      const vcard = 'BEGIN:VCARD\n' +
        'VERSION:3.0\n' +
        'FN:RzkyAds\n' +
        'ORG:Owner Bot;\n' +
        'item1.TEL;waid=6285704682918:+62 857-0468-2918\n' +
        'item1.X-ABLabel:Ponsel\n' +
        'END:VCARD';
      await client.sendMessage(msg.from, { contacts: { displayName: 'RzkyAds', contacts: [{ vcard }] } });
    } catch (err) {
      console.error("Gagal mengirim kontak owner:", err);
      msg.reply("Nomor Owner (RzkyAds): 085704682918");
    }
  }

  if (
    msg.body.toLowerCase() === ".stiker" ||
    msg.body.toLowerCase() === ".sticker"
  ) {
    let media = null;

    try {
      if (msg.hasMedia) {
        media = await msg.downloadMedia();
      } else if (msg.hasQuotedMsg) {
        const quotedMsg = await msg.getQuotedMessage();
        if (quotedMsg && quotedMsg.hasMedia) {
          media = await quotedMsg.downloadMedia();
        }
      }
    } catch (err) {
      console.error("Gagal mengambil media stiker:", err);
      msg.reply(
        "Maaf, terjadi kesalahan sistem pada WhatsApp saat mengunduh gambar Anda. Ini adalah bug dari sistem WhatsApp Web terbaru. Kami akan segera memperbaruinya!",
      );
      return;
    }

    if (media) {
      try {
        const { Sticker, StickerTypes } = require('wa-sticker-formatter');
        const sticker = new Sticker(Buffer.from(media.data, 'base64'), {
            pack: 'SmartBot',
            author: 'by RzkyAds',
            type: StickerTypes.FULL,
            quality: 50
        });
        const webpBuffer = await sticker.toBuffer();
        const options = _isGroup ? { quoted: fakeVerif } : {};
        await client.sendMessage(msg.from, { sticker: webpBuffer }, options);
      } catch (err) {
        console.error("Gagal mengirim stiker:", err);
        msg.reply("Maaf, terjadi kesalahan saat membuat stiker.");
      }
    } else {
      msg.reply(
        'Mohon kirim foto dengan caption ".stiker" atau reply foto dengan ".stiker"',
      );
    }
  }
}

module.exports = { handleMessage };
