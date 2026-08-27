const { tool } = require('ai');
const { z } = require('zod');
const TimeService = require('../services/timeService');

/**
 * General Tool Vercel AI SDK untuk Waktu & Tanggal
 */
const getCurrentTimeTool = tool({
    description: 'Mengambil informasi waktu real-time saat ini (hari, tanggal, bulan, tahun, dan jam/menit dalam zona waktu WIB Asia/Jakarta). Panggil tool ini jika pengguna bertanya tentang jam berapa sekarang, hari apa sekarang, atau tanggal berapa hari ini.',
    parameters: z.object({}),
    execute: async () => {
        return TimeService.getCurrentTimeInfo();
    }
});

module.exports = {
    getCurrentTimeTool
};
