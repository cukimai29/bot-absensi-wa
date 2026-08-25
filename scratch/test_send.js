const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');

async function testBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    
    const client = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        auth: state
    });

    client.ev.on('creds.update', saveCreds);

    client.ev.on('connection.update', async (update) => {
        const { connection } = update;
        if (connection === 'open') {
            console.log('Connected! Sending test message...');
            try {
                // Test basic sendMessage with interactiveMessage format
                const menuPesan = `Test message`;
                const sections = [
                    {
                        title: "Fitur Umum",
                        rows: [
                            { title: "📚 Tugas", id: ".tugas" },
                            { title: "📅 Jadwal", id: ".jadwal" }
                        ]
                    }
                ];

                const msg = await client.sendMessage("120363424800769453@g.us", { 
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
                });
                console.log("SUCCESS!", msg);
            } catch (err) {
                console.error("ERROR SENDING:", err);
            }
            process.exit(0);
        }
    });
}

testBot();
