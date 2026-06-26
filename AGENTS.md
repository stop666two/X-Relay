# X-Relay — AI Agent 项目指引

## 项目概述

基于 WebRTC 的局域网 P2P 文字/文件传输工具，纯 Node.js 后端 + Vanilla JS 前端。

## 架构

```
index.js  →  HTTP 路由 + WebSocket 信令
auth.js   →  房间认证 (HMAC-SHA256)
data.js   →  数据访问层 (桥接 DB 和内存)
db.js     →  SQLite 持久化 (better-sqlite3)
www/      →  静态前端 (Vanilla JS + WebRTC)
```

## 关键约定

- **不要修改 `www/xchatuser.js`** — WebRTC 数据通道核心，改动极易导致 P2P 文件传输失败
- **密码验证** — 统一走 `auth.js`，不要在 `index.js` 中直接写 crypto 逻辑
- **持久化数据** — 全部在 SQLite，`data.js` 中的 `sockets` 对象是唯一内存状态（WebSocket 连接无法序列化）
- **编码** — WebSocket URL 路径必须 `decodeURIComponent`（房间名可能含中文）
- **缓存** — 修改 `www/` 下任何 JS/CSS 后，同步更新 `index.html` 中的 `?v=N` 版本号
- **数据库** — 不要提交 `xrelay.db*` 文件，`.gitignore` 已排除

## 启动

```bash
npm install
npm run start        # 默认 8081
npm run start 3000   # 指定端口
```

## 测试

```bash
# 快速冒烟测试
node -e "require('./auth'); require('./db'); require('./data'); console.log('OK')"
```
