/* ═══════════════════════════════════════════
   X-Relay Client · Rewritten
   ═══════════════════════════════════════════ */

// ── Shortcuts ───────────────────────────────────
const $ = id => document.getElementById(id);

// ── State ───────────────────────────────────────
let users = [], me = new XChatUser(), ws = null, nick = '', pwd = '', roomKey = null,
    pfiles = [], rcnt = 0, unread = 0, hidden = false, scrolled = false,
    soundOn = true, userColors = {}, connTimes = {}, typingTimers = {},
    typingThrottle = null, editingMsg = null, pendingRoom = null, connecting = false,
    cancelXfer = false;
window._msgId = 0;

// ── AES-256-GCM ─────────────────────────────────
const ENC = { name: 'AES-GCM', length: 256 };
const ab2b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b642ab = s => { const b = atob(s), r = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) r[i] = b.charCodeAt(i); return r.buffer; };
async function deriveKey(pw, room) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: new TextEncoder().encode('x-relay:' + room), iterations: 100000, hash: 'SHA-256' }, km, ENC, false, ['encrypt', 'decrypt']);
}
async function encrypt(t) { if (!roomKey) return t; const iv = crypto.getRandomValues(new Uint8Array(12)), ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, roomKey, new TextEncoder().encode(t)); return JSON.stringify({ v: 1, iv: ab2b64(iv), ct: ab2b64(ct) }); }
async function decrypt(p) { if (!roomKey) return p; try { const { iv, ct } = JSON.parse(p); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b642ab(iv) }, roomKey, b642ab(ct))); } catch (_) { return '[无法解密]'; } }

// ── SHA-256 + HMAC ──────────────────────────────
async function sha256(s) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function hmac256(data, key) { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)); return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join(''); }

// ── Helpers ─────────────────────────────────────
const COLORS = ['#e57373', '#f06292', '#ba68c8', '#7986cb', '#64b5f6', '#4fc3f7', '#4dd0e1', '#4db6ac', '#81c784', '#aed581', '#ffb74d', '#ff8a65', '#a1887f', '#90a4ae'];
const ucolor = uid => { if (!userColors[uid]) userColors[uid] = COLORS[Object.keys(userColors).length % COLORS.length]; return userColors[uid]; };
const p2 = n => String(n).padStart(2, '0');
const now = () => { const d = new Date(); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const tfmt = ts => { const n = Number(ts); if (!n || n < 0) return '--:--'; const d = new Date(n); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const fsiz = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(1) + ' GB';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dev = () => { const u = navigator.userAgent; let o = '', b = ''; if (u.includes('Win')) o = 'Win'; else if (u.includes('Mac')) o = 'Mac'; else if (u.includes('Android')) o = 'Android'; else if (u.includes('iPhone') || u.includes('iPad')) o = 'iOS'; else o = 'Linux'; b = u.includes('Edg/') ? 'Edge' : u.includes('Firefox/') ? 'FF' : u.includes('Chrome/') ? 'Chrome' : u.includes('Safari/') && !u.includes('Chrome') ? 'Safari' : ''; return b ? o + ' · ' + b : o; };
const show = id => $(id).classList.add('show');
const hide = id => $(id).classList.remove('show');

// ── Audio ───────────────────────────────────────
let _ctx = null;
function beep() {
  if (!soundOn) return;
  try {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = _ctx.createOscillator(), g = _ctx.createGain();
    o.connect(g); g.connect(_ctx.destination);
    o.type = 'sine'; o.frequency.setValueAtTime(880, _ctx.currentTime); o.frequency.setValueAtTime(1100, _ctx.currentTime + .04);
    g.gain.setValueAtTime(.08, _ctx.currentTime); g.gain.exponentialRampToValueAtTime(.001, _ctx.currentTime + .15);
    o.start(); o.stop(_ctx.currentTime + .15);
  } catch (_) {}
}

// ── Snackbar ────────────────────────────────────
function snack(msg, action, cb) {
  const s = $('snackbar'); clearTimeout(s._t);
  $('snackMsg').textContent = msg; $('snackAction').textContent = action || ''; $('snackAction').onclick = cb || null;
  s.classList.add('show'); s._t = setTimeout(() => s.classList.remove('show'), action ? 5000 : 2500);
}

// ── Markdown ────────────────────────────────────
function md2html(t) {
  t = esc(t);
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
  t = t.replace(/~~(.+?)~~/g, '<del>$1</del>');
  t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => '<pre><code>' + code.trim() + '</code></pre>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/(https?:\/\/[^\s<>"']+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  return t;
}

// ── File icon ───────────────────────────────────
function ficon(name) {
  const e = name.split('.').pop()?.toLowerCase();
  return { zip: '📦', rar: '📦', pdf: '📕', doc: '📄', docx: '📄', xls: '📊', xlsx: '📊', ppt: '📽️', pptx: '📽️', mp3: '🎵', wav: '🎵', mp4: '🎬', mov: '🎬', avi: '🎬', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️', txt: '📝', js: '💛', ts: '💙', py: '🐍', html: '🌐', css: '🎨', json: '📋', md: '📝', exe: '⚙️', apk: '📱', dmg: '💿', iso: '💿' }[e] || '📄';
}

// ── Scroll ──────────────────────────────────────
function scrollBottom() { const b = $('msgs'); if (!scrolled || b.scrollHeight - b.scrollTop - b.clientHeight < 120) { b.scrollTop = b.scrollHeight; scrolled = false; updateFab(); } }
$('msgs').addEventListener('scroll', () => { scrolled = $('msgs').scrollHeight - $('msgs').scrollTop - $('msgs').clientHeight > 150; updateFab(); });
function updateFab() {
  const f = $('scrollFab'), b = $('unreadBadge');
  if (scrolled) { f.classList.add('show'); if (unread) { b.style.display = 'flex'; b.textContent = unread > 99 ? '99+' : unread; } else b.style.display = 'none'; }
  else { f.classList.remove('show'); unread = 0; b.style.display = 'none'; document.title = 'X-Relay'; }
}
$('scrollFab').onclick = () => { $('msgs').scrollTop = $('msgs').scrollHeight; unread = 0; scrolled = false; updateFab(); document.title = 'X-Relay'; };

function unreadInc() {
  if (hidden) { unread++; updateFab(); document.title = '(' + (unread > 99 ? '99+' : unread) + ') X-Relay'; }
}

// ── Messages ────────────────────────────────────
const DAY = 86400000;
let _lastDate = '';
function dateLabel(ts) {
  const d = new Date(Number(ts)), now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (msgDay === today) return '今天';
  if (msgDay === today - DAY) return '昨天';
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}
function maybeDateSep(ts) {
  const label = dateLabel(ts);
  if (label !== _lastDate) { _lastDate = label; const d = document.createElement('div'); d.className = 'date-sep'; d.textContent = label; $('msgs').appendChild(d); }
}

function addMsg(uid, text, ts, msgId, nobroadcast) {
  if (!text) return;
  if (!msgId) msgId = ++window._msgId;
  if (ts == null) ts = Date.now();
  maybeDateSep(ts);
  const el = document.createElement('div'); el.className = 'msg';
  el.dataset.mid = msgId; el.dataset.uid = uid; el.dataset.text = text; el.dataset.ts = ts;
  const u = users.find(x => x.id === uid), name = uid === 'system' ? '系统' : (u?.nickname || uid),
        sys = uid === 'system', mine = uid === me.id && !sys;
  const html = sys ? esc(text) : md2html(text);
  el.innerHTML = `<div class="msg-avatar" style="background:${ucolor(uid)}">${(name[0] || '?').toUpperCase()}</div>
    <div class="msg-body-wrap">
      <div class="msg-head"><span class="msg-author${sys ? ' sys' : ''}">${mine ? '（我）' : ''}${esc(name)}</span><span class="msg-time" title="${new Date(Number(ts)).toLocaleString()}">${tfmt(ts)}</span></div>
      <div class="msg-text">${html}</div>
      <div class="msg-actions">${!sys ? `<button class="msg-act" data-act="reply" title="回复">↩️</button><button class="msg-act" data-act="copy" title="复制">📋</button>${mine ? `<button class="msg-act" data-act="edit" title="编辑">✏️</button><button class="msg-act danger" data-act="delete" title="删除">🗑️</button>` : ''}` : ''}</div>
    </div>`;
  $('msgs').appendChild(el); scrollBottom();
  if (!nobroadcast && !mine && !sys) { beep(); unreadInc(); }
  bindMsgActions(el);
}

function replyMsg(el) {
  const uid = el.dataset.uid, txt = el.dataset.text, mid = el.dataset.mid;
  const u = users.find(x => x.id === uid), name = u?.nickname || uid;
  const preview = txt.length > 80 ? txt.slice(0, 80) + '…' : txt;
  $('msgInput').value = '';
  $('msgInput').focus();
  // Visual quote
  const q = document.createElement('div'); q.className = 'reply-quote'; q.id = 'replyQuote';
  q.innerHTML = `<span class="reply-quote-name">${esc(name)}</span> ${esc(preview)} <button class="reply-quote-close" onclick="cancelReply()">✕</button>`;
  q.dataset.replyTo = mid; q.dataset.replyName = name; q.dataset.replyText = preview;
  $('input-area').insertBefore(q, $('input-area').firstChild);
}
function cancelReply() { const q = $('replyQuote'); if (q) q.remove(); }

// Update reply button handler
function addFileMsg(uid, file, ts, nobroadcast) {
  const msgId = ++window._msgId; if (ts == null) ts = Date.now();
  const el = document.createElement('div'); el.className = 'msg';
  el.dataset.mid = msgId; el.dataset.uid = uid; el.dataset.type = 'file'; el.dataset.ts = ts;
  const u = users.find(x => x.id === uid), name = u?.nickname || uid, mine = uid === me.id,
        isImg = file.url && /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name), icon = ficon(file.name);
  let body = isImg ? `<img class="msg-file-img" src="${file.url}" alt="${esc(file.name)}" onclick="window.open(this.src)">`
    : `<a class="msg-file-card" href="${file.url || '#'}" ${file.url ? `download="${esc(file.name)}"` : ''}><span class="msg-file-icon">${icon}</span><div class="msg-file-info"><div class="msg-file-name">${esc(file.name)}</div>${file.size ? `<div class="msg-file-size">${fsiz(file.size)}</div>` : ''}</div></a>`;
  el.innerHTML = `<div class="msg-avatar" style="background:${ucolor(uid)}">${(name[0] || '?').toUpperCase()}</div>
    <div class="msg-body-wrap"><div class="msg-head"><span class="msg-author">${mine ? '（我）' : ''}${esc(name)}</span><span class="msg-time" title="${new Date(ts).toLocaleString()}">${tfmt(ts)}</span></div><div>${body}</div></div>`;
  $('msgs').appendChild(el); scrollBottom();
  if (!nobroadcast && !mine) { beep(); unreadInc(); }
}

function bindMsgActions(el) {
  el.querySelectorAll('.msg-act').forEach(btn => {
    btn.onclick = () => {
      const a = btn.dataset.act, txt = el.dataset.text, mid = el.dataset.mid;
      if (a === 'copy') { navigator.clipboard?.writeText(txt).then(() => snack('已复制')); return; }
      if (a === 'reply') { replyMsg(el); return; }
      if (a === 'edit') { editMsgInline(el, el.dataset.uid, txt, mid); return; }
      if (a === 'delete') { deleteMsgInline(el, el.dataset.uid, mid); return; }
    };
  });
}

function editMsgInline(el, uid, txt, mid) {
  if (editingMsg) cancelEdit();
  const wrap = el.querySelector('.msg-body-wrap'), textEl = wrap.querySelector('.msg-text'), actEl = wrap.querySelector('.msg-actions');
  textEl.style.display = 'none'; actEl.style.display = 'none'; el.classList.add('editing');
  const inp = document.createElement('textarea'); inp.className = 'msg-edit-input'; inp.value = txt;
  const btns = document.createElement('div'); btns.className = 'msg-edit-actions';
  btns.innerHTML = '<button class="msg-edit-save">保存</button><button class="msg-edit-cancel">取消</button>';
  wrap.appendChild(inp); wrap.appendChild(btns); inp.focus(); inp.setSelectionRange(txt.length, txt.length);
  btns.querySelector('.msg-edit-save').onclick = async () => {
    const nt = inp.value.trim(); if (!nt || nt === txt) { cancelEdit(); return; }
    textEl.innerHTML = md2html(nt); el.dataset.text = nt;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ uid: me.id, targetId: me.id, type: '9010', data: { msgId: mid, text: await encrypt(nt) } }));
    cancelEdit();
  };
  btns.querySelector('.msg-edit-cancel').onclick = cancelEdit;
  editingMsg = { el, textEl, actEl, inp, btns, wrap };
}
function cancelEdit() { if (!editingMsg) return; const e = editingMsg; e.textEl.style.display = ''; e.actEl.style.display = ''; e.inp.remove(); e.btns.remove(); e.el.classList.remove('editing'); editingMsg = null; }

function deleteMsgInline(el, uid, mid) {
  if (!confirm('删除此消息？')) return;
  el.querySelector('.msg-text').innerHTML = '<span class="msg-deleted">此消息已删除</span>';
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ uid: me.id, targetId: me.id, type: '9011', data: { msgId: mid } }));
}

// ── User list ───────────────────────────────────
function renderUsers() {
  $('sidebarTitle').textContent = '在线 (' + users.length + ')';
  $('userList').innerHTML = users.map(u => {
    const on = u.isMe || u.isConnected(), lat = u.latency ? u.latency + 'ms' : '';
    return `<li><div class="user-row"><div class="user-dot ${on ? 'on' : 'off'}"></div><div class="msg-avatar" style="background:${ucolor(u.id)};width:28px;height:28px;font-size:12px">${(u.nickname || u.id)[0]?.toUpperCase() || '?'}</div><div class="user-info"><div class="user-name">${esc(u.nickname || u.id)}${u.isMe ? '（我）' : ''}</div>${u.device ? `<div class="user-device">${esc(u.device)}</div>` : ''}</div>${lat ? `<div class="user-latency">${lat}</div>` : ''}</div></li>`;
  }).join('');
}

function refreshUsers(data) {
  const next = data.map(u => {
    let o = users.find(x => x.id === u.id);
    if (o) { o.nickname = u.nickname || o.nickname; o.device = u.device || o.device; return o; }
    let x = new XChatUser(); x.id = u.id; x.isMe = u.id === me.id; x.nickname = u.nickname; x.device = u.device || '';
    x.onConnectionStateChange = () => renderUsers();
    return x;
  });
  const gone = users.filter(u => !next.find(n => n.id === u.id));
  gone.forEach(u => { u.closeConnection(); if (!u.isMe && connTimes[u.id]) snack(esc(u.nickname || u.id) + ' 已离开'); });
  const joined = next.filter(n => !users.find(o => o.id === n.id) && !n.isMe);
  joined.forEach(n => { connTimes[n.id] = Date.now(); snack(esc(n.nickname || n.id) + ' 加入了房间'); });
  users = next;
  users.forEach(u => {
    if (u.isMe) return;
    u.onReceiveFile = f => addFileMsg(u.id, f);
    u.onReceiveProgress = (got, total, name) => {
      $('sendProgress').style.display = 'block'; $('progFill').style.width = (got / total * 100) + '%';
      $('progLabel').textContent = `接收 ${esc(name || '文件')} ${fsiz(got)}/${fsiz(total)}`;
      if (got >= total) setTimeout(() => { $('sendProgress').style.display = 'none'; $('progFill').style.width = '0'; }, 500);
    };
  });
  renderUsers();
}

// ── WebSocket ───────────────────────────────────
function connect() {
  if (ws) { ws.onclose = null; ws.onerror = null; try { ws.close(); } catch (_) {} }
  connecting = true;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.hostname + (location.port ? ':' + location.port : '');
  let room = location.pathname.replace(/^\//, '').split('/')[0];
  if (room === 'chat') room = '';
  $('roomMeta').textContent = '连接中…';
  const url = `${proto}://${host}/ws/${room}${pwd ? '/' + pwd.substring(0,8) + '...' : ''}`;
  console.log('[ws] connecting to:', url, 'hasPwd:', !!pwd);
  ws = new WebSocket(`${proto}://${host}/ws/${room}${pwd ? '/' + pwd : ''}`);
  ws.onopen = () => { connecting = false; rcnt = 0; $('roomMeta').textContent = '已连接'; if (nick) ws.send(JSON.stringify({ uid: me.id, targetId: me.id, type: '9004', data: { nickname: nick } })); };
  ws.onmessage = async e => {
    let type, data; try { ({ type, data } = JSON.parse(e.data)); } catch (_) { return; }

    if (type === '1001') {
      handleREG(data); return;
    }
    if (type === '1002') { refreshUsers(data); return; }
    if (type === '1003') { connectAll(); return; }
    if (type === '1004') { users.find(u => u.id === data.targetId)?.addIceCandidate(data.candidate); return; }
    if (type === '1005') { joinConn(data); return; }
    if (type === '1006') { joinedConn(data); return; }
    if (type === '1007') { const u = users.find(x => x.id === data.id); if (u) { u.nickname = data.nickname; renderUsers(); } return; }
    if (type === '1008') { const u = users.find(x => x.id === data.id); if (u) { u.device = data.device; renderUsers(); } return; }
    if (type === '1009') { showTyping(data.id, data.typing); return; }
    if (type === '1010') { data.text = await decrypt(data.text); addMsg(data.uid, data.text, data.ts, data.msgId); return; }
    if (type === '1011') { for (const m of data) { m.text = await decrypt(m.text); addMsg(m.uid, m.text, m.ts, m.msgId, true); } return; }
    if (type === '1012') { const el = $('msgs').querySelector(`[data-mid="${data.msgId}"]`); if (el) { el.querySelector('.msg-text').innerHTML = md2html(await decrypt(data.text)); el.dataset.text = await decrypt(data.text); } return; }
    if (type === '1013') { const el = $('msgs').querySelector(`[data-mid="${data.msgId}"]`); if (el) el.querySelector('.msg-text').innerHTML = '<span class="msg-deleted">此消息已删除</span>'; return; }
    if (type === '1014') { $('msgs').innerHTML = ''; _lastDate = ''; snack('聊天记录已清空'); return; }
  };
  ws.onclose = () => { if (connecting) return; $('roomMeta').textContent = '重连中…'; setTimeout(() => connect(), Math.min(1000 * Math.pow(2, rcnt), 30000)); rcnt++; };
  ws.onerror = () => { try { ws.close(); } catch (_) {} };
}

function handleREG(data) {
  console.log('[ws] REG response:', JSON.stringify(data));
  // Need password
  if (!data.roomId && data.needPwd) {
    connecting = true;
    show('pwdDlg'); $('pwdInput').value = ''; $('pwdInput').focus();
    $('pwdInput').onkeydown = e => { if (e.key === 'Enter') submitPwd(); };
    $('btnSubmitPwd').onclick = submitPwd;
    return;
  }
  // Unknown room
  if (!data.roomId) {
    connecting = true;
    if (pendingRoom) { addMsg('system', '⚠️ 房间不存在，即将返回大厅…'); setTimeout(() => location.href = '/', 2000); }
    else { $('main').style.display = ''; $('sidebar').style.display = ''; }
    return;
  }
  // Success
  me.id = data.id; me.roomId = data.roomId;
  $('main').style.display = ''; $('sidebar').style.display = '';
  if (data.turns?.length) {
    const existing = new Set(window.xrelay_config.iceServers.filter(s => s.urls).flatMap(s => [].concat(s.urls)));
    data.turns.forEach(t => { const urls = [].concat(t.urls || []); if (!urls.some(u => existing.has(u))) window.xrelay_config.iceServers.push(t); });
  }
  ws.send(JSON.stringify({ uid: me.id, targetId: me.id, type: '9005', data: { device: dev() } }));
  $('roomName').textContent = data.roomName || data.roomId || 'X-Relay 公共频道';
  $('roomMeta').textContent = data.roomId ? (data.turns?.length ? '已连接 · 加密' : '已连接') : '公共频道';
  $('btnShare').style.display = data.roomId ? '' : 'none';
  $('btnDeleteRoom').style.display = data.roomId ? '' : 'none';
  $('btnClearMsgs').style.display = data.roomId ? 'none' : '';
}

// ── WebRTC ──────────────────────────────────────
function connectAll() {
  users.filter(u => u.id !== me.id).forEach(t => {
    t.onicecandidate = c => ws.send(JSON.stringify({ uid: me.id, targetId: t.id, type: '9001', data: { candidate: c } }));
    t.createConnection().then(() => ws.send(JSON.stringify({ uid: me.id, targetId: t.id, type: '9002', data: { targetAddr: t.connAddressMe } }))).catch(e => { console.error(e); t.closeConnection(); });
  });
}
async function joinConn(d) {
  const t = users.find(u => u.id === d.targetId); if (!t) return;
  t.onicecandidate = c => ws.send(JSON.stringify({ uid: me.id, targetId: t.id, type: '9001', data: { candidate: c } }));
  try { await t.connectTarget(d.offer.sdp); ws.send(JSON.stringify({ uid: me.id, targetId: t.id, type: '9003', data: { targetAddr: t.connAddressMe } })); } catch (e) { console.error(e); t.closeConnection(); }
}
async function joinedConn(d) {
  const t = users.find(u => u.id === d.targetId); if (!t) return;
  await t.setRemoteSdp(d.answer.sdp); renderUsers();
}

// ── Typing ──────────────────────────────────────
function showTyping(uid, is) {
  if (uid === me.id) return;
  clearTimeout(typingTimers[uid]);
  if (is) {
    $('typingBar').innerHTML = esc((users.find(u => u.id === uid)?.nickname) || uid) + ' 正在输入 <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
    typingTimers[uid] = setTimeout(() => { $('typingBar').innerHTML = ''; }, 3000);
  }
}

// ── Emoji shortcuts ─────────────────────────────
const EMOJI = { ':)':'😊', ':D':'😄', ':P':'😛', ';)':'😉', ':<':'😢', ':O':'😮', ':|':'😐', ':/':'😕', '<3':'❤️', ':+1:':'👍', ':-1:':'👎', ':ok:':'👌', ':fire:':'🔥', ':100:':'💯', ':tada:':'🎉', ':eyes:':'👀', ':rocket:':'🚀', ':check:':'✅', ':x:':'❌' };
function emojiReplace(t) { return t.replace(/(:\+1:|:-1:|:ok:|:fire:|:100:|:tada:|:eyes:|:rocket:|:check:|:x:|:\)|:D|:P|;\)|:<|:O|:\||:\/|<3)/g, m => EMOJI[m] || m); }

// ── Send message ────────────────────────────────
async function sendMsg() {
  let txt = $('msgInput').value.trim(); if (!txt) return;
  txt = emojiReplace(txt);
  const replyTo = $('replyQuote');
  const replyData = replyTo ? { replyTo: replyTo.dataset.replyTo, replyName: replyTo.dataset.replyName, replyText: replyTo.dataset.replyText } : null;
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ uid: me.id, targetId: me.id, type: '9007', data: { text: await encrypt(txt), reply: replyData } }));
  $('msgInput').value = ''; $('msgInput').style.height = 'auto'; cancelReply();
}
$('msgInput').oninput = function () {
  this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  if (!ws || ws.readyState !== WebSocket.OPEN || typingThrottle) return;
  typingThrottle = setTimeout(() => { typingThrottle = null; }, 800);
  ws.send(JSON.stringify({ uid: me.id, targetId: me.id, type: '9006', data: { typing: true } }));
};
$('msgInput').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } };

// ── Files ───────────────────────────────────────
async function sendFiles(files) {
  const arr = Array.from(files); if (!arr.length) return;
  pfiles = arr;
  const others = users.filter(u => !u.isMe);
  if (!others.length) { snack('没有在线用户'); return; }
  const bi = $('fileBatchInfo');
  bi.innerHTML = arr.length === 1 ? '' : '<b>' + arr.length + ' 个文件</b>' + arr.map(f => `<div>${ficon(f.name)} ${esc(f.name)} (${fsiz(f.size)})</div>`).join('');
  if (others.length === 1) { await sendToOne(others[0], arr); pfiles = []; return; }
  showSendDlg(others);
}
function showSendDlg(others) {
  $('sendUserList').innerHTML = others.map(u => `<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin:2px 0;border-radius:8px;cursor:pointer"><input type="checkbox" value="${u.id}" style="accent-color:var(--md-sys-color-primary)"><span>${esc(u.nickname || u.id)}</span></label>`).join('');
  $('sendProgress').style.display = 'none'; show('sendDlg');
}
$('btnCancelSend').onclick = () => { cancelXfer = true; hide('sendDlg'); pfiles = []; };
$('btnCancelXfer').onclick = () => { cancelXfer = true; };
$('btnConfirmSend').onclick = async () => {
  const sel = [...$('sendUserList').querySelectorAll('input:checked')].map(cb => users.find(u => u.id === cb.value));
  if (!sel.length || !pfiles.length) return;
  $('sendProgress').style.display = 'block'; $('btnConfirmSend').disabled = true; cancelXfer = false;
  const allSize = pfiles.reduce((s, f) => s + f.size, 0); let done = 0, start = Date.now();
  for (const u of sel) { for (const f of pfiles) {
    if (cancelXfer) break;
    await u.sendFile({ name: f.name, size: f.size }, f, (sent, total) => {
      $('progFill').style.width = ((done + sent) / (allSize * sel.length) * 100) + '%';
      $('progLabel').textContent = esc(u.nickname || u.id) + ' ' + ((done + sent) / (Date.now() - start) * 1000 > 1048576 ? ((done + sent) / (Date.now() - start) * 1000 / 1048576).toFixed(1) + ' MB/s' : ((done + sent) / (Date.now() - start) * 1000 / 1024).toFixed(1) + ' KB/s');
    });
    done += f.size;
  } if (cancelXfer) break; }
  if (!cancelXfer) addMsg(me.id, '[文件] ' + pfiles.map(f => f.name).join(', '));
  hide('sendDlg'); $('btnConfirmSend').disabled = false; $('progFill').style.width = '0'; pfiles = [];
};
async function sendToOne(u, files) {
  $('sendUserList').innerHTML = ''; $('sendProgress').style.display = 'block'; show('sendDlg'); $('btnConfirmSend').style.display = 'none'; cancelXfer = false;
  const allSize = files.reduce((s, f) => s + f.size, 0); let done = 0, start = Date.now();
  for (const f of files) {
    if (cancelXfer) break;
    await u.sendFile({ name: f.name, size: f.size }, f, (sent, total) => {
      $('progFill').style.width = ((done + sent) / allSize * 100) + '%';
      $('progLabel').textContent = esc(u.nickname || u.id) + ' ' + ((done + sent) / (Date.now() - start) * 1000 > 1048576 ? ((done + sent) / (Date.now() - start) * 1000 / 1048576).toFixed(1) + ' MB/s' : ((done + sent) / (Date.now() - start) * 1000 / 1024).toFixed(1) + ' KB/s');
    });
    done += f.size;
  }
  if (!cancelXfer) addMsg(me.id, '[文件] ' + files.map(f => f.name).join(', '));
  hide('sendDlg'); $('btnConfirmSend').style.display = ''; $('progFill').style.width = '0';
}

// ── Search ──────────────────────────────────────
function openSearch() { show('searchDlg'); $('searchInput').value = ''; $('searchInput').focus(); $('searchCount').textContent = ''; doSearch(); }
function doSearch() {
  const q = $('searchInput').value.toLowerCase().trim(), items = $('msgs').querySelectorAll('.msg'); let cnt = 0;
  items.forEach(el => { const tc = (el.textContent || '').toLowerCase(); if (!q) { el.style.display = ''; el.classList.remove('highlight'); cnt++; return; } if (tc.includes(q)) { el.style.display = ''; el.classList.add('highlight'); cnt++; } else { el.style.display = 'none'; el.classList.remove('highlight'); } });
  $('searchCount').textContent = q ? '找到 ' + cnt + ' 条匹配' : '';
}
$('searchInput').oninput = () => { clearTimeout(window._st); window._st = setTimeout(doSearch, 150); };

// ── Export ──────────────────────────────────────
function exportChat() {
  const msgs = [...$('msgs').querySelectorAll('.msg')].map(el => {
    const h = el.querySelector('.msg-author')?.textContent || '', t = el.querySelector('.msg-time')?.textContent || '',
          b = el.querySelector('.msg-text')?.textContent || '', f = el.querySelector('.msg-file-name')?.textContent || '';
    return `[${t}] ${h}: ${f || b}`;
  }).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([msgs], { type: 'text/plain' }));
  a.download = 'xrelay-' + new Date().toISOString().slice(0, 10) + '.txt'; a.click(); snack('聊天记录已导出');
}

// ── Dialogs ─────────────────────────────────────
function showNickDlg() { show('nickDlg'); $('nickInput').value = nick; $('nickInput').focus(); }
$('btnCancelNick').onclick = () => hide('nickDlg');
$('btnSaveNick').onclick = () => {
  const v = $('nickInput').value.trim(); if (!v) return; nick = v;
  document.cookie = 'nickname=' + encodeURIComponent(nick) + ';path=/;max-age=31536000';
  hide('nickDlg');
  const u = users.find(x => x.id === me.id); if (u) { u.nickname = nick; renderUsers(); }
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ uid: me.id, targetId: me.id, type: '9004', data: { nickname: nick } }));
};

// Room manage dialog
function showRoomDlg() {
  const room = location.pathname.replace(/^\//, '').split('/')[0];
  if (!room || room === 'chat') { snack('公共频道无需此操作'); return; }
  show('roomManageDlg');
  $('roomShareLink').value = location.origin + '/' + room;
  $('roomShareHint').textContent = pwd ? '加密房间需告知对方密码' : '公开房间，无需密码即可加入';
}
function copyRoomLink() { $('roomShareLink').select(); navigator.clipboard?.writeText($('roomShareLink').value).then(() => snack('链接已复制')); }
function showDeleteRoomDlg() { hide('roomManageDlg'); show('deleteRoomDlg'); $('delRoomPwdInput').value = ''; $('delRoomPwdInput').focus(); }

async function doDeleteRoom() {
  const room = location.pathname.replace(/^\//, '').split('/')[0];
  const dp = $('delRoomPwdInput').value.trim(); if (!dp) { snack('请输入删除密码'); return; }
  try {
    const res = await fetch('/api/rooms/' + room, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deletionPassword: dp }) });
    if (res.ok) { hide('deleteRoomDlg'); snack('房间已删除'); setTimeout(() => location.href = '/', 1500); }
    else snack('删除密码错误');
  } catch (_) { snack('删除失败'); }
}

// Theme & sound
function toggleTheme() { document.body.classList.toggle('light'); localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark'); }
function toggleSound() { soundOn = !soundOn; $('btnSound').classList.toggle('active', !soundOn); snack(soundOn ? '提示音已开启' : '提示音已关闭'); }

// ── Init ────────────────────────────────────────
function init() {
  if (!window.RTCPeerConnection && !window.webkitRTCPeerConnection) { addMsg('system', '⚠️ 浏览器不支持 WebRTC'); return; }
  const t = localStorage.getItem('theme'); if (t === 'light') document.body.classList.add('light');
  else if (!t && matchMedia('(prefers-color-scheme:light)').matches) document.body.classList.add('light');
  const m = document.cookie.match(/nickname=([^;]+)/); if (m) nick = decodeURIComponent(m[1]);

  const room = location.pathname.replace(/^\//, '').split('/')[0];
  if (room && room !== 'chat') {
    pendingRoom = room;
    $('main').style.display = 'none'; $('sidebar').style.display = 'none';
    connect();
    return;
  }
  start();
}

async function submitPwd() {
  const v = $('pwdInput').value; if (!v) return;
  const room = pendingRoom || location.pathname.replace(/^\//, '').split('/')[0];
  try {
    const sha = await sha256(v);
    pwd = await hmac256(sha, room);
    roomKey = await deriveKey(v, room);
    console.log('[auth] pwd set, length:', pwd.length, 'room:', room);
    hide('pwdDlg');
    connect();
  } catch (e) {
    console.error('[auth] submitPwd error:', e);
    snack('加密失败: ' + (e.message || '未知错误'));
    show('pwdDlg');
  }
}

function start() {
  connect();
  setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: '9999' }));
    users.forEach(u => { if (!u.isMe) u.measureLatency(); });
  }, 10000);
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

// ── Events ──────────────────────────────────────
$('btnNick').onclick = showNickDlg;
$('btnFile').onclick = $('btnFileMob').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.onchange = e => { if (e.target.files.length) sendFiles(e.target.files); }; i.click(); };
$('btnSend').onclick = sendMsg;
$('btnTheme').onclick = toggleTheme;
$('btnSound').onclick = toggleSound;
$('btnClear').onclick = () => { if (confirm('清空本地显示？')) { $('msgs').innerHTML = ''; _lastDate = ''; snack('已清空'); } };
$('btnExport').onclick = $('btnExportMob').onclick = exportChat;
$('btnClearMsgs').onclick = async () => { if (!confirm('清空公共频道所有聊天记录？此操作不可逆！')) return; try { await fetch('/api/rooms/internal/clear', { method: 'POST' }); } catch (_) { snack('清空失败'); } };
$('btnRoom').onclick = showRoomDlg;
$('btnShare').onclick = showRoomDlg;
$('btnDeleteRoom').onclick = showDeleteRoomDlg;
$('btnUsersMob').onclick = () => document.body.classList.toggle('show-sidebar');
$('mobileBackdrop').onclick = () => document.body.classList.remove('show-sidebar');
$('btnSearch').onclick = openSearch;

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { hide('searchDlg'); hide('roomManageDlg'); hide('deleteRoomDlg'); if (editingMsg) cancelEdit(); }
  if (e.ctrlKey && e.key === 'k') { e.preventDefault(); openSearch(); }
  if (e.ctrlKey && e.key === 'l') { e.preventDefault(); $('msgs').innerHTML = ''; snack('已清空'); }
});

['dragenter', 'dragover'].forEach(ev => document.body.addEventListener(ev, e => { e.preventDefault(); document.body.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(ev => document.body.addEventListener(ev, e => { e.preventDefault(); document.body.classList.remove('dragging'); }));
document.body.addEventListener('drop', e => { if (e.dataTransfer.files.length) sendFiles(e.dataTransfer.files); });
document.addEventListener('paste', e => { for (const item of (e.clipboardData?.items || [])) { if (item.type.startsWith('image/')) { e.preventDefault(); const f = item.getAsFile(); if (f) sendFiles([new File([f], 'paste-' + Date.now() + '.png', { type: 'image/png' })]); break; } } });

$('userList').addEventListener('contextmenu', e => {
  const li = e.target.closest('li'); if (!li) return;
  const txt = li.querySelector('.user-name')?.textContent.replace('（我）', '').trim();
  const u = users.find(x => (x.nickname || x.id) === txt || x.id === txt);
  if (u && !u.isMe) showCtx(e, u.id);
});

document.addEventListener('visibilitychange', () => { hidden = document.hidden; if (!hidden) { unread = 0; updateFab(); document.title = 'X-Relay'; } });
document.addEventListener('DOMContentLoaded', init);

// ── Context menu ────────────────────────────────
function showCtx(e, uid) {
  e.preventDefault();
  const name = (users.find(u => u.id === uid)?.nickname) || uid;
  const m = $('ctxMenu');
  m.innerHTML = `<div onclick="sendToId('${uid}')">📁 发送文件</div><div onclick="copyId('${uid}')">📋 复制 ID</div>`;
  m.style.display = 'block'; m.style.left = Math.min(e.clientX, innerWidth - 170) + 'px'; m.style.top = Math.min(e.clientY, innerHeight - 100) + 'px';
  setTimeout(() => document.addEventListener('click', () => m.style.display = 'none', { once: true }), 0);
}
function sendToId(uid) { $('ctxMenu').style.display = 'none'; const u = users.find(x => x.id === uid); if (!u) return; const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.onchange = e => { if (e.target.files.length) { pfiles = Array.from(e.target.files); showSendDlg([u]); } }; inp.click(); }
function copyId(uid) { $('ctxMenu').style.display = 'none'; navigator.clipboard?.writeText(uid).then(() => snack('已复制')); }
