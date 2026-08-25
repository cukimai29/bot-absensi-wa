const { generateWAMessageFromContent } = require("@whiskeysockets/baileys");

try {
    const msgObj = generateWAMessageFromContent("120363@g.us", { text: "hello" }, { userJid: "120363@g.us" });
    console.log("Success:", msgObj.key);
} catch (err) {
    console.error("CRASH:", err);
}
