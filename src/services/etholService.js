const puppeteer = require("puppeteer");
const { catatAbsen } = require("../core/database");

let useSecondAccount = false;

/**
 * Service untuk mengelola Otomatisasi Presensi Ethol PENS
 */
class EtholService {
  /**
   * Mendapatkan nama akun CAS yang digunakan terakhir kali
   */
  static getLastUsedAccount() {
    if (useSecondAccount) {
      return process.env.ETHOL_USERNAME;
    } else {
      return process.env.ETHOL_USERNAME_2 || process.env.ETHOL_USERNAME;
    }
  }

  /**
   * Mengirim notifikasi presensi ke grup WhatsApp
   */
  static async announceAbsen(client, groupId, matkul, tanggal) {
    if (!client || !groupId) return;
    const fakeVerif = {
      key: {
        id: "12345678901234567890123456789012",
        fromMe: false,
        participant: "0@s.whatsapp.net",
        remoteJid: groupId,
      },
      message: { conversation: "SMARTBOT by RzkyAds" },
    };

    try {
      const text = `🚨 *ATTENTION PLEASE!* 🚨\n\nAbsensi untuk matkul *${matkul}* udah dibuka nih di ETHOL! 🔥\n\nBuruan diabsen yaa kawan-kawan, jangan sampai lupa apalagi nunggu mepet! Ingat, alpha menumpuk = SP di depan mata! 💀🏃‍♂️💨\n\n📅 Tanggal: ${tanggal}`;
      const metadata = await client.groupMetadata(groupId);
      const mentions = metadata.participants.map((p) => p.id);

      await client.sendMessage(
        groupId,
        { text: text, mentions: mentions },
        { quoted: fakeVerif },
      );
    } catch (err) {
      console.error("Gagal mengirim pengumuman absen dengan mentions:", err);
      try {
        const text = `🚨 *ATTENTION PLEASE!* 🚨\n\nAbsensi untuk matkul *${matkul}* udah dibuka nih di ETHOL! 🔥\n\nBuruan diabsen yaa kawan-kawan, jangan sampai lupa apalagi nunggu mepet! Ingat, alpha menumpuk = SP di depan mata! 💀🏃‍♂️💨\n\n📅 Tanggal: ${tanggal}`;
        await client.sendMessage(
          groupId,
          { text: text },
          { quoted: fakeVerif },
        );
      } catch (e) {}
    }
  }

  /**
   * Mengecek portal Ethol secara langsung via Puppeteer
   */
  static async checkPortal(client = null) {
    console.log("🌐 Membuka browser Puppeteer (Headless Mode)...");
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-zygote",
        "--disable-gpu",
      ],
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);

    let username = (process.env.ETHOL_USERNAME || "").trim();
    let password = (process.env.ETHOL_PASSWORD || "").trim();

    if (
      useSecondAccount &&
      process.env.ETHOL_USERNAME_2 &&
      process.env.ETHOL_PASSWORD_2
    ) {
      username = process.env.ETHOL_USERNAME_2.trim();
      password = process.env.ETHOL_PASSWORD_2.trim();
    }

    const activeAccount = username;
    console.log(`Menggunakan Akun CAS PENS: ${activeAccount}`);
    useSecondAccount = !useSecondAccount;

    try {
      console.log("Navigasi ke Halaman Login CAS PENS...");
      await page.goto(
        "https://login.pens.ac.id/cas/login?service=https%3A%2F%2Fethol.pens.ac.id%2Fapi%2Fauth%2Fcas-callback",
        { waitUntil: "domcontentloaded" },
      );

      await page.type("#username", username);
      await page.type("#password", password);

      console.log("Mengirim Form Login & Menunggu Redirect...");
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        page.keyboard.press("Enter"),
      ]);

      console.log("Menuju Beranda Ethol PENS...");
      await page.goto("https://ethol.pens.ac.id/mahasiswa/beranda", {
        waitUntil: "domcontentloaded",
      });
      await new Promise((resolve) => setTimeout(resolve, 3000));

      console.log("Membuka Notifikasi Lonceng Presensi...");
      try {
        const bellButtons = await page.$$('button[aria-label*="otifikasi" i]');
        if (bellButtons.length > 0) {
          for (let btn of bellButtons) {
            try {
              await btn.click();
            } catch (err) {}
          }
        } else {
          throw new Error("Lonceng tidak ditemukan");
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (e) {
        try {
          await page.evaluate(() => {
            const lonceng = document.querySelector(
              '.mdi-bell, .mdi-bell-outline, .v-badge, [class*="bell"], [aria-label*="notifikasi" i]',
            );
            if (lonceng) {
              const tombol = lonceng.closest("button") || lonceng;
              if (tombol) tombol.click();
            }
          });
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (err) {}
      }

      await page.screenshot({ path: "debug_portal.png" });

      console.log("Mengekstraksi Data Absensi Terbuka dari DOM...");
      const daftarAbsenTerbuka = await page.evaluate(() => {
        let hasil = [];
        const pola = "Dosen telah membuka presensi untuk matakuliah";
        const elements = Array.from(
          document.querySelectorAll("div, p, span, li, a"),
        );

        for (let el of elements) {
          if (el.textContent && el.textContent.includes(pola)) {
            const hasChildWithPola = Array.from(el.children).some(
              (child) => child.textContent && child.textContent.includes(pola),
            );
            if (!hasChildWithPola) {
              let teks = el.textContent.replace(/\s+/g, " ").trim();
              if (teks.includes(pola)) {
                let namaMatkul = teks.split(pola)[1].trim();
                let tanggalHariIni = new Date().toLocaleDateString("id-ID");
                if (!hasil.find((h) => h.matkul === namaMatkul)) {
                  hasil.push({ matkul: namaMatkul, tanggal: tanggalHariIni });
                }
              }
            }
          }
        }
        return hasil;
      });

      if (daftarAbsenTerbuka && daftarAbsenTerbuka.length > 0) {
        for (let absen of daftarAbsenTerbuka) {
          let isBaru = catatAbsen(absen.matkul, absen.tanggal);
          if (isBaru && client) {
            await this.announceAbsen(
              client,
              process.env.TARGET_GROUP_ID,
              absen.matkul,
              absen.tanggal,
            );
          }
        }
      }

      console.log(
        `✅ Pengecekan Selesai! Ditemukan ${daftarAbsenTerbuka ? daftarAbsenTerbuka.length : 0} absensi.`,
      );

      return {
        success: true,
        accountUsed: activeAccount,
        openPresensiCount: daftarAbsenTerbuka ? daftarAbsenTerbuka.length : 0,
        openPresensi: daftarAbsenTerbuka || [],
        message:
          daftarAbsenTerbuka && daftarAbsenTerbuka.length > 0
            ? `Ditemukan ${daftarAbsenTerbuka.length} absensi terbuka: ${daftarAbsenTerbuka.map((a) => a.matkul).join(", ")}`
            : "Tidak ada absensi baru yang dibuka oleh dosen saat ini.",
      };
    } catch (error) {
      console.error("Terjadi kesalahan saat mengecek portal:", error);
      return {
        success: false,
        accountUsed: activeAccount,
        error: error.message,
      };
    } finally {
      await browser.close();
    }
  }

  /**
   * Pengecekan intensif 10 menit saat waktu jam kuliah tiba
   */
  static async intensiveCheckPortal(client, targetMatkul) {
    console.log(
      `[INTENSIF] Memulai pengecekan intensif 10 menit untuk matkul: ${targetMatkul}`,
    );
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-zygote",
        "--disable-gpu",
      ],
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(120000);

    let username = (process.env.ETHOL_USERNAME || "").trim();
    let password = (process.env.ETHOL_PASSWORD || "").trim();

    try {
      await page.goto(
        "https://login.pens.ac.id/cas/login?service=https%3A%2F%2Fethol.pens.ac.id%2Fapi%2Fauth%2Fcas-callback",
        { waitUntil: "domcontentloaded" },
      );

      await page.type("#username", username);
      await page.type("#password", password);

      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        page.keyboard.press("Enter"),
      ]);

      await page.goto("https://ethol.pens.ac.id/mahasiswa/beranda", {
        waitUntil: "domcontentloaded",
      });
      await new Promise((resolve) => setTimeout(resolve, 5000));

      let startTime = Date.now();
      const MAX_DURATION = 10 * 60 * 1000;
      let absenFound = false;

      while (Date.now() - startTime < MAX_DURATION && !absenFound) {
        console.log(`[INTENSIF] Me-refresh halaman portal...`);
        await page.reload({ waitUntil: "domcontentloaded" });
        await new Promise((resolve) => setTimeout(resolve, 5000));

        try {
          const bellButtons = await page.$$(
            'button[aria-label*="otifikasi" i]',
          );
          if (bellButtons.length > 0) {
            for (let btn of bellButtons) {
              try {
                await btn.click();
              } catch (err) {}
            }
          } else {
            throw new Error("Lonceng tidak ditemukan");
          }
          await new Promise((resolve) => setTimeout(resolve, 3000));
        } catch (e) {
          try {
            await page.evaluate(() => {
              const lonceng = document.querySelector(
                '.mdi-bell, .mdi-bell-outline, .v-badge, [class*="bell"], [aria-label*="notifikasi" i]',
              );
              if (lonceng) {
                const tombol = lonceng.closest("button") || lonceng;
                if (tombol) tombol.click();
              }
            });
            await new Promise((resolve) => setTimeout(resolve, 3000));
          } catch (err) {}
        }

        const daftarAbsenTerbuka = await page.evaluate(() => {
          let hasil = [];
          const pola = "Dosen telah membuka presensi untuk matakuliah";
          const elements = Array.from(
            document.querySelectorAll("div, p, span, li, a"),
          );

          for (let el of elements) {
            if (el.textContent && el.textContent.includes(pola)) {
              const hasChildWithPola = Array.from(el.children).some(
                (child) =>
                  child.textContent && child.textContent.includes(pola),
              );
              if (!hasChildWithPola) {
                let teks = el.textContent.replace(/\s+/g, " ").trim();
                if (teks.includes(pola)) {
                  let namaMatkul = teks.split(pola)[1].trim();
                  let tanggalHariIni = new Date().toLocaleDateString("id-ID");
                  if (!hasil.find((h) => h.matkul === namaMatkul)) {
                    hasil.push({ matkul: namaMatkul, tanggal: tanggalHariIni });
                  }
                }
              }
            }
          }
          return hasil;
        });

        if (daftarAbsenTerbuka && daftarAbsenTerbuka.length > 0) {
          for (let absen of daftarAbsenTerbuka) {
            let isBaru = catatAbsen(absen.matkul, absen.tanggal);
            if (isBaru && client) {
              await this.announceAbsen(
                client,
                process.env.TARGET_GROUP_ID,
                absen.matkul,
                absen.tanggal,
              );
              console.log(
                `[INTENSIF] Pengumuman absen ${absen.matkul} berhasil dikirim!`,
              );
              absenFound = true;
            }
          }
        } else {
          console.log(
            `[INTENSIF] Belum ada absen baru... Menunggu 1 menit untuk refresh berikutnya.`,
          );
        }

        if (!absenFound) {
          await new Promise((resolve) => setTimeout(resolve, 52000));
        }
      }

      if (!absenFound) {
        console.log(
          `[INTENSIF] Waktu 10 menit habis, absen untuk kelas ini belum dibuka.`,
        );
      }
    } catch (error) {
      console.error("[INTENSIF] Terjadi kesalahan megecek portal:", error);
    } finally {
      await browser.close();
      console.log(`[INTENSIF] Pengecekan intensif selesai, browser ditutup.`);
    }
  }
}

module.exports = EtholService;
