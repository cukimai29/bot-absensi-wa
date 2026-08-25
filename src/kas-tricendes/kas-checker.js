const https = require('https');
const { loadData, saveData } = require('../database');

function getGvizUrl(inputUrl) {
    const idMatch = inputUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    const gidMatch = inputUrl.match(/gid=([0-9]+)/);
    if (idMatch && idMatch[1]) {
        let gvizUrl = `https://docs.google.com/spreadsheets/d/${idMatch[1]}/gviz/tq?tqx=out:json`;
        if (gidMatch && gidMatch[1]) {
            gvizUrl += `&gid=${gidMatch[1]}`;
        }
        return gvizUrl;
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
        // Cari posisi kolom nama, NRP, dan nominal kas secara dinamis
        let weeklyDues = 5000;
        // Cari nominal kas dari sel pertama di baris 0 yang memiliki nilai angka
        if (rows[0] && rows[0].c) {
            for (let c of rows[0].c) {
                if (c && typeof c.v === 'number' && c.v > 0) {
                    weeklyDues = c.v;
                    break;
                }
            }
        }

        const debtors = [];

        // Parsing baris mahasiswa
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || !row.c) continue;

            // Cari indeks kolom nama dan NRP pada baris ini
            let nameCol = -1;
            let nrpCol = -1;

            for (let cIdx = 0; cIdx < row.c.length; cIdx++) {
                const cell = row.c[cIdx];
                if (!cell || cell.v === null || cell.v === undefined) continue;

                // Cek jika nilai berupa angka NRP (dimulai 24... atau 10 digit)
                if (typeof cell.v === 'number' && String(cell.v).length >= 8 && nrpCol === -1) {
                    nrpCol = cIdx;
                } else if (typeof cell.v === 'string' && cell.v.trim().length > 2 && cell.v.trim() !== 'Nama Lengkap' && cell.v.trim() !== 'KETERANGAN' && nameCol === -1 && nrpCol === -1) {
                    nameCol = cIdx;
                }
            }

            if (nameCol === -1 || nrpCol === -1) continue;

            const name = row.c[nameCol].v.trim();
            const nrp = row.c[nrpCol].v;

            // Kolom minggu ke-1 dimulai 2 kolom setelah NRP (setelah Kolom Tanggal Lahir)
            let week1Col = nrpCol + 2;

            // Periksa minggu yang belum dibayar s.d. minggu perkuliahan aktif saat ini
            const unpaidWeeks = [];
            for (let w = 1; w <= currentWeek; w++) {
                const cellIndex = week1Col + (w - 1);
                const cell = row.c[cellIndex];
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