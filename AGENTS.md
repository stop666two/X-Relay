# X-Relay — AI Agent 项目指引

## 项目概述

基于 WebRTC 的局域网 P2P 文字/文件传输工具，Node.js 后端 + Vanilla JS 前端。

## 架构

```
index.js  →  HTTP 路由 + WebSocket 信令
auth.js   →  房间认证 (HMAC-SHA256)
data.js   →  数据访问层 (桥接 DB 和内存)
db.js     →  SQLite 持久化 (better-sqlite3)
www/      →  静态前端 (Vanilla JS + WebRTC)
```

## 关键约定

- **不要修改 `www/xchatuser.js`** — WebRTC 数据通道核心
- **密码验证** — 统一走 `auth.js`
- **持久化数据** — SQLite，`sockets` 是唯一内存状态
- **编码** — WebSocket URL 路径必须 `decodeURIComponent`
- **缓存** — 修改 `www/` 下 JS/CSS 后同步更新 `index.html` 中的 `?v=N`
- **数据库** — 不要提交 `xrelay.db*`

## 启动

```bash
npm install && npm run start
```
