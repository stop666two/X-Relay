// ═══════════════════════════════════════════
//  X-Relay — Cloudflare Worker
//  WebSocket + HTTP API + D1 持久化
// ═══════════════════════════════════════════

// ── Crypto (Web Crypto, 同浏览器端一致) ─────
async function sha256(s) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmac256(payload, key) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomKey() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(6))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── D1 查询 (首次访问自动建表) ──────────────
async function ensureSchema(db) {
  await db.exec(`
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
  `);
}

// ── 消息 ────────────────────────────────────
async function addMessage(db, roomKey, uid, text, nickname) {
  const ts = Date.now();
  const r = await db.prepare(
    'INSERT INTO messages (room_key, uid, text, nickname, ts) VALUES (?1, ?2, ?3, ?4, ?5)'
  ).bind(roomKey, uid, text, nickname, ts).run();
  const msgId = r.meta.last_row_id;

  // 每 10 条清理一次
  if (msgId % 10 === 0) {
    const { cnt } = await db.prepare(
      'SELECT COUNT(*) as cnt FROM messages WHERE room_key = ?1 AND deleted = 0'
    ).bind(roomKey).first();
    if (cnt > 500) {
      await db.prepare(`
        DELETE FROM messages WHERE room_key = ?1 AND id NOT IN (
          SELECT id FROM messages WHERE room_key = ?1 AND deleted = 0 ORDER BY ts DESC LIMIT 500
        )
      `).bind(roomKey).run();
    }
    await db.prepare(
      'DELETE FROM messages WHERE room_key = ?1 AND deleted = 1 AND ts < ?2'
    ).bind(roomKey, Date.now() - 7 * 86400000).run();
  }
  return { uid, msgId, text, nickname, ts };
}

async function getMessages(db, roomKey, limit = 100) {
  const r = await db.prepare(
    'SELECT id, uid, text, nickname, ts FROM messages WHERE room_key = ?1 AND deleted = 0 ORDER BY ts DESC LIMIT ?2'
  ).bind(roomKey, limit).all();
  return r.results.reverse().map(m => ({ uid: m.uid, msgId: m.id, text: m.text, nickname: m.nickname, ts: m.ts }));
}

// ── 房间 ────────────────────────────────────
async function listRooms(db, wss) {
  const r = await db.prepare(
    'SELECT room_key, name, CASE WHEN LENGTH(password) > 0 THEN 1 ELSE 0 END as encrypted, visible, created_at FROM rooms WHERE visible = 1 ORDER BY created_at DESC'
  ).all();

  const activity = await db.prepare(
    'SELECT room_key, MAX(ts) as last FROM messages WHERE deleted = 0 GROUP BY room_key'
  ).all();
  const actMap = {};
  activity.results.forEach(a => { actMap[a.room_key] = a.last; });

  const rooms = r.results.map(rr => ({
    id: rr.room_key,
    name: rr.name,
    encrypted: !!rr.encrypted,
    online: wss.roomUsers(rr.room_key).length,
    lastActivity: actMap[rr.room_key] || 0
  }));
  rooms.sort((a, b) => b.online - a.online || b.lastActivity - a.lastActivity);
  return rooms;
}

async function getRoom(db, roomKey) {
  return await db.prepare('SELECT * FROM rooms WHERE room_key = ?1').bind(roomKey).first();
}

// ── WebSocket 连接管理器 ─────────────────────
class WSSManager {
  constructor() {
    this.rooms = {}; // roomKey → [{id, ws, nickname, device}]
  }

  add(roomKey, id, ws, nickname) {
    if (!this.rooms[roomKey]) this.rooms[roomKey] = [];
    this.rooms[roomKey].push({ id, ws, nickname, device: '' });
  }

  remove(roomKey, id) {
    const r = this.rooms[roomKey];
    if (r) {
      const i = r.findIndex(u => u.id === id);
      if (i !== -1) r.splice(i, 1);
      if (r.length === 0) delete this.rooms[roomKey];
    }
  }

  get(roomKey, uid) {
    return (this.rooms[roomKey] || []).find(u => u.id === uid);
  }

  roomUsers(roomKey) {
    return this.rooms[roomKey] || [];
  }

  broadcast(roomKey, msg, excludeUid) {
    (this.rooms[roomKey] || []).forEach(u => {
      if (u.id !== excludeUid) {
        try { u.ws.send(msg); } catch (_) {}
      }
    });
  }

  broadcastAll(roomKey, msg) {
    (this.rooms[roomKey] || []).forEach(u => {
      try { u.ws.send(msg); } catch (_) {}
    });
  }
}

// ── JSON 响应 ───────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

// ── 主 Worker ───────────────────────────────
export default {
  async fetch(request, env, ctx) {
    await ensureSchema(env.DB);

    if (!globalThis.__wss) globalThis.__wss = new WSSManager();
    const wss = globalThis.__wss;
    const url = new URL(request.url);

    // WebSocket 升级
    if (url.pathname.startsWith('/ws/')) {
      const segs = decodeURIComponent(url.pathname).replace(/^\//, '').split('/');
      const roomId = (segs.length > 1 && segs[1] && segs[1].length <= 72) ? segs[1] : null;
      const clientHash = (segs.length > 2 && segs[2] && segs[2].length <= 128) ? segs[2] : null;

      if (!roomId || roomId === 'ws') return new Response('Invalid room', { status: 400 });

      const dbRoom = await getRoom(env.DB, roomId);
      const needPwd = dbRoom && dbRoom.password;
      const pwdOk = !needPwd || (clientHash && dbRoom.password === clientHash);

      if (needPwd && !pwdOk) {
        return new Response('Unauthorized', { status: 401 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();

      const uid = randomKey();
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const nickname = (await env.DB.prepare(
        'SELECT nickname FROM nicknames WHERE room_key = ?1 AND ip = ?2 ORDER BY updated_at DESC LIMIT 1'
      ).bind(roomId, ip).first())?.nickname || '';

      wss.add(roomId, uid, server, nickname);
      const userList = wss.roomUsers(roomId).map(u => ({ id: u.id, nickname: u.nickname, device: u.device }));

      // 发送注册信息
      server.send(JSON.stringify({
        type: '1001',
        data: { id: uid, roomId, roomName: dbRoom?.name || roomId, needPwd, turns: null }
      }));
      // 发送在线列表
      wss.broadcastAll(roomId, JSON.stringify({ type: '1002', data: userList }));
      server.send(JSON.stringify({ type: '1003', data: { id: uid } }));
      // 发送历史消息
      const history = await getMessages(env.DB, roomId);
      if (history.length) {
        server.send(JSON.stringify({ type: '1011', data: history }));
      }

      server.addEventListener('message', async (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch (_) { return; }
        const { type, data } = msg;
        if (!type) return;

        // Keepalive
        if (type === '9999') return;

        // 聊天消息
        if (type === '9007') {
          if (!data || typeof data.text !== 'string' || !data.text.trim()) return;
          const saved = await addMessage(env.DB, roomId, uid, data.text, nickname);
          wss.broadcastAll(roomId, JSON.stringify({
            type: '1010',
            data: { uid, text: data.text, msgId: saved.msgId, nickname: saved.nickname, ts: saved.ts }
          }));
          return;
        }

        // 编辑消息
        if (type === '9010') {
          if (!msg.uid || !data?.msgId || typeof data.text !== 'string') return;
          const r = await env.DB.prepare(
            'UPDATE messages SET text = ?1 WHERE id = ?2 AND uid = ?3 AND deleted = 0'
          ).bind(data.text, data.msgId, msg.uid).run();
          if (r.meta.changes > 0) {
            wss.broadcastAll(roomId, JSON.stringify({
              type: '1012', data: { msgId: data.msgId, text: data.text }
            }));
          }
          return;
        }

        // 删除消息
        if (type === '9011') {
          if (!msg.uid || !data?.msgId) return;
          const r = await env.DB.prepare(
            'UPDATE messages SET deleted = 1 WHERE id = ?1 AND uid = ?2'
          ).bind(data.msgId, msg.uid).run();
          if (r.meta.changes > 0) {
            wss.broadcastAll(roomId, JSON.stringify({
              type: '1013', data: { msgId: data.msgId }
            }));
          }
          return;
        }

        // WebRTC 信令 / 昵称 / 设备 / 输入状态
        const suid = msg.uid, targetId = msg.targetId;
        if (!suid || !targetId) return;
        const me = wss.get(roomId, suid);
        if (!me) return;
        const target = wss.get(roomId, targetId);

        if (type === '9001' && target) target.ws.send(JSON.stringify({ type: '1004', data: { targetId: suid, candidate: data?.candidate } }));
        else if (type === '9002' && target) target.ws.send(JSON.stringify({ type: '1005', data: { targetId: suid, offer: data?.targetAddr } }));
        else if (type === '9003' && target) target.ws.send(JSON.stringify({ type: '1006', data: { targetId: suid, answer: data?.targetAddr } }));
        else if (type === '9004') {
          const nn = (data?.nickname || '').slice(0, 20);
          if (nn) {
            me.nickname = nn;
            await env.DB.prepare(
              'INSERT OR REPLACE INTO nicknames (room_key, ip, nickname, updated_at) VALUES (?1, ?2, ?3, ?4)'
            ).bind(roomId, ip, nn, Date.now()).run();
            wss.broadcast(roomId, JSON.stringify({ type: '1007', data: { id: suid, nickname: nn } }), suid);
          }
        }
        else if (type === '9005') {
          if (data?.device && data.device.length <= 100) {
            me.device = data.device;
            wss.broadcast(roomId, JSON.stringify({ type: '1008', data: { id: suid, device: data.device } }), suid);
          }
        }
        else if (type === '9006') {
          wss.broadcast(roomId, JSON.stringify({ type: '1009', data: { id: suid, typing: data?.typing } }), suid);
        }
      });

      server.addEventListener('close', () => {
        wss.remove(roomId, uid);
        wss.broadcastAll(roomId, JSON.stringify({
          type: '1002',
          data: wss.roomUsers(roomId).map(u => ({ id: u.id, nickname: u.nickname, device: u.device }))
        }));
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // ── HTTP API ──────────────────────────────
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    // GET /api/rooms
    if (request.method === 'GET' && url.pathname === '/api/rooms') {
      return json(await listRooms(env.DB, wss));
    }

    // POST /api/rooms
    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      let b;
      try { b = await request.json(); } catch (_) { return json({ error: '无效请求' }, 400); }
      if (!b.name || !b.deletionPassword) return json({ error: '缺少参数' }, 400);
      const name = (b.name || '').replace(/[<>"']/g, '').trim().slice(0, 32);
      const delRaw = (b.deletionPassword || '').replace(/[<>"']/g, '').trim().slice(0, 64);
      if (!name || !delRaw) return json({ error: '参数无效' }, 400);

      const base = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      const key = base + '-' + randomKey();
      const pwd = b.password ? await hmac256((b.password || '').slice(0, 64), key) : '';
      const del = await hmac256(delRaw, key);

      await env.DB.prepare(
        'INSERT INTO rooms (room_key, name, password, deletion_password, visible, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
      ).bind(key, name, pwd, del, b.visibleInLobby !== false ? 1 : 0, Date.now()).run();

      return json({ roomKey: key, name, hasPassword: !!pwd }, 201);
    }

    // DELETE /api/rooms/:key
    if (request.method === 'DELETE' && url.pathname.startsWith('/api/rooms/')) {
      const key = decodeURIComponent(url.pathname.split('/api/rooms/')[1]);
      if (!key || key.length > 72) return json({ error: '无效房间' }, 400);
      let b;
      try { b = await request.json(); } catch (_) { return json({ error: '无效请求' }, 400); }
      if (!b.deletionPassword) return json({ error: '需要删除密码' }, 400);
      const delHash = await hmac256((b.deletionPassword || '').slice(0, 64), key);

      const room = await env.DB.prepare('SELECT * FROM rooms WHERE room_key = ?1').bind(key).first();
      if (!room || room.deletion_password !== delHash) return json({ success: false }, 403);

      await env.DB.prepare('DELETE FROM messages WHERE room_key = ?1').bind(key).run();
      await env.DB.prepare('DELETE FROM rooms WHERE room_key = ?1').bind(key).run();

      // 断开房间内所有 WebSocket
      wss.roomUsers(key).forEach(u => { try { u.ws.close(); } catch (_) {} });

      return json({ success: true });
    }

    // POST /api/rooms/:key/clear
    if (request.method === 'POST' && url.pathname.match(/^\/api\/rooms\/[^/]+\/clear$/)) {
      const key = decodeURIComponent(url.pathname.split('/api/rooms/')[1].split('/clear')[0]);
      const r = await env.DB.prepare(
        'UPDATE messages SET deleted = 1 WHERE room_key = ?1'
      ).bind(key).run();
      wss.broadcastAll(key, JSON.stringify({ type: '1014', data: {} }));
      return json({ cleared: r.meta.changes });
    }

    // 静态文件 — 由 Cloudflare Assets 自动处理，这里兜底
    return new Response('Not Found', { status: 404 });
  }
};
