require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => {
    console.log('QR Code generated. Please scan it.');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Client is ready!');
    client.sendMessage(undefined, 'Test message')
        .then(() => console.log('Message sent!'))
        .catch(err => {
            console.error('Failed to send message:', err.message);
            process.exit(1);
        });
});

client.initialize();
