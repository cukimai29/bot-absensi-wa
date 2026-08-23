const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, 'node_modules', 'whatsapp-web.js', 'src');

function patchDirectory(dir) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            patchDirectory(fullPath);
        } else if (fullPath.endsWith('.js')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let originalContent = content;
            
            // Tangkap variabel sebelum ._serialized dan tambahkan fallback ke .$1
            content = content.replace(/([a-zA-Z0-9_]+)\._serialized/g, function(match, p1) {
                return '(' + p1 + '._serialized || ' + p1 + '.$1)';
            });
            
            if (content !== originalContent) {
                fs.writeFileSync(fullPath, content, 'utf8');
                console.log(`Patched: ${fullPath}`);
            }
        }
    }
}

console.log("Mulai menambal (patching) whatsapp-web.js...");
patchDirectory(targetDir);
console.log("Patch selesai! Silakan jalankan ulang bot Anda.");
