// ═══════════════════════════════════════════
//  X-Relay — Cloudflare Worker
//  WebSocket + HTTP API + D1
//  静态文件: [assets] 优先, 内嵌 HTML 兜底
//  部署: wrangler deploy (非 Deploy 按钮)
// ═══════════════════════════════════════════

// ── 内嵌 HTML 兜底 (Assets 不可用时) ─────────
const LOBBY_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>X-Relay · 大厅</title>
<style>
:root{--bg:#0f172a;--bg2:#1a2332;--bg3:#243044;--fg:#e2e8f0;--fg2:#94a3b8;--fg3:#64748b;--accent:#14b8a6;--border:#334155;--red:#ef4444;--radius:10px}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font:14px system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 16px}
.lobby{max-width:640px;width:100%}
.lobby h1{font-size:28px;color:var(--accent);text-align:center;margin-bottom:4px}
.lobby .sub{text-align:center;color:var(--fg3);margin-bottom:20px;font-size:13px}
.toolbar{display:flex;gap:8px;margin-bottom:20px;justify-content:center}
.toolbar button{background:var(--bg2);color:var(--accent);border:1px solid var(--border);padding:8px 18px;border-radius:8px;cursor:pointer;font:inherit;font-size:13px;font-weight:600}
.toolbar button:hover{background:var(--bg3)}
.toolbar button.primary{background:var(--accent);color:#fff}
.room-list{display:flex;flex-direction:column;gap:8px}
.room-card{display:flex;align-items:center;gap:12px;padding:14px 18px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;text-decoration:none;color:inherit}
.room-card:hover{border-color:var(--accent)}
.room-card .icon{font-size:20px}
.room-card .info{flex:1}
.room-card .name{font-size:15px;font-weight:600}
.room-card .meta{font-size:12px;color:var(--fg2)}
.badge{padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600}
.badge.on{background:#22c55e;color:#fff}
.badge.off{background:var(--fg3);color:#fff}
.actions{display:flex;gap:4px}
.actions button{background:none;border:none;cursor:pointer;font-size:14px;padding:4px 6px;border-radius:4px;opacity:.6}
.actions button:hover{opacity:1}
.public-room{margin-top:16px;padding:14px 18px;background:var(--bg2);border:1px dashed var(--border);border-radius:var(--radius);text-align:center}
.public-room a,.footer-links a{color:var(--accent);text-decoration:none}
.footer-links{text-align:center;margin-top:24px;font-size:12px;color:var(--fg3)}
.dialog-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;display:none;align-items:center;justify-content:center}
.dialog-overlay.show{display:flex}
.dialog{background:var(--bg2);border-radius:var(--radius);padding:24px;width:400px;max-width:92vw;border:1px solid var(--border)}
.dialog h3{font-size:18px;margin-bottom:16px;color:var(--accent)}
.dialog label{display:block;font-size:12px;color:var(--fg2);margin-bottom:4px;margin-top:12px}
.dialog input[type=text],.dialog input[type=password]{width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit;font-size:14px;outline:none}
.dialog input:focus{border-color:var(--accent)}
.dialog .hint{font-size:11px;color:var(--fg3);margin-top:2px}
.dialog .checkbox-row{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px}
.dialog .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
.dialog .actions button{padding:8px 20px;border-radius:6px;border:1px solid var(--border);cursor:pointer;font:inherit;font-size:13px;font-weight:600}
.btn-cancel{background:var(--bg);color:var(--fg)}
.btn-submit{background:var(--accent);color:#fff}
.toast{position:fixed;top:16px;right:16px;background:var(--accent);color:#fff;padding:8px 18px;border-radius:6px;font-size:13px;z-index:9999;opacity:0;transform:translateY(-8px);transition:all .2s}
.toast.on{opacity:1;transform:translateY(0)}
</style>
</head>
<body>
<div class="toast" id="toast"></div>
<div class="lobby">
<h1>X-Relay</h1><p class="sub">局域网 P2P 文字/文件传输</p>
<div class="toolbar">
<button onclick="loadRooms()">刷新</button>
<button class="primary" onclick="showCreateDlg()">+ 创建房间</button>
</div>
<div class="room-list" id="roomList"></div>
<div class="public-room">或直接进入 <a href="/chat">公共频道</a>（无需密码）</div>
<div class="footer-links"><a href="https://github.com/stop666two/X-Relay" target="_blank">GitHub</a></div>
</div>
<div class="dialog-overlay" id="createDlg"><div class="dialog">
<h3>创建新房间</h3>
<label>房间名称 *</label><input type="text" id="roomName" maxlength="32" placeholder="给房间取个名字">
<label>房间密码（可选）</label><input type="password" id="roomPwd" placeholder="留空则不加密">
<div class="hint">设置密码后消息端到端加密</div>
<label>删除密码 *</label><input type="password" id="delPwd" placeholder="用于删除此房间">
<div class="checkbox-row"><input type="checkbox" id="roomVisible" checked> <span>在房间大厅中展示</span></div>
<div class="actions"><button class="btn-cancel" onclick="hideCreateDlg()">取消</button><button class="btn-submit" onclick="doCreate()">创建</button></div>
</div></div>
<div class="dialog-overlay" id="deleteDlg"><div class="dialog">
<h3>删除房间</h3><p style="font-size:13px;color:var(--fg2);margin-bottom:12px">正在删除: <strong id="delRoomName"></strong></p>
<label>删除密码</label><input type="password" id="delPwdInput" placeholder="输入此房间的删除密码">
<div class="actions"><button class="btn-cancel" onclick="hideDeleteDlg()">取消</button><button class="btn-submit" style="background:var(--red)" onclick="doDelete()">确认删除</button></div>
</div></div>
<script>
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),2000)}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
async function sha256(s){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return[...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('')}
async function loadRooms(){
const list=document.getElementById('roomList');list.innerHTML='<div class="empty">加载中...</div>';
try{
const res=await fetch('/api/rooms');const rooms=await res.json();
if(!rooms.length){list.innerHTML='<div class="empty">暂无活跃房间</div>';return}
list.innerHTML=rooms.map(r=>'<a class="room-card" href="/'+r.id+'"><span class="icon">'+(r.encrypted?'':'')+'</span><div class="info"><div class="name">'+esc(r.name)+'</div><div class="meta">'+(r.encrypted?'加密 · ':'公开 · ')+r.online+' 人在线</div></div><span class="badge '+(r.online?'on':'off')+'">'+(r.online?r.online+' 在线':'空')+'</span></a>').join('')
}catch(e){list.innerHTML='<div class="empty">无法加载房间列表</div>'}
}
function showCreateDlg(){document.getElementById('createDlg').classList.add('show');document.getElementById('roomName').focus()}
function hideCreateDlg(){document.getElementById('createDlg').classList.remove('show')}
async function doCreate(){
const name=document.getElementById('roomName').value.trim();
const pwdRaw=document.getElementById('roomPwd').value.trim();
const delPwd=document.getElementById('delPwd').value.trim();
const visible=document.getElementById('roomVisible').checked;
if(!name){toast('请输入房间名称');return}
if(!delPwd){toast('请设置删除密码');return}
const pwd=pwdRaw?await sha256(pwdRaw):'';
try{
const res=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,password:pwd,deletionPassword:delPwd,visibleInLobby:visible})});
if(res.ok){const data=await res.json();hideCreateDlg();toast('房间已创建');setTimeout(()=>location.href='/'+data.roomKey,800)}
else{const err=await res.json();toast('创建失败: '+(err.error||'未知错误'))}
}catch(e){toast('创建失败')}
}
let _curDel=null;
function showDelete(id,name){_curDel=id;document.getElementById('delRoomName').textContent=name;document.getElementById('deleteDlg').classList.add('show');document.getElementById('delPwdInput').value='';document.getElementById('delPwdInput').focus()}
function hideDeleteDlg(){document.getElementById('deleteDlg').classList.remove('show');_curDel=null}
async function doDelete(){
if(!_curDel)return;
const pwd=document.getElementById('delPwdInput').value.trim();
if(!pwd){toast('请输入删除密码');return}
try{
const res=await fetch('/api/rooms/'+_curDel,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({deletionPassword:pwd})});
if(res.ok){hideDeleteDlg();loadRooms();toast('房间已删除')}else toast('删除密码错误')
}catch(e){toast('删除失败')}
}
document.getElementById('roomList').addEventListener('click',e=>{
const btn=e.target.closest('button');
if(!btn)return;
e.preventDefault();e.stopPropagation();
const roomId=btn.closest('.room-card').href.split('/').pop();
if(btn.textContent.includes('删除'))showDelete(roomId,roomId);
});
document.querySelectorAll('.dialog-overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('show')}));
document.addEventListener('keydown',e=>{if(e.key==='Escape'){hideCreateDlg();hideDeleteDlg()}});
loadRooms();setInterval(loadRooms,15000);
</script>
</body>
</html>`;

const CHAT_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>X-Relay</title>
<style>
:root{--md-sys-color-primary:#4dd9cf;--md-sys-color-on-primary:#003734;--md-sys-color-surface:#0e1514;--md-sys-color-surface-container:#161c1b;--md-sys-color-surface-container-high:#202726;--md-sys-color-surface-container-highest:#2b3230;--md-sys-color-on-surface:#dce4e2;--md-sys-color-on-surface-variant:#bfc9c7;--md-sys-color-outline-variant:#3f4947;--error:#e57373;--success:#81c784}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;display:flex;background:var(--md-sys-color-surface);color:var(--md-sys-color-on-surface);font:400 14px/1.5 system-ui,sans-serif}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative;background:var(--md-sys-color-surface-container);margin:8px 0 8px 8px;border-radius:16px}
.room-header{padding:12px 16px;background:var(--md-sys-color-surface-container-high);border-bottom:1px solid var(--md-sys-color-outline-variant);display:flex;align-items:center;gap:8px}
.room-name{font-size:16px;font-weight:600;flex:1}
.room-meta{font-size:12px;color:var(--md-sys-color-on-surface-variant)}
.btn-icon{width:40px;height:40px;border-radius:50%;border:none;background:none;color:var(--md-sys-color-on-surface-variant);cursor:pointer;display:flex;align-items:center;justify-content:center}
.btn-icon:hover{background:rgba(220,228,226,.08);color:var(--md-sys-color-on-surface)}
.msgs{flex:1;overflow-y:auto;padding:8px 0}
.msg{display:flex;gap:8px;padding:4px 16px}
.msg:hover{background:rgba(220,228,226,.08)}
.msg-avatar{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#fff}
.msg-body{flex:1;min-width:0}
.msg-head{display:flex;align-items:baseline;gap:8px}
.msg-author{font-size:13px;font-weight:600}
.msg-time{font-size:11px;color:var(--md-sys-color-on-surface-variant)}
.msg-text{font-size:14px;line-height:1.55;word-break:break-word;white-space:pre-wrap}
.input-area{border-top:1px solid var(--md-sys-color-outline-variant);padding:8px 16px 12px}
.input-row{display:flex;align-items:flex-end;gap:8px}
.input-row textarea{flex:1;min-height:40px;max-height:120px;padding:8px 12px;border:1px solid var(--md-sys-color-outline-variant);border-radius:20px;background:var(--md-sys-color-surface-container-highest);color:var(--md-sys-color-on-surface);font:inherit;resize:none;outline:none}
.input-row textarea:focus{border-color:var(--md-sys-color-primary)}
.dialog-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:none;align-items:center;justify-content:center}
.dialog-overlay.show{display:flex}
.dialog{background:var(--md-sys-color-surface-container-high);border-radius:16px;padding:24px;min-width:320px}
.dialog h3{font-size:18px;font-weight:500;margin-bottom:12px}
.dialog input{width:100%;padding:8px 12px;border:1px solid var(--md-sys-color-outline-variant);border-radius:8px;background:var(--md-sys-color-surface-container-highest);color:var(--md-sys-color-on-surface);font:inherit;font-size:14px;outline:none;margin-bottom:8px}
.dialog input:focus{border-color:var(--md-sys-color-primary)}
.btn-filled{padding:8px 24px;border-radius:20px;border:none;background:var(--md-sys-color-primary);color:var(--md-sys-color-on-primary);font:inherit;font-size:14px;font-weight:500;cursor:pointer}
.snackbar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--md-sys-color-surface-container-highest);color:var(--md-sys-color-on-surface);padding:8px 24px;border-radius:8px;z-index:9999;font-size:13px;opacity:0;transition:opacity .2s}
.snackbar.show{opacity:1}
</style>
</head>
<body>
<div class="snackbar" id="snackbar"></div>
<main class="main" id="main" style="display:none">
<header class="room-header">
<span class="room-name" id="roomName">X-Relay</span>
<span class="room-meta" id="roomMeta"></span>
<a class="btn-icon" href="/" title="大厅">🏠</a>
</header>
<div class="msgs" id="msgs"></div>
<div class="input-area">
<div class="input-row">
<textarea id="msgInput" rows="1" placeholder="输入消息... (Enter 发送)"></textarea>
<button class="btn-icon" id="btnSend" title="发送">📤</button>
</div>
</div>
</main>
<div class="dialog-overlay" id="pwdDlg">
<div class="dialog">
<h3>房间密码</h3>
<input type="password" id="pwdInput" placeholder="输入密码">
<button class="btn-filled" id="btnSubmitPwd" style="width:100%;margin-top:8px">进入</button>
</div>
</div>
<script>
const $=id=>document.getElementById(id);
let ws=null,pwd='',roomKey=null,me={id:''},pendingRoom=null,connecting=false;
const ab2b64=buf=>btoa(String.fromCharCode(...new Uint8Array(buf)));
const b642ab=s=>{const b=atob(s),r=new Uint8Array(b.length);for(let i=0;i<b.length;i++)r[i]=b.charCodeAt(i);return r.buffer};
async function sha256(s){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return[...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('')}
async function hmac256(data,key){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(data));return[...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('')}
async function deriveKey(pw,room){const km=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:new TextEncoder().encode('x-relay:'+room),iterations:100000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function encrypt(t){if(!roomKey)return t;const iv=crypto.getRandomValues(new Uint8Array(12)),ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},roomKey,new TextEncoder().encode(t));return JSON.stringify({v:1,iv:ab2b64(iv),ct:ab2b64(ct)})}
async function decrypt(p){if(!roomKey)return p;try{const{iv,ct}=JSON.parse(p);return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:b642ab(iv)},roomKey,b642ab(ct)))}catch(_){return'[无法解密]'}}
function tfmt(ts){const d=new Date(Number(ts)),p=n=>String(n).padStart(2,'0');return p(d.getHours())+':'+p(d.getMinutes())}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function snack(msg){const s=$('snackbar');s.textContent=msg;s.classList.add('show');setTimeout(()=>s.classList.remove('show'),2000)}
const COLORS=['#e57373','#f06292','#ba68c8','#7986cb','#64b5f6','#4fc3f7','#4dd0e1','#4db6ac','#81c784','#ffb74d','#ff8a65'];
const uc={},ucolor=uid=>{if(!uc[uid])uc[uid]=COLORS[Object.keys(uc).length%COLORS.length];return uc[uid]};
function addMsg(uid,text,ts,msgId){if(!text)return;const el=document.createElement('div');el.className='msg';const name=uid==='system'?'系统':(uid===me.id?'我':uid);el.innerHTML='<div class="msg-avatar" style="background:'+ucolor(uid)+'">'+(name[0]||'?').toUpperCase()+'</div><div class="msg-body"><div class="msg-head"><span class="msg-author">'+esc(name)+'</span><span class="msg-time">'+tfmt(ts)+'</span></div><div class="msg-text">'+esc(text)+'</div></div>';$('msgs').appendChild(el);$('msgs').scrollTop=$('msgs').scrollHeight}
function connect(){
if(ws){ws.onclose=null;try{ws.close()}catch(_){}}
connecting=true;
const proto=location.protocol==='https:'?'wss':'ws';
const host=location.host;
let room=location.pathname.replace(/^\\//,'').split('/')[0];
if(room==='chat')room='';
$('roomMeta').textContent='connecting...';
ws=new WebSocket(proto+'://'+host+'/ws/'+room+(pwd?'/'+pwd:''));
ws.onopen=()=>{connecting=false;$('roomMeta').textContent='online'};
ws.onmessage=async e=>{
let type,data;try{({type,data}=JSON.parse(e.data))}catch(_){return}
if(type==='1001'){
if(!data.roomId&&data.needPwd){showPwdDlg();return}
if(!data.roomId)return;
me.id=data.id;$('main').style.display='';$('roomName').textContent=data.roomName||data.roomId;$('roomMeta').textContent=data.needPwd?'encrypted':'public';return
}
if(type==='1010'){data.text=await decrypt(data.text);addMsg(data.uid,data.text,data.ts,data.msgId);return}
if(type==='1011'){for(const m of data){m.text=await decrypt(m.text);addMsg(m.uid,m.text,m.ts,m.msgId)}return}
};
ws.onclose=()=>{if(connecting)return;$('roomMeta').textContent='reconnecting...';setTimeout(connect,3000)};
ws.onerror=()=>{try{ws.close()}catch(_){}}
}
function showPwdDlg(){$('pwdDlg').classList.add('show');$('pwdInput').value='';$('pwdInput').focus()}
$('btnSubmitPwd').onclick=async()=>{
const v=$('pwdInput').value;if(!v)return;
const room=pendingRoom||location.pathname.replace(/^\\//,'').split('/')[0];
pwd=await hmac256(await sha256(v),room);
roomKey=await deriveKey(v,room);
$('pwdDlg').classList.remove('show');
connect();
};
$('msgInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg()}};
$('btnSend').onclick=sendMsg;
async function sendMsg(){
const txt=$('msgInput').value.trim();if(!txt||!ws||ws.readyState!==1)return;
ws.send(JSON.stringify({uid:me.id,targetId:me.id,type:'9007',data:{text:await encrypt(txt)}}));
$('msgInput').value='';
}
(function init(){
const room=location.pathname.replace(/^\\//,'').split('/')[0];
if(room&&room!=='chat'){pendingRoom=room;$('main').style.display='none';connect()}else{$('main').style.display='';connect()}
setInterval(()=>{if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'9999'}))},10000);
})();
</script>
</body>
</html>`;

// ── 安全工具 ────────────────────────────────
function sanitize(str, max) {
  return String(str || '').replace(/[<>"']/g, '').trim().slice(0, max);
}

// ── 频率限制 ────────────────────────────────
const apiRate = new Map();
function checkApiRate(ip) {
  const now = Date.now(), e = apiRate.get(ip) || { count: 0, reset: now + 10000 };
  if (now > e.reset) { e.count = 0; e.reset = now + 10000; }
  apiRate.set(ip, e);
  return ++e.count <= 20;
}

const wsRate = new Map();
function checkWsRate(uid) {
  const now = Date.now(), e = wsRate.get(uid) || { count: 0, reset: now + 1000 };
  if (now > e.reset) { e.count = 0; e.reset = now + 1000; }
  wsRate.set(uid, e);
  return ++e.count <= 10;
}

function pruneRateMaps() {
  const now = Date.now();
  for (const [k, v] of apiRate) if (now > v.reset + 120000) apiRate.delete(k);
  for (const [k, v] of wsRate) if (now > v.reset + 60000) wsRate.delete(k);
}

// ── 响应头 ──────────────────────────────────
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer'
};

// ── Crypto ──────────────────────────────────
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

// ── D1 ─────────────────────────────────────
async function ensureSchema(db) {
  try {
    await db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, room_key TEXT NOT NULL, uid TEXT NOT NULL, text TEXT NOT NULL, nickname TEXT DEFAULT '', ts INTEGER NOT NULL, deleted INTEGER DEFAULT 0)"),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_key, ts)'),
      db.prepare("CREATE TABLE IF NOT EXISTS rooms (room_key TEXT PRIMARY KEY, name TEXT NOT NULL, password TEXT DEFAULT '', deletion_password TEXT NOT NULL, visible INTEGER DEFAULT 1, created_at INTEGER NOT NULL)"),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_rooms_visible ON rooms(visible, created_at)'),
      db.prepare("CREATE TABLE IF NOT EXISTS nicknames (room_key TEXT NOT NULL, ip TEXT NOT NULL, nickname TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (room_key, ip))")
    ]);
  } catch (_) {
    // batch 失败则逐条执行
    const stmts = [
      "CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, room_key TEXT NOT NULL, uid TEXT NOT NULL, text TEXT NOT NULL, nickname TEXT DEFAULT '', ts INTEGER NOT NULL, deleted INTEGER DEFAULT 0)",
      'CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_key, ts)',
      "CREATE TABLE IF NOT EXISTS rooms (room_key TEXT PRIMARY KEY, name TEXT NOT NULL, password TEXT DEFAULT '', deletion_password TEXT NOT NULL, visible INTEGER DEFAULT 1, created_at INTEGER NOT NULL)",
      'CREATE INDEX IF NOT EXISTS idx_rooms_visible ON rooms(visible, created_at)',
      "CREATE TABLE IF NOT EXISTS nicknames (room_key TEXT NOT NULL, ip TEXT NOT NULL, nickname TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (room_key, ip))"
    ];
    for (const s of stmts) await db.prepare(s).run();
  }
}

async function addMessage(db, roomKey, uid, text, nickname) {
  const ts = Date.now();
  const r = await db.prepare('INSERT INTO messages (room_key, uid, text, nickname, ts) VALUES (?1, ?2, ?3, ?4, ?5)').bind(roomKey, uid, text, nickname, ts).run();
  const msgId = r.meta.last_row_id;
  if (msgId % 10 === 0) {
    const { cnt } = await db.prepare('SELECT COUNT(*) as cnt FROM messages WHERE room_key = ?1 AND deleted = 0').bind(roomKey).first();
    if (cnt > 500) await db.prepare("DELETE FROM messages WHERE room_key = ?1 AND id NOT IN (SELECT id FROM messages WHERE room_key = ?1 AND deleted = 0 ORDER BY ts DESC LIMIT 500)").bind(roomKey).run();
    await db.prepare('DELETE FROM messages WHERE room_key = ?1 AND deleted = 1 AND ts < ?2').bind(roomKey, Date.now() - 7 * 86400000).run();
  }
  return { uid, msgId, text, nickname, ts };
}

async function getMessages(db, roomKey, limit = 100) {
  const r = await db.prepare('SELECT id, uid, text, nickname, ts FROM messages WHERE room_key = ?1 AND deleted = 0 ORDER BY ts DESC LIMIT ?2').bind(roomKey, limit).all();
  return r.results.reverse().map(m => ({ uid: m.uid, msgId: m.id, text: m.text, nickname: m.nickname, ts: m.ts }));
}

async function listRooms(db, wss) {
  const r = await db.prepare("SELECT room_key, name, CASE WHEN LENGTH(password) > 0 THEN 1 ELSE 0 END as encrypted, visible, created_at FROM rooms WHERE visible = 1 ORDER BY created_at DESC").all();
  const activity = await db.prepare('SELECT room_key, MAX(ts) as last FROM messages WHERE deleted = 0 GROUP BY room_key').all();
  const actMap = {}; activity.results.forEach(a => { actMap[a.room_key] = a.last; });
  const rooms = r.results.map(rr => ({ id: rr.room_key, name: rr.name, encrypted: !!rr.encrypted, online: wss.roomUsers(rr.room_key).length, lastActivity: actMap[rr.room_key] || 0 }));
  rooms.sort((a, b) => b.online - a.online || b.lastActivity - a.lastActivity);
  return rooms;
}

async function getRoom(db, roomKey) {
  return await db.prepare('SELECT * FROM rooms WHERE room_key = ?1').bind(roomKey).first();
}

// ── WebSocket ───────────────────────────────
class WSSManager {
  rooms = {};
  add(k, id, ws, n) { if (!this.rooms[k]) this.rooms[k] = []; this.rooms[k].push({ id, ws, nickname: n, device: '' }); }
  remove(k, id) { const r = this.rooms[k]; if (r) { const i = r.findIndex(u => u.id === id); if (i !== -1) r.splice(i, 1); if (!r.length) delete this.rooms[k]; } }
  get(k, uid) { return (this.rooms[k] || []).find(u => u.id === uid); }
  roomUsers(k) { return this.rooms[k] || []; }
  broadcast(k, msg, ex) { (this.rooms[k] || []).forEach(u => { if (u.id !== ex) try { u.ws.send(msg); } catch (_) {} }); }
  broadcastAll(k, msg) { (this.rooms[k] || []).forEach(u => { try { u.ws.send(msg); } catch (_) {} }); }
}

// ── 响应 ────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SEC_HEADERS } });
}

async function getAsset(env, path) {
  if (env.ASSETS) {
    try { return await env.ASSETS.fetch('https://x' + path); } catch (_) {}
  }
  return null;
}

// ── 主入口 ──────────────────────────────────
export default {
  async fetch(request, env) {
    try {
    pruneRateMaps();

    let dbOk = globalThis.__dbOk || false;
    if (!globalThis.__dbInited) {
      globalThis.__dbInited = true;
      try { await ensureSchema(env.DB); dbOk = true; globalThis.__dbOk = true; } catch (e) { console.error('D1:', e.message); }
    }

    if (!globalThis.__wss) globalThis.__wss = new WSSManager();
    const wss = globalThis.__wss;
    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    // ── 静态页面 ────────────────────────────
    const isHome = url.pathname === '/' || url.pathname === '/index.html';
    const isChat = url.pathname === '/chat' || url.pathname === '/chat.html';
    const isRoom = !isHome && !isChat && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/ws/') && !url.pathname.startsWith('/favicon');

    if (isHome) {
      const asset = await getAsset(env, '/index.html');
      if (asset?.ok) return asset;
      return new Response(LOBBY_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...SEC_HEADERS } });
    }

    if (isChat) {
      const asset = await getAsset(env, '/chat.html');
      if (asset?.ok) return asset;
      return new Response(CHAT_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...SEC_HEADERS } });
    }

    if (isRoom) {
      const asset = await getAsset(env, '/chat.html');
      if (asset?.ok) return asset;
      return new Response(CHAT_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...SEC_HEADERS } });
    }

    // 其他静态资源 → Assets
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/ws/')) {
      const asset = await getAsset(env, url.pathname);
      if (asset?.ok) return asset;
      return new Response('Not Found', { status: 404, headers: SEC_HEADERS });
    }

    // ── WebSocket ────────────────────────────
    if (url.pathname.startsWith('/ws/')) {
      if (!dbOk) return new Response('Database not configured', { status: 500 });
      const segs = decodeURIComponent(url.pathname).replace(/^\//, '').split('/');
      const roomId = (segs.length > 1 && segs[1] && segs[1].length <= 72) ? segs[1] : null;
      const clientHash = (segs.length > 2 && segs[2] && segs[2].length <= 128) ? segs[2] : null;
      if (!roomId || roomId === 'ws') return new Response('Invalid room', { status: 400 });

      const dbRoom = await getRoom(env.DB, roomId);
      const needPwd = dbRoom && dbRoom.password;
      if (needPwd && (!clientHash || dbRoom.password !== clientHash)) return new Response('Unauthorized', { status: 401 });

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();

      const uid = randomKey();
      const nickname = (await env.DB.prepare('SELECT nickname FROM nicknames WHERE room_key = ?1 AND ip = ?2 ORDER BY updated_at DESC LIMIT 1').bind(roomId, ip).first())?.nickname || '';
      wss.add(roomId, uid, server, nickname);

      server.send(JSON.stringify({ type:'1001', data:{ id:uid, roomId, roomName:dbRoom?.name||roomId, needPwd, turns:null } }));
      wss.broadcastAll(roomId, JSON.stringify({ type:'1002', data: wss.roomUsers(roomId).map(u=>({id:u.id,nickname:u.nickname,device:u.device})) }));
      server.send(JSON.stringify({ type:'1003', data:{ id:uid } }));
      const history = await getMessages(env.DB, roomId);
      if (history.length) server.send(JSON.stringify({ type:'1011', data:history }));

      server.addEventListener('message', async (event) => {
        if (typeof event.data !== 'string' || event.data.length > 65536) return;
        let msg; try { msg = JSON.parse(event.data); } catch (_) { return; }
        const { type, data } = msg;
        if (!type || type === '9999') return;

        if (type === '9007') {
          if (!checkWsRate(uid) || !data?.text?.trim) return;
          const saved = await addMessage(env.DB, roomId, uid, data.text, nickname);
          wss.broadcastAll(roomId, JSON.stringify({ type:'1010', data:{ uid, text:data.text, msgId:saved.msgId, nickname:saved.nickname, ts:saved.ts } }));
        } else if (type === '9010') {
          if (!msg.uid || !data?.msgId || !data?.text) return;
          const r = await env.DB.prepare('UPDATE messages SET text=?1 WHERE id=?2 AND uid=?3 AND deleted=0').bind(data.text, data.msgId, msg.uid).run();
          if (r.meta.changes>0) wss.broadcastAll(roomId, JSON.stringify({ type:'1012', data:{ msgId:data.msgId, text:data.text } }));
        } else if (type === '9011') {
          if (!msg.uid || !data?.msgId) return;
          const r = await env.DB.prepare('UPDATE messages SET deleted=1 WHERE id=?1 AND uid=?2').bind(data.msgId, msg.uid).run();
          if (r.meta.changes>0) wss.broadcastAll(roomId, JSON.stringify({ type:'1013', data:{ msgId:data.msgId } }));
        } else {
          const suid = msg.uid, targetId = msg.targetId;
          if (!suid || !targetId) return;
          const me = wss.get(roomId, suid); if (!me) return;
          const target = wss.get(roomId, targetId);
          if (type==='9001'&&target) target.ws.send(JSON.stringify({type:'1004',data:{targetId:suid,candidate:data?.candidate}}));
          else if (type==='9002'&&target) target.ws.send(JSON.stringify({type:'1005',data:{targetId:suid,offer:data?.targetAddr}}));
          else if (type==='9003'&&target) target.ws.send(JSON.stringify({type:'1006',data:{targetId:suid,answer:data?.targetAddr}}));
          else if (type==='9004'){const nn=(data?.nickname||'').slice(0,20);if(nn){me.nickname=nn;await env.DB.prepare('INSERT OR REPLACE INTO nicknames VALUES(?1,?2,?3,?4)').bind(roomId,ip,nn,Date.now()).run();wss.broadcast(roomId,JSON.stringify({type:'1007',data:{id:suid,nickname:nn}}),suid)}}
          else if (type==='9005'){if(data?.device&&data.device.length<=100){me.device=data.device;wss.broadcast(roomId,JSON.stringify({type:'1008',data:{id:suid,device:data.device}}),suid)}}
          else if (type==='9006') wss.broadcast(roomId, JSON.stringify({type:'1009',data:{id:suid,typing:data?.typing}}), suid);
        }
      });

      server.addEventListener('close', () => {
        wss.remove(roomId, uid);
        wss.broadcastAll(roomId, JSON.stringify({ type:'1002', data: wss.roomUsers(roomId).map(u=>({id:u.id,nickname:u.nickname,device:u.device})) }));
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // ── API ──────────────────────────────────
    if (request.method === 'GET' && url.pathname === '/api/rooms') {
      if (!dbOk) return json({ error: '数据库未就绪' }, 503);
      return json(await listRooms(env.DB, wss));
    }

    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      if (!dbOk) return json({ error: '数据库未就绪' }, 503);
      if (!checkApiRate(ip)) return json({ error: '请求过于频繁' }, 429);
      let b; try { b = await request.json(); } catch (_) { return json({ error: '无效请求' }, 400); }
      if (!b.name || !b.deletionPassword) return json({ error: '缺少参数' }, 400);
      const name = sanitize(b.name, 32), delRaw = sanitize(b.deletionPassword, 64);
      if (!name || !delRaw) return json({ error: '参数无效' }, 400);
      const key = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') + '-' + randomKey();
      const rawPwd = sanitize(b.password || '', 64);
      const pwd = rawPwd ? await hmac256(rawPwd, key) : '';
      const del = await hmac256(delRaw, key);
      await env.DB.prepare('INSERT INTO rooms VALUES(?1,?2,?3,?4,?5,?6)').bind(key, name, pwd, del, b.visibleInLobby !== false ? 1 : 0, Date.now()).run();
      return json({ roomKey: key, name, hasPassword: !!pwd }, 201);
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/api/rooms/')) {
      if (!dbOk) return json({ error: '数据库未就绪' }, 503);
      const key = decodeURIComponent(url.pathname.split('/api/rooms/')[1]);
      if (!key || key.length > 72) return json({ error: '无效房间' }, 400);
      let b; try { b = await request.json(); } catch (_) { return json({ error: '无效请求' }, 400); }
      if (!b.deletionPassword) return json({ error: '需要删除密码' }, 400);
      const delHash = await hmac256(sanitize(b.deletionPassword, 64), key);
      const room = await env.DB.prepare('SELECT * FROM rooms WHERE room_key=?1').bind(key).first();
      if (!room || room.deletion_password !== delHash) return json({ success: false }, 403);
      await env.DB.prepare('DELETE FROM messages WHERE room_key=?1').bind(key).run();
      await env.DB.prepare('DELETE FROM rooms WHERE room_key=?1').bind(key).run();
      wss.roomUsers(key).forEach(u => { try { u.ws.close(); } catch (_) {} });
      return json({ success: true });
    }

    if (request.method === 'POST' && url.pathname.match(/^\/api\/rooms\/[^/]+\/clear$/)) {
      if (!dbOk) return json({ error: '数据库未就绪' }, 503);
      if (!checkApiRate(ip)) return json({ error: '请求过于频繁' }, 429);
      const key = decodeURIComponent(url.pathname.split('/api/rooms/')[1].split('/clear')[0]);
      const r = await env.DB.prepare('UPDATE messages SET deleted=1 WHERE room_key=?1').bind(key).run();
      wss.broadcastAll(key, JSON.stringify({ type: '1014', data: {} }));
      return json({ cleared: r.meta.changes });
    }

    return new Response('Not Found', { status: 404, headers: SEC_HEADERS });

    } catch (e) {
      console.error('Error:', e.message, e.stack);
      return new Response('Internal Error: ' + e.message, { status: 500, headers: SEC_HEADERS });
    }
  }
};
