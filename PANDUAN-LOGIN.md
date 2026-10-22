# Panduan Mengaktifkan Bot dengan Pairing Code

Panduan ini untuk menjalankan bot di VPS Azure (Linux) memakai **pairing code**, jadi tidak perlu scan QR.

> **Penting:**
> - Nomor WhatsApp yang sudah diblokir tidak bisa dipakai lagi. Gunakan nomor baru yang masih aktif dan belum pernah dipakai untuk bot.
> - Nomor baru harus sudah masuk ke grup kelas (`TARGET_GROUP_ID`) sebelum bot dinyalakan. Kalau belum, notifikasi absen tidak bisa dikirim ke grup.

---

## 1. Update kode di VPS

Masuk ke folder bot di VPS, lalu tarik update (sesuaikan nama folder dengan yang ada di VPS; contoh repo ini biasanya `bot-absensi-wa`):

```bash
cd ~/bot-absensi-wa
git pull
npm install
```

> Jangan menjalankan `npm update` atau mengganti versi Baileys. Gunakan versi yang sudah dipin di `package.json` (commit 1.2.9). Kalau tidak ada perubahan dependency, `npm install` boleh dilewati.

Jika VPS tidak terhubung ke GitHub, upload file `index.js`, `package.json`, `ecosystem.config.js`, dan folder `scripts/` secara manual.

---

## 2. Hentikan bot dan reset sesi lama

> **Penting:** langkah ini hanya untuk nomor baru atau sesi lama yang sudah tidak valid. Kalau nomor baru sudah berhasil paired dan sesi masih valid, **jangan** jalankan `npm run reset-session`. Cukup `pm2 restart botwaku`.

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
- Untuk nomor luar Indonesia, isi `PAIRING_COUNTRY_CODE` sesuai kode negara (contoh `63` untuk Filipina) dan `PAIRING_NUMBER` dengan kode negara lengkap, misalnya `639123456789`.
- Script `scripts/pair-new-number.sh` sudah menanyakan kode negara dan nomor lokal, jadi tidak perlu edit manual.
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
| Log penuh `writer Timeout` / `writer Connection Closed` | Ada pengiriman ke grup yang writer-nya macet. Pastikan grup bermasalah ada di `COMMAND_BLOCKED_GROUPS`, `COMMAND_ALLOWED_GROUPS` hanya berisi grup kelas/testing, dan `SAFE_MODE=true`. Restart bot setelah mengubah `.env`. |
| Nomor baru langsung diblokir | Nomor baru perlu "pemanasan". Jangan langsung kirim pesan massal. Lihat bagian di bawah. |

---

## 8. Tips agar nomor baru tidak cepat diblokir

WhatsApp membatasi akun yang mengirim pesan otomatis dalam jumlah besar, apalagi dengan tag massal (hidetag).

- Jangan langsung menjalankan semua pengumuman otomatis setelah login pertama.
- Biarkan nomor "hidup" dulu 24-48 jam: chat normal, simpan kontak, masuk grup secara manual.
- Hindari tag semua anggota grup terlalu sering.
- Reminder subuh sudah dihapus. Reminder tugas dan morning briefing masih memakai hidetag; sebaiknya kurangi frekuensinya.
- Jangan menjalankan dua bot dengan nomor yang sama.
- HP nomor bot harus tetap online dan terhubung internet karena WhatsApp Web/Baileys bekerja sebagai perangkat tertaut.
- Untuk kebutuhan pengumuman massal yang resmi, pertimbangkan WhatsApp Business Cloud API.

Kalau mau, fitur hidetag otomatis bisa dinonaktifkan atau dijadwalkan ulang agar lebih aman untuk nomor baru.

---

## 9. Kalau absensi tidak terkirim

Cek log saat jam kelas. Kalau berulang seperti ini:

```text
[INTENSIF] Tombol notifikasi tidak muncul dalam 15s (URL: ...)
[INTENSIF] [DIAG] login=true ...
[INTENSIF] Login gagal: masih di halaman login...
```

berarti scraper tidak berhasil masuk ke ETHOL, atau selector halaman portal berubah.

Jalankan diagnosa manual (tidak mengirim WhatsApp dan tidak mencatat absensi):

```bash
npm run diagnose-portal
```

Untuk akun kedua:

```bash
npm run diagnose-portal -- second
```

Perhatikan baris `[DIAG]`:

- `login=true` atau URL masih `login.pens.ac.id` -> username/password salah, akun terkunci, atau portal meminta captcha.
- `login=false` tetapi `snippet`/`dosen` kosong -> notifikasi tidak muncul di beranda; pastikan akun terdaftar di matkul tersebut.
- `snippet` berisi teks notifikasi tetapi bot tidak mendeteksi -> kirim teks snippet-nya. Polanya sekarang menerima `presensi`/`absensi` dan `matakuliah`/`mata kuliah`.

Screenshot diagnosa disimpan sebagai `debug_diag.png` atau `debug_diag_login.png` di folder bot.

Jalankan diagnosa di luar jam kelas agar tidak berebut RAM/Chrome dengan pengecekan otomatis.

### 9.1. `RAM tersedia hanya ... Chrome tidak diluncurkan`

Log seperti ini bukan error login. Chrome sengaja tidak dibuka karena RAM VPS
di bawah `MIN_FREE_MEMORY_MB`:

```text
[ETHOL SYNC] Gagal membuka browser: RAM tersedia hanya 293 MB (minimum 300 MB).
Chrome tidak diluncurkan agar tidak OOM.
```

Di VPS 892 MB, tambahkan swap 1 GB terlebih dahulu. Swap mencegah Chrome
membunuh proses lain saat memori memuncak.

```bash
free -m
swapon --show

# Lewati tiga baris ini kalau /swapfile sudah ada.
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile

sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
free -m
```

Setelah swap aktif, turunkan batas RAM Chrome dan restart:

```bash
cd ~/bot-absensi-wa
cp .env .env.backup-before-ram-tune
sed -i 's/^MIN_FREE_MEMORY_MB=.*/MIN_FREE_MEMORY_MB=220/' .env
grep -E 'MIN_FREE_MEMORY_MB|PUPPETEER_MEMORY_WAIT_MS' .env
pm2 restart botwaku --update-env
```

Chrome sekarang menunggu sampai 30 detik (`PUPPETEER_MEMORY_WAIT_MS`) kalau
RAM sedang pas-pasan. Jangan turunkan `MIN_FREE_MEMORY_MB` tanpa swap; risikonya
proses lain dibunuh OOM killer. Kalau setelah swap + 220 MB masih sering gagal,
upgrade VPS ke RAM 2 GB.

---

## 10. Kalau muncul "writer Timeout"

Log seperti ini:

```text
Error: 120363xxxxxxxxxx@g.us writer Timeout
Error: 120363xxxxxxxxxx@g.us writer Connection Closed
```

artinya bot mencoba mengirim pesan ke grup tersebut, tetapi antrean tulis (writer) Baileys macet. Karena writer dipakai bersama, pengiriman berikutnya ikut gagal dan koneksi akhirnya ditutup (428/503).

Penyebab yang paling sering:

1. Ada command media (stiker, audio, dokumen, gambar) dari grup yang tidak dikenal.
2. `COMMAND_ALLOWED_GROUPS` kosong, sehingga semua grup bisa memicu command.
3. Retry otomatis terus mencoba mengirim ke grup yang sama saat writer masih macet.

Yang sudah diperbaiki di kode:

- Saat `SAFE_MODE=true` dan `COMMAND_ALLOWED_GROUPS` kosong, bot hanya memproses `TARGET_GROUP_ID` dan `BUTTONS_TEST_GROUP_ID`.
- Grup `120363318879953960@g.us` selalu masuk daftar blokir.
- Semua media diblokir saat `SAFE_MODE=true` (`SAFE_MODE_BLOCK_MEDIA=true`).
- Retry pengiriman berhenti total saat error `writer Timeout` / `Connection Closed`.
- `msg.reply` tidak lagi mengirim ulang pesan yang gagal.

Cek log startup:

```text
[CONFIG] Effective allowed groups=...
[CONFIG] COMMAND_BLOCKED_GROUPS=...
[SECURITY] Patch Baileys aktif ...
```

Kalau `Effective allowed groups=NONE`, isi `TARGET_GROUP_ID` atau `COMMAND_ALLOWED_GROUPS` dengan benar.

---

## 11. Keamanan

- Jangan bagikan file `.env` karena berisi password ETHOL dan API key.
- Jangan bagikan folder `session/` karena berisi kredensial WhatsApp.
- Simpan backup `session.backup-...` di tempat aman, atau hapus kalau sudah yakin tidak diperlukan.
