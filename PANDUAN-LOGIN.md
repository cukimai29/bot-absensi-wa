# Panduan Mengaktifkan Bot dengan Pairing Code

Panduan ini untuk menjalankan bot di VPS Azure (Linux) memakai **pairing code**, jadi tidak perlu scan QR.

> **Penting:**
> - Nomor WhatsApp yang sudah diblokir tidak bisa dipakai lagi. Gunakan nomor baru yang masih aktif dan belum pernah dipakai untuk bot.
> - Nomor baru harus sudah masuk ke grup kelas (`TARGET_GROUP_ID`) sebelum bot dinyalakan. Kalau belum, notifikasi absen tidak bisa dikirim ke grup.

---

## 1. Update kode di VPS

Masuk ke folder bot di VPS, lalu tarik update:

```bash
cd ~/botwaku
git pull
npm install
```

Jika VPS tidak terhubung ke GitHub, upload file `index.js`, `package.json`, `ecosystem.config.js`, dan folder `scripts/` secara manual.

---

## 2. Hentikan bot dan reset sesi lama

Sesi lama masih menyimpan kredensial nomor yang sudah diblokir. Sesi ini **harus** dibuang.

```bash
pm2 stop botwaku
npm run reset-session
```

Perintah di atas memindahkan folder `session/` menjadi `session.backup-...`, bukan menghapus permanen. Jadi masih bisa dikembalikan kalau diperlukan.

Kalau `npm run reset-session` belum ada (kode lama), gunakan cara manual:

```bash
mv session session.backup-lama
```

---

## 3. Isi nomor bot di `.env`

Buka file `.env`:

```bash
nano .env
```

Tambahkan baris berikut (sesuaikan nomornya):

```env
PAIRING_NUMBER=6281234567890
PAIRING_COUNTRY_CODE=62
```

Aturan penulisan:

- Gunakan format internasional, contoh `6281234567890`.
- Jangan pakai `+`, spasi, atau tanda hubung.
- Kalau nomor ditulis `081234567890`, kode akan otomatis mengubahnya menjadi `6281234567890` selama `PAIRING_COUNTRY_CODE=62`.
- Nomor harus nomor WhatsApp yang aktif di HP.

Simpan dengan `Ctrl+O`, lalu `Enter`, lalu keluar dengan `Ctrl+X`.

---

## 4. Jalankan bot lewat PM2

Cek dulu proses apa yang sedang terdaftar:

```bash
pm2 list
```

Hapus proses lama (sesuaikan namanya dengan yang muncul di `pm2 list`):

```bash
pm2 delete botwaku
```

Kalau PM2 bilang proses tidak ditemukan, lanjut saja. Lalu start dengan konfigurasi baru:

```bash
pm2 start ecosystem.config.js
```

Lihat log untuk mendapatkan kode pairing:

```bash
pm2 logs botwaku --lines 100
```

Tunggu sampai muncul tulisan seperti ini:

```text
==================================================
   KODE PAIRING WHATSAPP: ABCD-EFGH
==================================================
Nomor bot: 6281****890
```

Kode hanya berlaku sekitar **60 detik**. Jika kedaluwarsa, restart bot untuk mendapatkan kode baru:

```bash
pm2 restart botwaku
pm2 logs botwaku --lines 100
```

---

## 5. Masukkan kode di HP

Di HP yang memakai nomor bot:

1. Buka **WhatsApp**.
2. Masuk ke **Pengaturan** (Settings).
3. Pilih **Perangkat Tertaut** (Linked Devices).
4. Ketuk **Tautkan Perangkat** (Link a Device).
5. Pilih **Tautkan dengan nomor telepon** (Link with phone number instead).
6. Masukkan kode 8 digit dari log, contoh `ABCDEFGH` atau `ABCD-EFGH`.

Setelah berhasil, log akan menampilkan:

```text
Bot WhatsApp sudah siap dan terhubung!
```

Simpan konfigurasi PM2 agar otomatis jalan saat VPS reboot:

```bash
pm2 save
pm2 startup
```

Ikuti perintah `sudo` yang ditampilkan PM2 (kalau ada).

---

## 6. Kalau ingin kembali memakai QR

Kosongkan atau beri komentar pada `PAIRING_NUMBER` di `.env`:

```env
# PAIRING_NUMBER=6281234567890
```

Lalu reset sesi dan restart:

```bash
pm2 stop botwaku
npm run reset-session
pm2 restart botwaku
pm2 logs botwaku --lines 100
```

QR akan muncul di log. Scan dari WhatsApp > Perangkat Tertaut.

---

## 7. Troubleshooting

| Masalah | Solusi |
|---|---|
| Kode pairing tidak muncul | Tunggu 10-20 detik, lalu lihat `pm2 logs botwaku --lines 100`. Pastikan `PAIRING_NUMBER` terisi. |
| `PAIRING_NUMBER tidak valid` | Gunakan format `628xxxxxxxxxx`, tanpa `+`, spasi, atau tanda hubung. |
| Kode kedaluwarsa | `pm2 restart botwaku`, lalu ambil kode baru. |
| `Sesi ditolak WhatsApp (logged out / nomor diblokir)` | Sesi lama masih ada. Jalankan `npm run reset-session`, pastikan memakai nomor baru, lalu restart. |
| `waitForSocketOpen` gagal / timeout | Cek internet VPS: `curl -I https://web.whatsapp.com`. Restart bot. |
| `pm2: command not found` | Install PM2: `npm install -g pm2`. |
| Bot connect lalu langsung putus berulang | Hapus sesi, pastikan hanya satu instance bot yang jalan: `pm2 list`. |
| Nomor baru langsung diblokir | Nomor baru perlu "pemanasan". Jangan langsung kirim pesan massal. Lihat bagian di bawah. |

---

## 8. Tips agar nomor baru tidak cepat diblokir

WhatsApp membatasi akun yang mengirim pesan otomatis dalam jumlah besar, apalagi dengan tag massal (hidetag).

- Jangan langsung menjalankan semua pengumuman otomatis setelah login pertama.
- Biarkan nomor "hidup" dulu 24-48 jam: chat normal, simpan kontak, masuk grup secara manual.
- Hindari tag semua anggota grup terlalu sering.
- Reminder subuh, reminder tugas, dan morning briefing saat ini semuanya memakai hidetag. Sebaiknya kurangi atau matikan sementara.
- Jangan menjalankan dua bot dengan nomor yang sama.
- HP nomor bot harus tetap online dan terhubung internet karena WhatsApp Web/Baileys bekerja sebagai perangkat tertaut.
- Untuk kebutuhan pengumuman massal yang resmi, pertimbangkan WhatsApp Business Cloud API.

Kalau mau, fitur hidetag otomatis bisa dinonaktifkan atau dijadwalkan ulang agar lebih aman untuk nomor baru.

---

## 9. Keamanan

- Jangan bagikan file `.env` karena berisi password ETHOL dan API key.
- Jangan bagikan folder `session/` karena berisi kredensial WhatsApp.
- Simpan backup `session.backup-...` di tempat aman, atau hapus kalau sudah yakin tidak diperlukan.
