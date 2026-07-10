# Telos (claude-term) — 项目内部说明（给 Claude 自己看的）

手机版 **Claude Code** 聊天 App（品牌 **Telos**，标记 `>τ`）。后端直连用户自己 VPS 上跑的
`claude`（Claude Code），用的是订阅额度（OAuth，不是 API key）。这份文件记录架构 + 那些
踩过坑才定下来的约定，免得下次从头翻。面向用户的部署说明在 `README.md`。

> 本文件已**脱敏**（不含任何具体域名/密码/账号）。本机真实值（bridge 域名、ntfy、签名密码、
> CI secret 名、systemd 细节）在 **`CLAUDE.local.md`**（gitignored，不提交）。读这俩 = 完整上下文。

## 架构

```
Android WebView 壳  ──加载──▶  bundled assets（默认） 或 你的 bridge（REMOTE_URL 配了才远程加载）
   │  wss(token)  ──▶  cc-bridge (Node + @anthropic-ai/claude-agent-sdk)  ──▶  本机 claude
   │  https      ──▶  /upload /download /media /app.apk /version
```

- **App**：`app/` — 极薄的 WebView 壳（`MainActivity.kt`）。**默认加载 bundled UI**
  `file:///android_asset/web/index.html`（自包含、无外部依赖）。若 `BuildConfig.REMOTE_URL` 非空
  （由 `TELOS_REMOTE_URL` env / `local.properties` 的 `telos.remoteUrl` 注入），则改加载那个远程地址、
  失败再回退 bundled——这是给「前端热更」用的（见下表）。原生只做：硬件返回键桥接、文件选择器、下载、
  状态栏开关、版本号。
- **UI**：`app/src/main/assets/web/`（`index.html` / `app.js` / `app.css`）。这份既打进 APK，**也能被
  cc-bridge 当静态站点提供**（WEB_DIR 指向这里）——只有把 `REMOTE_URL` 指向 bridge 时，改一份文件两边同步。
- **后端**：`server/server.js` — WebSocket 桥 + HTTP。驱动本机 cc，暴露会话/历史/流式/工具/
  权限回调；以及文件上传下载、媒体、APK、版本。

## 改动 → 怎样生效（重要）

| 改了什么 | 怎么生效 | 会不会断用户 |
|---|---|---|
| 前端 `assets/web/*`（js/css/html） | **若 `REMOTE_URL` 指向 bridge**：从磁盘实时提供 → 用户完全杀掉 App 重开。**默认 bundled**：要重打 APK | 否（热更模式下） |
| 后端 `server/server.js` | **`systemctl restart cc-bridge.service`** | **会**（重启断 WS；用户多在终端，重启前确认/告知） |
| 原生 `MainActivity.kt`/`res/`/`AndroidManifest`/`build.gradle`/`themes.xml` | **重新出 APK**（见下）+ 用户重装 | 装新包 |

> 用户经常是在「终端」里跟我对话（不是在 App 里），那种情况下重启 bridge 不影响我们这条对话。
> 不确定时先问一句。

## 出 APK（GitHub Actions）

- `gh workflow run build.yml`（仓库见 `CLAUDE.local.md`；`GH_TOKEN`/PAT 是机密，**不要写进任何提交文件**）。
- 构建会 `sed` 把版本号写进 `app/build.gradle.kts`：`versionCode = <run_number>`、
  `versionName = 1.1.<run_number>`（每次自增，桌面图标/名字才会刷新——固定 versionCode 会被
  launcher 缓存住）。
- **签名**：密钥库 `app/telos.keystore`（提交在仓库）。**密码不再写进 `build.gradle.kts`**——读 gitignored
  `app/keystore.properties` 或 env `SIGNING_STORE_PASSWORD`/`SIGNING_KEY_PASSWORD`/`SIGNING_KEY_ALIAS`；
  两者都缺 → 回退 Gradle 默认 debug key（仍能出包）。CI 复现稳定签名要设对应 secrets（值见 `CLAUDE.local.md`）。
  **必须固定签名**，否则升级「签名冲突」；换签名/换包名那次用户要先卸载再装。
- 构建完：`gh run download <id> -D /root/apk_out`（产物到 `APK_PATH =
  /root/apk_out/ClaudeTerm-debug-apk/app-debug.apk`），再 `echo 1.1.<run> > server/apk_version.txt`。
  bridge 每次请求都读这俩文件，**不用重启**就能提供新包。
  **每次发版同时更新 `server/apk_notes.txt`**（changelog，App 内更新卡片显示的就是它；gitignored）。
- 用户下载用**带版本号的路径**：`https://<你的-bridge>/telos-1.1.<run>.apk`
  （新 URL 绕开手机浏览器对 `/app.apk` 的下载缓存——这是真踩过的坑）。
- **App 内更新提示**：bridge auth 后推 `{type:'app_update', version, url, notes}`（也在 `/version` 带 notes）。
  客户端比对 `APP_VERSION`(=`Android.appVersion()`)，更新时在抽屉顶部渲染 `#drawerUpdate` 卡片（`--surface-2`
  深底纹），点「下载更新」→ 拼带版本号的 `/telos-<ver>.apk`、`nativeDownload()` 调原生 `Android.download()` 直接进系统下载管理器（bundled 模式下 `<a>` 导航会被壳丢给外部浏览器、DownloadListener 接不到——踩过）；纯浏览器环境退回 `<a>`。
  开关 `updateNotify`（设置→更新「接受后端推送的更新」）gate 卡片与推送提示；「立即检查更新」走 HTTP `checkUpdate(true)`
  绕过开关。**卡片只在「已装 < 已发布」时出现**——发了新版本号才看得到。

## cc-bridge 运行细节

- systemd：`cc-bridge.service`，`WorkingDirectory=/root/claude-term/server`，
  node `v24.15.0`，日志 append 到 `server/cc-bridge.log`，监听 `127.0.0.1:8790`。
- 公网：cloudflared named tunnel → 你的 bridge 域名（CF 不缓存 WS；APK 也 BYPASS）。具体域名见 `CLAUDE.local.md`。
- `server/config.json`（gitignored）：`port` `token` `claudePath` `defaultCwd` `permissionMode`。
  鉴权 token == cfg.token；客户端存在 `localStorage.cc_token`。
- 其它持久化（都 gitignored）：`pins.json` `folders.json`（{list,assign}）`hidden.json`
  `mcpoff.json` `apk_version.txt`。
- `config.json.disallow`（数组）：永久禁用的工具名/前缀，并进 `disallowedTools`。用来挡掉会
  让 cc 空转卡死的 MCP 工具（如需认证的 claude.ai Gmail/Drive、自托管的 `mcp__claude_ai__gmail_*`、
  幻觉出的 `mcp__gmail`）。disallowedTools 是**前缀匹配**：`mcp__claude_ai_Gmail` 挡整个服务器，
  但注意 `mcp__claude_ai`（自托管"工具"服务器）是多个自托管服务的公共前缀，别用它整体挡（会误伤），
  要挡自托管 gmail 就逐个列 `mcp__claude_ai__gmail_*`。App 的 MCP 开关走 `mcpoff`→`disallowedFromOff()`，
  和 `config.json.disallow` 合并。

## SDK / 额度要点

- `query()` 跑用户本机 `claude`（`pathToClaudeCodeExecutable`=cfg.claudePath），**订阅额度**
  （`apiKeySource:none`, `rateLimitType:five_hour`），不烧 API。
- `canUseTool` 的 allow **必须带 `updatedInput`**（否则 Zod 报错）。
- **模型扫描**：cc 的 OAuth token（`~/.claude/.credentials.json` 的 `claudeAiOauth.accessToken`）
  能直接打 `GET https://api.anthropic.com/v1/models`（headers: `authorization: Bearer`,
  `anthropic-version: 2023-06-01`, `anthropic-beta: oauth-2025-04-20`）拿到账号可用模型。
  bridge `listModels()` 缓存 5 分钟，连接时推给 App。
- **1M 上下文 / 模型窗口**：`/v1/models` 的 `max_input_tokens` 是**理论能力**、会虚高——它说
  Sonnet 4.6/Opus 4.6 都是 1M，但**实测运行窗口**只有 **Opus 4.8/4.7 原生 1M**，其余默认 200K。
  cc 用 `model[1m]` 后缀选 1M 变体：`opus-4-6[1m]`/`sonnet-4-5[1m]` 能上 1M，但
  **`sonnet-4-6[1m]` 在本订阅报错「Usage credits required for 1M context」**（要额外付费 credits）。
  所以**别用 catalog 标 1M**（会误导+撞付费墙）。bridge 改为从每轮 `modelUsage[mainModel].contextWindow`
  **学习真实运行窗口**存 `modelwin.json`（gitignored，已用实测值做种子），`listModels` 据此给 ≥1M 的
  模型打 `1M` 徽章；没观测过的模型先不标、首次用到自学。`recordModelWin` 只学 BASE（跳过 `[1m]` 变体）。
  - **`[1m]` 变体条目**：`listModels` 对「catalog 能 1M（`max_input_tokens>=1M`）且 base 运行 <1M 且不在黑名单」的
    模型，额外合成一条 `{id:'<id>[1m]', ctx:1000000}`，前端自动按 ctx≥1M 打徽章、选它就带后缀跑 1M。
    原生 1M 的（opus-4-8/4-7）不合成（base 已 1M）。黑名单 `onemblock.json`（gitignored）种子含
    `claude-sonnet-4-6`（它的 1M 要付费 credits）；任何 turn 报 "usage credits required for 1m" 会
    `block1m()` 自动拉黑该模型并清 modelCache，下次扫描就不再提供其变体。
- **mode → permissionMode**：code→default, plan→plan, acceptEdits→acceptEdits。
  **bypass(=UI 的 Auto/全部允许) 不能用 'bypassPermissions'**——那是 `--dangerously-skip-permissions`，
  **cc 以 root 跑会直接拒绝退出（exit 1）**。所以 bypass 走 permissionMode 'default' + 一个
  **auto-allow 的 canUseTool**（直接 resolve allow），效果一样（不弹窗、全放行）又不触发 root 限制。
  UI 模式名对齐 TUI：Code / Accept Edits / Plan / Auto。
- **媒体**：`rewriteMedia()` 把 assistant 文本里的本地**图片**路径换成 `/media` URL（inline），
  **音频路径直接删掉**（用播放器展示，别让原始路径当文字漏出来）。`detectMedia()`→`media` 事件，
  audio→`<audio>` 播放器；图片 inline。tts 命令输出 mp3 路径，bridge 检测后发 player。
- **Token 统计**（turn_end 三个字段，别再混）：
  - `ctxTokens`（↑ 上下文占用）= **最后一条 assistant 消息**的 `input + cache_read + cache_creation`
    （= 窗口真实占用，和 TUI 一致）。**不要**把它和单列的 cached 并排显示——第二轮起几乎全是
    cache_read，两数几乎相等，看着像假的（用户原话）。
  - `outTokens`（↓ 输出）= **`result.usage.output_tokens`**（整轮累加）。**不能**取最后一条 assistant
    的 output_tokens——那只是收尾那句、会少算几十倍（实测 4 vs 真实 98）。
  - `ctxWindow` = `modelUsage` 里 footprint 最大那条（主对话模型，跳过 haiku 背景模型）的 contextWindow，
    前端显示成 `↑ 占用/窗口（%）`。占用 > 窗口（如 356K/200K=178%）= 用户选了个 200K 模型但会话超了，
    不是 bug，换 1M 模型即正常。
- **用量 /usage**（bridge `usage_report` → `usage` 消息）：账号级限额走 cc 的同一接口
  `GET https://api.anthropic.com/api/oauth/usage`（OAuth bearer + `anthropic-beta: oauth-2025-04-20`，只读），
  返回 `five_hour`/`seven_day`/`seven_day_opus`/`seven_day_sonnet`（各 `{utilization, resets_at}`，本订阅
  opus 那条常为 null）+ `extra_usage`（信用 `used_credits`/`monthly_limit`）。**本会话花费**：SDK 的
  `total_cost_usd` 是**单轮**的，bridge 在每个 `turn_end` 按 sessionId 累加进 `costs.json`（gitignored）
  报会话累计（cost/out/turns）；另按 sessionId 之外的 `_days`（按天）/`_archived`（删除会话先折进来，
  累计不回退）两个聚合键报 `totals`（累计$/会话数/轮次）+`today`。**用量页只显账号口径**，
  「本会话」只在对话内的搜索窄条显示（列表屏的 currentSession 是「上一个打开的对话」，
  显示成本会话会和对话里重复——用户报过）。**活跃天数**：`activedays.json` 持久化、只增不减
  （启动时从全部会话 jsonl 消息时间戳一次性回填；turn_end + listSessions mtime 并集保鲜）。
  旧实现拿 mtime 去重计天，续聊老会话/自动清理会让天数倒退（12→11，用户报过）。
  两个入口：① 左滑搜索框顶部一行窄条（`usageStrip`，每次 openSearch 拉一次，点 `us-line` 展开本会话明细）；
  ② 抽屉「用量」(`drUsage`) → 全屏 `#usageFull` 只读「终端风格」`<pre>`（`renderUsageFull` 用 `ubar()` 画进度条，
  数据同上、非真 PTY）。
- **输入框遮挡回复**：`.dock` 是 `position:absolute; bottom:0` 往上长，thread 的 `padding-bottom` 不能写死。
  `syncDockPad()`（`resizeComposer` 里 + `ResizeObserver(dock)`）把 thread 底padding 设成 `dock 高+22`，
  原本贴底就保持贴底。
- **fork（编辑/重生成）**：`resumeSessionAt` + `forkSession`，且**把原会话 hide（hidden.json）而不是
  删除**——fork 依赖原数据。
- **resume**：必须在该会话自己的 cwd 里跑（`getSessionInfo`），否则 "No conversation found"。

## 连接健壮性（已实现，别破坏）

- **turn 与连接解耦**：`turns` Map（turnId → {events[], seq, done, abort, detachTimer}）。
  WS 断开**不**中止正在跑的 turn，给 10 分钟宽限；重连后客户端发 `attach{turnId, after}`，
  bridge 回放缓冲事件续流。`out(turn,obj)` 给事件编号 `_i` 并缓冲。
- **心跳**：bridge 每 30s `ws.ping()`（扛 Cloudflare ~100s WS 空闲超时）。
- **畸形工具调用 → 整条回复被吞（已兜底，别拆）**：Opus 4.8 在本 CLI 里**偶发**把 tool_use 序列化成
  无法解析的形式（`date '+%Y-%m-%d %H:%M'` 那种带 `%`/引号/空格的复杂参数概率最高，但**无参数的
  `mcp__clock__now` 也中过**，所以根因是 4.8×CLI 的工具调用序列化、不是某个工具）。CLI 自己会重试一次
  （注入 isMeta「Your tool call was malformed…Please retry.」）；**首次 + 这次重试都畸形**时，CLI 吐一条
  `<synthetic>`「could not be parsed (retry also failed)」、整轮没有任何回复文字 → 用户看到**空气泡 +
  完成震动**。已两层缓解：① 时间改走 in-process `mcp__clock__now`（无参 tool_use 最不易被搞坏，取代
  `date`，见「SDK/额度要点」）；② **`runTurn` 透明重跑**——`MAX_ATTEMPTS=3`，一轮跑完若 `!gotText`
  （这轮一个字都没吐）且非用户 abort、非 1M 付费墙、且是 parse 失败/空结果，就 `resume` **同一个会话**
  （绝不再 fork、删掉 `resumeSessionAt/forkSession`）+ 发 `PARSE_RETRY_PROMPT` 让模型重答；`turn_end`
  **推迟到拿到真回复或重试耗尽**才发，所以**震动只在真有内容时才响**。`<synthetic>` 文本被吞、不当
  assistant_text 外发。③ **delta 捞回**——parse 失败可能把「已流出的回复」连带吞掉（assistant_delta
  流了文字但收尾 assistant 消息没来 → gotText/replyText 全空，唤醒推送/追问当 cc 没说话，
  2026-06 日记+唤醒撞点时真发生过）：每 attempt 攒 `deltaText`，`isParseFail` 且 delta 比
  replyText 长就捞回当本轮回复、不再只信重试版本；`outerGotText/outerReplyText` 改成无 result 也带出。`PARSE_RETRY_PROMPT` 带 `RETRY_SENTINEL`（隐藏字符+tag），连同遗留的
  「could not be parsed」报错气泡都在 `historyItems()`（`HIDE_TEXT` + `isApiErrorMessage`/`model==='<synthetic>'`）
  里滤掉，历史看不到杂质。
- **鉴权**：bridge 对 auth 之前的杂散消息**直接忽略**（只有真 auth 带错 token 才 auth_fail+close）。
  客户端 `wsend()` 要求 `connected && authed` 才发。`auth_fail` 在曾成功鉴权过（everAuthed）后
  当作短暂重连、不弹「token不正确」。
- **断联界面**：`#discScreen`（与世界断联，红黑闪+坠落遥测），断后 ~1.6s 才出现（上传中 9s）、
  重连/前台恢复即隐藏；设置→外观「断联动画」关掉就只用横幅。

## 「醒来」机制 + 每对话日记/便签（分三期，一期已上线；详见仓库 `wakeup-plan.md`）

第一期纯**服务端 + 前端热更，没打 APK**。

- **定时唤醒（可多个时间）**：会话长按菜单「定时唤醒」。`wakeups[sid].schedules = [{id,nextAt,repeat,by}]`——
  **一个对话可挂多个唤醒时间**（每条 once / daily HH:MM / every Nm 各自带 nextAt+repeat）。`by:'user'` 是用户在
  界面里设的、`by:'cc'` 是 cc 自己安排的（**可多格并存**，上限 12，不去重——撞了就排队）。`enabled` 是「开启定时唤醒」总开关，gate 所有
  check-in 排程（含 cc 的）。bridge 调度器 `setInterval(checkWakeups,30000)` 每 30s 扫，**队列语义**：
  到点的排程不合并、不丢弃——每个 tick 只触发**最早的一条**（触发时才推进它：repeat 算下次、once 丢弃），
  其余留在队列里等这轮唤醒跑完（activeSessions 释放）后续 tick 依次触发；时间重复/相邻的也各触发一次。`pubWake` 还回一个 `nextAt = wakeNextAt(w)`（所有排程里
  最近一次）给会话列表显示「下次醒来」。**老结构（单 `nextAt`/`repeat`）由 `ensureWake()` 在加载/每次处理时迁移成
  schedules 数组**。到点**服务端**(无客户端) resume 该会话、注入隐藏的「系统唤醒」提示(`WAKE_SENTINEL`，被
  `historyItems` 的 `HIDE_TEXT` 滤掉)、cc 醒来产出回复并写进 jsonl，**重开对话可见**(推送挂了也不丢)。`runTurn`
  **返回** `{gotText,text,sessionId}` 供 `fireWake` 判断 cc 是否真说了话(决定追问/推送)。
- **cc 自治**：per-turn 的 `makeSessionMcp(sessionRef)` 注册 `mcp__telos__*`：`set_wakeup`(绝对/相对/HH:MM/repeat——
  **每次调用新增一个 `by:'cc'` 格、可多个并存（上限 12，不去重），不动用户设的排程**；enable:false 清掉
  全部 cc 格、用户排程还在；曾经只有一格、每次覆盖——用户嫌限制次数鸡肋，2026-06 放开)、
  `read_diary`(返回正文+心情天气标签+**图片绝对路径**，cc 用 Read 看图)、`write_diary`、`leave_note`。checkin 唤醒
  提示词已提醒 cc：用户设的固定时间会自动重复、不必重复安排；自己想连续做事就多排几个。
  **sessionRef 是 per-turn 的、不是全局**——clock 的全局 `currentTz` 那套不能照搬到会话作用域(并发 turn 会串台)。
- **小纸条**：醒来发话后 5 分钟没回 → `fireWake('followup')` 追问，`MAX_FOLLOWUP=2` 后 `leaveSticky`。
  `lastUserMsgAt`(用户发消息时记) > `lastWakeAt` 即视为已回。进对话时未读 sticky 弹 `stickyScrim`。
  **「连续追问」**：per-session `wakeups[sid].chase`（表单开关 `wkChase`，`wakeup_set` 的 `chase` 字段）——
  开了就跳过 MAX_FOLLOWUP 封顶、不留 sticky，一直每 5 分钟追，直到用户回话或 cc 自己回「（不再打扰）」
  （quiet-stop 保留当刹车）；followup 提示词会告知 cc 该状态。
- **并发保护**：`activeSessions` Set(runTurn 进出维护)挡住唤醒和用户 turn 同时 resume 同一会话；用户发消息会
  abort 正在跑的 wake turn(`wakeTurnBySession`)。删会话调 `forgetSession()` 清 wakeups/diary/stickies；
  **开了唤醒的会话免于 autoCleanup**。
- **存储**(均 gitignored)：`server/wakeups.json` / `diary.json` / `stickies.json`。
- **每对话日记**：一页多条、user 与 cc 各写各的，带 mood/weather/tags、可插图(复用 /upload + /media；图片存**原始
  设备路径**，前端 `diaryImgUrl()` 转 /media)。`#diary` 屏两态：overview(抽屉汇总，各对话卡片)/detail(单对话，
  上日历下便签夹)；写/编辑走独立屏 `#diaryWrite`(点条目编辑、长按列表删)。日历选天**点了即时高亮**(乐观更新、
  别等服务器，否则觉得卡)。
- **定时写日记（独立功能）**：`wakeups[sid].dawn` 开关 + 可配置 `dawnTime`("HH:MM"，默认 04:00，唤醒表单里有时/分
  横滑选)。**完全独立于「开启定时唤醒」总开关**——checkWakeups 分支 3 只看 `w.dawn`。到点 cc 被唤醒、回顾对话、
  自行决定要不要给**前一天**写日记(`fireWake('dawn')` 的提示词；通常不打扰用户)。`nextDawnAt(w)` 按 dawnTime 算下次。
  (之前是写死 `DAWN_HOUR=4` 且和定时唤醒混在一起，用户嫌不像独立功能 → 拆出来、时间可调。)
- **媒体在历史里可见**(重开不丢)：`historyItems` 的 `pushText`——assistant 文本走 `rewriteMedia`(图内联)+音频出
  media 项；user 文本把 `[附带文件：路径]` 行删掉、图/音频抽成 media 项(因为 `addUser` 用 textContent、不渲染 md)。
  前端 `renderHistory` **按 role 分流**：用户的图片项回填进最近的用户气泡当缩略图
  （`userB`/`.bubimgs`，点开灯箱），其余才走 `addMedia`（cc 侧大图/播放器）——曾经全走 addMedia，
  重开后用户自己的图变成 cc 侧大图（用户报过）。聊天附件本就是**按路径**给 cc(`refPaths`→`[附带文件：路径]`，
  Read 按需看)、**不是 base64 内联**，所以图片不会永久塞爆上下文。
- **媒体快照(路径失效兜底)**：按路径引用的死穴是路径是活的——cc 整理相册把用户刚发的截图 `mv` 改名，
  重进对话图全没、连标识都不剩（踩过）。修法：发送(`refPaths`)/直播(`assistant_text`)/日记(`diaryAdd`/`diary_edit`)
  时对媒体文件建**硬链接快照**（`~/.cc-bridge/chatmedia/<内容hash>.<ext>`，同盘零空间、原文件删了 inode 仍在），
  `mediamap.json`(gitignored)记「原路径→快照」；`rewriteMedia`/`detectMedia`/`GET /media` 找不到原文件时按 map 回退
  （/media 兜底让客户端里烤定的旧 URL 也能继续加载）。真丢了(无快照)不再无声消失：assistant 的死链 markdown 图
  和 user 的附带行都换成可见占位「〔图片不见了：文件名〕」。附带路径改从 `[附带…：]` 注记行**原文提取**——
  带空格/括号的文件名 `PATH_RE` 抓不到（`屏幕截图(1024).png` 当年就从没显示过）。改完 bridge 记得重启，
  `_transCache` 里烤着旧解析结果。
- **记忆分池(按目录隔离)**：Mnemosyne 记忆池按**对话的 cwd** 隔离——同目录共池、异目录互相看不见（新对话
  默认各自独立空目录=独立池；「克隆为新窗口」同目录=同池；显式选目录=进那个人设/项目的池）。实现：bridge 挂
  MCP 时把 cwd 拼在地址上（`mnemosyneMcp(cwd)` → `?scope=`），streamable-http 每个 POST 原样带 query、
  SDK 把 Request 塞进 `ctx.request_context.request`，工具端 `_scope(ctx)` 读出来——模型看不到也改不了自己的池。
  ingest/recover/面板统计同样带 scope；对话向量不存 scope（跟 `dialog_sessions.scope` 走，挪池=改一行）；
  **记忆库页也按池**——老 App 的 `memory_list` 不带 sessionId，桥用 `ws._memSid`（这条连接最近 memory_get
  的对话）兜底过滤（用户报过「从别的对话进记忆库还看得到茜茜的」）；App 列表搜索页仍全库。
  scope 参数**缺失**（≠空串）回落 config 的
  `legacy_default_scope`（旧 bridge 兼容垫片）。目录在磁盘上改名/搬家会孤儿化旧池，用
  `POST /admin/rescope?from=&to=` 接回。机制详见 `mnemosyne/README.md`。
- **Mnemosyne 已退役（2026-07）**：`server/config.json` 设 `"mnemosyne": false` 一票关停（工具不挂、教学不注入、
  恢复只剩下面的书头部+最近对话；面板变恢复面板、回看轮数存 `server/recover.json`）。服务已 disable、
  数据保留——复活=改回 true + `systemctl enable --now mnemosyne` + 重启桥。分池/钥匙化等机制代码都在，只是不走。
- **回忆录(文件即记忆)**：`<cwd>/回忆录.md`（文件名固定＝桥找得到；书名她自己写第一行）——模型的长期
  自我叙事，她用 Read/Grep/Edit 亲手养，不加任何新工具。约定：分界线 `<!-- 以下按需翻阅 -->` 以上是头部
  （我是谁/当下篇/目录钥匙），**压缩恢复只注入头部**（`memoirHead()`，6000 字封顶带截断提醒）——书写多厚
  恢复都是恒定大小；细节在线下编年史各章（`##` 标题锚点，Grep 再 Read 那一章，行号会漂、锚点不会）。
  有书就注入、**不看 Mnemosyne 白名单**（新人设的书天然生效）。**记忆教学两变体**（按书的存在切换，
  每对话稳定→缓存只在建书那次破一次）：有书=「叙事进书、原文靠归档、零碎记卡」（remember 降为备忘卡、
  钉选退役、recall_dialog=地面真相）；没书=旧 Mnemosyne 教学。恢复块顺序＝回忆录头部→[Mnemosyne 在役时]钉选**钥匙**(summary 优先,分段子预算+溢出索引)→最近 N 轮(**所有对话**都有,不看白名单)。
  `remember` 工具带 `summary`(一句话标题≤50字)＝钥匙来源。
- **踩坑**：表单**绝不要用 `<input type=datetime-local>` / `<select>`**——安卓 WebView 会弹**系统原生选择器**(丑且
  违和)。唤醒配置全自定义控件：`.seg` 分段(只一次/每天/每隔) + `.wkscroll` 时/分横滑 chip(分钟 0–59) + 日期 chip
  (今天/明天/后天/未来 60 天)。

## 推送(第二期) + 自动压缩(血泪)

- **推送 = 自建 ntfy**：VPS 装 ntfy(`ntfy.service`,绑 127.0.0.1:2586)+ 独立隧道 `cloudflared-ntfy.service` →
  你的 ntfy 域名(token 鉴权,deny-all,topic 随机；具体见 `CLAUDE.local.md`)。**坑**:`cloudflared tunnel route dns
  <name> <host>` 会被默认 `/etc/cloudflared/config.yml` 的 tunnel 抢了 name 解析、把 DNS 指错隧道——必须
  `cloudflared --config <自己.yml> tunnel route dns --overwrite-dns <tunnelID> <host>` 用**显式 ID**。bridge 经
  `cfg.ntfy{url,topic,token}`(config.json, gitignored)POST 到 **localhost:2586**(本机发布、不绕公网);手机用 ntfy
  App 订阅公网域名。`maybePush` 无配置即 no-op。
- **不打扰 / 在线**:客户端发 `presence{sessionId,foreground,model,effort}`(在 `show()` + visibilitychange 触发),
  bridge 存 `ws._view/._fg`,推送时正前台看该对话就跳过;`push_pref{enabled}` 是「接收唤醒推送」总开关(`pushEnabled`)。
  唤醒产出回复时 `broadcast({type:'wake_message'})` 给在线客户端(在看→`addAssistantText`;否则 toast+列表刷新)。
- **模型/effort 每对话一份(2026-06 起)**:`sessmodel.json`(gitignored)按 sessionId 记 `{model,effort}`,
  在 `presence`/`send` 时 `rememberModel()` 捕获(模型含 `[1m]`,这是客户端运行态、jsonl 里看不到);
  `get_history` 把它当 `pref` 带回,客户端进对话切到 pref(没记过=''默认),选择器只改当前对话、立刻
  `sendPresence()` 回写;没会话(新对话)时才写全局默认 `LS.model`。**pref 加载前 presence 不带 model**
  (`state.modelMine` 标志)——旧版 App 每次看对话都拿全局值 stamp,正是它把每会话记忆冲掉的。
  `fireWake` 用 pref resume——**否则唤醒用默认 200K 模型 resume 一个 >200K 的对话 → cc 自动压缩 →
  用户丢细节**(踩过);想让唤醒对话单独用 haiku,进那个对话选一次即可,不影响别的对话。
  开页即显示模型(v1.1.26):`get_history` 另带 `lastModel`(jsonl 最后一条 assistant 的 model,
  '<synthetic>'/导入占位 'claude' 不算),标题下小字按 pref→lastModel→服务器默认显示,不用先发消息。
- **自动压缩**:cli 里自动压缩调用 `customInstructions:null`——**它不读任何「压缩提示词」**;之所以有时像按自定义提示词压,
  是因为那段提示词当时在上下文里、被总结模型顺手看见。已给 bridge systemd 加 `Environment=DISABLE_AUTO_COMPACT=1`
  (**只关自动、保留手动**;`DISABLE_COMPACT` 会连手动一起禁,别用)。手动「压缩历史」走 `/compact <pref.compactPrompt>`
  (设置→对话→编辑压缩提示词;弹框留空就用它)。`DISABLE_AUTO_COMPACT`/`autoCompactThreshold` 等都是 cli 认的 env。

## 易踩的坑（血泪）

- **bundled UI = file:// 页面，origin 是 "null"**。XHR/fetch 打 bridge 是跨域——bridge 必须发
  `Access-Control-Allow-Origin: *` 并应答 OPTIONS 预检（`xhr.send(file)` 的 Content-Type 非 simple、
  必有预检），否则上传/手动检查更新全是「网络错误」。最迷惑的是 **WS 和 `<img>` 不受 CORS 限制**——
  聊天/图片全正常、只有 JS 发的 HTTP 挂，看着像服务器没事。原生侧
  `allowUniversalAccessFromFileURLs = true` 兜底（随下个 APK 生效）。
- **静态 UI 必须 `Cache-Control: no-store`**。`no-cache` 会被 Cloudflare 改写成
  `max-age=14400`（边缘还缓存，`cf-cache-status` 可见）→ 手机端拿 4 小时旧 UI，
  前端热更像「没生效」。bridge 静态文件已改发 `no-store, must-revalidate`（CF 回 BYPASS）。
- **硬件返回键 = rootFlag 契约**。原生 `onBackPressed` 在 rootFlag=true 时直接退 App、
  不问 JS。rootFlag 必须等于「在 list/setup 屏**且无任何浮层**」——由 `overlayUp()`+
  `syncAtRoot()` 统一计算（show/各 open 入口同步 + 300ms interval 兜底）。曾经只在
  `show()` 里按屏幕名设置 → 列表屏开用量页/抽屉/搜索/长按菜单/多选时按返回直接回桌面。
  新加全屏浮层记得并进 `overlayUp()`。
- **`SCREENS` 数组里的名字必须等于元素 id**。`show()` 会 `$(name).classList...`，对不上就抛错、
  **整个 boot 中断、卡在启动页**。加新屏幕后用脚本核一遍（`SCREENS`/`SCRIMS`/`DRAG_SCRIMS` 都用变量遍历，
  字面量 `$('x')` 校验抓不到）。
- **switch 不能有重复 case**。曾经 `case 'folders'` 因重复 case 穿透进了 `auth_fail`，导致每条
  folders 消息都弹「token不正确」+踢回设置。
- **并发消息**：bridge 的 `ws.on('message', async ...)` 不串行，多条消息会并发跑 `handle()`。
  删除后别紧接着发 `list_sessions`（会和删除竞态、看着像没删）——让删除处理完再由 bridge 触发刷新。
- **`list_sessions` 的 limit**：默认给 **1000**（不是几十）做安全垫。`listSessions` 跨所有项目目录、
  按 mtime 取前 N 条再过滤 hidden。注意 **`listSessions` 返回数 ≠ 磁盘 jsonl 文件数**：它会过滤掉
  子代理/sidechain/空转写文件（实测磁盘 101 个 jsonl，listSessions 只返回 44 个"真"会话）。所以
  limit 只有在真会话数超过它时才截断（如大量导入后）；截断时删/隐藏一条会被下一条补位、可见数卡住，
  看着像「删不掉 / fork 不隐藏」其实都生效了（端到端验证：deleteSession 真删文件、regenerate 真把原 id
  写进 hidden.json）。
- **自动清理废弃对话**：客户端 pref `autoCleanup`（默认开，设置→对话）。auth_ok 后每次启动跑一次
  （`state._cleaned` 防重连重复跑），开关打开时也立即跑一次。bridge `cleanup_stale` → `cleanupStale()`：
  删掉 `lastModified` 超过 1 天、真实 user 轮次 ≤1（含空会话）、**未置顶**的会话（pin 是保护机制）。
  删完回 `cleanup_done {removed}`，客户端 toast + 重列。破坏性操作：动前先 dry-run 看会删哪些。
- **文件夹 ⇒ 置顶**：`assign_folder`（单个）和 `assign_many {ids,folder}`（多选批量）在 folder 非空时
  会把会话**自动 pin**（`pinned.add`）。理由：归类即视为"在意"，pin 让它置顶且**免于自动清理**
  （cleanup 跳过 pinned）。移出文件夹不自动取消 pin（留给用户手动）。多选栏的「文件夹」按钮走 `assign_many`。
- **状态栏隐藏→顶部黑洞**：`MainActivity` 没开真 edge-to-edge 也没设刘海模式时，有刘海的机器一隐藏状态栏，
  系统就把刘海区黑色 letterbox（用户原话"空洞洞的黑色"）。修：onCreate 加
  `WindowCompat.setDecorFitsSystemWindows(window,false)` + 状态/导航栏 `Color.TRANSPARENT` +（API28+）
  `layoutInDisplayCutoutMode = SHORT_EDGES`。配合 `viewport-fit=cover` 和 CSS 的 `--safe-top/--safe-bottom`
  （内容靠 safe-area 让位、奶油色窗口背景铺到顶）。**改了原生 → 要重打包 APK 才生效。**
- **沙箱 exit 144 = OOM**（重命令在沙箱里跑会被内存上限杀）。跑 systemctl/gh/curl/node 用
  `dangerouslyDisableSandbox:true` 并保持命令轻量。（bridge 本身是 systemd 服务、不在沙箱、8G 内存。）
- **extended thinking 退出重进就没了 / 只显示三行**：两个独立 bug。① `runTurn` 实时会 `out` thinking，
  但 `historyItems()` 当初**只拼 text/tool_use/tool_result、漏了 thinking 块** → get_history 永远不带，
  退出重进就没了。修：`historyItems` 加 `block.type==='thinking'`→`{kind:'thinking',text:block.thinking}`，
  前端 `renderHistory` 加 `it.kind==='thinking'`→`addThinking()`。**只对修复后产生的轮次有效**（老轮次当时
  没存进可读历史；导入的对话本就不带 thinking）。② `.thinking` 的 CSS 写死 `max-height:4.5em;overflow:hidden`
  （硬截 3 行还不能滚）→ 去掉，改成**默认显示全文**，点一下 toggle `.collapsed`（`-webkit-line-clamp:3`）折叠。

## 文件相关

- **上传** `POST /upload?dir=&name=&t=`（流式落盘，自动避免重名，homedir 内）；
  **下载** `GET /download?p=&t=`（带 Content-Length；`nativeDownload()`→`Android.download()`→系统下载管理器显示进度，浏览器环境退回 `<a>`）；
  **媒体/缩略图** `/media?p=&t=`。前端上传用 XHR 显示进度+速度。
- 文件管理是整页 `#files`（不是弹窗）；输入框 + 面板里也能进（attach 模式）。附件以**真实设备路径**
  引用给 cc（`msg.refPaths` → prompt 里 `[附带文件：...]`），图片 cc 用 Read 看。
- 长文本粘贴可设为文件（`msg.texts` → bridge 写到 `~/.cc-bridge/pasted/`）。

## 导入 Claude.ai 对话

- 长按 `.json`（文件管理）→ `import_list` 读清单 → `#import` 选择页勾选 → `import_convos
  {path, indices}`。
- 转换：每个对话 → 一个合法 cc 会话 JSONL，写到 `~/.claude/projects/<cwd编码>/<sessionId>.jsonl`。
  **cwd → 项目目录名编码 = `path.replace(/[^a-zA-Z0-9]/g,'-')`**（如 `/root/imported` → `-root-imported`）。
  行格式：`{type:'user'|'assistant', message:{role,content}, uuid, parentUuid(串链), sessionId, cwd,
  userType:'external', version, timestamp}`。标题用 `renameSession`，没有就回退 firstPrompt。
  导入的统一放进「导入」文件夹（folders.assign）。只取文字（thinking/tool/图片不带）。

## UI 风格约定

- **极简**：按钮/菜单标签只写动作，不要括号解释、不要装饰箭头、中英文别混。
  弹框/对话**去掉 ✕**（点框外关闭）。详见 memory `feedback_telos_ui_concise`。
- 调色板：`--bg #FAF9F5` / `--surface #FFFFFF` / `--surface-2 #F1EEE7` / `--accent #c2613f`
  / 纸色图标底 `#EAE2D2`。字体 Inter / Newsreader(serif) / JetBrains Mono。
- 手势：对话内右滑→返回列表、左滑→搜索；列表右滑→抽屉、左滑→搜索；输入区上滑开 + 面板、下滑收。
  触发都有阈值 + 震动（`buzz()`，受设置开关控制）。
- 设置是三级：设置 → 连接/外观/对话/触感/更新 → 各项（`SET_CATS` 数据驱动）。偏好存
  `localStorage.cc_pref_*`，不受「清除配置」影响。

## 提交约定

- commit 末尾：`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 不要提交：`config.json`、各 `*.json` 状态文件、`apk_version.txt`、`feedback/`（个人截图/导出）。
