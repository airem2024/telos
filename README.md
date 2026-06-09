# Code · 手机版 Claude Code

一个原生 Android app，UI 仿官方 Claude Code 手机版（聊天气泡 + 工具卡片 + 权限弹窗），
后端直连你自己 VPS 上跑的 Claude Code。

## 架构
```
Android (WebView 聊天UI)  ──wss(token鉴权)──▶  cc-bridge (Node + Agent SDK)  ──▶  你的 claude
```
- **App**：`app/` — WebView 套壳，聊天 UI 在 `assets/web/`，用 JS 的 WebSocket 直连后端。
- **后端**：`server/` — Node + `@anthropic-ai/claude-agent-sdk` + `ws`，驱动本机的 cc，
  暴露会话列表 / 历史 / 流式消息 / 工具调用 / `canUseTool` 权限回调。

## 功能
- 会话列表（读取 cc 已有会话）、新建会话、resume 续聊
- 流式逐字回复、工具调用紧凑卡片、思考块
- 权限弹窗（允许/拒绝）；命令详情只在弹窗里，不进对话气泡
- 后端地址 / token 在 app 内可配置

## 架构要点：App 是瘦客户端
App 本身**不含任何 cc、不含任何账号**，它只是连到某个 bridge 的「地址 + token」。
真正干活的是 bridge 所在那台机器、用那台机器登录的 `claude`。所以「用谁的额度、在哪跑」
完全取决于 bridge 在哪。token 是唯一钥匙——别人拿到你的 token 才能用你的 cc。

## 后端部署（任意 Linux + systemd）
一键：
```
git clone <repo> && cd <repo>
bash server/deploy.sh                # 装依赖、生成 token、装并启动 systemd 服务
# bash server/deploy.sh --no-svc     # 只装依赖+生成 token，自己手动跑
```
手动：
```
cd server && npm install
node server.js                       # 首次运行生成 config.json 与鉴权 token（控制台打印 auth token）
```
前置条件：那台机器已装好并登录 `claude`（`claude` 能正常跑），装了 Node 18+。

`server/config.json` 可调：`port`(默认8790) · `token` · `claudePath` · `defaultCwd` · `permissionMode`。

bridge 只监听 `127.0.0.1`，必须套隧道暴露成 `wss://` 手机才能连：
```
cloudflared tunnel --url http://127.0.0.1:8790   # 拿到一个 https://xxx.trycloudflare.com
```
然后 App → **设置 → 连接**：地址填 `wss://xxx…`，Token 填上面那个，保存并重连。

## 换一台机器的 cc
会话历史存在各自机器的 `~/.claude` 里，**不会跟着 App 走**。换机 = 在新机器上跑一遍
`deploy.sh`，拿到新 token + 新隧道地址，App 设置里改「地址 + token」即可（旧会话留在旧机器）。

## 别人怎么用（自托管）
装 APK 没用，除非他也有自己的 bridge。每个人：自己一台机器 → 登录自己的 `claude` →
`bash server/deploy.sh` → cloudflared 暴露 → App 设置里填自己的地址+token。各连各的，互不串额度。

## App 构建
推送到 GitHub 由 Actions 自动编译，产物在 run 的 **Artifacts → APK**。
本地：`./gradlew assembleDebug`，APK 在 `app/build/outputs/apk/debug/`。

## 开源组件
JetBrains Mono（OFL）、@anthropic-ai/claude-agent-sdk、ws。
