# 「一键转到终端」功能 · 知识汇总与实现指南

> 目标：在 Telos App 里对某条对话一键操作，把它克隆成终端 Claude Code 里可直接 `/resume` 看到、可接着聊的会话。
> 本文档所有结论均在 2026-08-12 实测通过（claude 2.1.228，原生二进制）：真实对话成功转出并出现在 `/resume` 列表。

## 一、Claude Code 会话存储结构

- 会话文件：`~/.claude/projects/<项目目录名>/<sessionId>.jsonl`
  - `<项目目录名>` = 工作目录路径中非字母数字字符替换为 `-`，如 `/root/cc-sessions/90e94fce-…` → `-root-cc-sessions-90e94fce-…`
  - Telos 每条对话的工作目录是 `/root/cc-sessions/<telos对话id>`，所以每条对话独占一个项目目录
- 子 agent 记录：与 jsonl 同名的**目录** `<sessionId>/subagents/agent-*.jsonl`，克隆时要一起带走
- jsonl 每行一个 JSON 对象，常见 `type`：`user` / `assistant` / `queue-operation` / `ai-title`（对话标题，`/resume` 列表显示用）/ `last-prompt` / `mode` / `attachment` 等
- ⚠️ 此格式是 Claude Code 内部实现，跨版本可能变化；每次 CC 升级后应回归验证一次本功能

## 二、为什么 Telos 的对话在 `/resume` 里看不到（三道关卡）

直接把 jsonl 复制到目标项目目录**不够**，实测有三道关卡：

### 关卡 1：entrypoint SDK 过滤（★ 实测确认为决定性条件）
`/resume` 选择器会**硬性剔除**以下会话（从 claude 二进制内嵌源码中挖出，有日志文案 `Session … filtered from /resume: …` 为证）：
- `sessionKind` 为 `daemon` / `daemon-worker` 的会话
- `/loop` 会话（`isLoopSession`）
- **`entrypoint` ∈ {`sdk-cli`, `sdk-ts`, `sdk-py`} 的会话**（源码：`Oon=new Set(["sdk-cli","sdk-ts","sdk-py"])`）
  - 例外：当前进程自己就是从 SDK 入口起的则不过滤（`let l=Oon.has(当前entrypoint)`）——这就是 Telos 自己能 resume 自己会话的原因
- Telos 经 Agent SDK 创建的会话，每个 user 行都带 `"entrypoint":"sdk-ts"`、`"promptSource":"sdk"`
- **修法：把 `"entrypoint":"sdk-ts"` 全部替换为 `"entrypoint":"cli"`。`promptSource:"sdk"` 可以不动（过滤器只看 entrypoint，实测保留 sdk 值也能显示）**

### 关卡 2：cwd 字段
- 每行记录的 `"cwd"` 指向原 Telos 工作目录；选择器按 cwd 归类会话，不匹配当前目录会被过滤/归到别处
- 修法：把 `"cwd":"/root/cc-sessions/<convId>…"` 全部改成目标目录（如 `"/root"`）。**只改 `"cwd":"…"` 字段本身**，别动对话内容里出现的同样路径（用 `"cwd":"` 作为锚点做正则替换）

### 关卡 3：`~/.claude/history.jsonl` 索引
- 终端里每输入一条消息就登记一行：
  ```json
  {"display":"<输入文本>","pastedContents":{},"timestamp":<毫秒epoch>,"project":"/root","sessionId":"<id>"}
  ```
- SDK 会话从不写入此文件。给克隆会话补一条（display 用首条用户消息摘要，project 填目标目录）
- 注：关卡 2、3 是在关卡 1 之前先修的，未单独隔离验证其必要性；三项全做后成功显示。**建议实现时三项都做**，成本极低且稳妥

## 三、完整迁移流程（可直接照抄）

```bash
OLD=<telos会话的sessionId>            # 即 Telos 对话工作目录下 jsonl 的文件名
CONV=<telos对话id>                    # cc-sessions 下的目录名
NEW=$(cat /proc/sys/kernel/random/uuid)
SRC=~/.claude/projects/-root-cc-sessions-$CONV
DST=~/.claude/projects/-root          # 目标项目 /root

# 1. 克隆主文件并换新 sessionId（全文替换，含 ai-title 等所有行）
sed "s/$OLD/$NEW/g" "$SRC/$OLD.jsonl" > "$DST/$NEW.jsonl"

# 2. 克隆 subagents 目录（若存在），同样换 ID
[ -d "$SRC/$OLD" ] && cp -r "$SRC/$OLD" "$DST/$NEW" && \
  grep -rl "$OLD" "$DST/$NEW" | xargs sed -i "s/$OLD/$NEW/g"

# 3. cwd 改为目标目录（只动 cwd 字段）
sed -i "s#\"cwd\":\"/root/cc-sessions/$CONV[^\"]*\"#\"cwd\":\"/root\"#g" "$DST/$NEW.jsonl"

# 4. entrypoint 去 SDK 化（关键一步）
sed -i 's/"entrypoint":"sdk-ts"/"entrypoint":"cli"/g' "$DST/$NEW.jsonl"

# 5. 补 history.jsonl 索引（display 记得做 JSON 转义）
printf '{"display":"%s","pastedContents":{},"timestamp":%s,"project":"/root","sessionId":"%s"}\n' \
  "<首条用户消息摘要>" "$(date +%s%3N)" "$NEW" >> ~/.claude/history.jsonl

# 6. 逐行 JSON 校验（防 sed 弄坏文件）
python3 -c "
import json,sys
[json.loads(l) for l in open('$DST/$NEW.jsonl')]
print('ok')"
```

完成后：
- `claude` 在 `/root` 下打开 → `/resume` 列表可见（标题取自 ai-title 行）
- 或任意目录 `claude --resume $NEW` 直连（v2.1.223+ 跨目录搜索所有项目）

## 四、设计要点与坑

1. **必须克隆为新 UUID，绝不 move、绝不复用旧 ID**
   - 原件 Telos 还在用（SDK 继续 append），动了会弄坏 App 侧对话
   - v2.1.223+ 跨目录 resume 遇到重复 sessionId 会直接报 not-found（防呆设计），同 ID 两份必炸
   - 语义上等同 App 里已有的「克隆为新窗口」（v1.1.86）：转出后两边独立，互不写回
2. **history.jsonl 的并发**：追加是行级操作，与正在运行的 cc 会话并发写基本安全，但建议单次原子 append（一条 printf/appendFile），别读改写全文件
3. **display 文本转义**：首条用户消息可能含引号/换行/emoji，写入 history.jsonl 前务必 JSON 转义（用 `JSON.stringify` 而不是字符串拼接）
4. **sed 替换 sessionId 是全文替换**：UUID 随机碰撞概率可忽略，但若对话内容里恰好引用了自身 sessionId（如调试场景）会一起被改——可接受
5. **版本前提**：跨目录 `--resume <id>` 需 CC ≥ 2.1.223；`/resume` 选择器 Ctrl+A=所有项目、Ctrl+W=当前仓库全部 worktree；`/cd` 会迁移会话存储（≥ 2.1.169）
6. **Telos 服务端做这事没有权限障碍**：本次手工操作被 cc 会话内的 auto-mode 安全分类器拦过几次（改 `~/.claude` 内部文件敏感），但 Telos server 是独立 Node 进程，直接 fs 操作即可，不经过分类器

## 五、建议的功能形态（供参考，最终以用户拍板为准）

- 入口：对话长按菜单加「转到终端」，与「复制为新窗口」并列（复用其克隆语义）
- 服务端：新增一个接口（如 `POST /conversations/:id/export-terminal`），用 Node fs 实现上面第三节流程（别 shell out 拼 sed，直接逐行 `JSON.parse`/改字段/`JSON.stringify` 更稳，还天然完成第 6 步校验）
- 完成后弹提示：`已转出，终端里 /resume 可见；或 claude --resume <新ID>`，附复制按钮
- 目标项目目录建议固定 `/root`（用户终端的默认位置）；如以后要可选，做成参数
