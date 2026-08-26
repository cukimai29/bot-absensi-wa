const KasService = require('../services/kasService');

async function checkKasAndSend(client, targetGroupId, manualTrigger = false) {
    try {
        const analysis = await KasService.getKasAnalysis();
        const { currentWeek, weeklyDues, paymentInfo, sheetUrl, debtors } = analysis;

        if (debtors.length === 0) {
            if (manualTrigger) {
                return `Luar biasa! Semua mahasiswa telah melunasi kas sampai Minggu ke-${currentWeek}.`;
            }
            return;
        }

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

        await client.sendMessage(targetGroupId, { text: text, mentions: mentions });
        return `Berhasil mengirimkan pengingat kas ke grup untuk ${debtors.length} orang.`;
    } catch (err) {
        console.error('Gagal memproses pengingat kas:', err);
        if (manualTrigger) throw err;
    }
}

module.exports = { checkKasAndSend };