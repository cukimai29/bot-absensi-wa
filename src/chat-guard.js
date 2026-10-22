// Guard terpusat untuk chat/grup dan pengiriman pesan.
// Tujuan utama:
// 1. Saat SAFE_MODE, grup di luar allowlist tidak diproses sama sekali (fail-closed).
// 2. Grup yang pernah memicu "writer Timeout" selalu diblokir.
// 3. Media tidak dikirim saat SAFE_MODE agar writer Baileys tidak macet.
// 4. Error writer/koneksi dikenali sebagai fatal supaya tidak di-retry berulang.

const DEFAULT_BLOCKED_GROUPS = ['120363318879953960@g.us'];

const MEDIA_KEYS = ['image', 'video', 'audio', 'document', 'sticker', 'contacts'];

// Perintah yang mengirim media, dokumen, kontak, atau memicu pengiriman massal.
// Saat SAFE_MODE perintah-perintah ini tidak dijalankan sama sekali.
const SAFE_MODE_BLOCKED_COMMANDS = new Set([
    '.testabsen',
    '.testkas',
    '.hidetag',
    '.testnotif',
    '.cekportal',
    '.allabsensi',
    '.suara',
    '.tebaklagu',
    '.stiker',
    '.sticker',
    '.meme',
    '.nulis',
    '.owner',
]);

const FATAL_SEND_ERROR_PATTERNS = [
    'writer timeout',
    'writer connection closed',
    'connection closed',
    'connection failure',
    'socket closed',
    'stream errored',
    'not-authorized',
    'forbidden',
    'item-not-found',
    'logged out',
    'conflict',
    'sendmessage timeout',
];

function readBool(name, defaultValue = false) {
    const raw = String(process.env[name] || '').trim().toLowerCase();
    if (!raw) return defaultValue;
    return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

function isSafeModeEnabled() {
    return readBool('SAFE_MODE', false);
}

function isSafeModeMediaBlocked() {
    return readBool('SAFE_MODE_BLOCK_MEDIA', true);
}

function isSafeModeReactionsEnabled() {
    return readBool('SAFE_MODE_REACTIONS', false);
}

function areReactionsEnabled() {
    return isSafeModeEnabled() ? isSafeModeReactionsEnabled() : true;
}

function parseIdList(raw) {
    return String(raw || '')
        .split(/[\s,;]+/)
        .map((id) => id.trim())
        .filter(Boolean);
}

function isValidGroupJid(id) {
    return /^\d+@g\.us$/.test(String(id || '').trim());
}

function getConfiguredAllowedGroups() {
    return parseIdList(process.env.COMMAND_ALLOWED_GROUPS).filter(isValidGroupJid);
}

function getBlockedGroups() {
    // Daftar dari .env bersifat tambahan. Grup pemicu writer timeout selalu
    // diblokir agar tidak bisa aktif lagi hanya karena salah edit .env.
    const configured = parseIdList(process.env.COMMAND_BLOCKED_GROUPS).filter(isValidGroupJid);
    return Array.from(new Set([...DEFAULT_BLOCKED_GROUPS, ...configured]));
}

function isBlockedGroup(chatId) {
    const id = String(chatId || '').trim();
    if (!id) return false;
    return getBlockedGroups().includes(id);
}

function getEffectiveAllowedGroups() {
    const configured = getConfiguredAllowedGroups();
    if (configured.length > 0) return configured;

    // Di luar SAFE_MODE, allowlist kosong berarti semua grup diizinkan.
    if (!isSafeModeEnabled()) return null;

    // Di SAFE_MODE, allowlist kosong berarti hanya grup kelas dan grup testing.
    // Kalau dua-duanya kosong, hasilnya [] = tolak semua grup (fail-closed).
    const safe = [];
    for (const id of [process.env.TARGET_GROUP_ID, process.env.BUTTONS_TEST_GROUP_ID]) {
        const trimmed = String(id || '').trim();
        if (isValidGroupJid(trimmed) && !safe.includes(trimmed)) safe.push(trimmed);
    }
    return safe;
}

function isGroupAllowed(chatId) {
    const id = String(chatId || '').trim();
    if (!id.endsWith('@g.us')) return true;
    if (isBlockedGroup(id)) return false;

    const allowed = getEffectiveAllowedGroups();
    if (allowed === null) return true;
    return allowed.includes(id);
}

// Nama lama yang dipakai commands.js sebelum guard dipindahkan ke modul ini.
function isCommandAllowedInChat(chatId) {
    return isGroupAllowed(chatId);
}

function getCommandName(body) {
    const text = String(body || '').trim().toLowerCase();
    if (!text.startsWith('.')) return '';
    return text.split(/\s+/)[0];
}

function isSafeModeBlockedCommand(body) {
    if (!isSafeModeEnabled()) return false;
    const command = getCommandName(body);
    if (!command) return false;
    for (const blocked of SAFE_MODE_BLOCKED_COMMANDS) {
        // Prefix check menutup bypass seperti ".hidetagfoo" atau ".suarafoo",
        // karena handler command memakai startsWith untuk beberapa perintah.
        if (command === blocked || command.startsWith(blocked)) return true;
    }
    return false;
}

function getOutgoingKind(content) {
    if (!content || typeof content !== 'object') return null;
    for (const key of MEDIA_KEYS) {
        if (content[key] !== undefined && content[key] !== null) return key;
    }
    return null;
}

function getBufferSize(value) {
    if (Buffer.isBuffer(value)) return value.length;
    if (value && typeof value === 'object' && Buffer.isBuffer(value.data)) return value.data.length;
    return 0;
}

function getOutgoingMediaSize(content, kind) {
    if (!kind || kind === 'contacts') return 0;
    return getBufferSize(content[kind]);
}

function guardOutgoingMessage(chatId, content) {
    // Pertahanan terakhir: grup pemicu writer timeout tidak boleh dikirimi
    // apa pun, walaupun ada jalur kode baru yang lupa memeriksa allowlist.
    if (isBlockedGroup(chatId)) {
        throw new Error(`[GUARD] Grup ${chatId} diblokir; pengiriman dibatalkan.`);
    }

    const kind = getOutgoingKind(content);
    if (!kind) return;

    const size = getOutgoingMediaSize(content, kind);
    const maxMb = Number(process.env.MAX_OUTGOING_MEDIA_MB || 16);
    if (maxMb > 0 && size > maxMb * 1024 * 1024) {
        throw new Error(`[GUARD] Media ${kind} terlalu besar (${(size / 1024 / 1024).toFixed(1)} MB, maks ${maxMb} MB) untuk ${chatId}.`);
    }

    if (isSafeModeEnabled() && isSafeModeMediaBlocked()) {
        throw new Error(`[GUARD] SAFE_MODE mencegah pengiriman media ${kind} ke ${chatId}.`);
    }

    if (process.env.DEBUG_MESSAGES === 'true') {
        console.log(`[SEND] ${kind} -> ${chatId} (${(size / 1024).toFixed(0)} KB)`);
    }
}

function capMentions(participants) {
    const list = Array.isArray(participants) ? participants : [];
    const max = Number(process.env.MAX_OUTGOING_MENTIONS || 512);
    if (max <= 0 || list.length <= max) return list;
    console.log(`[GUARD] Mention dibatasi dari ${list.length} menjadi ${max} untuk mengurangi beban writer.`);
    return list.slice(0, max);
}

function isFatalSendError(err) {
    const message = String(err?.message || err || '').toLowerCase();
    if (!message) return false;
    return FATAL_SEND_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function withTimeout(promise, ms, label) {
    if (!ms || ms <= 0) return promise;
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(label)), ms);
        }),
    ]);
}

function getBaileysVersion() {
    try {
        const pkg = require('@whiskeysockets/baileys/package.json');
        return `${pkg.name || '@whiskeysockets/baileys'}@${pkg.version || 'unknown'}`;
    } catch (err) {
        return 'unknown';
    }
}

module.exports = {
    DEFAULT_BLOCKED_GROUPS,
    areReactionsEnabled,
    capMentions,
    getBaileysVersion,
    getBlockedGroups,
    getCommandName,
    getEffectiveAllowedGroups,
    getOutgoingKind,
    guardOutgoingMessage,
    isBlockedGroup,
    isCommandAllowedInChat,
    isFatalSendError,
    isGroupAllowed,
    isSafeModeBlockedCommand,
    isSafeModeEnabled,
    isSafeModeMediaBlocked,
    isSafeModeReactionsEnabled,
    isValidGroupJid,
    withTimeout,
};
