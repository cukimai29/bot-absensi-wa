const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'absensi_data.json');

// Memuat database lokal JSON
function loadData() {
    if (!fs.existsSync(DB_PATH)) {
        return { minggu_ke: 1, semester: 1, jadwal: {}, daftar_jadwal: {}, daftar_tugas: [], kas_mapping: {} };
    }
    let data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    if (!data.daftar_jadwal) data.daftar_jadwal = {};
    if (!data.daftar_tugas) data.daftar_tugas = [];
    if (!data.kas_mapping) data.kas_mapping = {};
    return data;
}

// Menyimpan database lokal JSON
function saveData(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Mencatat presensi matkul baru
function catatAbsen(matkul, tanggal) {
    let data = loadData();
    let mingguIni = `minggu_${data.minggu_ke}`;

    if (!data.jadwal[mingguIni]) {
        data.jadwal[mingguIni] = [];
    }

    let sudahAda = data.jadwal[mingguIni].find(a => a.matkul === matkul);
    if (!sudahAda) {
        data.jadwal[mingguIni].push({ matkul, tanggal });
        saveData(data);
        return true; 
    }
    return false;
}

module.exports = { loadData, saveData, catatAbsen };
