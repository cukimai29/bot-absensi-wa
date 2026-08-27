require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const EtholSyncService = require('../src/services/etholSyncService');
const { loadData } = require('../src/core/database');

async function runSyncTest() {
    console.log('🧪 Memulai Pengujian Sinkronisasi Jadwal dari Ethol PENS...\n');
    try {
        const result = await EtholSyncService.syncScheduleFromEthol();
        console.log('\n====================================================');
        console.log('✅ SINKRONISASI BERHASIL!');
        console.log('====================================================');
        console.log('👤 Akun CAS:', result.accountUsed);
        console.log('📊 Jumlah Matkul Tersimpan:', result.syncedScheduleCount);
        console.log('\n📅 Rincian Jadwal di absensi_data.json:');
        
        const dbData = loadData();
        console.log(JSON.stringify(dbData.daftar_jadwal, null, 2));
        console.log('====================================================\n');
    } catch (err) {
        console.error('❌ Terjadi kesalahan saat pengujian:', err);
    }
}

runSyncTest();
