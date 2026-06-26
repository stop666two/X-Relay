// ═══════════════════════════════════════════
//  X-Relay — 房间认证模块
//  统一处理 DB 房间和配置文件房间的密码验证
// ═══════════════════════════════════════════

const crypto = require('crypto');
const path = require('path');

// ── 哈希工具 ──────────────────────────────────

function hmac256(payload, key) {
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

function randomKey() {
  return crypto.randomBytes(6).toString('base64url');
}

// ── 配置文件房间 ─────────────────────────────

let configRooms = {};
let configRoomKeys = [];

function loadConfig() {
  configRooms = {};
  configRoomKeys = [];
  try {
    const exePath = process.pkg ? path.dirname(process.execPath) : __dirname;
    const raw = require(path.join(exePath, 'room_pwd.json'));
    if (Array.isArray(raw)) {
      configRoomKeys = raw.filter(r => r.roomId && r.pwd && r.pwd.length === 64);
      configRoomKeys.forEach(r => {
        configRooms[r.roomId] = { pwd: r.pwd, turns: r.turns };
      });
    }
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') {
      console.error('[auth] room_pwd.json 加载失败:', e.message);
    }
  }
  return configRoomKeys.length;
}

loadConfig();

// ── 房间创建 ─────────────────────────────────

function createRoomKey(name) {
  const base = name.toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base + '-' + randomKey();
}

function makeRoomPassword(rawPassword, roomKey) {
  if (!rawPassword) return '';
  return hmac256(rawPassword, roomKey);
}

function makeDeletionPassword(rawPassword, roomKey) {
  return hmac256(rawPassword, roomKey);
}

// ── 房间验证 ─────────────────────────────────

/**
 * 验证房间访问权限
 * @param {object} dbRoom - 从 SQLite 查出的房间记录 (null if none)
 * @param {string} roomId - 房间 key
 * @param {string} clientHash - 客户端传来的密码哈希 (null if no password)
 * @returns {{ ok: boolean, needPwd: boolean, turns: object|null }}
 */
function verifyAccess(dbRoom, roomId, clientHash) {
  const cfg = configRooms[roomId];

  // 房间不存在
  if (!dbRoom && !cfg) {
    return { ok: false, needPwd: false };
  }

  // 配置文件中的房间 (使用原始 SHA-256 对比)
  if (cfg && cfg.pwd) {
    if (!clientHash || cfg.pwd !== clientHash) {
      return { ok: false, needPwd: true };
    }
    return { ok: true, needPwd: true, turns: cfg.turns || null };
  }

  // 数据库中的加密房间 (使用 HMAC 对比)
  if (dbRoom && dbRoom.password) {
    if (!clientHash || dbRoom.password !== clientHash) {
      return { ok: false, needPwd: true };
    }
    return { ok: true, needPwd: true, turns: null };
  }

  // 公开房间 (DB 中存在但无密码)
  return { ok: true, needPwd: false, turns: null };
}

module.exports = {
  hmac256,
  randomKey,
  loadConfig,
  configRooms,
  configRoomKeys,
  createRoomKey,
  makeRoomPassword,
  makeDeletionPassword,
  verifyAccess
};
