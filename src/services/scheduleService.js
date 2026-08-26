const { loadData, saveData } = require('../core/database');

/**
 * Service untuk mengelola Jadwal Perkuliahan
 */
class ScheduleService {
    /**
     * Mengambil jadwal perkuliahan pada hari tertentu
     * @param {string} targetHari - Nama hari (misal: 'senin', 'selasa', dll.)
     */
    static getJadwalByDay(targetHari) {
        const hari = (targetHari || '').toLowerCase().trim();
        const data = loadData();
        const jadwalHari = data.daftar_jadwal && data.daftar_jadwal[hari] ? data.daftar_jadwal[hari] : [];
        return {
            hari: hari.charAt(0).toUpperCase() + hari.slice(1),
            jadwal: jadwalHari
        };
    }

    /**
     * Mengambil jadwal perkuliahan hari ini (WIB)
     */
    static getJadwalHariIni() {
        const namaHari = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
        const todayStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" });
        const todayName = namaHari[new Date(todayStr).getDay()];
        return this.getJadwalByDay(todayName);
    }

    /**
     * Menambahkan mata kuliah ke jadwal hari tertentu
     * @param {string} hari 
     * @param {string} matkul 
     * @param {string} jam 
     * @param {string} ruang 
     */
    static addJadwal(hari, matkul, jam, ruang) {
        const h = (hari || '').toLowerCase().trim();
        let data = loadData();
        if (!data.daftar_jadwal) data.daftar_jadwal = {};
        if (!data.daftar_jadwal[h]) data.daftar_jadwal[h] = [];

        data.daftar_jadwal[h].push({ matkul, jam, ruang });
        saveData(data);
        return { success: true, message: `Berhasil menambahkan mata kuliah *${matkul}* ke jadwal hari *${h}*.` };
    }

    /**
     * Menghapus mata kuliah spesifik dari jadwal hari tertentu
     * @param {string} hari 
     * @param {string} matkul 
     */
    static deleteJadwal(hari, matkul) {
        const h = (hari || '').toLowerCase().trim();
        const m = (matkul || '').toLowerCase().trim();
        let data = loadData();

        if (!data.daftar_jadwal || !data.daftar_jadwal[h]) {
            return { success: false, message: `Tidak ada jadwal untuk hari *${h}*.` };
        }

        const index = data.daftar_jadwal[h].findIndex(j => j.matkul.toLowerCase() === m);
        if (index !== -1) {
            const deletedMatkul = data.daftar_jadwal[h][index].matkul;
            data.daftar_jadwal[h].splice(index, 1);
            saveData(data);
            return { success: true, message: `Berhasil menghapus mata kuliah *${deletedMatkul}* dari jadwal hari *${h}*.` };
        }

        return { success: false, message: `Mata kuliah *${matkul}* tidak ditemukan pada jadwal hari *${h}*.` };
    }

    /**
     * Mereset seluruh jadwal pada hari tertentu
     * @param {string} hari 
     */
    static resetJadwalHari(hari) {
        const h = (hari || '').toLowerCase().trim();
        let data = loadData();
        if (!data.daftar_jadwal) data.daftar_jadwal = {};
        data.daftar_jadwal[h] = [];
        saveData(data);
        return { success: true, message: `Jadwal hari *${h}* berhasil direset/dikosongkan.` };
    }
}

module.exports = ScheduleService;
