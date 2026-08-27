const { generateText } = require('ai');
const { createGoogleGenerativeAI } = require('@ai-sdk/google');
const { allTools } = require('../tools');
const { SYSTEM_PROMPT } = require('./systemPrompt');

// Inisialisasi Google Provider Vercel AI SDK
const google = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY
});

/**
 * Helper untuk memformat hasil tool secara otomatis jika AI tidak mengembalikan teks rangkuman
 */
function formatFallbackFromToolResult(toolName, tr) {
    if (!tr) return null;

    if (toolName === 'getCurrentTime') {
        return `🕒 *INFORMASI WAKTU SAAT INI (WIB)*\n\nHari: *${tr.hari}*\nTanggal: *${tr.tanggalFormatted}*\nPukul: *${tr.waktuFormatted}*`;
    }

    if (toolName === 'checkEthol') {
        let msg = `🔍 *HASIL PENGECEKAN ETHOL PENS*\n\n`;
        msg += `👤 Akun Login: *${tr.accountUsed || 'Akun Utama'}*\n`;
        if (tr.openPresensiCount > 0) {
            msg += `🔥 *STATUS: Ada ${tr.openPresensiCount} Absensi Terbuka!*\n\n`;
            tr.openPresensi.forEach((a, i) => {
                msg += `${i + 1}. *${a.matkul}* (Tanggal: ${a.tanggal})\n`;
            });
        } else {
            msg += `📌 *STATUS: Saat ini TIDAK ADA absensi yang dibuka oleh dosen.*`;
        }
        return msg;
    }

    if (toolName === 'checkKas') {
        let msg = `📢 *LAPORAN TUNGGAKAN KAS KELAS*\n\n`;
        msg += `Perkuliahan: *Minggu ke-${tr.currentWeek || 1}*\n`;
        msg += `Tarif Mingguan: *Rp${(tr.weeklyDues || 5000).toLocaleString('id-ID')}*\n\n`;
        if (tr.debtors && tr.debtors.length > 0) {
            msg += `Berikut daftar mahasiswa yang belum melunasi kas (${tr.debtors.length} orang):\n\n`;
            tr.debtors.forEach((d, i) => {
                msg += `${i + 1}. *${d.name}* (${d.nrp})\n   Total Tunggakan: Rp${d.totalOwed.toLocaleString('id-ID')}\n`;
            });
        } else {
            msg += `🎉 Luar biasa! Semua mahasiswa telah melunasi kas sampai Minggu ini.`;
        }
        return msg;
    }

    if (toolName === 'getSchedule') {
        if (!tr.jadwal || tr.jadwal.length === 0) {
            return `📅 *Jadwal Hari ${tr.hari || 'Ini'}*: Tidak ada jadwal perkuliahan.`;
        }
        let msg = `📅 *JADWAL KULIAH HARI ${(tr.hari || '').toUpperCase()}*\n\n`;
        tr.jadwal.forEach((j, i) => {
            msg += `${i + 1}. *${j.matkul}*\n   Jam: ${j.jam} | Ruang: ${j.ruang}\n`;
        });
        return msg;
    }

    if (toolName === 'getTasks') {
        if (!tr.list || tr.list.length === 0) {
            return `✅ Tidak ada tugas kelas yang aktif saat ini.`;
        }
        let msg = `📚 *DAFTAR TUGAS KELAS (${tr.count} Tugas)*\n\n`;
        tr.list.forEach((t) => {
            msg += `${t.nomor}. *${t.matkul}*\n   Deskripsi: ${t.deskripsi}\n   Deadline: ${t.deadline} ${t.sisaTeks}\n\n`;
        });
        return msg;
    }

    if (tr.message) return tr.message;
    return typeof tr === 'string' ? tr : JSON.stringify(tr, null, 2);
}

/**
 * Agentic Orchestrator Engine (ReAct Decision Engine)
 * Primary Model: gemini-3.5-flash-lite
 * Fallbacks: gemini-2.5-flash, gemini-2.5-flash-lite, gemini-2.5-pro
 */
async function processAgentQuery(userPrompt, historyMsgs = []) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error('API Key Gemini (GEMINI_API_KEY) belum dikonfigurasi di .env');
    }

    const modelsToTry = [
        'gemini-3.5-flash-lite',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.5-pro'
    ];

    for (let i = 0; i < modelsToTry.length; i++) {
        const modelName = modelsToTry[i];
        try {
            const result = await generateText({
                model: google(modelName),
                system: SYSTEM_PROMPT,
                prompt: userPrompt,
                tools: allTools,
                maxSteps: 5,
                onStepFinish: ({ text, toolCalls }) => {
                    if (toolCalls && toolCalls.length > 0) {
                        toolCalls.forEach(tc => {
                            console.log(`[AGENTIC TOOL EXECUTE] -> Executing Tool: "${tc.toolName}" (${modelName})`);
                        });
                    }
                }
            });

            let finalText = (result.text || '').trim();

            // Proteksi: Jika result.text kosong (model AI tidak menulis rangkuman), ekstrak dari steps/toolResults
            if (!finalText && result.steps && result.steps.length > 0) {
                const stepTexts = result.steps.map(s => (s.text || '').trim()).filter(Boolean);
                if (stepTexts.length > 0) {
                    finalText = stepTexts.join('\n\n');
                } else {
                    for (let s of result.steps) {
                        if (s.toolResults && s.toolResults.length > 0) {
                            for (let trObj of s.toolResults) {
                                const toolData = trObj.output !== undefined ? trObj.output : trObj.result;
                                const formatted = formatFallbackFromToolResult(trObj.toolName, toolData);
                                if (formatted) {
                                    finalText = formatted;
                                    break;
                                }
                            }
                        }
                        if (finalText) break;
                    }
                }
            }

            if (!finalText) {
                finalText = "✅ Permintaan Anda telah selesai diproses oleh sistem.";
            }

            return {
                text: finalText,
                steps: result.steps,
                modelUsed: modelName
            };
        } catch (err) {
            const errStr = String(err) + JSON.stringify(err);
            const isRateLimit = errStr.includes('429') || errStr.includes('Quota exceeded') || errStr.includes('RESOURCE_EXHAUSTED');

            if (isRateLimit && i < modelsToTry.length - 1) {
                console.warn(`[AGENTIC WARN] Rate limit pada ${modelName}. Mengalihkan ke model cadangan (${modelsToTry[i + 1]})...`);
                continue;
            }

            if (i < modelsToTry.length - 1) {
                continue;
            }

            if (isRateLimit) {
                return {
                    text: '⏳ *Mohon maaf, AI sedang menerima terlalu banyak permintaan saat ini (Rate Limit Exceeded).* \n\nSilakan tunggu sekitar 30 detik sebelum mencoba bertanya kembali ya! 🙏',
                    isError: true
                };
            }

            return {
                text: '❌ Terjadi kesalahan sistem pada AI Agent saat memproses permintaan Anda.',
                isError: true
            };
        }
    }
}

module.exports = { processAgentQuery };
