const https = require('https');
const { loadData, saveData } = require('../database');

function getGvizUrl(inputUrl) {
    const match = inputUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
        return `https://docs.google.com/spreadsheets/d/${match[1]}/gviz/tq?tqx=out:json`;
    }
    return inputUrl;
}
function fetchSheetData(url) {
    return new Promise((resolve, reject) => {
        const gvizUrl = getGvizUrl(url);
        https.get(gvizUrl, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    // Google Sheets mengembalikan string JSON dibungkus fungsi google.visualization.Query.setResponse
                    const match = data.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);/);
                    if (match && match[1]) {
                        resolve(JSON.parse(match[1]));
                    } else {
                        reject(new Error('Format respons Google Sheets tidak valid.'));
                    }
                } catch (err) {
                    reject(err);
                }
            });
        }).on('error', reject);
    });
}
async function checkKasAndSend(client, targetGroupId, manualTrigger = false) {
    const dbData = loadData();
    const sheetUrl = dbData.kas_url || process.env.KAS_SPREADSHEET_URL;
    const paymentInfo = dbData.kas_payment_info || process.env.KAS_PAYMENT_INFO || 'Belum diatur';
    const mapping = dbData.kas_mapping || {};
    const currentWeek = dbData.minggu_ke || 1;
    if (!sheetUrl) {
        console.error('URL Google Sheet Kas belum dikonfigurasi!');
        if (manualTrigger) throw new Error('URL Google Sheet Kas belum dikonfigurasi!');
        return;
    }
    try {
        const sheetJson = await fetchSheetData(sheetUrl);
        const rows = sheetJson.table.rows;
        if (!rows || rows.length < 3) {
            throw new Error('Data spreadsheet kosong atau tidak valid.');
        }
        // Ambil nominal kas mingguan dari Row 0 Kolom U (indeks 20)
        const weeklyDues = rows[0].c[20] ? rows[0].c[20].v : 5000;
        const debtors = [];
        // Parsing baris dimulai dari baris ke-3 (indeks 2)
        for (let i = 2; i < rows.length; i++) {
            const row = rows[i];
            if (!row.c || !row.c[1]) continue;
            const name = row.c[1].v ? row.c[1].v.trim() : null;
            if (!name) continue;
            const nrp = row.c[2] ? row.c[2].v : null;
            // Pastikan baris ini adalah baris mahasiswa dengan memverifikasi NRP berupa angka
            if (typeof nrp !== 'number') continue;
            // Periksa minggu yang belum dibayar s.d. minggu perkuliahan aktif saat ini
            const unpaidWeeks = [];
            for (let w = 1; w <= currentWeek; w++) {
                const cell = row.c[3 + w]; // Kolom E (indeks 4) adalah Minggu 1
                const isPaid = cell ? !!cell.v : false;
                if (!isPaid) {
                    unpaidWeeks.push(w);
                }
            }
            // Jika ada minggu yang menunggak, masukkan ke daftar tunggakan
            if (unpaidWeeks.length > 0) {
                const totalOwed = unpaidWeeks.length * weeklyDues;
                debtors.push({
                    name,
                    nrp,
                    unpaidWeeks,
                    totalOwed,
                    waId: mapping[name] || null
                });
            }
        }
        if (debtors.length === 0) {
            if (manualTrigger) {
                return `Luar biasa! Semua mahasiswa telah melunasi kas sampai Minggu ke-${currentWeek}.`;
            }
            return; // Jangan spam grup jika tidak ada yang menunggak
        }
        // Urutkan penunggak berdasarkan jumlah tunggakan terbesar
        debtors.sort((a, b) => b.totalOwed - a.totalOwed);
        // Susun teks pesan WhatsApp
        let text = `📢 *PENGINGAT KAS KELAS TRI C* 📢\n`;
        text += `Perkuliahan: *Minggu ke-${currentWeek}*\n`;
        text += `Tarif Mingguan: *Rp${weeklyDues.toLocaleString('id-ID')}*\n\n`;
        text += `Berikut adalah daftar mahasiswa yang belum melunasi kas s.d. Minggu ini:\n\n`;
        const mentions = [];
        debtors.forEach((debtor, idx) => {
            let debtorStr = `${idx + 1}. `;
            if (debtor.waId) {
                debtorStr += `@${debtor.waId.split('@')[0]}`;
                mentions.push(debtor.waId);
            } else {
                debtorStr += `*${debtor.name}*`;
            }
            debtorStr += ` (${debtor.nrp})\n`;
            debtorStr += `   Status: Belum bayar minggu: *${debtor.unpaidWeeks.join(', ')}*\n`;
            debtorStr += `   Total Tunggakan: *Rp${debtor.totalOwed.toLocaleString('id-ID')}*\n\n`;
            text += debtorStr;
        });
        text += `💳 *INFO PEMBAYARAN*:\n`;
        text += `${paymentInfo}\n\n`;
        text += `🔗 *LINK DETAIL SPREADSHEET KAS*:\n`;
        text += `${sheetUrl}\n\n`;
        text += `Mohon segera melunasi kas masing-masing agar rekap keuangan tetap rapi. Terima kasih! 🙏`;
        // Kirim ke grup target
        const chat = await client.getChatById(targetGroupId);
        await chat.sendMessage(text, { mentions });
        return `Berhasil mengirimkan pengingat kas ke grup untuk ${debtors.length} orang.`;
    } catch (err) {
        console.error('Gagal memproses pengingat kas:', err);
        if (manualTrigger) throw err;
    }
}
module.exports = { checkKasAndSend };