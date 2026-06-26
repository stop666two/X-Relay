# X-Relay — AI Agent 项目指引

## 项目概述

基于 WebRTC 的局域网 P2P 文字/文件传输工具。双后端架构：Node.js（本地开发）和 Cloudflare Workers（生产部署）。

## 架构

```
www/        →  静态前端 (Vanilla JS + WebRTC)
                  xchatuser.js  — WebRTC 数据通道（勿改）
                  index.js      — 聊天室客户端
                  lobby.html    — 大厅页面

Node.js 版:
  index.js  →  HTTP + WebSocket 服务器
  auth.js   →  房间认证 (HMAC-SHA256)
  data.js   →  数据访问层
  db.js     →  SQLite (better-sqlite3)

Cloudflare Workers 版:
  worker.js →  全功能 Worker (HTTP + WS + D1)
                  WSSManager   — WebSocket 连接池
                  D1            — 持久化 (同 SQLite schema)
```

## 关键约定

- **不要改 `www/xchatuser.js`** — WebRTC 核心，改动极易导致 P2P 失败
- **密码哈希统一** — `HMAC-SHA256(SHA256, roomKey)`，Node.js 版走 `auth.js`，Worker 版内联
- **编码** — WebSocket URL 路径必须 `decodeURIComponent`
- **缓存** — 改 `www/` 下 JS/CSS 后同步更新 `index.html` 中的 `?v=N`
- **数据库** — 不提交 `xrelay.db*` 文件
- **双版本同步** — 改 Node.js 版功能时，同步更新 `worker.js` 中对应逻辑

## 启动

```bash
# Node.js 版
npm install && npm run start

# Cloudflare Workers 版
npx wrangler dev
```

## 部署

```bash
# Workers 一键部署
npx wrangler deploy

# 或点击 README 中的 Deploy 按钮
```
