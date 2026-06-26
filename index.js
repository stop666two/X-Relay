const WebSocket = require('ws');
const service = require('./data');
const auth = require('./auth');
const path = require('path');
const http = require('http');
const fs = require('fs');

// ── Logging ──────────────────────────────────────
const ts = () => { const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3,'0')}`; };
const log = (...a) => console.log(`[${ts()}]`, ...a);
const errLog = (...a) => console.error(`[${ts()}]`, ...a);

// ── Config ──────────────────────────────────────
const PORT = parseInt(process.argv[2]) || 8081;
const WWW = path.resolve(__dirname, 'www');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const CACHEABLE = /\.(js|css|ico|png|jpg|jpeg|gif|svg|webp|woff2?)$/i;

log(`已加载 ${auth.configRoomKeys.length} 个配置加密房间`);

// ── Helpers ─────────────────────────────────────
function sanitize(str, max) { const s = String(str || '').replace(/[<>"']/g, '').trim(); return s.slice(0, max); }

function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise(resolve => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size <= 4096) chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { errLog('readBody parse error:', e.message); resolve(null); } });
    req.on('error', (e) => { errLog('readBody error:', e.message); resolve(null); });
  });
}

function serveStatic(req, res, filePath) {
  const ext = path.extname(filePath);
  if (/\.(db|db-shm|db-wal|db-journal|sqlite|sqlite3|env|pem|key|crt|p12)$/i.test(ext)) {
    res.writeHead(404); return res.end('Not Found');
  }
  res.setHeader('Content-Type', MIME[ext] || 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (CACHEABLE.test(ext)) res.setHeader('Cache-Control', 'public, max-age=2592000');
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) { res.writeHead(404); res.end('Not Found'); }
    else { res.destroy(); }
  });
  stream.pipe(res);
  res.on('error', () => { if (!stream.destroyed) stream.destroy(); });
}

function sanitizePath(urlPath) {
  urlPath = path.normalize(urlPath).replace(/^[\/\\]+/, '');
  if (/\.\.(\/|\\)|(\/|\\)\.\.|^\.\./.test(urlPath)) return null;
  if (/^\.|\.db$/i.test(urlPath) || /room_pwd|package\.json|\.env|\.git|node_modules|\.pem|\.key|\.crt/i.test(urlPath)) return null;
  return urlPath || 'index.html';
}

// ── API rate limiter ────────────────────────────
const apiRate = new Map();
function checkApiRate(ip) {
  const now = Date.now(), e = apiRate.get(ip) || { count: 0, reset: now + 10000 };
  if (now > e.reset) { e.count = 0; e.reset = now + 10000; }
  apiRate.set(ip, e);
  return ++e.count <= 20;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of apiRate) if (now > v.reset + 120000) apiRate.delete(k); }, 60000);

// ── HTTP Server ─────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': req.headers.origin || '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' });
    return res.end();
  }

  const url = req.url.split('?')[0];
  const ip = (req.socket?.remoteAddress || '').replace('::ffff:', '');

  // GET /api/rooms
  if (req.method === 'GET' && url === '/api/rooms')
    return json(res, service.getRoomList(auth.configRoomKeys));

  // POST /api/rooms — create room
  if (req.method === 'POST' && url === '/api/rooms') {
    if (!checkApiRate(ip)) return json(res, { error: '请求过于频繁' }, 429);
    const b = await readBody(req);
    if (!b || !b.name || !b.deletionPassword) return json(res, { error: '缺少参数' }, 400);
    const name = sanitize(b.name, 32);
    const delRaw = sanitize(b.deletionPassword, 64);
    if (!name || !delRaw) return json(res, { error: '参数无效' }, 400);

    const key = auth.createRoomKey(name);
    const pwd = auth.makeRoomPassword(sanitize(b.password, 64), key);
    const del = auth.makeDeletionPassword(delRaw, key);
    const created = service.createRoom(key, name, pwd, del, b.visibleInLobby !== false, 'web');
    return json(res, created, 201);
  }

  // DELETE /api/rooms/:key
  if (req.method === 'DELETE' && url.startsWith('/api/rooms/')) {
    const key = decodeURIComponent(url.split('/api/rooms/')[1]).split('/')[0];
    if (!key || key.length > 72) return json(res, { error: '无效房间' }, 400);
    const b = await readBody(req);
    if (!b || !b.deletionPassword) return json(res, { error: '需要删除密码' }, 400);
    const delHash = auth.makeDeletionPassword(sanitize(b.deletionPassword, 64), key);
    const ok = service.deleteRoom(key, delHash);
    return json(res, { success: ok }, ok ? 200 : 403);
  }

  // POST /api/rooms/:key/clear
  if (req.method === 'POST' && url.match(/^\/api\/rooms\/[^/]+\/clear$/)) {
    if (!checkApiRate(ip)) return json(res, { error: '请求过于频繁' }, 429);
    const key = decodeURIComponent(url.split('/api/rooms/')[1].split('/clear')[0]);
    const count = service.clearMessages(key);
    service.getUserList(null, key).forEach(u => { try { u.socket.send(JSON.stringify({ type: '1014', data: {} })); } catch (e) { errLog('clear notify error:', e.message); } });
    return json(res, { cleared: count });
  }

  // Static files
  const urlPath = sanitizePath(decodeURIComponent(url));
  if (!urlPath) { res.writeHead(403); return res.end('Forbidden'); }
  let fp = path.join(WWW, urlPath);
  if (!path.resolve(fp).startsWith(WWW + path.sep)) fp = path.join(WWW, 'index.html');
  fs.stat(fp, (e, st) => {
    if (e || !st.isFile()) {
      // 根路径 → 大厅(index.html), 其他路径 → 聊天室(chat.html)
      const fallback = (!urlPath || urlPath === 'index.html') ? 'index.html' : 'chat.html';
      serveStatic(req, res, path.join(WWW, fallback));
    } else {
      serveStatic(req, res, fp);
    }
  });
});

server.listen(PORT, () => log(`X-Relay 已启动 → http://localhost:${PORT}`));

// ── WebSocket ───────────────────────────────────
const wss = new WebSocket.Server({ server });

const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => { if (ws.isAlive === false) return ws.terminate(); ws.isAlive = false; ws.ping(); });
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

const S = { REG: '1001', ROOM_INFO: '1002', JOINED: '1003', CANDIDATE: '1004', CONNECTION: '1005', CONNECTED: '1006', NICKNAME: '1007', DEVICE: '1008', TYPING: '1009', CHAT_MSG: '1010', CHAT_HISTORY: '1011', CHAT_EDIT: '1012', CHAT_DELETE: '1013', CHAT_CLEAR: '1014' };
const R = { CANDIDATE: '9001', CONNECTION: '9002', CONNECTED: '9003', NICKNAME: '9004', DEVICE: '9005', TYPING: '9006', CHAT_MSG: '9007', CHAT_EDIT: '9010', CHAT_DELETE: '9011', KEEPALIVE: '9999' };
const send = (ws, type, data) => { try { ws.send(JSON.stringify({ type, data })); } catch (e) { errLog('send error:', e.message); } };

// WS rate limiter
const wsRate = new Map();
function checkWsRate(uid) {
  const now = Date.now(), e = wsRate.get(uid) || { count: 0, reset: now + 1000 };
  if (now > e.reset) { e.count = 0; e.reset = now + 1000; }
  wsRate.set(uid, e);
  return ++e.count <= 10;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of wsRate) if (now > v.reset + 60000) wsRate.delete(k); }, 60000);

const broadcast = (ip, roomId, type, data) => service.getUserList(ip, roomId).forEach(u => send(u.socket, type, data));
const userListPayload = (ip, roomId) => service.getUserList(ip, roomId).map(x => ({ id: x.id, nickname: x.nickname, device: x.device || '' }));

wss.on('connection', (socket, request) => {
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });

  const ip = (socket._socket?.remoteAddress || '').replace('::ffff:', '') || ('u-' + auth.randomKey());

  const segs = decodeURIComponent(request.url).replace(/^\//, '').split('/');
  let roomId = (segs.length > 1 && segs[1] && segs[1].length <= 72) ? segs[1].trim() : null;
  const clientHash = (segs.length > 2 && segs[2] && segs[2].length <= 128) ? segs[2].trim() : null;
  if (roomId === 'ws' || roomId === '') roomId = null;
  log(`WS连接 roomId=${roomId} hasPwd=${!!clientHash}`);

  let access = null;
  if (roomId) {
    const dbRoom = service.getRoomInfo(roomId);
    access = auth.verifyAccess(dbRoom, roomId, clientHash);
  }

  const effectiveRoom = (access && access.ok) ? roomId : null;
  const uid = service.registerUser(ip, effectiveRoom, socket);

  if (access && !access.ok && access.needPwd) {
    send(socket, S.REG, { id: uid, roomId: null, needPwd: true });
    log(`${uid}@${ip} 需要密码 ${roomId}`);
    socket.close();
    return;
  }

  if (!effectiveRoom) {
    send(socket, S.REG, { id: uid, roomId: null, needPwd: false });
    socket.close();
    return;
  }

  const roomName = service.getRoomInfo(roomId)?.name || roomId;
  send(socket, S.REG, { id: uid, roomId, roomName, turns: access.turns, needPwd: access.needPwd });
  log(`${uid}@${ip} → ${roomId}`);

  const info = userListPayload(ip, roomId);
  broadcast(ip, roomId, S.ROOM_INFO, info);
  send(socket, S.JOINED, { id: uid });

  const history = service.getMessages(ip, roomId, 100);
  if (history.length) send(socket, S.CHAT_HISTORY, history);

  socket.on('message', raw => {
    const str = raw.toString();
    if (!str || Buffer.byteLength(str, 'utf8') > 65536) return;
    let msg; try { msg = JSON.parse(str); } catch (_) { return; }
    const { type, data } = msg;
    if (!type) return;

    if (type === R.KEEPALIVE) return;

    if (type === R.CHAT_MSG) {
      if (!checkWsRate(uid) || !data || typeof data.text !== 'string' || !data.text.trim()) return;
      const saved = service.addMessage(ip, roomId, uid, data.text);
      broadcast(ip, roomId, S.CHAT_MSG, { uid, text: data.text, msgId: saved.msgId, nickname: saved.nickname, ts: saved.ts });
      return;
    }

    if (type === R.CHAT_EDIT) {
      if (!msg.uid || !data || !data.msgId || typeof data.text !== 'string' || !data.text.trim()) return;
      if (service.editMessage(ip, roomId, data.msgId, msg.uid, data.text))
        broadcast(ip, roomId, S.CHAT_EDIT, { msgId: data.msgId, text: data.text });
      return;
    }

    if (type === R.CHAT_DELETE) {
      if (!msg.uid || !data || !data.msgId) return;
      if (service.deleteMessage(ip, roomId, data.msgId, msg.uid))
        broadcast(ip, roomId, S.CHAT_DELETE, { msgId: data.msgId });
      return;
    }

    const { uid: suid, targetId } = msg;
    if (!suid || !targetId) return;
    const me = service.getUser(ip, roomId, suid);
    if (!me) return;
    const target = service.getUser(ip, roomId, targetId);

    if (type === R.CANDIDATE && target) send(target.socket, S.CANDIDATE, { targetId: suid, candidate: data.candidate });
    else if (type === R.CONNECTION && target) send(target.socket, S.CONNECTION, { targetId: suid, offer: data.targetAddr });
    else if (type === R.CONNECTED && target) send(target.socket, S.CONNECTED, { targetId: suid, answer: data.targetAddr });
    else if (type === R.NICKNAME) {
      const nn = data && typeof data.nickname === 'string' ? sanitize(data.nickname, 20) : '';
      if (nn && service.updateNickname(ip, roomId, suid, nn))
        broadcast(ip, roomId, S.NICKNAME, { id: suid, nickname: nn });
    }
    else if (type === R.DEVICE) {
      if (data && typeof data.device === 'string' && data.device.length <= 100 && service.updateDevice(ip, roomId, suid, data.device))
        broadcast(ip, roomId, S.DEVICE, { id: suid, device: data.device });
    }
    else if (type === R.TYPING) {
      broadcast(ip, roomId, S.TYPING, { id: suid, typing: data.typing });
    }
  });

  socket.on('close', () => {
    service.unregisterUser(ip, roomId, uid);
    broadcast(ip, roomId, S.ROOM_INFO, userListPayload(ip, roomId));
    log(`${uid}@${ip} ← ${roomId}`);
  });

  socket.on('error', e => { errLog(`socket ${uid}:`, e?.message || e); socket.close(); });
});
