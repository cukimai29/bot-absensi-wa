const { tool } = require('ai');
const { z } = require('zod');
const EtholService = require('../services/etholService');
const EtholSyncService = require('../services/etholSyncService');

/**
 * Tool Vercel AI SDK untuk Presensi & Sinkronisasi Ethol PENS
 */
const checkEtholTool = tool({
    description: 'Mengecek portal Ethol PENS secara langsung menggunakan Puppeteer headless browser untuk melihat apakah ada dosen yang sedang membuka sesi presensi/absen saat ini. Mengembalikan akun CAS PENS yang digunakan dan status presensi yang terbuka.',
    parameters: z.object({}),
    execute: async () => {
        return await EtholService.checkPortal(null);
    }
});

const syncEtholScheduleTool = tool({
    description: 'Menyinkronkan jadwal kuliah kelas secara otomatis dari portal Ethol PENS ke database JSON lokal. Panggil tool ini jika pengguna meminta untuk memperbarui atau menyinkronkan jadwal dari Ethol.',
    parameters: z.object({}),
    execute: async () => {
        return await EtholSyncService.syncScheduleFromEthol();
    }
});

module.exports = {
    checkEtholTool,
    syncEtholScheduleTool
};
