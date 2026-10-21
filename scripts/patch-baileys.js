const fs = require('fs');
const path = require('path');

const file = path.join(
    __dirname,
    '..',
    'node_modules',
    '@whiskeysockets',
    'baileys',
    'lib',
    'Socket',
    'newsletter.js'
);

if (!fs.existsSync(file)) {
    console.log('[PATCH] File Baileys tidak ditemukan, patch dilewati.');
    process.exit(0);
}

let content = fs.readFileSync(file, 'utf8');
let changed = false;

// Fork Baileys ini otomatis follow channel/newsletter setelah connect.
// Fitur itu bikin timeout dan berisiko membuat nomor baru diblokir.
const autoJoinPattern = /\/\/ Panggil setelah koneksi WA benar-benar open\s*setTimeout\(\(\) => \{\s*console\.log\("Starting auto Connect\.\.\."\);\s*autoJoinNewsletters\(5000\);\s*\}, 5000\);/;

if (autoJoinPattern.test(content)) {
    content = content.replace(
        autoJoinPattern,
        '// Auto-join newsletter dinonaktifkan oleh scripts/patch-baileys.js'
    );
    changed = true;
}

// Security patrol melakukan query newsletter setiap 10 detik.
// Tidak diperlukan untuk bot ini dan menambah beban koneksi.
const securityPatrolPattern = /^\s*startSecurityPatrol\(\)\s*$/m;

if (securityPatrolPattern.test(content)) {
    content = content.replace(
        securityPatrolPattern,
        '    // startSecurityPatrol() dinonaktifkan oleh scripts/patch-baileys.js'
    );
    changed = true;
}

if (changed) {
    fs.writeFileSync(file, content);
    console.log('[PATCH] Fitur auto-join newsletter dan security patrol Baileys dinonaktifkan.');
} else {
    console.log('[PATCH] Baileys sudah dipatch atau pola tidak ditemukan.');
}
