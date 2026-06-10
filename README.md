# Telos · 手机上的 Claude Code  `>τ`

把 VPS 上你自己的 [Claude Code](https://claude.com/claude-code) 装进手机。一个原生 Android App，
UI 仿官方 Claude Code 移动端（聊天气泡 + 工具卡片 + 权限弹窗），通过一个轻量 Node 桥接（cc-bridge）
直连你自己机器上跑的 `claude`——**用你的订阅额度，不烧 API key**。

<!-- TODO: 放 2~3 张截图（会话列表 / 聊天流式 / 权限弹窗）到这里 -->

## 是什么 / 不是什么

- **是**：你自己 cc 的手机遥控器。真正干活的是你机器上登录好的 `claude`。
- **不是**：云服务。App 本身不含任何账号、不含任何模型，只是「连到某个 bridge 的地址 + token」。
  用谁的额度、在哪跑，完全取决于 bridge 在哪。

## 功能

- 读取并续聊 cc 已有会话、新建会话、编辑/重生成（fork）
- 流式逐字回复、工具调用紧凑卡片、思考块、权限弹窗（允许/拒绝）
- 模型切换 + 1M 上下文识别、账号用量 + 本会话花费统计
- 文件上传 / 下载、图片与音频预览、按路径把附件交给 cc
- 导入 claude.ai 导出的对话
- 断线**不**中止正在跑的回合，重连自动续流
- 定时唤醒 + 每对话日记/便签 + 推送（自建 ntfy）

## 怎么用（三步）

> 前提：一台 Linux 机器（systemd），已装好并登录 `claude`（`claude` 能正常跑），Node 18+。

### 1 · 起后端 bridge

```bash
git clone https://github.com/airem2024/telos && cd telos
bash server/deploy.sh          # 装依赖、生成鉴权 token、装并启动 systemd 服务
```

bridge 只监听 `127.0.0.1`，得套隧道暴露成 `wss://` 手机才连得上：

```bash
cloudflared tunnel --url http://127.0.0.1:8790   # 拿到一个 https://xxx.trycloudflare.com
```

### 2 · 装 App

去 **[Releases](https://github.com/airem2024/telos/releases/latest)** 下载最新的 `telos-*.apk`，
手机上直接安装（需允许「未知来源」）。包是**自包含**的——界面已内置，装上即可用，不依赖任何外部服务。
（也可以自己编译，见下方「自己构建 APK」。）

### 3 · 在 App 里连接

设置 → 连接：**地址**填 `wss://xxx…`、**Token** 填 `deploy.sh` 打印的那个 → 保存重连。

## 安全模型（瘦客户端）

token 是唯一钥匙——谁拿到你的 `地址 + token`，谁就能用你的 cc。所以：bridge 别裸奔公网（务必走隧道 + token），
token 别外传。每个人连各自的 bridge，互不串额度。

## 自己构建 APK

推到你自己 fork 的仓库，GitHub Actions 会自动编译，产物在该 run 的 **Artifacts**。
**零配置**即可出一个 bundled + debug-key 签名的可用包。两个可选增强：

- **稳定签名**（让升级不出现「签名冲突」）：`keytool` 生成 keystore → base64，设进仓库 Secrets：
  `SIGNING_KEYSTORE_B64`、`SIGNING_STORE_PASSWORD`、`SIGNING_KEY_PASSWORD`（可选 `SIGNING_KEY_ALIAS`）。
  不设则用默认 debug key。
- **前端热更**（高级）：让 bridge 同时托管界面，设仓库 Variable `TELOS_REMOTE_URL=https://你的bridge/`，
  APK 就从 bridge 加载 UI——以后改前端只需重开 App、不必重新打包。默认（不设）= 用 APK 内置界面。

## 配置

`server/config.json`（首次运行自动生成，**不提交**）：
`port`(默认 8790) · `token` · `claudePath` · `defaultCwd` · `permissionMode`。

## FAQ

- **会话历史在哪？** 在 bridge 那台机器的 `~/.claude` 里，**不跟 App 走**。换机器 = 在新机器跑一遍
  `deploy.sh`，App 设置里改「地址 + token」，旧会话留在旧机器。

## 开源组件

JetBrains Mono（OFL） · `@anthropic-ai/claude-agent-sdk` · `ws` · marked
