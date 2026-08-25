const { generateWAMessageFromContent, proto } = require("@whiskeysockets/baileys");

try {
    const menuPesan = `Hadirr, siap membantu!\n\nSilakan pilih menu dari tombol di bawah ini!`;
    const sections = [
        {
            title: "Fitur Umum",
            rows: [
                { title: "📚 Tugas", id: ".tugas" },
                { title: "📅 Jadwal", id: ".jadwal" }
            ]
        }
    ];

    const menuMessage = {
        viewOnceMessage: {
            message: {
                messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                interactiveMessage: {
                    body: { text: menuPesan },
                    nativeFlowMessage: {
                        buttons: [{
                            name: "single_select",
                            buttonParamsJson: JSON.stringify({
                                title: "PILIH MENU",
                                sections: sections
                            })
                        }]
                    }
                }
            }
        }
    };

    const msgObj = generateWAMessageFromContent("120363@g.us", menuMessage, { userJid: "628123456789@s.whatsapp.net" });
    console.log("Success:", msgObj.key);
} catch (err) {
    console.error("CRASH:", err);
}
