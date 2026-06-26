# X-Relay

> 基于 WebRTC 的局域网 P2P 文字/文件传输工具 · Material Design 3

[![Version](https://img.shields.io/badge/version-0.1.0-blue)](./package.json)
[![GitHub](https://img.shields.io/badge/GitHub-stop666two%2FX--Relay-blue?logo=github)](https://github.com/stop666two/X-Relay)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

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
- 😊 **Emoji 选择器** — 输入框旁一键插入表情
- 🌐 **国际化** — 中/English 双语切换，自动检测浏览器语言

## 🚀 快速开始

```bash
npm install
npm run start [端口]    # 默认 8081
```

打开浏览器访问 `http://localhost:8081`

## 🖥 部署

### 局域网

内网机器启动服务端，其他设备通过 IP 访问：

```bash
npm install && npm run start 8081
# 其他设备访问 http://192.168.1.100:8081
```

### 公网服务器

```bash
# 上传项目
scp -r . user@server:/opt/x-relay
# 启动
ssh user@server "cd /opt/x-relay && npm install && npm run start 8081"
```

### Nginx 反代 (可选)

```nginx
server {
    listen 443 ssl;
    server_name relay.example.com;
    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## 📖 使用方式

### 大厅 `/`
- **创建房间** — 设置名称、密码、删除密码、大厅可见性
- **房间卡片** — 点击进入 / 🔗 分享 / 🗑️ 删除
- **公共频道** — 无需密码，所有人可加入
- **GitHub 链接** — 底部可跳转项目主页

### 房间 `/<roomKey>`
- 公开房间：直接进入
- 加密房间：输入密码
- 房间头部：🏠 返回大厅 / 🔗 分享 / 🗑️ 删除

## 🔐 安全

| 措施 | 说明 |
|------|------|
| 密码 | `HMAC-SHA256(SHA256, roomKey)` 每房间独立盐 |
| 删除密码 | HMAC-SHA256 加密存储 |
| 消息 | AES-256-GCM 端到端加密 |
| API | 20 次/10 秒/IP 限流 |
| WS | 10 条/秒/用户 限流 |
| 输入 | 剥离 `<>"'` 特殊字符 |
| 路径 | 阻止敏感文件/目录访问 |
| 数据 | 已删除消息 7 天后自动清除 |

## 🛠 技术栈

- **服务端**: Node.js + ws + better-sqlite3
- **前端**: Vanilla JS + WebRTC + Material Design 3
- **安全**: Web Crypto API (AES-GCM, PBKDF2, HMAC-SHA256)

## 📂 项目结构

```
X-Relay/
├── index.js          # 入口 (HTTP + WebSocket)
├── auth.js           # 房间认证
├── data.js           # 数据访问层
├── db.js             # SQLite 持久化
├── package.json
├── room_pwd.json     # 预设加密房间（可选）
└── www/
    ├── index.html     # 聊天室
    ├── lobby.html     # 大厅
    ├── index.js       # 客户端逻辑
    ├── xchatuser.js   # WebRTC
    └── style.css      # 样式
```

## ☁️ Cloudflare Workers

目前暂不支持部署到 Cloudflare Workers。因个人能力有限，WebSocket 在 Workers 环境下的兼容性问题未能解决。未来如有大佬贡献 Workers 适配代码，将更新支持。

## 📄 免责声明

本项目仅用于学习交流，请勿用于非法用途。
