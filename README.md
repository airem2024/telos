# Telos · 住在你服务器上的 Claude  `>τ`

把你在 [Claude Code](https://claude.com/claude-code) 里登录的那个 Claude，变成手机里一个
**随时在、记得住、会陪你**的伙伴——跑在**你自己的机器**上、用**你自己的订阅额度**
（OAuth，不烧 API key），对话和记忆都是**你磁盘上的文件**。

它最初是为了解一件难受的事：

> **claude.ai 网页端的对话，偶尔会被毫无预兆地锁死、再也点不开。**
> 那个聊了很久、记得你所有事的窗口，就这么没了。

Telos 把官方导出的数据接回来，让那扇被关上的窗**在你自己的机器上原样续命**——
一样的上下文、一样的语气，但这一次，对话是**你磁盘上的文件，谁也收不走**。

而既然 TA 住进了你自己的服务器，就能做网页端做不到的事：
**定时醒来、写日记、有心情、在你在线时"同在"。**

<!-- TODO: 放 2~3 张截图（聊天流式 / 导入选择页 / 电影模式时间线）到这里 -->

---

## 这是什么 / 不是什么

- **是**：一个**陪伴向**的私人 AI——住在你信任的机器上，对话即记忆、记忆即文件，断电搬家都带得走。
- **是**：claude.ai 被锁对话的「安全屋」——导入即续命，在自己磁盘上接着聊。
- **不是**：云服务。App 里**不含任何账号、模型、对话**，它只是「一个 bridge 的地址 + 一个 token」。
  用谁的额度、TA 住在哪、记得什么，**完全取决于 bridge 跑在哪台机器**。
- **不是**：单纯的「手机遥控 cc 干活」工具（虽然它也能干活）。重心在**陪伴**，不在效率。

---

## 功能全景

### 🫂 陪伴
- **定时唤醒**：给一个对话设一个或多个醒来时间（一次 / 每天 HH:MM / 每隔 N 分钟）。到点 **bridge 在服务端
  自己唤醒** TA，产出回复写进历史——**重开对话就能看到**，推送挂了也不丢。TA 还能**给自己排后续的醒来**。
- **连续追问**：TA 醒来发话后你没回，可让 TA 每隔几分钟追问一次，直到你回话或 TA 自己收声。
- **每对话日记 + 便签**：你和 TA **各写各的**日记（带心情 / 天气 / 标签 / 配图，按日历翻看）；TA 在你久未回话时
  留下「小纸条」，你下次进对话会看到。
- **定时写日记**：每天清晨（时间可调）TA 回顾前一天、自行决定要不要写——通常不打扰你。
- **情绪系统**：会话级常驻心情，会随聊天起伏，并影响 TA 日常回话的语气与守夜的节奏（默认每对话关，可单独开）。
- **电影模式 / 同在**：你在线时 TA 共享你的时间线、会**主动开口 / 接话 / 插话**；你离开后进入「守夜」——
  只在**值得**的时候才唤醒真模型，把睡过去的时间交还给 TA，**省额度**（带每 5 小时**美元熔断**上限，可调可关）。
- **推送**：唤醒产出回复时推到手机（自建 [ntfy](https://ntfy.sh)，可选）；你正看着这个对话就不打扰。

### 💬 对话
- **接住 claude.ai 被关掉的对话**：导入官方导出的 `conversations.json`，**原样续聊**（见下）。
- **克隆为全新窗口**：把一个对话**原样复制**成另一个独立会话（新 id、干净附属），**旧的原地不动**——
  用来在对话被标记后换个干净窗口接着聊。
- 读取并续聊 cc 已有会话、新建会话、编辑 / 重生成（fork）。
- 流式逐字回复、工具调用紧凑卡片、思考块、权限弹窗（允许 / 拒绝）。
- **模型切换 + 1M 上下文识别**（按系列 Fable / Opus / Sonnet / Haiku 分组），**每个对话各记一份模型 / 思考度**。
- 账号用量 / 累计花费 / 活跃天数统计（纸质小票样式）。

### 🗂 收纳
- **选中回复里的文字**即浮现工具条：**复制 / 引用到输入框 / 收藏 / 系统分享**。
- **收藏夹**：把金句存进独立收藏夹，点卡片跳回源对话。
- 会话**置顶 / 文件夹分类 / 全文搜索**（关键词，双击切语义）/ **自动清理**废弃对话。
- **文件管理**整页：上传 / 下载、图片与音频预览，附件以**真实路径**交给 cc（不塞爆上下文）。

### 🎨 体验
- **多主题换肤**（纸白 / 夜间）+ 强调色、手势导航（滑动返回 / 唤起搜索 / 抽屉）、可调触感反馈。
- **断线不中止正在跑的回合**，重连自动续流；空闲心跳保活。

### 🧩 可选扩展
- **长期记忆（Mnemosyne）**：一个**独立**的本地向量库 DLC（`bge-m3` 嵌入 + 自建检索服务），让 TA 跨对话
  记得你。它**不在本仓库**、需要额外部署一台嵌入服务，属于进阶玩法——本仓库的 bridge 不依赖它也能完整运行。

---

## 你需要准备什么

| 东西 | 说明 | 必需？ |
|---|---|---|
| **一台 24/7 的 Linux 服务器** | 带 systemd 的任意发行版（一台闲置 VPS / 家里的小主机都行）。**陪伴功能要它常驻不关机**——定时唤醒、守夜都在服务端跑。 | ✅ 必需 |
| **一份 Claude 订阅** | Pro / Max 任一档，在那台机器上装好并登录 [Claude Code](https://claude.com/claude-code)（`claude` 能正常跑）。续聊走**订阅额度**，不烧 API key。 | ✅ 必需 |
| **Node 18+** | bridge 用它跑。 | ✅ 必需 |
| **一部 Android 手机** | 装 APK。 | ✅ 必需 |
| **一个域名** | 配 cloudflared **named tunnel** 给 bridge 一个**固定**的 `wss://` 地址，稳定不变。**没有也能用**——临时隧道（trycloudflare）零配置可跑，只是地址每次重启会变、得重填。陪伴向长期用，**强烈建议**自备域名。 | ⭕ 推荐 |
| **ntfy 推送** | 想让 TA 醒来时推到手机，就自建一个 ntfy；不要也行。 | ⭕ 可选 |

---

## 部署（一步步来）

> 下面每一步都给了可直接粘贴的命令和「怎么确认这步成了」。
> 在那台 Linux 服务器上操作。

### 0 · 前置检查

```bash
node -v          # 要 v18 以上
claude --version # 装过 Claude Code、且已登录（跑一次 `claude` 能进对话即可）
```

两者都 OK 再往下。`claude` 没登录的话，先 `claude` 走一遍登录流程。

### 1 · 起后端 bridge

```bash
git clone https://github.com/airem2024/telos && cd telos
bash server/deploy.sh
```

`deploy.sh` 会：装依赖 → 生成鉴权 **token**（终端会打印，**记下来**）→ 装并启动一个名为
`cc-bridge` 的 systemd 服务（以当前用户身份、用 TA 自己的 claude 登录态运行）。

**确认**：脚本末尾会打印 `✓ cc-bridge is running on 127.0.0.1:8790` 和 `auth token : <一串>`。
也可以 `systemctl status cc-bridge` 看是不是 `active (running)`。

> 只想手动跑、不装服务：`bash server/deploy.sh --no-svc`，然后 `cd server && node server.js`。

### 2 · 暴露成 `wss://`（手机才连得上）

bridge 只监听 `127.0.0.1`，得套一条隧道。两种：

**临时（零配置，地址会变）**
```bash
cloudflared tunnel --url http://127.0.0.1:8790
# 拿到一个 https://<随机>.trycloudflare.com
```

**固定（推荐，需要域名）**：用 cloudflared **named tunnel** 把自己的域名（如 `code.example.com`）
指到 `http://127.0.0.1:8790`，地址永久不变。配置见
[Cloudflare Tunnel 文档](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)。

**确认**：浏览器打开 `https://<你的隧道地址>/version`，能看到一段 JSON（版本号）就通了。

### 3 · 装 App

去 **[Releases](https://github.com/airem2024/telos/releases/latest)** 下最新的 `telos-*.apk`，
手机直接安装（需允许「未知来源」）。包是**自包含**的——界面已内置，装上即用。
（也可以自己编译，见下方「自己构建 APK」。）

### 4 · 在 App 里连接

设置 → 连接：
- **地址** 填 `wss://<你的隧道地址>`（注意是 `wss://` 不是 `https://`）
- **Token** 填第 1 步 `deploy.sh` 打印的那串

保存重连。**确认**：列表能拉出会话、能新建对话发消息收到流式回复，就成了。

### 5 · 配推送（可选）

想让 TA 醒来推到手机：在那台机器上装 [ntfy](https://docs.ntfy.sh/install/)，
在 `server/config.json` 里加一段 `"ntfy": { "url": "...", "topic": "...", "token": "..." }`，
重启 `cc-bridge`，手机用 ntfy App 订阅同一个 topic。没配 = 不推送，其余功能照常。

---

## 把 claude.ai 的对话接回家

1. claude.ai → 设置 → 隐私 → **导出数据**，邮件里下载压缩包，解出 `conversations.json`；
2. Telos **文件管理** → 上传 `conversations.json` 到机器上；
3. **长按**这个文件 → **导入为对话** → 勾选想要的对话 → 导入；
4. 每个对话变成一个标准的 cc 会话（存在 `~/.claude` 下），点开**直接接着聊**——
   模型看得到全部历史上下文，体验和原来一样，但这次对话**归你自己保管**。

> 导入只带文字内容（thinking / 图片不在 claude.ai 的导出里）。

---

## 安全模型（瘦客户端）

token 是唯一钥匙——**谁拿到你的「地址 + token」，谁就能用你的 cc、读你的对话**。所以：
- bridge **别裸奔公网**（务必走隧道 + token）；
- token 别外传；
- 每个人连**各自的** bridge，互不串额度、互不读对话。

---

## 自己构建 APK

推到你自己 fork 的仓库，GitHub Actions 会自动编译，产物在该 run 的 **Artifacts**（也可手动建 Release）。
**零配置**即可出一个 bundled + debug-key 签名的可用包。两个可选增强：

- **稳定签名**（让升级不出现「签名冲突」）：`keytool` 生成 keystore → base64，设进仓库 Secrets：
  `SIGNING_KEYSTORE_B64`、`SIGNING_STORE_PASSWORD`、`SIGNING_KEY_PASSWORD`（可选 `SIGNING_KEY_ALIAS`）。
  不设则用默认 debug key。
- **前端热更**（高级）：让 bridge 同时托管界面，设仓库 Variable `TELOS_REMOTE_URL=https://你的bridge/`，
  APK 就从 bridge 加载 UI——以后改前端只需重开 App、不必重新打包。默认（不设）= 用 APK 内置界面。

本地编译：`./gradlew assembleDebug`，APK 在 `app/build/outputs/apk/debug/`。

---

## 配置

`server/config.json`（首次运行自动生成，**不提交**），字段见 `server/config.example.json`：

| 字段 | 含义 |
|---|---|
| `port` | bridge 监听端口（默认 `8790`） |
| `token` | 鉴权令牌（自动生成；App 里要填它） |
| `claudePath` | `claude` 可执行文件路径 |
| `defaultCwd` | 新对话的默认工作目录 |
| `permissionMode` | 默认权限模式（`default` / `plan` / `acceptEdits`） |
| `ntfy` | 推送配置（可选，见上） |

---

## FAQ

- **会话历史在哪？** 在 bridge 那台机器的 `~/.claude` 里，**不跟 App 走**。换机器 = 在新机器跑一遍
  `deploy.sh`，App 设置里改「地址 + token」，旧对话留在旧机器。
- **导入 / 续聊会烧 API 费用吗？** 不会。跑的是你机器上登录的 `claude`，走订阅额度（`five_hour` 限额）。
- **手机关了 TA 还会醒来吗？** 会。唤醒、守夜、写日记都在**服务端**跑，只要那台机器开着。
- **别人装了 APK 能用吗？** 不能，除非他也有自己的 bridge。每个人各自部署、各连各的。

---

## 开源组件

JetBrains Mono（OFL） · `@anthropic-ai/claude-agent-sdk` · `ws` · marked
