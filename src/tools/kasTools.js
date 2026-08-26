const { tool } = require('ai');
const { z } = require('zod');
const KasService = require('../services/kasService');

/**
 * Tool Vercel AI SDK untuk Keuangan Kas Kelas
 */
const checkKasTool = tool({
    description: 'Mengecek laporan tunggakan kas kelas terbaru secara real-time dari Google Sheets, mendeteksi siapa saja yang belum melunasi kas hingga minggu aktif saat ini.',
    parameters: z.object({}),
    execute: async () => {
        try {
            return await KasService.getKasAnalysis();
        } catch (err) {
            return { error: err.message };
        }
    }
});

const mapKasContactTool = tool({
    description: 'Memetakan nama mahasiswa di spreadsheet kas ke nomor WhatsApp (Khusus Admin).',
    parameters: z.object({
        name: z.string().describe('Nama mahasiswa sesuai spreadsheet'),
        waId: z.string().describe('ID WhatsApp / Nomor WA (misal: 6285704682918@c.us)')
    }),
    execute: async ({ name, waId }) => {
        return KasService.mapContact(name, waId);
    }
});

module.exports = {
    checkKasTool,
    mapKasContactTool
};
