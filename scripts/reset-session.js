const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const sessionDir = process.env.SESSION_DIR
    ? path.resolve(__dirname, '..', process.env.SESSION_DIR)
    : path.join(__dirname, '..', 'session');

if (!fs.existsSync(sessionDir)) {
    console.log(`[RESET] Folder session tidak ditemukan: ${sessionDir}`);
    console.log('[RESET] Tidak ada yang perlu dihapus. Jalankan bot untuk login baru.');
    process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = `${sessionDir}.backup-${stamp}`;

try {
    fs.renameSync(sessionDir, backupDir);
    console.log('[RESET] Sesi WhatsApp lama berhasil dipindahkan ke:');
    console.log(`        ${backupDir}`);
    console.log('[RESET] Folder session baru akan dibuat otomatis saat bot dijalankan.');
    console.log('[RESET] Sekarang restart bot, misalnya: pm2 restart botwaku');
} catch (err) {
    console.error('[RESET] Gagal memindahkan folder session:', err.message);
    console.error('[RESET] Pastikan bot sedang berhenti (pm2 stop botwaku) lalu coba lagi.');
    process.exit(1);
}
