const fs = require("fs");
const os = require("os");
const { loadData } = require("./database");
const { getScraperStatus } = require("./ethol-scraper");

function formatBotUptime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];

  if (days > 0) parts.push(`${days} hari`);
  if (hours > 0) parts.push(`${hours} jam`);
  parts.push(`${minutes} menit`);

  return parts.join(" ");
}

function readSystemMemory() {
  try {
    const meminfo = fs.readFileSync("/proc/meminfo", "utf8");
    const readKb = (key) => {
      const match = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, "m"));
      return match ? Math.floor(Number(match[1]) / 1024) : null;
    };

    return {
      availableMb: readKb("MemAvailable"),
      swapTotalMb: readKb("SwapTotal"),
      swapFreeMb: readKb("SwapFree"),
    };
  } catch (err) {
    return {
      availableMb: Math.floor(os.freemem() / 1024 / 1024),
      swapTotalMb: null,
      swapFreeMb: null,
    };
  }
}

function formatWibDateTime(timestamp) {
  if (!timestamp) return "belum ada";

  try {
    return `${new Date(timestamp).toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })} WIB`;
  } catch (err) {
    return new Date(timestamp).toLocaleString("id-ID");
  }
}

function getTodayNameWib() {
  const days = ["minggu", "senin", "selasa", "rabu", "kamis", "jumat", "sabtu"];
  const todayStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" });
  return days[new Date(todayStr).getDay()];
}

function getAutomationLabel() {
  const isTrue = (value) => String(value || "").trim().toLowerCase() === "true";
  const safeMode = isTrue(process.env.SAFE_MODE);
  const attendanceOnly = isTrue(process.env.ATTENDANCE_ONLY);
  const scraperEnabled = isTrue(process.env.SCRAPER_ENABLED);

  if (!scraperEnabled) return "scraper mati";
  if (safeMode && !attendanceOnly) return "nonaktif (SAFE_MODE)";
  if (attendanceOnly) return "absensi saja";
  return "aktif semua";
}

function buildBotStatusMessage(client) {
  const scraper = getScraperStatus();
  const memory = readSystemMemory();
  const botMemoryMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const botNumber = client?.user?.id
    ? String(client.user.id).split(":")[0].split("@")[0]
    : null;

  let data = { minggu_ke: 1, daftar_jadwal: {}, daftar_tugas: [], jadwal: {} };
  try {
    data = loadData();
  } catch (err) {
    console.error("[STATUS] Gagal membaca database:", err?.message || err);
  }

  const todayName = getTodayNameWib();
  const jadwalHariIni = data.daftar_jadwal?.[todayName];
  const daftarTugas = Array.isArray(data.daftar_tugas) ? data.daftar_tugas : [];
  const tugasBelum = daftarTugas.filter(
    (t) => !String(t.status || "").toLowerCase().includes("selesai"),
  ).length;
  const mingguKe = data.minggu_ke || 1;
  const absenMingguIni = data.jadwal?.[`minggu_${mingguKe}`];
  const jumlahJadwal = Array.isArray(jadwalHariIni) ? jadwalHariIni.length : 0;
  const jumlahAbsen = Array.isArray(absenMingguIni) ? absenMingguIni.length : 0;

  const lines = [
    "📊 *STATUS BOT*",
    "",
    `🟢 WhatsApp: ${botNumber ? `terhubung (${botNumber})` : "terhubung"}`,
    `⏱️ Uptime: ${formatBotUptime(process.uptime())}`,
    `🧠 RAM bot: ${botMemoryMb} MB`,
    `💾 RAM tersedia: ${memory.availableMb !== null ? `${memory.availableMb} MB` : "tidak diketahui"}`,
  ];

  if (memory.swapTotalMb !== null && memory.swapTotalMb > 0) {
    const swapUsed = Math.max(0, memory.swapTotalMb - (memory.swapFreeMb || 0));
    lines.push(`🔄 Swap: ${swapUsed} / ${memory.swapTotalMb} MB`);
  } else {
    lines.push("🔄 Swap: tidak aktif");
  }

  const chromeInfo = scraper.activeBrowsers > 0
    ? ` (${scraper.activeBrowsers} Chrome)`
    : "";
  lines.push(
    `🕷️ Scraper: ${scraper.busy ? "sibuk" : "idle"}${chromeInfo}`,
    `🔁 Sync ETHOL: ${formatWibDateTime(scraper.lastSyncAt)}${scraper.lastSyncOk === true ? " — berhasil" : scraper.lastSyncOk === false ? " — gagal" : ""}`,
  );

  if (scraper.lastSyncOk === false && scraper.lastSyncError) {
    lines.push(
      `⚠️ Error sync: ${String(scraper.lastSyncError).replace(/\s+/g, " ").slice(0, 140)}`,
    );
  }

  lines.push(
    `📚 Jadwal hari ini: ${jumlahJadwal} kelas`,
    `📝 Tugas belum selesai: ${tugasBelum}`,
    `✅ Absen minggu ke-${mingguKe}: ${jumlahAbsen} matkul`,
    `⚙️ Otomatisasi: ${getAutomationLabel()}`,
    "",
    "_Khusus admin/owner bot._",
  );

  return lines.join("\n");
}

module.exports = { buildBotStatusMessage };
