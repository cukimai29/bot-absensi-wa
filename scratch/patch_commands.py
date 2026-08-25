import re
import os

filepath = r"c:\Users\chici\Downloads\botwaku\src\commands.js"

with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Imports
content = content.replace(
    'const { MessageMedia, Poll } = require("whatsapp-web.js");',
    'const { downloadMediaMessage, generateWAMessageFromContent } = require("@whiskeysockets/baileys");'
)

# 2. Shim
shim = """async function handleMessage(client, rawMsg) {
  if (!rawMsg.message) return;
  const _chatId = rawMsg.key.remoteJid;
  const _senderId = rawMsg.key.participant || rawMsg.key.remoteJid;
  const _isGroup = _chatId.endsWith('@g.us');

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
              try { bodyText = JSON.parse(paramsJson).id; } catch(e) {}
          }
      }
  }

  const msg = {
      from: _chatId,
      author: _senderId,
      body: bodyText,
      timestamp: rawMsg.messageTimestamp,
      hasMedia: !!(rawMsg.message && (rawMsg.message.imageMessage || rawMsg.message.videoMessage || rawMsg.message.documentMessage)),
      hasQuotedMsg: !!(rawMsg.message?.extendedTextMessage?.contextInfo?.quotedMessage),
      
      reply: async (content) => {
          if (typeof content === 'string') {
              return await client.sendMessage(_chatId, { text: content }, { quoted: rawMsg });
          } else {
              return await client.sendMessage(_chatId, content, { quoted: rawMsg });
          }
      },
      
      getChat: async () => {
          return {
              isGroup: _isGroup,
              sendStateTyping: async () => await client.sendPresenceUpdate('composing', _chatId),
              clearState: async () => await client.sendPresenceUpdate('paused', _chatId),
              participants: _isGroup ? (await client.groupMetadata(_chatId)).participants : []
          };
      },
      
      downloadMedia: async () => {
          const buffer = await downloadMediaMessage(rawMsg, 'buffer', {}, { logger: require('pino')({level:'silent'})});
          let mimetype = rawMsg.message?.imageMessage?.mimetype || rawMsg.message?.videoMessage?.mimetype || rawMsg.message?.documentMessage?.mimetype;
          return { data: buffer.toString('base64'), mimetype: mimetype };
      },
      
      getQuotedMessage: async () => {
          if (!msg.hasQuotedMsg) return null;
          const quoted = rawMsg.message.extendedTextMessage.contextInfo.quotedMessage;
          return {
              body: quoted.conversation || quoted.extendedTextMessage?.text || quoted.imageMessage?.caption || '',
              hasMedia: !!(quoted.imageMessage || quoted.videoMessage || quoted.documentMessage),
              downloadMedia: async () => {
                  const fakeMsg = { message: quoted };
                  const buffer = await downloadMediaMessage(fakeMsg, 'buffer', {}, { logger: require('pino')({level:'silent'})});
                  let mimetype = quoted.imageMessage?.mimetype || quoted.videoMessage?.mimetype || quoted.documentMessage?.mimetype;
                  return { data: buffer.toString('base64'), mimetype: mimetype };
              }
          };
      }
  };
"""

content = content.replace("async function handleMessage(client, msg) {", shim)

# 3. MessageMedia replacements
content = content.replace('const media = MessageMedia.fromFilePath(filePath);', 'const media = { document: require("fs").readFileSync(filePath), mimetype: "text/plain", fileName: fileName };')
content = content.replace('const media = MessageMedia.fromFilePath(portalPath);', 'const media = { image: require("fs").readFileSync(portalPath) };')
content = content.replace('const media = new MessageMedia("audio/mp3", base64, "audio.mp3");', 'const media = { audio: Buffer.from(base64, "base64"), ptt: true };')
content = content.replace('await client.sendMessage(msg.from, media, { sendAudioAsVoice: true });', 'await client.sendMessage(msg.from, media);')

content = content.replace('const memeMedia = new MessageMedia("image/png", memeBase64, "meme.png");', 'const memeMedia = { image: Buffer.from(memeBase64, "base64") };')
content = content.replace('const nulisMedia = new MessageMedia(\n        "image/png",\n        nulisBase64,\n        "nulis.png",\n      );', 'const nulisMedia = { image: Buffer.from(nulisBase64, "base64") };')

# 4. .menu buttons injection
menu_replacement = """    const menuPesan = `*MENU SMARTBOT ABSENSI*\\n\\nSilakan pilih menu dari tombol di bawah ini!`;
    const sections = [
        {
            title: "Fitur Umum",
            rows: [
                { title: "📚 Tugas", id: ".tugas" },
                { title: "📅 Jadwal", id: ".jadwal" },
                { title: "🎮 Mini Games", id: ".susunkata" },
                { title: "🌤 Cuaca", id: ".cuaca" }
            ]
        },
        {
            title: "Fitur Sistem",
            rows: [
                { title: "📋 Rekap Absen", id: ".allabsensi" },
                { title: "🤖 Status Bot", id: ".runtime" },
                { title: "👑 Owner", id: ".owner" }
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

    const msgObj = generateWAMessageFromContent(msg.from, menuMessage, { userJid: msg.from });
    await client.relayMessage(msg.from, msgObj.message, { messageId: msgObj.key.id });
"""

content = re.sub(r'const menuPesan =[\s\S]*?msg\.reply\(menuPesan\);', menu_replacement, content)

# 5. Owner contact replacement
owner_replacement = """      const vcard = 'BEGIN:VCARD\\n' +
            'VERSION:3.0\\n' + 
            'FN:RzkyAds\\n' +
            'ORG:Owner Bot;\\n' +
            'TEL;type=CELL;type=VOICE;waid=6285704682918:+62 857-0468-2918\\n' +
            'END:VCARD';
      await client.sendMessage(msg.from, { contacts: { displayName: 'RzkyAds', contacts: [{ vcard }] } });"""
content = re.sub(r'const ownerContact = await client\.getContactById[\s\S]*?await client\.sendMessage\(msg\.from, ownerContact\);', owner_replacement, content)

# 6. Sticker replacement (SAFER REGEX)
sticker_regex = r'await client\.sendMessage\(msg\.from, media, \{\s*sendMediaAsSticker:\s*true,\s*stickerName:\s*"Bot Stiker",\s*stickerAuthor:\s*"RzkyAds",?\s*\}\);'
sticker_replacement = """await client.sendMessage(msg.from, { sticker: Buffer.from(media.data, 'base64') });"""
content = re.sub(sticker_regex, sticker_replacement, content)

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)

print("Patching commands.js completed.")
