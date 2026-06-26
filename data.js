// ═══════════════════════════════════════════
//  X-Relay — Data Layer
//  持久数据 → SQLite (消息/房间/昵称)
//  连接状态 → 内存   (socket 不可避免)
// ═══════════════════════════════════════════

const db = require('./db');
const crypto = require('crypto');

// 在线用户连接池 — socket 是实时网络对象，不可序列化到 SQLite
// key → [{id, socket, nickname, device}]
const sockets = {};

function getCookieValue(socket) {
  try {
    const cookie = socket.request?.headers?.cookie;
    if (!cookie) return null;
    const match = cookie.match(/nickname=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch (e) { return null; }
}

function internalNet(ip) {
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('172.')) { const s = parseInt(ip.split('.')[1]); if (s >= 16 && s <= 31) return true; }
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('127.')) return true;
  if (ip === '::1') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
  if (ip.startsWith('fe80:')) return true;
  return false;
}

function getKey(ip, roomId) {
  if (roomId) return roomId;
  return internalNet(ip) ? 'internal' : ip;
}

// ── 用户管理 ──
// 昵称持久化到 SQLite，socket 引用仅在内存

function registerUser(ip, roomId, socket) {
  const key = getKey(ip, roomId);
  if (!sockets[key]) sockets[key] = [];

  const id = crypto.randomBytes(6).toString('base64url');

  // 昵称来源优先级: Cookie > SQLite 历史 > 空
  let nickname = getCookieValue(socket);
  if (!nickname) nickname = db.getNickname(key, ip) || '';

  sockets[key].push({ id, socket, nickname, device: '' });
  return id;
}

function unregisterUser(ip, roomId, id) {
  const key = getKey(ip, roomId);
  const room = sockets[key];
  if (room) { const idx = room.findIndex(u => u.id === id); if (idx !== -1) room.splice(idx, 1); }
}

function getUserList(ip, roomId) {
  const key = getKey(ip, roomId);
  return sockets[key] || [];
}

function getUser(ip, roomId, uid) {
  const key = getKey(ip, roomId);
  return (sockets[key] || []).find(u => u.id === uid);
}

function updateNickname(ip, roomId, id, nickname) {
  const key = getKey(ip, roomId);
  const room = sockets[key];
  if (!room) return false;
  const u = room.find(x => x.id === id);
  if (u) {
    u.nickname = nickname;
    // 持久化到 SQLite
    db.saveNickname(key, ip, nickname);
    return true;
  }
  return false;
}

function updateDevice(ip, roomId, id, device) {
  const room = sockets[getKey(ip, roomId)];
  if (!room) return false;
  const u = room.find(x => x.id === id);
  if (u) { u.device = device; return true; }
  return false;
}

// ── 消息 (SQLite) ──

function addMessage(ip, roomId, uid, text) {
  const key = getKey(ip, roomId);
  const room = sockets[key];
  const u = room?.find(x => x.id === uid);
  return db.addMessage(key, uid, text, u?.nickname || '');
}

function getMessages(ip, roomId, limit = 100) {
  return db.getMessages(getKey(ip, roomId), limit);
}

function editMessage(ip, roomId, msgId, uid, text) {
  return db.editMessage(getKey(ip, roomId), msgId, uid, text);
}

function deleteMessage(ip, roomId, msgId, uid) {
  return db.deleteMessage(getKey(ip, roomId), msgId, uid);
}

// ── 房间 (SQLite) ──

function createRoom(roomKey, name, password, deletionPassword, visible, createdBy) {
  return db.createRoom(roomKey, name, password, deletionPassword, visible, createdBy);
}

function getRoomInfo(roomKey) {
  return db.getRoom(roomKey);
}

function deleteRoom(roomKey, deletionPassword) {
  const result = db.deleteRoom(roomKey, deletionPassword);
  if (result) {
    if (sockets[roomKey]) {
      sockets[roomKey].forEach(u => { try { u.socket.close(); } catch (_) {} });
      delete sockets[roomKey];
    }
  }
  return result;
}

function clearMessages(roomKey) {
  return db.clearMessages(roomKey);
}

// ── 大厅房间列表 ──

function getRoomList(pwdConfig = []) {
  const configEncrypted = new Set((pwdConfig||[]).map(r => r.roomId));
  const rooms = [];
  const seen = new Set();
  const activityMap = db.batchGetLastActivity();

  // 1. DB 中的房间
  const dbRooms = db.listVisibleRooms();
  for (const r of dbRooms) {
    seen.add(r.room_key);
    const onlineUsers = sockets[r.room_key] || [];
    rooms.push({
      id: r.room_key,
      name: r.name || r.room_key,
      encrypted: !!r.has_password,
      online: onlineUsers.length,
      lastActivity: activityMap[r.room_key] || 0
    });
  }

  // 2. 仅内存中的活跃房间（非 DB、非 internal）
  for (const [key, roomSockets] of Object.entries(sockets)) {
    if (key === 'internal' || seen.has(key)) continue;
    seen.add(key);
    if (roomSockets.length === 0) continue;
    rooms.push({
      id: key,
      name: key,
      encrypted: configEncrypted.has(key),
      online: roomSockets.length,
      lastActivity: activityMap[key] || 0
    });
  }

  // 3. 配置文件中的房间（无人在线时也展示）
  for (const cfg of (pwdConfig||[])) {
    if (!seen.has(cfg.roomId)) {
      rooms.push({ id: cfg.roomId, name: cfg.roomId, encrypted: true, online: 0, lastActivity: 0 });
    }
  }

  rooms.sort((a, b) => b.online - a.online || b.lastActivity - a.lastActivity);
  return rooms;
}

module.exports = {
  registerUser, unregisterUser, getUserList, getUser, updateNickname, updateDevice,
  addMessage, getMessages, editMessage, deleteMessage,
  getRoomList, createRoom, getRoomInfo, deleteRoom, clearMessages
};
