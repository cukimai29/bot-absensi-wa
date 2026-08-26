const https = require('https');
const { loadData, saveData } = require('../core/database');

/**
 * Service untuk mengelola Kas Kelas & Google Sheets Integration
 */
class KasService {
    /**
     * Mengonversi URL Google Sheets ke format gviz JSON
     */
    static getGvizUrl(inputUrl) {
        const idMatch = inputUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
        const gidMatch = inputUrl.match(/gid=([0-9]+)/);
        if (idMatch && idMatch[1]) {
            let gvizUrl = `https://docs.google.com/spreadsheets/d/${idMatch[1]}/gviz/tq?tqx=out:json`;
            if (gidMatch && gidMatch[1]) {
                gvizUrl += `&gid=${gidMatch[1]}`;
            }
            return gvizUrl;
        }
        return inputUrl;
    }

    /**
     * Memuat data JSON gviz dari Google Sheets
     */
    static fetchSheetData(url) {
        return new Promise((resolve, reject) => {
            const gvizUrl = this.getGvizUrl(url);
            https.get(gvizUrl, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const match = data.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);/);
                        if (match && match[1]) {
                            resolve(JSON.parse(match[1]));
                        } else {
                            reject(new Error('Format respons Google Sheets tidak valid.'));
                        }
                    } catch (err) {
                        reject(err);
                    }
                });
            }).on('error', reject);
        });
    }

    /**
     * Memproses analisis tunggakan kas dari Google Sheets
     */
    static async getKasAnalysis() {
        const dbData = loadData();
        const sheetUrl = dbData.kas_url || process.env.KAS_SPREADSHEET_URL;
        const paymentInfo = dbData.kas_payment_info || process.env.KAS_PAYMENT_INFO || 'Belum diatur';
        const mapping = dbData.kas_mapping || {};
        const currentWeek = dbData.minggu_ke || 1;

        if (!sheetUrl) {
            throw new Error('URL Google Sheet Kas belum dikonfigurasi!');
        }

        const sheetJson = await this.fetchSheetData(sheetUrl);
        const rows = sheetJson.table.rows;
        if (!rows || rows.length < 3) {
            throw new Error('Data spreadsheet kosong atau tidak valid.');
        }

        let weeklyDues = 5000;
        if (rows[0] && rows[0].c) {
            for (let c of rows[0].c) {
                if (c && typeof c.v === 'number' && c.v > 0) {
                    weeklyDues = c.v;
                    break;
                }
            }
        }

        const debtors = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || !row.c) continue;

            let nameCol = -1;
            let nrpCol = -1;

            for (let cIdx = 0; cIdx < row.c.length; cIdx++) {
                const cell = row.c[cIdx];
                if (!cell || cell.v === null || cell.v === undefined) continue;

                if (typeof cell.v === 'number' && String(cell.v).length >= 8 && nrpCol === -1) {
                    nrpCol = cIdx;
                } else if (typeof cell.v === 'string' && cell.v.trim().length > 2 && cell.v.trim() !== 'Nama Lengkap' && cell.v.trim() !== 'KETERANGAN' && nameCol === -1 && nrpCol === -1) {
                    nameCol = cIdx;
                }
            }

            if (nameCol === -1 || nrpCol === -1) continue;

            const name = row.c[nameCol].v.trim();
            const nrp = row.c[nrpCol].v;
            const week1Col = nrpCol + 2;

            const unpaidWeeks = [];
            for (let w = 1; w <= currentWeek; w++) {
                const cellIndex = week1Col + (w - 1);
                const cell = row.c[cellIndex];
                const isPaid = cell ? !!cell.v : false;
                if (!isPaid) {
                    unpaidWeeks.push(w);
                }
            }

            if (unpaidWeeks.length > 0) {
                const totalOwed = unpaidWeeks.length * weeklyDues;
                debtors.push({
                    name,
                    nrp,
                    unpaidWeeks,
                    totalOwed,
                    waId: mapping[name] || null
                });
            }
        }

        debtors.sort((a, b) => b.totalOwed - a.totalOwed);

        return {
            currentWeek,
            weeklyDues,
            paymentInfo,
            sheetUrl,
            debtors
        };
    }

    /**
     * Memetakan nama di spreadsheet ke nomor WA
     */
    static mapContact(name, waId) {
        let data = loadData();
        if (!data.kas_mapping) data.kas_mapping = {};
        data.kas_mapping[name] = waId;
        saveData(data);
        return { success: true, name, waId };
    }

    /**
     * Menghapus pemetaan kontak
     */
    static deleteMapping(name) {
        let data = loadData();
        if (data.kas_mapping && data.kas_mapping[name]) {
            delete data.kas_mapping[name];
            saveData(data);
            return { success: true };
        }
        return { success: false };
    }
}

module.exports = KasService;
