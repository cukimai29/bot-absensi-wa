#!/usr/bin/env bash
# Pairing aman untuk nomor WhatsApp baru.
# Jalankan dari root repo: bash scripts/pair-new-number.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "❌ File .env tidak ditemukan di $(pwd)."
  echo "   Salin dulu: cp .env.example .env, lalu isi kredensial ETHOL/Gemini."
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "❌ PM2 tidak ditemukan. Install dulu: npm install -g pm2"
  exit 1
fi

printf "Nomor WhatsApp baru (contoh 6281234567890): "
read -r RAW_NUMBER
NUMBER="$(printf '%s' "$RAW_NUMBER" | tr -cd '0-9')"

if [ "${NUMBER#0}" != "$NUMBER" ]; then
  NUMBER="62${NUMBER#0}"
fi

if ! printf '%s' "$NUMBER" | grep -Eq '^62[0-9]{8,15}$'; then
  echo "❌ Format nomor tidak valid. Gunakan 62xxxxxxxxxx tanpa +, spasi, atau tanda hubung."
  exit 1
fi

MASKED="${NUMBER:0:4}****${NUMBER: -3}"
echo "Nomor bot: $MASKED"
printf "Ketik YA untuk reset session lama, set SAFE_MODE, dan mulai pairing: "
read -r CONFIRM
if [ "$CONFIRM" != "YA" ]; then
  echo "Dibatalkan."
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
cp .env ".env.backup-$STAMP"
echo "✅ Backup .env: .env.backup-$STAMP"

echo "🛑 Menghentikan dan menghapus PM2 lama..."
pm2 stop botwaku >/dev/null 2>&1 || true
pm2 delete botwaku >/dev/null 2>&1 || true

echo "🧹 Reset session WhatsApp lama..."
npm run reset-session

echo "⚙️  Menulis konfigurasi aman ke .env..."
node - "$NUMBER" <<'NODE'
const fs = require('fs');
const number = process.argv[2];
const path = '.env';
let text = fs.readFileSync(path, 'utf8');

const updates = {
  PAIRING_NUMBER: number,
  PAIRING_COUNTRY_CODE: '62',
  ENABLE_BUTTONS: 'false',
  MENU_STYLE: 'buttons',
  SAFE_MODE: 'true',
  SCRAPER_ENABLED: 'false',
};

for (const [key, value] of Object.entries(updates)) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) {
    text = text.replace(re, `${key}=${value}`);
  } else {
    text = text.replace(/\s*$/, '') + `\n${key}=${value}\n`;
  }
}

fs.writeFileSync(path, text);
NODE

echo "🚀 Menjalankan bot..."
pm2 start ecosystem.config.js --update-env
pm2 save

echo ""
echo "⏳ Mencari kode pairing di log (maksimal 60 detik)..."
CODE=""
for _ in $(seq 1 12); do
  sleep 5
  CODE="$(pm2 logs botwaku --lines 200 --nostream 2>/dev/null \
    | sed -r 's/\x1B\[[0-9;]*[mK]//g' \
    | grep -oE 'KODE PAIRING WHATSAPP: [A-Z0-9-]+' \
    | tail -1 || true)"
  if [ -n "$CODE" ]; then
    break
  fi
done

if [ -z "$CODE" ]; then
  echo "⚠️  Kode pairing belum muncul. Cek manual:"
  echo "   pm2 logs botwaku --lines 100"
  exit 0
fi

echo ""
echo "=================================================="
echo "  $CODE"
echo "=================================================="
echo "Nomor bot: $MASKED"
echo ""
echo "Di HP nomor baru: WhatsApp > Perangkat Tertaut > Tautkan Perangkat"
echo "> Tautkan dengan nomor telepon > masukkan kode di atas."
echo ""
echo "Setelah masuk, cek: pm2 logs botwaku --lines 100"
echo "Harus muncul: Bot WhatsApp sudah siap dan terhubung!"
echo ""
echo "Setelah pairing berhasil, biarkan nomor warm-up dulu."
echo "Jangan langsung set SAFE_MODE=false atau ENABLE_BUTTONS=true."
