const { tool } = require('ai');
const { z } = require('zod');
const ScheduleService = require('../services/scheduleService');

/**
 * Tool Vercel AI SDK untuk Jadwal Kuliah
 */
const getScheduleTool = tool({
    description: 'Mengambil daftar jadwal perkuliahan berdasarkan hari tertentu (misal: senin, selasa, rabu, kamis, jumat, sabtu, minggu) atau hari ini.',
    parameters: z.object({
        day: z.string().describe('Nama hari dalam bahasa Indonesia (misal: senin, selasa, hari ini)')
    }),
    execute: async ({ day }) => {
        if (day.toLowerCase() === 'hari ini') {
            return ScheduleService.getJadwalHariIni();
        }
        return ScheduleService.getJadwalByDay(day);
    }
});

const addScheduleTool = tool({
    description: 'Menambahkan mata kuliah baru ke jadwal hari tertentu (Khusus Admin/Pengurus).',
    parameters: z.object({
        day: z.string().describe('Nama hari (misal: senin)'),
        matkul: z.string().describe('Nama mata kuliah'),
        jam: z.string().describe('Waktu kuliah (misal: 08:00 WIB)'),
        ruang: z.string().describe('Ruangan kuliah (misal: Lab 1 / D4-301)')
    }),
    execute: async ({ day, matkul, jam, ruang }) => {
        return ScheduleService.addJadwal(day, matkul, jam, ruang);
    }
});

const deleteScheduleTool = tool({
    description: 'Menghapus mata kuliah tertentu dari jadwal hari tertentu (Khusus Admin/Pengurus).',
    parameters: z.object({
        day: z.string().describe('Nama hari'),
        matkul: z.string().describe('Nama mata kuliah yang ingin dihapus')
    }),
    execute: async ({ day, matkul }) => {
        return ScheduleService.deleteJadwal(day, matkul);
    }
});

module.exports = {
    getScheduleTool,
    addScheduleTool,
    deleteScheduleTool
};
