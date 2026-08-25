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
                interactiveMessage: proto.Message.InteractiveMessage.create({
                    body: proto.Message.InteractiveMessage.Body.create({ text: menuPesan }),
                    footer: proto.Message.InteractiveMessage.Footer.create({ text: "SmartBot Absensi" }),
                    header: proto.Message.InteractiveMessage.Header.create({
                        title: "PILIH MENU",
                        hasMediaAttachment: false
                    }),
                    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                        buttons: [{
                            name: "single_select",
                            buttonParamsJson: JSON.stringify({
                                title: "Buka Menu",
                                sections: sections
                            })
                        }]
                    })
                })
            }
        }
    };

    const msgObj = generateWAMessageFromContent("120363@g.us", menuMessage, { userJid: "628123456789@s.whatsapp.net" });
    console.log("Success:", JSON.stringify(msgObj, null, 2));
} catch (err) {
    console.error("CRASH:", err);
}
