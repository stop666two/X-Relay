-- X-Relay D1 数据库 Schema
-- Worker 首次请求时自动建表，此文件供手动参考

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
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rooms_visible ON rooms(visible, created_at);

CREATE TABLE IF NOT EXISTS nicknames (
  room_key TEXT NOT NULL,
  ip TEXT NOT NULL,
  nickname TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (room_key, ip)
);
