const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');

// Anti-Spam Cooldown Storage
const userCooldowns = new Map();
const COOLDOWN_MS = 2500;

// Memory Percakapan Pasif (Context Window 15 pesan terakhir)
const chatMemory = new Map();

/**
 * Normalisasi pesan Baileys ke format Objek Pesan standar
 */
function normalizeMessage(client, rawMsg) {
    const _chatId = rawMsg.key.remoteJid;
    const _isGroup = _chatId.endsWith('@g.us');
    const _senderId = _isGroup ? (rawMsg.key.participant || rawMsg.participant) : _chatId;

    let bodyText = '';
    if (rawMsg.message) {
        if (rawMsg.message.conversation) bodyText = rawMsg.message.conversation;
        else if (rawMsg.message.extendedTextMessage) bodyText = rawMsg.message.extendedTextMessage.text;
        else if (rawMsg.message.imageMessage) bodyText = rawMsg.message.imageMessage.caption || '';
        else if (rawMsg.message.videoMessage) bodyText = rawMsg.message.videoMessage.caption || '';
        else if (rawMsg.message.buttonsResponseMessage) bodyText = rawMsg.message.buttonsResponseMessage.selectedButtonId;
        else if (rawMsg.message.listResponseMessage) bodyText = rawMsg.message.listResponseMessage.singleSelectReply.selectedRowId;
        else if (rawMsg.message.templateButtonReplyMessage) bodyText = rawMsg.message.templateButtonReplyMessage.selectedId;
        else if (rawMsg.message.interactiveResponseMessage) {
            const paramsJson = rawMsg.message.interactiveResponseMessage.nativeFlowResponseMessage?.paramsJson;
            if (paramsJson) {
                try { bodyText = JSON.parse(paramsJson).id; } catch (e) { }
            }
        }
    }

    const fakeVerif = {
        key: {
            id: '12345678901234567890123456789012',
            fromMe: false,
            participant: '0@s.whatsapp.net',
            ...(rawMsg.key.remoteJid ? { remoteJid: rawMsg.key.remoteJid } : {})
        },
        message: { conversation: "SMARTBOT by RzkyAds" }
    };

    const msg = {
        raw: rawMsg,
        from: _chatId,
        author: _senderId,
        body: bodyText,
        isGroup: _isGroup,
        timestamp: rawMsg.messageTimestamp,
        hasMedia: !!(rawMsg.message && (rawMsg.message.imageMessage || rawMsg.message.videoMessage || rawMsg.message.documentMessage)),
        hasQuotedMsg: !!(rawMsg.message?.extendedTextMessage?.contextInfo?.quotedMessage),

        reply: async (content) => {
            const options = _isGroup ? { quoted: fakeVerif } : {};
            if (typeof content === 'string') {
                return await client.sendMessage(_chatId, { text: content }, options);
            } else {
                return await client.sendMessage(_chatId, content, options);
            }
        },

        react: async (emoji) => {
            return await client.sendMessage(_chatId, { react: { text: emoji, key: rawMsg.key } }).catch(() => {});
        },

        getChat: async () => {
            return {
                isGroup: _isGroup,
                sendStateTyping: async () => {
                    if (_isGroup) {
                        await client.sendPresenceUpdate('available', _chatId).catch(() => {});
                        await client.sendPresenceUpdate('composing', _chatId).catch(() => {});
                    }
                },
                clearState: async () => {
                    if (_isGroup) await client.sendPresenceUpdate('paused', _chatId).catch(() => {});
                },
                participants: _isGroup ? (await client.groupMetadata(_chatId)).participants : []
            };
        },

        downloadMedia: async () => {
            const buffer = await downloadMediaMessage(rawMsg, 'buffer', {}, { logger: pino({ level: 'silent' }) });
            let mimetype = rawMsg.message?.imageMessage?.mimetype || rawMsg.message?.videoMessage?.mimetype || rawMsg.message?.documentMessage?.mimetype;
            return { data: buffer.toString('base64'), mimetype: mimetype };
        },

        getQuotedMessage: async () => {
            if (!msg.hasQuotedMsg) return null;
            const contextInfo = rawMsg.message.extendedTextMessage.contextInfo;
            const quoted = contextInfo.quotedMessage;
            let botJid = client.user.id.split(':')[0] + '@s.whatsapp.net';
            let isQuotedFromMe = contextInfo.participant === botJid;
            
            return {
                body: quoted.conversation || quoted.extendedTextMessage?.text || quoted.imageMessage?.caption || '',
                hasMedia: !!(quoted.imageMessage || quoted.videoMessage || quoted.documentMessage),
                fromMe: isQuotedFromMe,
                downloadMedia: async () => {
                    const fakeMsg = { message: quoted };
                    const buffer = await downloadMediaMessage(fakeMsg, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                    let mimetype = quoted.imageMessage?.mimetype || quoted.videoMessage?.mimetype || quoted.documentMessage?.mimetype;
                    return { data: buffer.toString('base64'), mimetype: mimetype };
                }
            };
        }
    };

    return msg;
}

module.exports = { normalizeMessage, chatMemory, userCooldowns, COOLDOWN_MS };
