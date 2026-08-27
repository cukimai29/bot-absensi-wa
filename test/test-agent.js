require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const readline = require('readline');
const { processAgentQuery } = require('../src/agents/orchestrator');

console.log(`
===========================================================
🤖 SMARTBOT TRICENDENCE - AGENTIC AI TERMINAL TESTER
===========================================================
Selamat datang! Anda dapat bercakap-cakap dalam Bahasa Alami.
Otak Agentic AI (Gemini 3.5 Flash-Lite) akan secara otomatis
memilih & menjalankan Tools (Jadwal, Tugas, Kas, dll) secara otonom!

Contoh pertanyaan yang bisa dicoba:
- "besok ada kuliah apa aja ya?"
- "ada tugas apa yang belum dikerjakan?"
- "siapa aja yang belum bayar kas minggu ini?"
- "sekarang hari apa tanggal berapa dan jam berapa?"
- "sinkronkan jadwal dari ethol dong"

Ketik 'exit' atau 'keluar' untuk mengakhiri sesi pengujian.
===========================================================
`);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\nAnda 👤 > '
});

rl.prompt();

rl.on('line', async (line) => {
    const input = line.trim();
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'keluar') {
        console.log('Sesi pengujian diakhiri. Sampai jumpa! 👋');
        process.exit(0);
    }

    if (!input) {
        rl.prompt();
        return;
    }

    console.log('🤖 Agentic AI sedang berpikir & mengeksekusi Tools...\n');

    try {
        const response = await processAgentQuery(input);
        console.log('-----------------------------------------------------------');
        if (response.modelUsed) {
            console.log(`[Model Aktif: ${response.modelUsed}]`);
        }
        console.log(`🤖 SmartBot >\n\n${response.text}`);
        console.log('-----------------------------------------------------------');
    } catch (err) {
        console.error('❌ Terjadi Kesalahan:', err.message);
    }

    rl.prompt();
});
