/**
 * Service Umum (General Service) untuk Informasi Waktu, Hari, dan Tanggal Real-Time (WIB)
 */
class TimeService {
    /**
     * Mengambil rincian waktu, hari, dan tanggal saat ini dalam zona waktu Asia/Jakarta (WIB)
     */
    static getCurrentTimeInfo() {
        const namaHari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const namaBulan = [
            'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
        ];

        // Dapatkan waktu saat ini dalam zona waktu Asia/Jakarta
        const now = new Date();
        const jakartaStr = now.toLocaleString("en-US", { timeZone: "Asia/Jakarta" });
        const jakartaDate = new Date(jakartaStr);

        const dayName = namaHari[jakartaDate.getDay()];
        const dateNum = jakartaDate.getDate();
        const monthName = namaBulan[jakartaDate.getMonth()];
        const yearNum = jakartaDate.getFullYear();

        const hours = String(jakartaDate.getHours()).padStart(2, '0');
        const minutes = String(jakartaDate.getMinutes()).padStart(2, '0');
        const seconds = String(jakartaDate.getSeconds()).padStart(2, '0');

        const isoDate = `${yearNum}-${String(jakartaDate.getMonth() + 1).padStart(2, '0')}-${String(dateNum).padStart(2, '0')}`;
        const formattedDate = `${dateNum} ${monthName} ${yearNum}`;
        const formattedTime = `${hours}:${minutes}:${seconds} WIB`;
        const fullText = `${dayName}, ${formattedDate} Pukul ${hours}:${minutes} WIB`;

        return {
            hari: dayName,
            tanggalNumber: dateNum,
            bulan: monthName,
            tahun: yearNum,
            tanggalFormatted: formattedDate,
            waktuFormatted: formattedTime,
            isoDate: isoDate,
            fullText: fullText
        };
    }
}

module.exports = TimeService;
