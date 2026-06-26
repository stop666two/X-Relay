# X-Relay

> 基于 WebRTC 的局域网 P2P 文字/文件传输工具 · Material Design 3

[![Version](https://img.shields.io/badge/version-0.1.0-blue)](./package.json)
[![GitHub](https://img.shields.io/badge/GitHub-stop666two%2FX--Relay-blue?logo=github)](https://github.com/stop666two/X-Relay)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Deploy to Cloudflare Pages](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/stop666two/X-Relay)

## ✨ 特性

- 🚀 **零安装** — 打开浏览器即可使用
- 🔐 **端到端加密** — AES-256-GCM，消息文本加密传输+存储，服务端不可读
- 🏠 **动态房间** — 创建房间，可选密码保护、可见性控制、删除密码
- 💬 **实时消息** — 文字消息经 WebSocket 持久化广播
- 📁 **P2P 文件传输** — 大文件直接点对点，支持批量发送、进度显示、取消传输
- 🎨 **Material Design 3** — 自适应明暗主题
- ✏️ **消息编辑/删除** — 发送后可编辑或撤回
- ↩️ **可视化引用回复** — 点击消息直接引用回复
- 📝 **Markdown 渲染** — 粗体/斜体/代码块/链接
- 😊 **Emoji 快捷** — `:)` → 😊 `:fire:` → 🔥
- 🔍 **消息搜索** — Ctrl+K 快速搜索
- 📅 **日期分隔线** — 今天/昨天/日期自动分隔
- 🔔 **浏览器通知** — 后台时显示未读提示
- 📥 **文件类型图标** — 30+ 文件类型自动识别
- 📤 **导出聊天记录** — 一键导出为文本文件
- ⌨️ **快捷键** — Ctrl+L 清屏, Ctrl+K 搜索, Enter 发送
- 📱 **移动端适配** — 底部导航栏 + 侧滑面板
- ⚡ **速率限制** — 服务端 10 条/秒防刷，API 20 次/10 秒
- 🔗 **分享链接** — 一键复制房间链接
- 🗑️ **删除房间** — 删除密码保护，完全清除数据
- 🔒 **安全** — HMAC-SHA256 加盐哈希，crypto 安全随机 key

## 🚀 快速开始

```bash
npm install
npm run start [端口]    # 默认 8081
```

打开浏览器访问 `http://localhost:8081`

## ☁️ 一键部署

点击上方 **Deploy to Cloudflare Pages** 按钮，即可一键将静态前端部署到 Cloudflare 全球 CDN。

> ⚠️ WebSocket 服务端仍需在 Node.js 环境中单独运行。

## 📖 使用方式

### 大厅 `/`
- **创建房间** — 设置名称、密码（可选）、删除密码、大厅可见性
- **房间卡片** — 点击进入 / 🔗 分享 / 🗑️ 删除
- **公共频道** — 无需密码，所有人可加入
- **GitHub 链接** — 底部可跳转项目主页

### 房间 `/<roomKey>`
- 公开房间：直接进入
- 加密房间：输入密码（消息端到端加密）
- 房间头部：🏠 返回大厅 / 🔗 分享 / 🗑️ 删除

### 聊天
- Enter 发送，Shift+Enter 换行
- 点击消息的 ↩️ 可视化引用回复
- 点击消息的 ✏️ 编辑 / 🗑️ 删除
- Ctrl+K 搜索，Ctrl+L 清屏
- 拖拽文件或粘贴图片发送

## 🏗 房间配置（可选）

创建 `room_pwd.json`（密码填写 SHA-256 哈希值）：

```json
[
  {
    "roomId": "myroom",
    "pwd": "sha256(你的密码)",
    "turns": [{
      "urls": ["turn:example.com:3478"],
      "username": "user",
      "credential": "pass"
    }]
  }
]
```

## 🔐 安全

| 措施 | 说明 |
|------|------|
| 密码传输 | 原始密码不离开浏览器，SHA-256 → HMAC 后传输 |
| 密码存储 | `HMAC-SHA256(SHA256, roomKey)` 每房间独立盐 |
| 删除密码 | HMAC-SHA256 加密存储，非明文 |
| 房间 key | `crypto.randomBytes` 密码学安全随机 |
| 用户 ID | `crypto.randomBytes` 密码学安全随机 |
| 消息加密 | AES-256-GCM 端到端，服务端不可读 |
| API 限流 | 20 次 / 10 秒 / IP |
| 消息限流 | 10 条 / 秒 / 用户 |
| 输入净化 | 剥离 `<>"'` 特殊字符 |
| 路径安全 | 阻止敏感文件 / 目录访问 |
| 数据清理 | 已删除消息 7 天后自动清除 |
| 密码哈希 | 房间列表不暴露密码哈希值 |

## 📡 API

| 方法 | 地址 | 用途 |
|------|------|------|
| `GET` | `/api/rooms` | 列出可见房间 |
| `POST` | `/api/rooms` | 创建房间 |
| `DELETE` | `/api/rooms/:key` | 删除房间（需删除密码） |
| `POST` | `/api/rooms/:key/clear` | 清空房间消息 |

## 🛠 技术栈

- **服务端**: Node.js + ws + better-sqlite3
- **前端**: Vanilla JS + WebRTC + Material Design 3
- **传输**: WebSocket（信令 / 消息）+ WebRTC DataChannel（文件）
- **安全**: Web Crypto API（AES-GCM、PBKDF2、HMAC-SHA256）
- **部署**: Cloudflare Pages + Node.js 服务端

## 🏛 架构

```
┌──────────────────────────────────────────┐
│  浏览器 A         浏览器 B              │
│  ┌─────────┐     ┌─────────┐            │
│  │ WebRTC  │◄───►│ WebRTC  │  文件 P2P  │
│  └────┬────┘     └────┬────┘            │
│       │ WebSocket     │                  │
├───────┴────────────────┴────────────────┤
│         Node.js 服务端                    │
│  ┌────────────────────────────┐          │
│  │ index.js   — HTTP + WS 入口 │          │
│  │ auth.js    — 房间认证模块   │          │
│  │ data.js    — 数据访问层     │          │
│  │ db.js      — SQLite 持久化  │          │
│  │                              │          │
│  │ SQLite 表:                   │          │
│  │  ├ messages   消息/编辑/删除  │          │
│  │  ├ rooms      房间配置/密码   │          │
│  │  └ nicknames  用户昵称历史    │          │
│  │                              │          │
│  │ 内存: sockets  在线连接池     │          │
│  └────────────────────────────┘          │
├──────────────────────────────────────────┤
│  Cloudflare Pages（静态前端 CDN）         │
└──────────────────────────────────────────┘
```

## 📂 项目结构

```
X-Relay/
├── index.js          # 服务入口 (HTTP + WebSocket)
├── auth.js           # 房间认证模块
├── data.js           # 数据访问层
├── db.js             # SQLite 持久化层
├── package.json
├── wrangler.toml     # Cloudflare Pages 配置
├── room_pwd.json     # 预设加密房间（可选）
└── www/
    ├── index.html     # 聊天室页面
    ├── index.js       # 聊天室客户端逻辑
    ├── lobby.html     # 大厅页面
    ├── xchatuser.js   # WebRTC 用户类
    └── style.css      # Material Design 3 样式
```

## 📄 免责声明

本项目仅用于学习交流，请勿用于非法用途。
