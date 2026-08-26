const { loadData, saveData } = require('../core/database');

/**
 * Service untuk mengelola Daftar Tugas Kelas
 */
class TaskService {
    /**
     * Mengambil daftar tugas yang belum terlewat / urut berdasarkan deadline terdekat
     */
    static getTugasList() {
        const data = loadData();
        let tugas = data.daftar_tugas || [];

        if (tugas.length === 0) {
            return { count: 0, list: [] };
        }

        // Urutkan berdasarkan deadline terdekat
        tugas.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

        const nowWIB = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
        nowWIB.setHours(0, 0, 0, 0);

        const formattedList = tugas.map((t, idx) => {
            const targetDate = new Date(t.deadline);
            targetDate.setHours(0, 0, 0, 0);
            const sisaHari = Math.round((targetDate - nowWIB) / (1000 * 60 * 60 * 24));
            const sisaTeks = sisaHari < 0 ? "*(TERLEWAT)*" : sisaHari === 0 ? "*(HARI INI)*" : sisaHari === 1 ? "*(H-1/BESOK)*" : sisaHari === 2 ? "*(H-2)*" : `(${sisaHari} hari lagi)`;
            
            return {
                nomor: idx + 1,
                matkul: t.matkul,
                deskripsi: t.deskripsi,
                deadline: t.deadline,
                sisaHari,
                sisaTeks
            };
        });

        return { count: formattedList.length, list: formattedList };
    }

    /**
     * Menambahkan tugas baru
     * @param {string} matkul 
     * @param {string} deskripsi 
     * @param {string} deadline - Format YYYY-MM-DD
     */
    static addTugas(matkul, deskripsi, deadline) {
        let data = loadData();
        if (!data.daftar_tugas) data.daftar_tugas = [];

        data.daftar_tugas.push({
            matkul: matkul.trim(),
            deskripsi: deskripsi.trim(),
            deadline: deadline.trim()
        });
        saveData(data);

        return { success: true, message: `✅ Tugas *${matkul}* berhasil dicatat dengan deadline ${deadline}.` };
    }

    /**
     * Menghapus tugas berdasarkan nomor urut (1-indexed)
     * @param {number} nomor 
     */
    static deleteTugas(nomor) {
        let data = loadData();
        if (!data.daftar_tugas || data.daftar_tugas.length === 0) {
            return { success: false, message: "Daftar tugas sedang kosong." };
        }

        data.daftar_tugas.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
        
        if (isNaN(nomor) || nomor < 1 || nomor > data.daftar_tugas.length) {
            return { success: false, message: `Nomor tugas tidak valid. Total tugas saat ini: ${data.daftar_tugas.length}` };
        }

        const tugasDihapus = data.daftar_tugas.splice(nomor - 1, 1)[0];
        saveData(data);

        return { success: true, message: `✅ Tugas *${tugasDihapus.matkul}* telah berhasil dihapus dari daftar.`, deletedTask: tugasDihapus };
    }

    /**
     * Mengambil tugas yang mendesak (H-0 s.d. H-2) untuk auto-reminder sore
     */
    static getUrgentTugas() {
        const data = loadData();
        const tugas = data.daftar_tugas || [];
        if (tugas.length === 0) return [];

        const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
        const hrIniStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, '0') + "-" + String(now.getDate()).padStart(2, '0');
        
        const besok = new Date(now);
        besok.setDate(besok.getDate() + 1);
        const besokTgl = besok.getFullYear() + "-" + String(besok.getMonth() + 1).padStart(2, '0') + "-" + String(besok.getDate()).padStart(2, '0');

        const lusa = new Date(now);
        lusa.setDate(lusa.getDate() + 2);
        const lusaTgl = lusa.getFullYear() + "-" + String(lusa.getMonth() + 1).padStart(2, '0') + "-" + String(lusa.getDate()).padStart(2, '0');

        return tugas.filter(t => t.deadline === hrIniStr || t.deadline === besokTgl || t.deadline === lusaTgl).map(t => {
            const sisa = t.deadline === hrIniStr ? "*(HARI INI!)*" : (t.deadline === besokTgl ? "*(H-1/BESOK)*" : "*(H-2)*");
            return { ...t, statusLabel: sisa };
        });
    }
}

module.exports = TaskService;
