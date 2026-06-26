// ═══════════════════════════════════════════
//  X-Relay — SQLite 持久化层
// ═══════════════════════════════════════════

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, 'xrelay.db');

const db = new Database(DB_PATH);

// 性能优化
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -16000'); // 16MB cache
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// 建表
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_key TEXT NOT NULL,
    uid TEXT NOT NULL,
    text TEXT NOT NULL,
    nickname TEXT DEFAULT '',
    ts INTEGER NOT NULL,
    deleted INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_key, ts);
  CREATE TABLE IF NOT EXISTS rooms (
    room_key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    password TEXT DEFAULT '',
    deletion_password TEXT NOT NULL,
    visible INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    created_by TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_rooms_visible ON rooms(visible, created_at);
  CREATE TABLE IF NOT EXISTS nicknames (
    room_key TEXT NOT NULL,
    ip TEXT NOT NULL,
    nickname TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (room_key, ip)
  );
`);

// ── 消息操作 ──

const insertStmt = db.prepare(
  'INSERT INTO messages (room_key, uid, text, nickname, ts) VALUES (?, ?, ?, ?, ?)'
);
const historyStmt = db.prepare(
  'SELECT id, uid, text, nickname, ts FROM messages WHERE room_key = ? AND deleted = 0 ORDER BY ts DESC LIMIT ?'
);
const editStmt = db.prepare(
  'UPDATE messages SET text = ? WHERE id = ? AND uid = ? AND deleted = 0'
);
const deleteStmt = db.prepare(
  'UPDATE messages SET deleted = 1 WHERE id = ? AND uid = ? AND deleted = 0'
);
const cleanupStmt = db.prepare(
  `DELETE FROM messages WHERE room_key = ? AND id NOT IN (
    SELECT id FROM messages WHERE room_key = ? AND deleted = 0 ORDER BY ts DESC LIMIT ?
  )`
);
const cleanupDeletedStmt = db.prepare(
  'DELETE FROM messages WHERE room_key = ? AND deleted = 1 AND ts < ?'
);
const msgCountStmt = db.prepare(
  'SELECT COUNT(*) as cnt FROM messages WHERE room_key = ? AND deleted = 0'
);
const totalMsgCountStmt = db.prepare(
  'SELECT COUNT(*) as cnt FROM messages WHERE room_key = ?'
);

// 每个房间最多保留的消息数，已删除消息保留 7 天
const MAX_MSGS_PER_ROOM = 500;
const DELETED_MSG_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天

function addMessage(roomKey, uid, text, nickname) {
  const ts = Date.now();
  const result = insertStmt.run(roomKey, uid, text, nickname, ts);
  const msgId = result.lastInsertRowid;

  // 每隔 10 条消息检查一次是否需要清理
  if (msgId % 10 === 0) {
    const { cnt } = msgCountStmt.get(roomKey);
    if (cnt > MAX_MSGS_PER_ROOM) {
      cleanupStmt.run(roomKey, roomKey, MAX_MSGS_PER_ROOM);
    }
    // 清理 7 天前的已删除消息
    cleanupDeletedStmt.run(roomKey, Date.now() - DELETED_MSG_TTL);
  }

  return { uid, msgId, text, nickname, ts };
}

function getMessages(roomKey, limit = 100) {
  const rows = historyStmt.all(roomKey, limit);
  // 返回时间升序（前端期望）
  return rows.reverse().map(r => ({
    uid: r.uid,
    msgId: r.id,
    text: r.text,
    nickname: r.nickname,
    ts: r.ts
  }));
}

function editMessage(roomKey, msgId, uid, text) {
  const result = editStmt.run(text, msgId, uid);
  return result.changes > 0;
}

function deleteMessage(roomKey, msgId, uid) {
  const result = deleteStmt.run(msgId, uid);
  return result.changes > 0;
}

// ── 房间活跃度（大厅用） ──
const lastActivityStmt = db.prepare(
  'SELECT MAX(ts) as lastTs FROM messages WHERE room_key = ? AND deleted = 0'
);
const batchActivityStmt = db.prepare(
  'SELECT room_key, MAX(ts) as lastTs FROM messages WHERE deleted = 0 GROUP BY room_key'
);

function getLastActivity(roomKey) {
  const row = lastActivityStmt.get(roomKey);
  return row?.lastTs || 0;
}

function batchGetLastActivity() {
  const map = {};
  for (const row of batchActivityStmt.all()) map[row.room_key] = row.lastTs;
  return map;
}

// ── 房间管理 ──
const createRoomStmt = db.prepare(
  'INSERT INTO rooms (room_key, name, password, deletion_password, visible, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const getRoomStmt = db.prepare(
  'SELECT * FROM rooms WHERE room_key = ?'
);
const listRoomsStmt = db.prepare(
  'SELECT room_key, name, CASE WHEN LENGTH(password) > 0 THEN 1 ELSE 0 END as has_password, visible, created_at FROM rooms WHERE visible = 1 ORDER BY created_at DESC'
);
const deleteRoomStmt = db.prepare(
  'DELETE FROM rooms WHERE room_key = ? AND deletion_password = ?'
);
const deleteRoomMsgsStmt = db.prepare(
  'DELETE FROM messages WHERE room_key = ?'
);
const clearMsgsStmt = db.prepare(
  'UPDATE messages SET deleted = 1 WHERE room_key = ?'
);

function createRoom(roomKey, name, password, deletionPassword, visible, createdBy) {
  createRoomStmt.run(roomKey, name, password || '', deletionPassword, visible ? 1 : 0, Date.now(), createdBy || '');
  return { roomKey, name, hasPassword: !!password };
}

function getRoom(roomKey) {
  return getRoomStmt.get(roomKey) || null;
}

function listVisibleRooms() {
  return listRoomsStmt.all();
}

function deleteRoom(roomKey, deletionPassword) {
  const room = getRoomStmt.get(roomKey);
  if (!room) return false;
  if (room.deletion_password !== deletionPassword) return false;
  deleteRoomMsgsStmt.run(roomKey);
  deleteRoomStmt.run(roomKey, deletionPassword);
  return true;
}

function clearMessages(roomKey) {
  const result = clearMsgsStmt.run(roomKey);
  return result.changes;
}

// ── 昵称持久化 ──
const getNickStmt = db.prepare(
  'SELECT nickname FROM nicknames WHERE room_key = ? AND ip = ? ORDER BY updated_at DESC LIMIT 1'
);
const saveNickStmt = db.prepare(
  'INSERT OR REPLACE INTO nicknames (room_key, ip, nickname, updated_at) VALUES (?, ?, ?, ?)'
);

function getNickname(roomKey, ip) {
  const row = getNickStmt.get(roomKey, ip);
  return row?.nickname || null;
}

function saveNickname(roomKey, ip, nickname) {
  saveNickStmt.run(roomKey, ip, nickname, Date.now());
}

// ── 关闭 ──
let _closed = false;
function close() {
  if (_closed) return;
  _closed = true;
  try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch (_) {}
}

// 优雅退出
process.on('exit', () => {
  if (_closed) return;
  _closed = true;
  try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch (_) {}
});
process.on('SIGINT', () => { close(); process.exit(); });
process.on('SIGTERM', () => { close(); process.exit(); });

module.exports = {
  addMessage,
  getMessages,
  editMessage,
  deleteMessage,
  getLastActivity,
  batchGetLastActivity,
  createRoom,
  getRoom,
  listVisibleRooms,
  deleteRoom,
  clearMessages,
  getNickname,
  saveNickname,
  close
};
