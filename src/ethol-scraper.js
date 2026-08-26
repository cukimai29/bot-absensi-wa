const EtholService = require('./services/etholService');

module.exports = {
    checkPortal: (client) => EtholService.checkPortal(client),
    announceAbsen: (client, groupId, matkul, tanggal) => EtholService.announceAbsen(client, groupId, matkul, tanggal),
    getLastUsedAccount: () => EtholService.getLastUsedAccount(),
    intensiveCheckPortal: (client, targetMatkul) => EtholService.intensiveCheckPortal(client, targetMatkul)
};
