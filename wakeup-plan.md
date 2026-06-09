# Telos「醒来」机制 + 便签夹/日记 + 推送 + 电脑控制端 —— 实施计划

> 状态:**第一期已完成并部署**(服务端已重启、前端热更已在供;端到端测试通过)。第二期(ntfy 推送)、第三期(电脑控制端)待启动。本文件是需求与进度的唯一来源。

## 背景与目标
让 Telos 里某个对话可以被「定时唤醒」:到点 cc 在服务端自动醒来、产出回复、并能自己决定下次醒来时间(高自由度,用户也能随时设/改/取消)。配套:醒来没人回时的「小纸条」追问、每对话的「日记/便签夹」子系统、手机推送通知、以及一个独立的「电脑控制端」。

## 架构(三部件)
- **Telos**(现有安卓壳 + 前端):聊天 + 醒来开关 + 日记/便签 UI;以后承载安卓权限/信息采集(权限放这里)。
- **推送服务**:VPS 上一个轻量 ntfy(TTS 已清,内存够);手机用现成 ntfy App 订阅私有 topic,通知深链跳回 Telos。每个 App 连自己的 bridge,分享不会让用户当中转。
- **控制端**:**单独**做,专门「完全控制用户的电脑」。最后做。

## 关键决策(已和用户对齐)
- 系统精确闹钟:**不做**(用户抵触)。醒来由 bridge 服务端调度。
- 安卓无障碍操控:**删,暂不做**。
- 醒来兜底:回复直接写进对话 jsonl,**重开对话就能看到**,推送挂了也不丢消息。
- 调度高自由度:cc 用工具自调度/停;用户在 Telos 手动设/改/取消并可覆盖。
- 日记/便签:**每对话各自一份**;另有抽屉汇总页(卡片列出各对话)。
- 日记:**一页多条、用户与 cc 各写各的**;支持插入图片;cc 可每天凌晨自动写前一天。

## 数据模型(bridge 端 JSON,均 gitignore)
- `server/wakeups.json` = `{ [sessionId]: { enabled, nextAt(ms|null), repeat(null|{kind:'daily',at:'HH:MM'}|{kind:'every',minutes:N}), dawn(bool), followupCount, lastFiredAt, lastUserMsgAt, tz } }`
- `server/diary.json` = `{ [sessionId]: { [YYYY-MM-DD]: [ { author:'user'|'cc', text, images:[mediaRef...], ts } ] } }`
- `server/stickies.json` = `{ [sessionId]: [ { id, text, ts, read } ] }`

## cc 的 MCP 工具(in-process,仿现有 clockServer)
- `mcp__wakeup__set` — `{ when?, repeat?, enable? }`;when 支持绝对时间 / 相对(如 `+30m`)/ `HH:MM`;repeat 支持 daily/every/none;enable:false 取消。返回算出的下次时间。
- `mcp__diary__read` — `{ date? }` 读当前对话日记(指定某天或全部/最近)。
- `mcp__diary__write` — `{ text, date?, images? }` 给当前对话某天追加一条(author=cc,默认今天;凌晨任务写前一天)。
- `mcp__sticky__leave` — `{ text }` 给当前对话留一张小纸条。
- 工具靠闭包变量 `currentSessionId`(仿 `currentTz`)知道作用于哪个对话;系统类工具 auto-allow(仿 clock)。

---

## 第一期:醒来核心 + 小纸条 + 日记(纯服务端 + 前端热更,不打 APK)

### 1. 醒来核心(服务端)
- [ ] 新增 `wakeups.json` 读写帮助(仿 `pins.json` 等)。
- [ ] `mcp__wakeup__set` 工具 + 注册进 query options 的 mcpServers。
- [ ] 调度器:`setInterval(checkWakeups, 30000)`;到期且 enabled 的会话触发。
- [ ] 触发=服务端无客户端地 resume 该会话(原 cwd)、注入唤醒系统提示、跑一轮;算下次时间(repeat / cc 调用的 set / 一次性则停)。
- [ ] 并发保护:该会话有活跃 turn 时跳过/延后本次唤醒。
- [ ] 记录 `lastUserMsgAt`(用户给该会话发消息时更新),供小纸条判断。

### 2. 小纸条(追问)
- [ ] 唤醒发话后 5 分钟检查:若期间无用户回复 → 再醒一次(追问)。
- [ ] 连续无回复达上限(默认 2)→ 写一张 sticky 到 `stickies.json`,停止追问。
- [ ] `mcp__sticky__leave` 工具(cc 也能主动留)。
- [ ] 前端:进入对话/App 时若该对话有未读 sticky → 弹窗呈现;点「已读」/「跳过」收进便签夹(标 read)。

### 3. 会话「定时唤醒」开关(前端)
- [ ] 会话长按菜单(`sessScrim`)加「定时唤醒」项 → 打开配置(首次时间 / 重复 / 关闭)。
- [ ] 协议:前端发 `{type:'wakeup_set', sessionId, ...}`;bridge 落库;`{type:'wakeup_state'}` 回传。
- [ ] 列表/会话头显示「下次 HH:MM 醒来」小标识,可随手关。

### 4. 日记/便签 页面(前端 + 服务端)
- [ ] bridge:`diary.json`/`stickies.json` 读写 + 协议(读/写/列举)。
- [ ] cc 工具 `mcp__diary__read` / `mcp__diary__write`。
- [ ] 「+」工具面板加「日记 / 便签夹」入口,放在「压缩历史」**上方**;「压缩历史」固定到面板**最底部**。
- [ ] 当前对话页:上半=日记(月历,有内容打点;点某天看/写;一页多条按时间;插入图片复用现有上传/媒体);下半=便签夹(列表 + 二级菜单:点开看详情 + 删除/已读)。
- [ ] 抽屉边栏:加「日记 / 便签夹」汇总入口 → 汇总页按对话列卡片(像会话列表),点进对应对话的日记/便签页。
- [ ] 每天凌晨给开了 `dawn` 的对话排一次唤醒,提示 cc 决定是否写前一天日记。

### 第一期验证
- 设一个会话 1–2 分钟后醒来 → 看 bridge 日志触发、对话 jsonl 出现 cc 回复、重开可见。
- cc 调 `mcp__wakeup__set` 设下次 → 落库且下次按时触发。
- 不回复 → 5 分钟后追问 → 再不回 → 出 sticky → 进 App 弹窗 → 收进便签夹。
- 日记:用户写一条 + cc 写一条同一天 → 日历打点、两条并存;插图正常;抽屉汇总页按对话列出。

---

## 第二期:推送(VPS ntfy)
- [ ] VPS 装 ntfy(systemd,绑 127.0.0.1 + cloudflared/已有隧道,私有 topic)。
- [ ] bridge:唤醒产出回复后 POST 到 ntfy(标题=对话名,正文=摘要,点击深链跳回 Telos 对应对话)。
- [ ] 总开关「是否全部推送」;**默认所有对话都推**;**正待在某对话里时不推该对话**。
- [ ] 手机:装 ntfy App 订阅私有 topic;通知点击 → 打开 Telos 到对应对话(深链/intent)。可能需小幅原生改动 → 打 APK。

## 第三期:电脑控制端(单独做,最后)
- [ ] 传输:**Tailscale 优先**(PC+VPS 组私网,cc 走私网够到 PC agent,不公网暴露);备选复用 cloudflared + 强 token。
- [ ] PC 端 agent(Windows?):暴露为 cc 的 MCP 工具,先做命令执行 + 文件读写;GUI 键鼠/截屏待定。
- [ ] 安卓信息采集(位置/应用使用时长/电量网络)落在 **Telos**,做成 cc 工具按需取;没连返回上次值。

---

## 备注
- 仿现有持久化(`pins.json`/`folders.json` 等)与 MCP 工具(`clockServer`)模式,改动surgical。
- 不提交 token / `*.json` 状态文件 / `apk_version.txt` / `apk_notes.txt` / `feedback/`。
