const { tool } = require('ai');
const { z } = require('zod');
const TaskService = require('../services/taskService');

/**
 * Tool Vercel AI SDK untuk Daftar Tugas
 */
const getTasksTool = tool({
    description: 'Mengambil daftar seluruh tugas kelas yang aktif beserta deadline dan sisa waktunya.',
    parameters: z.object({}),
    execute: async () => {
        return TaskService.getTugasList();
    }
});

const addTaskTool = tool({
    description: 'Menambahkan tugas kelas baru dengan deadline tertentu (Khusus Admin/Pengurus).',
    parameters: z.object({
        matkul: z.string().describe('Nama mata kuliah'),
        deskripsi: z.string().describe('Rincian/deskripsi tugas'),
        deadline: z.string().describe('Tanggal deadline format YYYY-MM-DD (misal: 2026-08-30)')
    }),
    execute: async ({ matkul, deskripsi, deadline }) => {
        return TaskService.addTugas(matkul, deskripsi, deadline);
    }
});

const deleteTaskTool = tool({
    description: 'Menghapus tugas kelas berdasarkan nomor urut tugas pada daftar tugas (Khusus Admin/Pengurus).',
    parameters: z.object({
        nomor: z.number().describe('Nomor urut tugas yang ingin dihapus (1-indexed)')
    }),
    execute: async ({ nomor }) => {
        return TaskService.deleteTugas(nomor);
    }
});

module.exports = {
    getTasksTool,
    addTaskTool,
    deleteTaskTool
};
