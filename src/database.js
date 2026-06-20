const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'absensi_data.json');

// Fungsi untuk memuat database absensi
function loadData() {
    if (!fs.existsSync(DB_PATH)) {
        return { minggu_ke: 1, jadwal: {} };
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

// Fungsi untuk menyimpan database absensi
function saveData(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Fungsi mencatat absen baru
function catatAbsen(matkul, tanggal) {
    let data = loadData();
    let mingguIni = `minggu_${data.minggu_ke}`;

    if (!data.jadwal[mingguIni]) {
        data.jadwal[mingguIni] = [];
    }

    let sudahAda = data.jadwal[mingguIni].find(a => a.matkul === matkul && a.tanggal === tanggal);
    if (!sudahAda) {
        data.jadwal[mingguIni].push({ matkul, tanggal });
        saveData(data);
        return true; 
    }
    return false;
}

module.exports = { loadData, saveData, catatAbsen };
