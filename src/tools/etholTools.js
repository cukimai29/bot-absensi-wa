const { tool } = require('ai');
const { z } = require('zod');
const EtholService = require('../services/etholService');

/**
 * Tool Vercel AI SDK untuk Presensi Ethol PENS
 */
const checkEtholTool = tool({
    description: 'Mengecek portal Ethol PENS secara langsung menggunakan Puppeteer headless browser untuk melihat apakah ada dosen yang sedang membuka sesi presensi/absen saat ini. Mengembalikan akun CAS PENS yang digunakan dan status presensi yang terbuka.',
    parameters: z.object({}),
    execute: async () => {
        return await EtholService.checkPortal(null);
    }
});

module.exports = {
    checkEtholTool
};
