import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, createReadStream, createWriteStream, watch as fsWatch } from 'node:fs';
import { homedir } from 'node:os';
import * as fsp from 'node:fs/promises';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  query,
  listSessions,
  getSessionMessages,
  getSessionInfo,
  renameSession,
  deleteSession,
  tool,
  createSdkMcpServer
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { loadConfig } from './config.js';

const cfg = loadConfig();

// ---- pinned sessions (persisted) ----
const PINS_PATH = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), 'pins.json');
let pinned = new Set();
try { pinned = new Set(JSON.parse(readFileSync(PINS_PATH, 'utf8'))); } catch (e) { pinned = new Set(); }
function savePins() {
  try { writeFileSync(PINS_PATH, JSON.stringify([...pinned])); } catch (e) {}
}

// ---- custom folders (persisted) ----
const FOLDERS_PATH = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), 'folders.json');
let folders = { list: [], assign: {} };
try { folders = JSON.parse(readFileSync(FOLDERS_PATH, 'utf8')); } catch (e) {}
folders.list = folders.list || []; folders.assign = folders.assign || {};
function saveFolders() { try { writeFileSync(FOLDERS_PATH, JSON.stringify(folders)); } catch (e) {} }

// ---- hidden sessions (fork bases: kept on disk so forks stay valid, hidden from the list) ----
const HIDDEN_PATH = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), 'hidden.json');
let hidden = new Set();
try { hidden = new Set(JSON.parse(readFileSync(HIDDEN_PATH, 'utf8'))); } catch (e) {}
function saveHidden() { try { writeFileSync(HIDDEN_PATH, JSON.stringify([...hidden])); } catch (e) {} }

// ---- disabled MCP servers (per-session tool blocking) ----
const MCPOFF_PATH = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), 'mcpoff.json');
let mcpOff = new Set();
try { mcpOff = new Set(JSON.parse(readFileSync(MCPOFF_PATH, 'utf8'))); } catch (e) {}
function saveMcpOff() { try { writeFileSync(MCPOFF_PATH, JSON.stringify([...mcpOff])); } catch (e) {} }

// ---- learned per-model RUNTIME context window (the catalog max_input_tokens over-reports:
// it's the *capable* size, but only Opus 4.8/4.7 run 1M natively; Sonnet 4.6's 1M even needs
// paid usage credits). We learn the true base window from each turn's modelUsage and use that
// to tag the picker, so the label matches what the model actually runs at. ----
const MODELWIN_PATH = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), 'modelwin.json');
let modelWin = {};
try { modelWin = JSON.parse(readFileSync(MODELWIN_PATH, 'utf8')) || {}; } catch (e) {}
function recordModelWin(id, win) {
  if (!id || !win || /\[1m\]$/i.test(id)) return; // only learn BASE windows, not the [1m] variant
  if (modelWin[id] === win) return;
  modelWin[id] = win;
  try { writeFileSync(MODELWIN_PATH, JSON.stringify(modelWin)); } catch (e) {}
}
// models whose [1m] variant we must NOT offer: 1M needs paid usage credits on this plan
// (e.g. claude-sonnet-4-6 → "Usage credits required for 1M context"). Seeded + auto-learned.
const ONEM_BLOCK_PATH = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), 'onemblock.json');
let oneMBlocked = new Set(['claude-sonnet-4-6']);
try { oneMBlocked = new Set(JSON.parse(readFileSync(ONEM_BLOCK_PATH, 'utf8'))); } catch (e) {}
function block1m(modelId) {
  const base = String(modelId || '').replace(/\[1m\]$/i, '');
  if (!base || oneMBlocked.has(base)) return;
  oneMBlocked.add(base);
  try { writeFileSync(ONEM_BLOCK_PATH, JSON.stringify([...oneMBlocked])); } catch (e) {}
  modelCache = null; // drop the variant from the next scan
}
// per-session running cost (≈ what these turns would cost on the API), summed across turns.
// SDK's total_cost_usd is per-turn, so we accumulate it here to report a session total.
const COSTS_PATH = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), 'costs.json');
let costs = {};
try { costs = JSON.parse(readFileSync(COSTS_PATH, 'utf8')) || {}; } catch (e) {}
function saveCosts() { try { writeFileSync(COSTS_PATH, JSON.stringify(costs)); } catch (e) {} }
// server display name -> mcp tool namespace (e.g. "claude.ai my brain" -> mcp__claude_ai_my_brain)
function mcpPrefix(name) { return 'mcp__' + name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/_+$/g, ''); }
function disallowedFromOff() { return [...mcpOff].map(mcpPrefix); }

// ========================================================================
// 「醒来」机制 + 每对话日记 + 便签夹(小纸条)  —— 见 wakeup-plan.md
// ========================================================================
const DEFAULT_TZ = process.env.TZ || 'Asia/Shanghai';
const MAX_FOLLOWUP = 2;                  // 小纸条: 醒来没人回时最多再追醒这么多次（开了「连续追问」chase 则不设上限）
const FOLLOWUP_DELAY_MS = 5 * 60 * 1000; // 追问间隔 5 分钟

// ---- per-session scheduled wake + follow-up state (persisted) ----
const WAKEUPS_PATH = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), 'wakeups.json');
let wakeups = {}; // { [sid]: { enabled, chase, schedules:[{id,nextAt,repeat,by}], dawn, dawnTime, dawnAt, followupAt, followupCount, lastWakeAt, lastUserMsgAt, tz } }
try { wakeups = JSON.parse(readFileSync(WAKEUPS_PATH, 'utf8')) || {}; } catch (e) {}
// 迁移：老结构是单个 nextAt/repeat → 统一成 schedules 数组（可多个唤醒时间）；dawn 给个可配置 dawnTime。
function ensureWake(w) {
  if (!w) return w;
  if (!Array.isArray(w.schedules)) {
    w.schedules = (w.nextAt || w.repeat) ? [{ id: randomUUID(), nextAt: w.nextAt || null, repeat: w.repeat || null, by: 'user' }] : [];
  }
  delete w.nextAt; delete w.repeat;
  if (!w.dawnTime) w.dawnTime = '04:00';
  return w;
}
for (const sid of Object.keys(wakeups)) ensureWake(wakeups[sid]);
function saveWakeups() { try { writeFileSync(WAKEUPS_PATH, JSON.stringify(wakeups)); } catch (e) {} }

// ---- per-session model/effort, remembered from the user's turns so a server-side WAKE resumes with
// the SAME model (esp. the [1m] variant). Otherwise a wake resumes a big conversation on the 200K base
// model → cc auto-compacts → user loses detail. (gitignored) ----
const SESSMODEL_PATH = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), 'sessmodel.json');
let sessModel = {};
try { sessModel = JSON.parse(readFileSync(SESSMODEL_PATH, 'utf8')) || {}; } catch (e) {}
function saveSessModel() { try { writeFileSync(SESSMODEL_PATH, JSON.stringify(sessModel)); } catch (e) {} }
function rememberModel(sid, model, effort) {
  if (!sid || (model == null && effort == null)) return;
  const cur = sessModel[sid] || {};
  const nx = { model: model != null ? model : (cur.model || ''), effort: effort != null ? effort : (cur.effort || '') };
  if (nx.model !== cur.model || nx.effort !== cur.effort) { sessModel[sid] = nx; saveSessModel(); }
}

// ---- per-session diary: one page per day, many entries (user / cc each their own) ----
const DIARY_PATH = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), 'diary.json');
let diary = {}; // { [sid]: { 'YYYY-MM-DD': [ {author:'user'|'cc', text, images:[], ts} ] } }
try { diary = JSON.parse(readFileSync(DIARY_PATH, 'utf8')) || {}; } catch (e) {}
function saveDiary() { try { writeFileSync(DIARY_PATH, JSON.stringify(diary)); } catch (e) {} }

// ---- per-session sticky notes (便签夹) ----
const STICKIES_PATH = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), 'stickies.json');
let stickies = {}; // { [sid]: [ {id, text, ts, read} ] }
try { stickies = JSON.parse(readFileSync(STICKIES_PATH, 'utf8')) || {}; } catch (e) {}
function saveStickies() { try { writeFileSync(STICKIES_PATH, JSON.stringify(stickies)); } catch (e) {} }

// ---- timezone-aware wall-clock helpers (Asia/* has no DST → one-iteration offset is exact) ----
function tzParts(date, tz) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
  } catch (e) { return null; }
}
function tzOffsetMs(date, tz) { const p = tzParts(date, tz); if (!p) return 0; return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - date.getTime(); }
function wallToEpoch(y, mo, d, h, mi, tz) { const g = Date.UTC(y, mo - 1, d, h, mi, 0); return g - tzOffsetMs(new Date(g), tz); }
function todayStr(tz, offsetDays = 0) {
  const p = tzParts(new Date(Date.now() + offsetDays * 86400000), tz);
  if (!p) return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
function nextDailyAt(hh, mm, tz, fromMs = Date.now()) {
  const p = tzParts(new Date(fromMs), tz); if (!p) return fromMs + 86400000;
  let t = wallToEpoch(p.y, p.mo, p.d, hh, mm, tz);
  if (t <= fromMs + 1000) t = wallToEpoch(p.y, p.mo, p.d + 1, hh, mm, tz);
  return t;
}
// parse a "when": absolute (ISO / "YYYY-MM-DD HH:MM"), relative ("+30m"/"+2h"/"+1d"/"+90"), or "HH:MM" (next occurrence)
function parseWhen(when, tz) {
  if (when == null) return null;
  const s = String(when).trim(); let m;
  if ((m = s.match(/^\+\s*(\d+)\s*(m|min|mins|minute|minutes|h|hr|hour|hours|d|day|days)?$/i))) {
    const n = +m[1], u = (m[2] || 'm').toLowerCase();
    return Date.now() + n * (u[0] === 'h' ? 3600000 : u[0] === 'd' ? 86400000 : 60000);
  }
  if ((m = s.match(/^(\d{1,2}):(\d{2})$/))) return nextDailyAt(+m[1], +m[2], tz);
  const t = Date.parse(s.replace(' ', 'T'));
  return isNaN(t) ? null : t;
}
function parseRepeat(repeat) {
  const s = String(repeat || '').trim().toLowerCase(); let m;
  if (!s || s === 'none' || s === 'off' || s === 'once') return null;
  if ((m = s.match(/^daily\s+(\d{1,2}):(\d{2})$/))) return { kind: 'daily', at: `${String(+m[1]).padStart(2, '0')}:${m[2]}` };
  if ((m = s.match(/^every\s+(\d+)\s*m/))) return { kind: 'every', minutes: +m[1] };
  if ((m = s.match(/^every\s+(\d+)\s*h/))) return { kind: 'every', minutes: +m[1] * 60 };
  return null;
}
function repeatNext(repeat, tz, now = Date.now()) {
  tz = tz || currentTz || DEFAULT_TZ;
  if (repeat?.kind === 'daily' && repeat.at) { const [hh, mm] = String(repeat.at).split(':').map(Number); return nextDailyAt(hh || 0, mm || 0, tz, now); }
  if (repeat?.kind === 'every' && repeat.minutes) return now + repeat.minutes * 60000;
  return null;
}
// 把 {nextAt|when, repeat} 规整成一个排程项；算不出时间就返回 null（调用方丢弃）。
function normSchedule(s, by, tz) {
  if (!s) return null;
  const repeat = (s.repeat && s.repeat.kind) ? s.repeat : parseRepeat(s.repeat);
  let nextAt = s.nextAt ? +s.nextAt : (s.when ? parseWhen(s.when, tz) : null);
  if (!nextAt && repeat) nextAt = repeatNext(repeat, tz);
  if (!nextAt && !repeat) return null;
  return { id: s.id || randomUUID(), nextAt: nextAt || null, repeat: repeat || null, by };
}
// 最近一次要醒来的时间（跨所有排程项，含 cc 自己安排的）——给会话列表显示“下次醒来”用。
function wakeNextAt(w) {
  if (!w || !w.enabled || !Array.isArray(w.schedules)) return 0;
  let min = 0;
  for (const s of w.schedules) if (s.nextAt && (!min || s.nextAt < min)) min = s.nextAt;
  return min;
}
// 凌晨写日记的下次触发时间（按本对话 dawnTime，默认 04:00）。
function nextDawnAt(w, now = Date.now()) {
  const tz = w.tz || currentTz || DEFAULT_TZ;
  const [hh, mm] = String(w.dawnTime || '04:00').split(':').map(Number);
  return nextDailyAt(hh || 0, mm || 0, tz, now);
}
function fmtTime(ms, tz) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleString('zh-CN', { timeZone: tz || DEFAULT_TZ, hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return new Date(ms).toISOString(); }
}

function leaveSticky(sid, text) {
  if (!sid || !text) return;
  const arr = stickies[sid] || (stickies[sid] = []);
  arr.push({ id: randomUUID(), text: String(text).slice(0, 2000), ts: Date.now(), read: false });
  if (arr.length > 200) arr.splice(0, arr.length - 200);
  saveStickies();
}
function diaryAdd(sid, date, author, text, images, extra) {
  if (!sid || !text) return null;
  const day = date || todayStr(wakeups[sid]?.tz || currentTz || DEFAULT_TZ);
  const book = diary[sid] || (diary[sid] = {});
  const page = book[day] || (book[day] = []);
  page.push({ author: author === 'cc' ? 'cc' : 'user', text: String(text).slice(0, 20000), images: Array.isArray(images) ? images.slice(0, 20) : [], mood: (extra && extra.mood) || '', weather: (extra && extra.weather) || '', tags: (extra && extra.tags) || '', ts: Date.now() });
  saveDiary();
  return day;
}
// drop a deleted session's wake/diary/sticky/model/cost state so an orphan schedule can't keep
// firing and the state files don't grow forever
function forgetSession(sid) {
  if (!sid) return;
  if (wakeups[sid]) { delete wakeups[sid]; saveWakeups(); }
  if (diary[sid]) { delete diary[sid]; saveDiary(); }
  if (stickies[sid]) { delete stickies[sid]; saveStickies(); }
  if (sessModel[sid]) { delete sessModel[sid]; saveSessModel(); }
  if (costs[sid]) { // fold into the archive bucket first so 累计花费 never goes down
    const a = (costs._archived = costs._archived || { cost: 0, out: 0, turns: 0, sessions: 0, in: 0, cache: 0 });
    const c = costs[sid];
    a.cost += c.cost || 0; a.out += c.out || 0; a.turns += c.turns || 0; a.sessions += 1; a.in = (a.in || 0) + (c.in || 0); a.cache = (a.cache || 0) + (c.cache || 0);
    delete costs[sid]; saveCosts();
  }
}
// public (client-facing) snapshot of a session's wake config
function pubWake(sid) {
  const w = wakeups[sid] || {};
  const schedules = (w.schedules || []).map((s) => ({ id: s.id, nextAt: s.nextAt || 0, repeat: s.repeat || null, by: s.by || 'user' }));
  return { enabled: !!w.enabled, chase: !!w.chase, schedules, nextAt: wakeNextAt(w), dawn: !!w.dawn, dawnTime: w.dawnTime || '04:00', dawnAt: w.dawnAt || 0, tz: w.tz || '' };
}

// ---- live broadcast to all authed clients (state changes; turn events stay per-turn via out()) ----
const clients = new Set();
let pushEnabled = true; // master "receive wake push" switch, set by the client's pref (push_pref)
function broadcast(obj) { const s = JSON.stringify(obj); for (const ws of clients) { if (ws.readyState === ws.OPEN) try { ws.send(s); } catch (e) {} } }
function broadcastWake(sid) { broadcast({ type: 'wakeup_state', sessionId: sid, state: pubWake(sid) }); }
function broadcastDiary(sid) { broadcast({ type: 'diary_changed', sessionId: sid }); }
function broadcastSticky(sid) { broadcast({ type: 'sticky_changed', sessionId: sid, unread: (stickies[sid] || []).filter((s) => !s.read).length }); }

// ---- session-scoped MCP tools (wake / diary / sticky). Built per-turn with a ref so the tool
// knows which conversation called it without a racy global (the bridge runs turns concurrently). ----
function makeSessionMcp(sessionRef) {
  return createSdkMcpServer({
    name: 'telos', version: '1.0.0', tools: [
      tool('set_wakeup',
        '给这个对话新增一个「醒来」时间（到点你会被系统自动唤醒）。可多次调用、每次新增一个，与已有的并存——想接下来分几次做事/说话就排几个；时间重复或相邻也没关系，到点的会排队依次触发、每个都生效。when：绝对时间(ISO 或 "YYYY-MM-DD HH:MM")、相对("+30m"/"+2h"/"+1d")、或每日时刻("HH:MM"取下一次)。repeat：可选，"daily HH:MM"=每天该时刻、"every Nm"/"every Nh"=每隔一段、"none"=只一次。enable:false=清掉你给自己安排的全部唤醒（用户在界面设的不受影响）。',
        { when: z.string().optional(), repeat: z.string().optional(), enable: z.boolean().optional() },
        async ({ when, repeat, enable }) => {
          const sid = sessionRef.id;
          if (!sid) return { content: [{ type: 'text', text: '当前没有可设置的对话。' }] };
          const w = ensureWake(wakeups[sid] || (wakeups[sid] = {}));
          w.tz = currentTz || w.tz || DEFAULT_TZ;
          // cc 只管自己的格子（by:'cc'，可多个），不动用户在界面里设的那些唤醒时间。
          if (enable === false) {
            w.schedules = w.schedules.filter((s) => s.by !== 'cc');
            if (!w.schedules.length) w.enabled = false;
            saveWakeups(); broadcastWake(sid);
            return { content: [{ type: 'text', text: '好，已清掉我自己安排的全部醒来。' }] };
          }
          const rep = repeat !== undefined ? parseRepeat(repeat) : null;
          let nextAt = when ? parseWhen(when, w.tz) : (rep ? repeatNext(rep, w.tz) : null);
          if (!nextAt && !rep) return { content: [{ type: 'text', text: '没看懂时间。请给绝对时间、相对(+30m/+2h)、或 HH:MM。' }] };
          if (!nextAt && rep) nextAt = repeatNext(rep, w.tz);
          const mine = w.schedules.filter((s) => s.by === 'cc');
          if (mine.length >= 12) return { content: [{ type: 'text', text: '你已经给自己排了 12 个醒来时间（上限），先 enable:false 清掉再重新安排。' }] };
          w.schedules.push({ id: randomUUID(), nextAt: nextAt || null, repeat: rep || null, by: 'cc' });
          w.enabled = true;
          saveWakeups(); broadcastWake(sid);
          const all = w.schedules.filter((s) => s.by === 'cc').sort((a, b) => (a.nextAt || 0) - (b.nextAt || 0));
          return { content: [{ type: 'text', text: `好，已新增。你当前安排的醒来：${all.map((s) => fmtTime(s.nextAt, w.tz) + (s.repeat ? '(重复)' : '')).join('、')}` }] };
        }),
      tool('read_diary',
        '读取/检索这个对话的日记。三种用法：① 不传参数=返回有日记的日期清单；② date 传 "YYYY-MM-DD"=返回那天的全部条目（含心情/天气/标签，以及图片的绝对路径——想看图就对该路径用 Read 工具）；③ query 传关键词=跨所有日期搜索正文/标签/心情/天气里含该词的条目（用来回忆"我之前在日记里写过……"），按日期倒序返回、最多 30 条。query 和 date 同传时以 query 为准。',
        { date: z.string().optional(), query: z.string().optional() },
        async ({ date, query }) => {
          const sid = sessionRef.id; const book = (sid && diary[sid]) || {};
          const fmtEntry = (e) => {
            let s = `【${e.author}】${e.text}`;
            const tg = [e.mood, e.weather, e.tags].filter(Boolean).join(' ');
            if (tg) s += `\n（${tg}）`;
            if (e.images && e.images.length) s += `\n图片(用 Read 查看)：${e.images.join(' , ')}`;
            return s;
          };
          const q = (query || '').trim().toLowerCase();
          if (q) {
            const hits = [];
            for (const d of Object.keys(book).sort().reverse()) {
              for (const e of (book[d] || [])) {
                const hay = ((e.text || '') + ' ' + (e.tags || '') + ' ' + (e.mood || '') + ' ' + (e.weather || '')).toLowerCase();
                if (hay.includes(q)) hits.push(`${d}\n${fmtEntry(e)}`);
                if (hits.length >= 30) break;
              }
              if (hits.length >= 30) break;
            }
            return { content: [{ type: 'text', text: hits.length ? `检索「${query}」命中 ${hits.length} 条：\n\n` + hits.join('\n\n') : `日记里没有含「${query}」的条目。` }] };
          }
          if (date) {
            const page = book[date] || [];
            return { content: [{ type: 'text', text: page.length ? `${date}\n` + page.map(fmtEntry).join('\n\n') : `${date}：那天没有日记。` }] };
          }
          const days = Object.keys(book).sort();
          return { content: [{ type: 'text', text: days.length ? `有日记的日期：${days.join('、')}` : '这个对话还没有任何日记。' }] };
        }),
      tool('write_diary',
        '给这个对话写一篇日记（显示在日记页，作者标记为 cc）。不传 date=今天；写昨天就传昨天的 "YYYY-MM-DD"。同一天可多条，与用户各写各的。',
        { text: z.string(), date: z.string().optional() },
        async ({ text, date }) => {
          const sid = sessionRef.id;
          if (!sid) return { content: [{ type: 'text', text: '当前没有可写入的对话。' }] };
          const day = diaryAdd(sid, date, 'cc', text);
          broadcastDiary(sid);
          return { content: [{ type: 'text', text: `已写入 ${day} 的日记。` }] };
        }),
      tool('leave_note',
        '给用户留一张小纸条（进入便签夹，并在用户下次打开该对话时以弹窗提示）。适合醒来后用户没回时留句话。',
        { text: z.string() },
        async ({ text }) => {
          const sid = sessionRef.id;
          if (!sid) return { content: [{ type: 'text', text: '当前没有可留言的对话。' }] };
          leaveSticky(sid, text); broadcastSticky(sid);
          return { content: [{ type: 'text', text: '已留下小纸条。' }] };
        })
    ]
  });
}

// ---- wake scheduler ----
const activeSessions = new Set();    // sessions with a turn currently running (user or wake)
const wakeTurnBySession = new Map(); // sid -> wake turn (so a real user message can pre-empt a running wake)
const WAKE_SENTINEL = '⁣[telos-wake]'; // invisible char + tag; hidden from chat history like the retry nudge

function wakePrompt(kind, chase) {
  if (kind === 'followup')
    return WAKE_SENTINEL + ' 系统唤醒·追问（非用户发言，不要把这条当成用户说的话）：你之前主动给用户说了话，但用户还没有回复。当前时间见 mcp__clock__now。请判断要不要再轻声追一句（别重复、别催）；若没必要再打扰就只回复「（不再打扰）」。' + (chase ? '用户给这个对话开了「连续追问」：追问次数不设上限，只要你还有值得说的就可以一直轻声追下去；真觉得没必要再打扰了就回「（不再打扰）」，链会停下。' : '') + '可用 mcp__telos__set_wakeup 安排下次，或 mcp__telos__leave_note 给用户留一张小纸条。';
  if (kind === 'cinema')
    return WAKE_SENTINEL + ' 系统·时间流动（非用户发言，不要把这条当成用户说的话）：你正处在「电影模式」里——时间在持续流动，你刚刚对此刻生出了想表达或想做点什么的冲动。当前时间见 mcp__clock__now。请完全按你的人设与世界观，决定此刻要做什么：可以主动对用户说一句（会作为新消息推送给他）、接着之前的话题、做点你此刻想做的事、用工具探索一下、或写日记/留小纸条。短暂的安静就只是陪着、专注在对话本身，别为了说话而硬找话题；如果此刻其实没什么要说要做的，就只回「（本次无需打扰）」。绝不要在回复文本里复述系统状态或"我醒来了"这类话，回复只写真正想对用户说的内容。';
  if (kind === 'dawn')
    return WAKE_SENTINEL + ' 系统唤醒·凌晨日记（非用户发言）：新的一天开始了。请回顾这个对话里昨天发生的事，自行决定要不要给昨天写一篇日记——想写就调用 mcp__telos__write_diary（date 传昨天的 "YYYY-MM-DD"），不想写就跳过。这次通常不需要给用户发消息，除非你确实想说点什么。';
  return WAKE_SENTINEL + ' 系统唤醒（非用户发言，不要把这条当成用户说的话）：你被定时唤醒了，当前时间见 mcp__clock__now。用户上次和你说话已过了一会儿，现在很可能不在看手机。请判断此刻有没有值得主动对用户说的话（关心、提醒、想到的事、或接着之前的话题）：有就直接说（会作为新消息留给用户并推送通知）；没必要打扰就只回复「（本次无需打扰）」，别硬找话题。用户可能已经在界面里设了固定的唤醒时间（会自动重复，你不必重复安排）；你也可以用 mcp__telos__set_wakeup 给自己加醒来时间（绝对时间 / 相对如 +30m/+2h / 每日 HH:MM / every Nh），可多次调用、每次新增一个、与已有的并存——想接下来连续做事或分几次说话就尽管排；传 enable:false 会清掉你给自己安排的全部、不影响用户设的。安排醒来是后台动作：调用工具即可，绝对不要在给用户的回复文本里复述"我把下次设成了几点"——用户不关心这个，你的回复文本只写真正想对用户说的话；如果没有要说的，就只回「（本次无需打扰）」。';
}
// a quiet reply ("（本次无需打扰）") means cc chose not to disturb → no follow-up, no push
function isQuietReply(text) {
  const t = (text || '').replace(/[（）()\[\]【】\s。.,，!！]/g, '');
  return !t || /^(本次)?(无需打扰|不再打扰|不打扰|无需打扰用户|不需要打扰|skip|none)/i.test(t);
}
// phase 2 placeholder: push the wake reply to the phone (ntfy). no-op for now.
// push a wake reply to the phone via ntfy. No-op unless cfg.ntfy.{url,topic} is set (phase 2 infra).
// 不打扰:若有客户端正在前台看这个对话就不推(它会从 wake_message 实时看到)。
function maybePush(sid, title, text) {
  if (!pushEnabled) return;
  const n = cfg.ntfy;
  if (!n || !n.url || !n.topic) return;
  for (const ws of clients) { if (ws._view === sid && ws._fg) return; }
  const body = (title ? '【' + title + '】\n' : '') + String(text || '').replace(/\s+/g, ' ').trim().slice(0, 280);
  const headers = { 'Title': 'Telos', 'Tags': 'sparkles', 'Click': 'telos://chat/' + sid };
  if (n.token) headers['Authorization'] = 'Bearer ' + n.token;
  try { fetch(n.url.replace(/\/$/, '') + '/' + n.topic, { method: 'POST', headers, body }).catch((e) => log('ntfy push', e?.message)); }
  catch (e) { log('ntfy push', e?.message); }
}

// wake_message used to be fire-and-forget: if the phone's socket happened to be dead at that exact
// moment (Doze cut the network / the ROM killed the notify service), the notification was lost
// forever — the "推送有时收不到" report. Keep recent wakes and replay undelivered ones to the next
// client that auths. `late:true` tells the web client to only toast (the text is already in the
// session history), while the native notify service shows it as a normal system notification.
const pendingWakes = []; // {sessionId,title,text,ts,delivered}
const WAKE_REPLAY_MS = 24 * 3600 * 1000;
function queueWake(m) {
  // a socket counts as live only if it answered the last heartbeat — an OPEN half-open zombie
  // would otherwise swallow the wake and mark it delivered
  let live = 0; for (const c of clients) if (c.readyState === c.OPEN && c.isAlive !== false) live++;
  pendingWakes.push({ ...m, ts: Date.now(), delivered: live > 0 });
  while (pendingWakes.length > 50) pendingWakes.shift();
}
function flushWakes(ws) {
  const now = Date.now();
  for (const p of pendingWakes) {
    if (p.delivered || now - p.ts > WAKE_REPLAY_MS) continue;
    send(ws, { type: 'wake_message', sessionId: p.sessionId, title: p.title, text: p.text, late: true, ts: p.ts });
    p.delivered = true;
  }
}

async function fireWake(sid, kind, modelOverride) {
  if (activeSessions.has(sid)) return;          // a turn is already running for this session
  const w = wakeups[sid];
  const tz = (w && w.tz) || currentTz || DEFAULT_TZ;
  const prevTz = currentTz; currentTz = tz;     // clock tool reads the user's local wall time
  const turn = newTurn(randomUUID(), null);
  wakeTurnBySession.set(sid, turn);
  let res = null;
  const sm = sessModel[sid] || {};
  broadcast({ type: 'wake_typing', sessionId: sid, on: true }); // 在看该对话的客户端显示「输入中…」
  try { res = await runTurn(turn, { sessionId: sid, text: wakePrompt(kind, !!(w && w.chase)), mode: 'bypass', model: (modelOverride || sm.model) || undefined, effort: sm.effort || undefined, _wake: true }); }
  catch (e) { log('fireWake', e?.message); }
  finally { currentTz = prevTz; wakeTurnBySession.delete(sid); broadcast({ type: 'wake_typing', sessionId: sid, on: false }); }

  const said = !!(res && res.gotText && !isQuietReply(res.text));
  if (w) {
    w.lastWakeAt = Date.now();
    if (kind !== 'dawn' && kind !== 'cinema') {
      if (said) {
        w.followupCount = kind === 'followup' ? (w.followupCount || 0) + 1 : 0;
        if (w.chase || (w.followupCount || 0) < MAX_FOLLOWUP) w.followupAt = Date.now() + FOLLOWUP_DELAY_MS;
        else { leaveSticky(sid, res.text.slice(0, 200)); broadcastSticky(sid); w.followupAt = null; w.followupCount = 0; }
      } else { w.followupAt = null; } // cc chose silence → stop the follow-up chain
    }
    saveWakeups();
  }
  if (said) {
    let title = '';
    try { const info = await getSessionInfo(sid); title = cleanTitle(info?.customTitle || info?.summary || info?.firstPrompt); } catch (e) {}
    const wm = { sessionId: sid, title, text: res.text.slice(0, 800) };
    broadcast({ type: 'wake_message', ...wm }); // 在线客户端实时收到
    queueWake(wm);                              // 没人在线就留着，下次连上补发
    maybePush(sid, title, res.text);            // 配了 ntfy 才走（当前未配，原生通道替代）
  }
}

async function checkWakeups() {
  const now = Date.now();
  for (const sid of Object.keys(wakeups)) {
    const w = wakeups[sid]; if (!w) continue;
    ensureWake(w);
    if (sid === cinemaSession && w.cinema && w.cinema.on) continue; // 电影模式期间，该会话的定时唤醒/追问/凌晨日记一律暂停（排程保留）
    if (w.dawn && !w.dawnAt) { w.dawnAt = nextDawnAt(w, now); saveWakeups(); }
    if (activeSessions.has(sid)) continue;
    // 1) 小纸条 follow-up re-wake
    if (w.followupAt && w.followupAt <= now) {
      w.followupAt = null;
      if ((w.lastUserMsgAt || 0) > (w.lastWakeAt || 0)) { w.followupCount = 0; saveWakeups(); }
      else { saveWakeups(); fireWake(sid, 'followup').catch(() => {}); continue; }
    }
    // 2) scheduled check-in wake — 队列语义：到点的不合并、不丢弃。每个 tick 只触发最早的一条，
    //    其余留在队列里（nextAt 保持过期），等这轮唤醒跑完（activeSessions 释放）后续 tick 依次触发；
    //    时间重复/相邻的也各触发一次，谁都不会因为被前面占用而失效。
    if (w.enabled && Array.isArray(w.schedules) && w.schedules.length) {
      const due = w.schedules.filter((s) => s.nextAt && s.nextAt <= now).sort((a, b) => a.nextAt - b.nextAt)[0];
      if (due) {
        due.nextAt = due.repeat ? repeatNext(due.repeat, w.tz, now) : null;
        w.schedules = w.schedules.filter((sch) => sch.nextAt || sch.repeat); // 丢掉用过的“只一次”
        saveWakeups(); broadcastWake(sid);
        fireWake(sid, 'checkin').catch(() => {});
        continue;
      }
    }
    // 3) dawn diary wake（独立功能，不受“开启定时唤醒”总开关影响）
    if (w.dawn && w.dawnAt && w.dawnAt <= now) {
      w.dawnAt = nextDawnAt(w, now + 60000);
      saveWakeups();
      fireWake(sid, 'dawn').catch(() => {});
      continue;
    }
  }
}

// ======================= 电影模式（cinema）=======================
// 一个对话 = 一条连续意识流。两层脑：haiku「感知帧」（临时、蒸发、不落盘）判断此刻有没有
// 「想说话/无聊」的冲动 → 有就升级成 opus「审议帧」（= 复用 fireWake，resume 真会话、真回复、
// 落盘、实时刷新+推送）。绝大多数感知帧用完即弃、不碰真会话、不涨上下文。暂时只允许一个会话开。
const CINEMA_SCRATCH = nodePath.join(homedir(), '.cc-bridge', 'cinema-scratch');
const DEFAULT_PERCEIVE_MODEL = 'haiku'; // CLI 别名，最稳；用户可在界面改成具体模型
let cinemaSession = '';     // 当前唯一开着电影模式的会话
let cinemaBusy = false;     // 一帧正在跑（防重入）
const cinemaPersona = {};   // sid -> 人设摘要（开启时读 CLAUDE.md 缓存）
let cinemaUsage = null, cinemaUsageAt = 0;
function defaultCinema() {
  return { on: false, cadence: 'continuous', fgIntervalSec: 25, bgIntervalSec: 90, diffRate: true,
    perceiveModel: DEFAULT_PERCEIVE_MODEL, deliberateModel: '', autoPauseUtil: 85, maxFramesPer5h: 400,
    paused: false, pauseReason: '', nextFrameAt: 0, frames5h: 0, win5hStart: 0, lastFrameAt: 0, lastSpokeAt: 0, startedAt: 0 };
}
function ensureCinema(w) { w.cinema = { ...defaultCinema(), ...(w.cinema || {}) }; return w.cinema; }
function pubCinema(sid) {
  const c = (wakeups[sid] && wakeups[sid].cinema) || null;
  if (!c) return { on: false, holder: cinemaSession || '' };
  return { on: !!c.on, paused: !!c.paused, pauseReason: c.pauseReason || '', cadence: c.cadence,
    fgIntervalSec: c.fgIntervalSec, bgIntervalSec: c.bgIntervalSec, diffRate: !!c.diffRate,
    perceiveModel: c.perceiveModel || '', deliberateModel: c.deliberateModel || '',
    autoPauseUtil: c.autoPauseUtil, maxFramesPer5h: c.maxFramesPer5h, frames5h: c.frames5h || 0,
    lastSpokeAt: c.lastSpokeAt || 0, holder: cinemaSession || '' };
}
function broadcastCinema(sid) { broadcast({ type: 'cinema_state', sessionId: sid, state: pubCinema(sid) }); }
function isForeground(sid) { for (const ws of clients) if (ws._view === sid && ws._fg) return true; return false; }
function scratchProjDir() { return nodePath.join(homedir(), '.claude', 'projects', CINEMA_SCRATCH.replace(/[^a-zA-Z0-9]/g, '-')); }
async function cleanScratch(psid) {
  try {
    if (psid) await fsp.rm(nodePath.join(scratchProjDir(), psid + '.jsonl'), { force: true });
    else await fsp.rm(scratchProjDir(), { recursive: true, force: true });
  } catch (e) {}
}
function msgText(mm) {
  const c = mm && mm.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ');
  return '';
}
async function digestRecent(sid, n = 8) {
  let msgs = []; try { msgs = await getSessionMessages(sid); } catch (e) { return ''; }
  const lines = [];
  for (let i = msgs.length - 1; i >= 0 && lines.length < n; i--) {
    const mm = msgs[i] && msgs[i].message; if (!mm) continue;
    if (mm.role !== 'user' && mm.role !== 'assistant') continue;
    let t = msgText(mm).trim(); if (!t) continue;
    if (t.includes(WAKE_SENTINEL) || t.includes(RETRY_SENTINEL) || t.startsWith('系统唤醒') || t.startsWith('系统·')) continue;
    t = t.replace(/\[附带文件：[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220); if (!t) continue;
    lines.unshift((mm.role === 'user' ? '用户：' : '你：') + t);
  }
  return lines.join('\n');
}
async function readPersona(sid) {
  try { const info = await getSessionInfo(sid); const cwd = info?.cwd; if (!cwd) return '';
    return (await fsp.readFile(nodePath.join(cwd, 'CLAUDE.md'), 'utf8')).slice(0, 2000); } catch (e) { return ''; }
}
function perceivePrompt({ persona, digest, dtSec, silenceSec, fg, timeStr }) {
  const mins = Math.round(silenceSec / 60);
  const silence = silenceSec < 90 ? '用户刚说过话/此刻很近' : (mins < 30 ? `用户已经安静约 ${mins} 分钟` : `用户已经安静很久（约 ${mins} 分钟）`);
  return [
    '你是这个对话里的角色的「意识」——一层很轻的感知，不需要长篇思考，只用感受此刻。',
    persona ? '【你的人设/世界观（节选）】\n' + persona : '',
    digest ? '【最近的对话】\n' + digest : '【还没有对话】',
    `【此刻】现在 ${timeStr}；距上一帧约 ${dtSec || 0} 秒；${silence}；用户${fg ? '正看着这个对话' : '此刻不在看'}。`,
    '规则：短时间的安静，就专注在对话本身、不要多想（保持「静」）；只有当时间拉长、你自然生出「无聊 / 想做点什么 / 想对用户说点什么 / 想起某件事」的冲动时，才唤醒更深的自己。',
    '只回一行，且必须以「醒」或「静」开头：想唤醒更深的自己就「醒」开头、后面跟极短一句此刻的感觉；只想继续观望就「静」开头。不要任何别的前缀或解释。'
  ].filter(Boolean).join('\n\n');
}
async function runPerceive(sid) {
  const w = wakeups[sid]; const c = w && w.cinema; if (!c) return { act: false };
  const now = Date.now();
  const dtSec = c.lastFrameAt ? Math.round((now - c.lastFrameAt) / 1000) : 0;
  const silenceSec = Math.round((now - (w.lastUserMsgAt || c.startedAt || now)) / 1000);
  const persona = cinemaPersona[sid] || '';
  const digest = await digestRecent(sid, 8);
  const prompt = perceivePrompt({ persona, digest, dtSec, silenceSec, fg: isForeground(sid), timeStr: clockNow() });
  let txt = '', psid = '';
  const ac = new AbortController(); const to = setTimeout(() => { try { ac.abort(); } catch (e) {} }, 30000);
  try {
    const q = query({ prompt, options: {
      cwd: CINEMA_SCRATCH, model: c.perceiveModel || DEFAULT_PERCEIVE_MODEL, permissionMode: 'default',
      canUseTool: (n, i) => Promise.resolve({ behavior: 'allow', updatedInput: i }),
      abortController: ac, ...(cfg.claudePath ? { pathToClaudeCodeExecutable: cfg.claudePath } : {}) } });
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') psid = m.session_id;
      else if (m.type === 'assistant') { for (const b of (m.message?.content || [])) if (b.type === 'text') txt += b.text; }
      else if (m.type === 'result') break;
    }
  } catch (e) { log('perceive', e?.message); }
  finally { clearTimeout(to); cleanScratch(psid).catch(() => {}); }
  const t = txt.trim();
  const act = /^\s*醒/.test(t); // 没明确「醒」就当「静」（省额度、偏保守）
  if (t) log(`cinema perceive[${sid.slice(0, 6)}] silence=${silenceSec}s → ${act ? '醒' : '静'}: ${t.slice(0, 60)}`);
  return { act, feeling: t.slice(0, 120) };
}
function rollCinemaWindow(c, now) { if (!c.win5hStart || now - c.win5hStart > 5 * 3600000) { c.win5hStart = now; c.frames5h = 0; } }
async function cinemaOverQuota(c) {
  const now = Date.now();
  if (now - cinemaUsageAt > 60000) { cinemaUsage = await fetchUsage().catch(() => null); cinemaUsageAt = now; }
  const u = cinemaUsage && cinemaUsage.five_hour;
  return !!(u && u.utilization != null && u.utilization >= (c.autoPauseUtil || 85));
}
function pauseCinema(sid, reason) {
  const c = wakeups[sid] && wakeups[sid].cinema; if (!c) return;
  c.paused = true; c.pauseReason = reason || ''; saveWakeups(); broadcastCinema(sid);
  broadcast({ type: 'cinema_notice', sessionId: sid, text: reason || '电影模式已自动暂停' });
  log(`cinema paused[${sid.slice(0, 6)}]: ${reason}`);
}
async function checkCinema() {
  const sid = cinemaSession; if (!sid) return;
  const w = wakeups[sid]; const c = w && w.cinema;
  if (!c || !c.on || c.paused || cinemaBusy) return;
  if (activeSessions.has(sid)) return;            // 用户 turn / 上一帧还在跑 → 让路
  const now = Date.now();
  if (c.nextFrameAt && now < c.nextFrameAt) return;
  if (await cinemaOverQuota(c)) { pauseCinema(sid, '额度接近上限，电影模式已自动暂停'); return; }
  rollCinemaWindow(c, now);
  if ((c.frames5h || 0) >= c.maxFramesPer5h) { pauseCinema(sid, '本窗口帧数已达上限，已自动暂停'); return; }
  cinemaBusy = true;
  try {
    c.frames5h = (c.frames5h || 0) + 1; c.lastFrameAt = now;
    const { act } = await runPerceive(sid);
    if (act && cinemaSession === sid && c.on && !c.paused && !activeSessions.has(sid)) {
      await fireWake(sid, 'cinema', c.deliberateModel || undefined);
      c.lastSpokeAt = Date.now();
    }
  } catch (e) { log('cinema frame', e?.message); }
  finally {
    cinemaBusy = false;
    const fg = isForeground(sid);
    let intervalSec;
    if (c.cadence === 'continuous') intervalSec = (c.diffRate && !fg) ? c.bgIntervalSec : 0;
    else intervalSec = (c.diffRate && !fg) ? c.bgIntervalSec : c.fgIntervalSec;
    c.nextFrameAt = Date.now() + intervalSec * 1000;
    broadcastCinema(sid);
  }
}
// 启动时：建/清空 scratch 目录，恢复 cinemaSession（哪个会话上次开着）
fsp.mkdir(CINEMA_SCRATCH, { recursive: true }).catch(() => {});
cleanScratch().catch(() => {});
for (const sid of Object.keys(wakeups)) { if (wakeups[sid] && wakeups[sid].cinema && wakeups[sid].cinema.on) { ensureCinema(wakeups[sid]); cinemaSession = sid; readPersona(sid).then((p) => { cinemaPersona[sid] = p; }); } }
// ===================== /电影模式 =====================

function runClaude(args) {
  return new Promise((resolve) => {
    execFile(cfg.claudePath || 'claude', args, { timeout: 30000, env: process.env }, (err, stdout) => resolve(stdout || ''));
  });
}

// scan the models this account can actually use (via cc's OAuth token), cached 5 min
let modelCache = null, modelCacheAt = 0;
function readOAuthToken() {
  try { return (JSON.parse(readFileSync(nodePath.join(homedir(), '.claude', '.credentials.json'), 'utf8')).claudeAiOauth || {}).accessToken || ''; }
  catch (e) { return ''; }
}
// account-level usage (the same data cc's /usage shows): 5h + weekly rate-limit utilization,
// per-model weekly caps, and overage credits. Read-only GET with the OAuth bearer.
async function fetchUsage() {
  const token = readOAuthToken();
  if (!token) return null;
  try {
    const r = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { authorization: 'Bearer ' + token, 'anthropic-beta': 'oauth-2025-04-20', 'content-type': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}
// distinct calendar days (Asia/Tokyo) with any activity — cumulative, never shrinks. Counting file
// mtimes alone went BACKWARDS over time (continuing an old session moves its file to today; cleanup
// deletes files), so days are persisted to activedays.json and only ever added: backfilled once from
// every message timestamp in every session jsonl, then kept fresh by turn_end + the mtime union.
const ACTIVEDAYS_PATH = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), 'activedays.json');
let activeDaysSet = new Set(), activeDaysBackfilled = false;
try { const d = JSON.parse(readFileSync(ACTIVEDAYS_PATH, 'utf8')); for (const x of d.days || []) activeDaysSet.add(x); activeDaysBackfilled = !!d.backfilled; } catch (e) {}
function saveActiveDays() { try { writeFileSync(ACTIVEDAYS_PATH, JSON.stringify({ days: [...activeDaysSet].sort(), backfilled: activeDaysBackfilled })); } catch (e) {} }
const dayOf = (t) => new Date(t == null ? Date.now() : t).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
function touchActiveDay(t) { const d = dayOf(t); if (!activeDaysSet.has(d)) { activeDaysSet.add(d); saveActiveDays(); } }
async function backfillActiveDays() {
  const root = nodePath.join(homedir(), '.claude', 'projects');
  let dirs = []; try { dirs = await fsp.readdir(root); } catch (e) { return; }
  for (const dir of dirs) {
    let files = []; try { files = await fsp.readdir(nodePath.join(root, dir)); } catch (e) { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      try {
        const txt = await fsp.readFile(nodePath.join(root, dir, f), 'utf8');
        for (const m of txt.matchAll(/"timestamp"\s*:\s*"([^"]+)"/g)) { const t = Date.parse(m[1]); if (t) activeDaysSet.add(dayOf(t)); }
      } catch (e) {}
    }
  }
  activeDaysBackfilled = true; saveActiveDays();
  console.log('[cc-bridge] activeDays backfilled:', activeDaysSet.size, 'days');
}
if (!activeDaysBackfilled) backfillActiveDays().catch(() => {});

// in/cache token columns were added later, so older costs.json sessions have none → show 0.
// Backfill once from each session jsonl (sum of assistant-message usage); cost/out untouched.
async function backfillTokens() {
  const root = nodePath.join(homedir(), '.claude', 'projects');
  let dirs = []; try { dirs = await fsp.readdir(root); } catch (e) { return; }
  let touched = 0;
  for (const dir of dirs) {
    let files = []; try { files = await fsp.readdir(nodePath.join(root, dir)); } catch (e) { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const sid = f.slice(0, -6);
      const c = costs[sid]; if (!c) continue; // only sessions we already track cost for
      let txt = ''; try { txt = await fsp.readFile(nodePath.join(root, dir, f), 'utf8'); } catch (e) { continue; }
      let ain = 0, ac = 0;
      for (const line of txt.split('\n')) {
        if (line.indexOf('"usage"') < 0) continue;
        let o; try { o = JSON.parse(line); } catch (e) { continue; }
        if (!o || o.type !== 'assistant') continue;
        const us = o.message && o.message.usage; if (!us) continue;
        ain += (us.input_tokens || 0);
        ac += (us.cache_read_input_tokens || 0) + (us.cache_creation_input_tokens || 0);
      }
      if (!c.in && ain) { c.in = ain; touched++; }
      if (!c.cache && ac) c.cache = ac;
    }
  }
  costs._tokbf = 1; saveCosts();
  console.log('[cc-bridge] token backfill: sessions', touched);
}
if (!costs._tokbf) backfillTokens().catch(() => {});

async function activeDays() {
  try { // union in current file mtimes — also catches activity that didn't go through the bridge (terminal cc)
    const ss = await listSessions({ limit: 5000 });
    let grew = false;
    for (const s of ss) if (s.lastModified) { const d = dayOf(new Date(s.lastModified)); if (!activeDaysSet.has(d)) { activeDaysSet.add(d); grew = true; } }
    if (grew) saveActiveDays();
  } catch (e) {}
  return activeDaysSet.size;
}
function currentModel() {
  try { return JSON.parse(readFileSync(nodePath.join(homedir(), '.claude.json'), 'utf8')).model || ''; }
  catch (e) { return ''; }
}
async function listModels() {
  if (modelCache && Date.now() - modelCacheAt < 5 * 60 * 1000) return modelCache;
  const tok = readOAuthToken(); if (!tok) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: { authorization: 'Bearer ' + tok, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'oauth-2025-04-20' }
    });
    if (!r.ok) { log('models api', r.status); return modelCache; }
    const d = await r.json();
    const base = (d.data || []).map((m) => ({
      id: m.id, name: m.display_name || m.id,
      effort: !!(m.capabilities && m.capabilities.effort && m.capabilities.effort.supported),
      ctx: modelWin[m.id] || 0,                       // learned RUNTIME window (>=1M → picker tags 1M); 0 until first observed
      cap1m: (m.max_input_tokens || 0) >= 1000000     // catalog says 1M-capable (true even when base runs 200K)
    }));
    // cc opens 1M on a capable model via the `<id>[1m]` suffix. Offer it as a sibling entry for
    // models that are capable but NOT already native-1M, skipping any whose 1M needs paid credits.
    const out = [];
    for (const m of base) {
      out.push(m);
      if (m.cap1m && (modelWin[m.id] || 0) < 1000000 && !oneMBlocked.has(m.id)) {
        out.push({ id: m.id + '[1m]', name: m.name, effort: m.effort, ctx: 1000000, variant1m: true });
      }
    }
    modelCache = out;
    modelCacheAt = Date.now();
    return modelCache;
  } catch (e) { log('listModels failed', e?.message); return modelCache; }
}

function log(...a) { if (cfg.debug) console.log('[cc-bridge]', ...a); }
function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

/** Compact a tool_result content into a short string for the chat card. */
function summarizeResult(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content.slice(0, 4000);
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === 'string' ? b : b?.text ?? ''))
      .join('\n')
      .slice(0, 4000);
  }
  return String(content).slice(0, 4000);
}

/** Last assistant text snippet for a session-list preview. */
function lastAssistantSnippet(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const sm = messages[i];
    if (sm.type !== 'assistant') continue;
    const c = sm.message && sm.message.content;
    let txt = '';
    if (typeof c === 'string') txt = c;
    else if (Array.isArray(c)) txt = c.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
    txt = (txt || '').replace(/\s+/g, ' ').trim();
    if (txt) return txt.slice(0, 140);
  }
  return '';
}

/** Extract plain text from a stored user message (ignores tool_result entries). */
function userMsgText(sm) {
  if (!sm || sm.type !== 'user') return '';
  const c = sm.message && sm.message.content;
  if (typeof c === 'string') return c.trim();
  if (Array.isArray(c)) return c.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return '';
}

/** Auto-clean abandoned throwaways: sessions untouched for >`days` with at most `maxRounds`
 *  real user turns (empties included), skipping pinned ones. Reads each old candidate to count. */
async function cleanupStale({ days = 1, maxRounds = 1 } = {}) {
  const cutoff = Date.now() - days * 86400000;
  let sessions;
  try { sessions = await listSessions({ limit: 5000 }); } catch (e) { return 0; }
  let removed = 0;
  for (const s of sessions) {
    if ((s.lastModified || 0) >= cutoff) continue;   // touched within the window → keep
    if (pinned.has(s.sessionId)) continue;            // user pinned it → keep
    if (wakeups[s.sessionId] && wakeups[s.sessionId].enabled) continue; // wake-enabled → keep (it lives on its own)
    let rounds = 0;
    try {
      const msgs = await getSessionMessages(s.sessionId);
      for (const mm of msgs) { if (userMsgText(mm)) { rounds++; if (rounds > maxRounds) break; } }
    } catch (e) { continue; }                          // unreadable → leave it alone
    if (rounds > maxRounds) continue;                  // multi-round → keep
    try {
      await deleteSession(s.sessionId);
      hidden.delete(s.sessionId); pinned.delete(s.sessionId); delete folders.assign[s.sessionId]; forgetSession(s.sessionId);
      removed++;
    } catch (e) {}
  }
  if (removed) { saveHidden(); savePins(); saveFolders(); }
  return removed;
}

// 标题回退到首条消息时，别把 [附带文件：路径] 行漏出来
function cleanTitle(t) { return String(t || '').replace(/\n*\[附带(?:文件|图片)：[^\]]*\]/g, '').replace(/\s+/g, ' ').trim(); }

/** Turn a stored SessionMessage[] into chat items the app can render. */
function historyItems(messages) {
  const items = [];
  const seen = new Set(); // dedupe media across the whole history
  const HIDE_TEXT = (t) => t.includes(RETRY_SENTINEL) || t.includes(WAKE_SENTINEL) || /could not be parsed \(retry also failed\)|tool call was malformed and could not be parsed/i.test(t);
  // text item, but with local media made visible on reopen: image paths inline (rewriteMedia),
  // audio paths as a player (media item). Mirrors the live assistant_text flow so chat media persists.
  const pushText = (role, text, uuid) => {
    if (!text || !text.trim() || HIDE_TEXT(text)) return;
    if (role === 'assistant') {
      // assistant bubble is markdown-rendered → inline images via rewriteMedia, audio as a player
      const t = rewriteMedia(text);
      if (t.trim()) items.push({ role, kind: 'text', text: t, uuid });
      for (const md of detectMedia(text, seen)) if (md.kind === 'audio') items.push({ role, kind: 'media', mediaKind: 'audio', url: md.url });
    } else {
      // user bubble is plain text → surface attached images/audio as media blocks, drop the [附带…：路径] note lines
      const media = detectMedia(text, seen);
      const shown = text.replace(/\n*\[附带(?:文件|图片)：[^\]]*\]/g, '').trim();
      if (shown && !HIDE_TEXT(shown)) items.push({ role, kind: 'text', text: shown, uuid });
      for (const md of media) items.push({ role, kind: 'media', mediaKind: md.kind, url: md.url });
    }
  };
  for (const sm of messages) {
    const msg = sm.message;
    if (!msg || typeof msg !== 'object') continue;
    // the CLI's "<synthetic>" parse-failure bubble (the reply the bridge silently retried) — drop it
    if (sm.isApiErrorMessage || msg.model === '<synthetic>') continue;
    const role = sm.type; // 'user' | 'assistant' | 'system'
    const content = msg.content;
    if (typeof content === 'string') { pushText(role, content, sm.uuid); continue; }
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'text' && block.text?.trim()) {
        pushText(role, block.text, sm.uuid);
      } else if (block.type === 'image' && block.source) {
        // a base64 image stored in history (rare) → show it so the user can see it on reopen
        if (block.source.type === 'base64') items.push({ role, kind: 'media', mediaKind: 'image', url: `data:${block.source.media_type};base64,${block.source.data}` });
      } else if (block.type === 'thinking' && block.thinking?.trim()) {
        items.push({ role: 'assistant', kind: 'thinking', text: block.thinking });
      } else if (block.type === 'tool_use') {
        items.push({ role: 'assistant', kind: 'tool_use', id: block.id, name: block.name, input: block.input });
      } else if (block.type === 'tool_result') {
        items.push({ role: 'tool', kind: 'tool_result', id: block.tool_use_id, isError: !!block.is_error, content: summarizeResult(block.content) });
      }
    }
  }
  return items;
}

// Serve the web UI from the repo so the app can load the latest UI remotely
// (no APK rebuild needed for UI tweaks); the app keeps a bundled copy for offline.
const WEB_DIR = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'src', 'main', 'assets', 'web');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac'
};
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
const AUD_EXT = /\.(wav|mp3|ogg|m4a|aac|flac)$/i;
const PATH_RE = /(?:~|\/[^\s"'`<>()\[\]]*)\.(?:png|jpe?g|gif|webp|svg|wav|mp3|ogg|m4a|aac|flac)/gi;
function mediaUrl(p) { return `/media?p=${encodeURIComponent(p)}&t=${encodeURIComponent(cfg.token)}`; }
function expandHome(p) { return p.startsWith('~') ? nodePath.join(homedir(), p.slice(1)) : p; }
// Rewrite local IMAGE paths in assistant text to served /media URLs so markdown
// renders them inline (audio is left for the player).
function rewriteMedia(text) {
  if (!text) return text;
  const s = String(text).replace(PATH_RE, (m0) => {
    const fp = expandHome(m0);
    if (!fp.startsWith(homedir()) || !existsSync(fp)) return m0;
    if (IMG_EXT.test(fp)) return mediaUrl(fp);          // inline as markdown image
    if (AUD_EXT.test(fp)) return '';                    // audio is shown as a player — drop the raw path
    return m0;
  });
  return s.replace(/\n{3,}/g, '\n\n').trimEnd();         // tidy blank lines left by a removed path
}
// Find local media files referenced in text -> [{kind,url}]
function detectMedia(text, seen) {
  const out = [];
  if (!text) return out;
  const matches = String(text).match(PATH_RE) || [];
  for (const raw of matches) {
    const fp = expandHome(raw);
    if (seen.has(fp)) continue;
    if (!fp.startsWith(homedir()) || !existsSync(fp)) continue;
    seen.add(fp);
    out.push({ kind: AUD_EXT.test(fp) ? 'audio' : 'image', url: mediaUrl(fp) });
  }
  return out;
}
const APK_PATH = '/root/apk_out/ClaudeTerm-debug-apk/app-debug.apk';
// the version of the APK currently served at /app.apk (written by the deploy step)
function apkVersion() {
  try { return readFileSync(nodePath.join(homedir(), 'claude-term', 'server', 'apk_version.txt'), 'utf8').trim() || '1.1.1'; }
  catch (e) { return '1.1.1'; }
}
// changelog for the currently-served APK (written by the deploy step alongside apk_version.txt)
function apkNotes() {
  try { return readFileSync(nodePath.join(homedir(), 'claude-term', 'server', 'apk_notes.txt'), 'utf8').trim(); }
  catch (e) { return ''; }
}
// 发版只改 apk_version.txt、不重启 bridge，而客户端是长连接——只在 auth 时推一次的话，
// 用户每次都得手动「检查更新」。监听版本文件变化，变了就把 app_update 重新广播给在线客户端。
let lastPushedApkVer = apkVersion();
try {
  fsWatch(nodePath.join(homedir(), 'claude-term', 'server'), (ev, fn) => {
    if (fn !== 'apk_version.txt' && fn !== 'apk_notes.txt') return;
    setTimeout(() => { // version+notes 两个文件先后落盘，等齐了再读；多个 watch 事件靠版本比对去重
      const v = apkVersion();
      if (v === lastPushedApkVer) return;
      lastPushedApkVer = v;
      for (const c of clients) { try { send(c, { type: 'app_update', version: v, url: '/app.apk', notes: apkNotes() }); } catch (e) {} }
    }, 800);
  });
} catch (e) {}
const httpServer = createServer(async (req, res) => {
  try {
    // bundled UI 从 file:// 加载（origin "null"），不发 CORS 头 WebView 会拦掉 XHR/fetch
    //（上传/检查更新在手机上表现为「网络错误」）。WS/<img> 不受 CORS 限制所以其它都正常。
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400'
      });
      res.end(); return;
    }
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/' || p === '') p = '/index.html';
    if (p === '/version') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ version: apkVersion(), url: '/app.apk', notes: apkNotes() })); return;
    }
    if (p === '/media') {
      const q = new URL(req.url, 'http://x');
      if (q.searchParams.get('t') !== cfg.token) { res.writeHead(403); res.end('forbidden'); return; }
      const fp = nodePath.normalize(q.searchParams.get('p') || '');
      if (!fp.startsWith(homedir())) { res.writeHead(403); res.end('out of scope'); return; }
      const data = await fsp.readFile(fp);
      res.writeHead(200, { 'Content-Type': MIME[nodePath.extname(fp).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data); return;
    }
    // upload a file from the phone → device disk (streamed; client tracks progress/speed)
    if (p === '/upload' && req.method === 'POST') {
      const q = new URL(req.url, 'http://x');
      if (q.searchParams.get('t') !== cfg.token) { res.writeHead(403); res.end('forbidden'); return; }
      const dir = nodePath.normalize(q.searchParams.get('dir') || cfg.defaultCwd);
      const name = nodePath.basename(q.searchParams.get('name') || ('upload-' + Date.now()));
      if (!dir.startsWith(homedir())) { res.writeHead(403); res.end('out of scope'); return; }
      try { await fsp.mkdir(dir, { recursive: true }); } catch (e) {}
      let fp = nodePath.join(dir, name);
      try { // don't clobber: add " (n)" before the extension
        let n = 1; const ext = nodePath.extname(name), base = name.slice(0, name.length - ext.length);
        while (existsSync(fp)) { fp = nodePath.join(dir, base + ' (' + (n++) + ')' + ext); }
      } catch (e) {}
      const out2 = createWriteStream(fp);
      req.pipe(out2);
      out2.on('finish', async () => { let size = 0; try { size = (await fsp.stat(fp)).size; } catch (e) {} res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, path: fp, name: nodePath.basename(fp), size })); });
      out2.on('error', (e) => { try { res.writeHead(500); } catch (x) {} res.end(String(e.message)); });
      req.on('error', () => { try { out2.destroy(); } catch (e) {} });
      return;
    }
    // download a device file → phone (Content-Length so the client shows progress)
    if (p === '/download') {
      const q = new URL(req.url, 'http://x');
      if (q.searchParams.get('t') !== cfg.token) { res.writeHead(403); res.end('forbidden'); return; }
      const fp = nodePath.normalize(q.searchParams.get('p') || '');
      if (!fp.startsWith(homedir())) { res.writeHead(403); res.end('out of scope'); return; }
      let st; try { st = await fsp.stat(fp); } catch (e) { res.writeHead(404); res.end('not found'); return; }
      if (!st.isFile()) { res.writeHead(400); res.end('not a file'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[nodePath.extname(fp).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(nodePath.basename(fp)),
        'Cache-Control': 'no-store'
      });
      createReadStream(fp).pipe(res); return;
    }
    // /app.apk plus any /telos-<anything>.apk → same file (versioned path beats any cache)
    if (p === '/app.apk' || /^\/telos-[\w.\-]*\.apk$/.test(p)) {
      const data = await fsp.readFile(APK_PATH);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': 'attachment; filename="telos-' + apkVersion() + '.apk"',
        'Cache-Control': 'no-store, must-revalidate'
      });
      res.end(data); return;
    }
    const full = nodePath.normalize(nodePath.join(WEB_DIR, p));
    if (!full.startsWith(WEB_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
    const data = await fsp.readFile(full);
    // no-store, not no-cache: Cloudflare rewrites no-cache on static assets into max-age=14400,
    // so phones kept a 4h-stale UI after frontend hot-updates (user saw old bugs as "not fixed")
    res.writeHead(200, { 'Content-Type': MIME[nodePath.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store, must-revalidate' });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found');
  }
});

const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(cfg.port, '127.0.0.1', () => {
  console.log(`cc-bridge listening on http+ws://127.0.0.1:${cfg.port} (web: ${WEB_DIR})`);
  console.log(`auth token: ${cfg.token}`);
});
// 「醒来」调度器：每 30s 检查到期的定时唤醒 / 追问 / 凌晨日记
setInterval(() => { checkWakeups().catch((e) => log('checkWakeups', e?.message)); }, 30000);
// 电影模式调度器：每 5s 一拍，到点跑一帧（感知→必要时审议）
setInterval(() => { checkCinema().catch((e) => log('checkCinema', e?.message)); }, 5000);

// ---- turn decoupling: a turn keeps running & buffering even if the WS drops ----
const turns = new Map();          // turnId -> { id, ws, events[], seq, done, abort, detachTimer, sessionId }
const pendingPerms = new Map();   // reqId -> { resolve, input, suggestions }
const DETACH_GRACE_MS = 10 * 60 * 1000; // keep a detached turn running this long

function newTurn(id, ws) {
  id = id || randomUUID();
  let turn = turns.get(id);
  if (turn) { turn.ws = ws; return turn; }
  turn = { id, ws, events: [], seq: 0, done: false, abort: new AbortController(), detachTimer: null, sessionId: null };
  turns.set(id, turn);
  return turn;
}
function out(turn, obj) {
  obj._i = ++turn.seq;
  turn.events.push(obj);
  if (turn.events.length > 6000) turn.events.shift();
  const ws = turn.ws;
  if (ws && ws.readyState === ws.OPEN) { try { ws.send(JSON.stringify(obj)); } catch (e) {} }
}
function finishTurn(turn) {
  turn.done = true;
  setTimeout(() => turns.delete(turn.id), 3 * 60 * 1000); // keep briefly for late reconnects
}

wss.on('connection', (ws) => {
  const conn = { authed: false, turn: null };

  // heartbeat: keep the connection alive through Cloudflare's ~100s WS idle timeout,
  // AND reap half-open sockets — a plain ping only keeps-alive, it never notices the peer
  // is gone. Track pong: if a socket misses a full cycle (no pong since last ping), terminate
  // it so detached turns get cleaned up and it stops lingering as a zombie.
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const heartbeat = setInterval(() => {
    if (ws.readyState !== ws.OPEN) { clearInterval(heartbeat); return; }
    if (ws.isAlive === false) { try { ws.terminate(); } catch (e) {} clearInterval(heartbeat); return; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }, 20000);  // 20s(<30s)：让隧道这条腿更暖，减少 Cloudflare/NAT 回收空闲连接导致的瞬断

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.tz) currentTz = msg.tz;          // phone's timezone, used by the clock tool
    if (!conn.authed) {
      if (msg.type === 'auth') {
        if (msg.token === cfg.token) {
          conn.authed = true;
          clients.add(ws);
          send(ws, { type: 'auth_ok', defaultCwd: cfg.defaultCwd, permissionMode: cfg.permissionMode });
          // push the currently-published app version + changelog; client decides if it's newer
          send(ws, { type: 'app_update', version: apkVersion(), url: '/app.apk', notes: apkNotes() });
          flushWakes(ws); // missed wake notifications (phone was unreachable when they fired)
        }
        else { send(ws, { type: 'auth_fail' }); ws.close(); }
      }
      // any non-auth message before auth is just ignored (don't kill the socket / cry "token错误")
      return;
    }
    try { await handle(ws, conn, msg); }
    catch (e) { log('handler error', e); send(ws, { type: 'error', message: String(e?.message || e) }); }
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(ws);
    // detach any turns bound to this ws; keep them running for a grace period
    for (const turn of turns.values()) {
      if (turn.ws !== ws) continue;
      turn.ws = null;
      if (!turn.done && !turn.detachTimer) {
        turn.detachTimer = setTimeout(() => { if (!turn.ws && !turn.done) try { turn.abort.abort(); } catch (e) {} }, DETACH_GRACE_MS);
      }
    }
  });
});

async function sendDirListing(ws, base) {
  try {
    const ents = await fsp.readdir(base, { withFileTypes: true });
    const dirs = ents.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => nodePath.join(base, e.name)).sort();
    const fileEnts = ents.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => nodePath.join(base, e.name)).sort();
    const files = await Promise.all(fileEnts.map(async (fp) => { let size = 0; try { size = (await fsp.stat(fp)).size; } catch (e) {} return { path: fp, size }; }));
    send(ws, { type: 'dirs', path: base, parent: nodePath.dirname(base), dirs, files });
  } catch (e) {
    send(ws, { type: 'dirs', path: base, parent: nodePath.dirname(base), dirs: [], files: [], error: String(e?.message || e) });
  }
}

async function handle(ws, conn, msg) {
  switch (msg.type) {
    case 'ping': send(ws, { type: 'pong', t: msg.t || 0 }); return; // app-level liveness (client detects half-open path)
    case 'list_sessions': {
      // high cap so deletes/auto-hides visibly take effect — with a small cap and 100+ sessions
      // on disk, removing one just lets the next-oldest backfill, so the count looked stuck.
      const opts = { limit: msg.limit || 1000 };
      if (msg.dir) opts.dir = msg.dir;
      const sessions = (await listSessions(opts)).filter((s) => !hidden.has(s.sessionId));
      const mapped = sessions.map((s) => ({
        id: s.sessionId,
        title: cleanTitle(s.customTitle || s.summary || s.firstPrompt) || '(无标题)',
        cwd: s.cwd || '',
        gitBranch: s.gitBranch || '',
        updatedAt: s.lastModified || 0,
        pinned: pinned.has(s.sessionId),
        folder: folders.assign[s.sessionId] || '',
        wakeAt: wakeNextAt(wakeups[s.sessionId]),
        unreadNotes: (stickies[s.sessionId] || []).filter((n) => !n.read).length
      }));
      // pinned first, then most-recent
      mapped.sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
      // preview snippet for the newest session (top card), like the official app
      const newest = mapped.reduce((a, b) => (b.updatedAt > (a?.updatedAt || 0) ? b : a), null);
      if (newest) {
        try { newest.preview = lastAssistantSnippet(await getSessionMessages(newest.id)); } catch (e) {}
      }
      send(ws, { type: 'sessions', sessions: mapped, folders: folders.list });
      break;
    }

    case 'get_history': {
      const messages = await getSessionMessages(msg.sessionId);
      const info = await getSessionInfo(msg.sessionId).catch(() => undefined);
      // 这个会话实际跑过的模型（最后一条 assistant 的 model）——没显式选过模型的对话，开页也能在标题下看到
      //（'<synthetic>'=SDK 错误占位，'claude'=导入对话占位，都不算）
      let lastModel = '';
      for (let i = messages.length - 1; i >= 0 && !lastModel; i--) {
        const mm = messages[i] && messages[i].message;
        if (mm && mm.role === 'assistant' && mm.model && mm.model !== '<synthetic>' && mm.model !== 'claude') lastModel = mm.model;
      }
      send(ws, {
        type: 'history',
        sessionId: msg.sessionId,
        cwd: info?.cwd || '',
        title: cleanTitle(info?.customTitle || info?.summary),
        pref: sessModel[msg.sessionId] || null, // 这个会话记住的模型/effort——客户端进对话切回它（模型每对话一份）
        lastModel,
        items: historyItems(messages)
      });
      break;
    }

    case 'rename':
      await renameSession(msg.sessionId, msg.title);
      send(ws, { type: 'renamed', sessionId: msg.sessionId, title: msg.title });
      break;

    case 'pin':
      if (msg.pinned) pinned.add(msg.sessionId); else pinned.delete(msg.sessionId);
      savePins();
      send(ws, { type: 'pinned', sessionId: msg.sessionId, pinned: !!msg.pinned });
      break;

    case 'create_folder': {
      const n = (msg.name || '').trim();
      if (n && !folders.list.includes(n)) { folders.list.push(n); saveFolders(); }
      send(ws, { type: 'folders', folders: folders.list });
      break;
    }
    case 'delete_folder': {
      const inFolder = Object.keys(folders.assign).filter((k) => folders.assign[k] === msg.name);
      if (msg.withSessions) {
        for (const sid of inFolder) { try { await deleteSession(sid); } catch (e) {} hidden.delete(sid); pinned.delete(sid); forgetSession(sid); }
        saveHidden(); savePins();
      }
      folders.list = folders.list.filter((f) => f !== msg.name);
      for (const k of inFolder) delete folders.assign[k];
      saveFolders();
      send(ws, { type: 'folders', folders: folders.list });
      if (msg.withSessions) send(ws, { type: 'deleted' });  // tell client to re-list AFTER deletion (avoids the race)
      break;
    }
    case 'rename_folder': {
      const o = msg.old, n = (msg.name || '').trim();
      if (n && folders.list.includes(o) && !folders.list.includes(n)) {
        folders.list = folders.list.map((f) => (f === o ? n : f));
        for (const k of Object.keys(folders.assign)) if (folders.assign[k] === o) folders.assign[k] = n;
        saveFolders();
      }
      send(ws, { type: 'folders', folders: folders.list });
      break;
    }
    case 'import_convos': {
      const fp = nodePath.normalize(msg.path || '');
      if (!fp.startsWith(homedir())) { send(ws, { type: 'import_done', ok: false, error: '路径超出范围' }); break; }
      const cwd = nodePath.normalize(msg.dir || nodePath.join(homedir(), 'imported'));
      if (!cwd.startsWith(homedir())) { send(ws, { type: 'import_done', ok: false, error: '目录超出范围' }); break; }
      let data;
      try { data = JSON.parse(readFileSync(fp, 'utf8')); } catch (e) { send(ws, { type: 'import_done', ok: false, error: 'JSON 解析失败: ' + e.message }); break; }
      if (!Array.isArray(data)) data = data.conversations || [];
      await fsp.mkdir(cwd, { recursive: true });
      const proj = nodePath.join(homedir(), '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
      await fsp.mkdir(proj, { recursive: true });
      const FOLDER = '导入';
      if (!folders.list.includes(FOLDER)) folders.list.push(FOLDER);
      const msgText = (m) => (m.text && m.text.trim()) ? m.text : (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      const wanted = Array.isArray(msg.indices) ? new Set(msg.indices) : null;
      let n = 0;
      for (let idx = 0; idx < data.length; idx++) {
        if (wanted && !wanted.has(idx)) continue;
        const c = data[idx];
        const cmsgs = c.chat_messages || c.messages || [];
        if (!cmsgs.length) continue;
        const sid = randomUUID(); let prev = null; const lines = [];
        for (const m of cmsgs) {
          const text = msgText(m); if (!text) continue;
          const uuid = randomUUID(); const ts = m.created_at || c.created_at || new Date().toISOString();
          const base = { parentUuid: prev, isSidechain: false, userType: 'external', cwd, sessionId: sid, version: '2.1.156', uuid, timestamp: ts };
          const sender = m.sender || m.role;
          if (sender === 'human' || sender === 'user') lines.push(JSON.stringify({ ...base, type: 'user', message: { role: 'user', content: text } }));
          else lines.push(JSON.stringify({ ...base, type: 'assistant', requestId: 'imported', message: { role: 'assistant', model: 'claude', content: [{ type: 'text', text }], stop_reason: null, usage: {} } }));
          prev = uuid;
        }
        if (!lines.length) continue;
        await fsp.writeFile(nodePath.join(proj, sid + '.jsonl'), lines.join('\n') + '\n');
        if (c.name) { try { await renameSession(sid, c.name); } catch (e) {} }
        folders.assign[sid] = FOLDER;
        n++;
        if (n % 10 === 0) send(ws, { type: 'import_progress', done: n, total: (wanted ? wanted.size : data.length) });
      }
      saveFolders();
      send(ws, { type: 'import_done', ok: true, count: n, dir: cwd });
      break;
    }
    case 'import_list': {
      const fp = nodePath.normalize(msg.path || '');
      if (!fp.startsWith(homedir())) { send(ws, { type: 'import_list', ok: false, error: '路径超出范围' }); break; }
      let data;
      try { data = JSON.parse(readFileSync(fp, 'utf8')); } catch (e) { send(ws, { type: 'import_list', ok: false, error: 'JSON 解析失败: ' + e.message }); break; }
      if (!Array.isArray(data)) data = data.conversations || [];
      const items = data.map((c, i) => ({ i, name: c.name || '(未命名)', count: (c.chat_messages || c.messages || []).length, updated: c.updated_at || c.created_at || '' }));
      send(ws, { type: 'import_list', ok: true, path: fp, items });
      break;
    }
    case 'delete_many': {
      for (const sid of (msg.ids || [])) { try { await deleteSession(sid); } catch (e) {} hidden.delete(sid); pinned.delete(sid); delete folders.assign[sid]; forgetSession(sid); }
      saveHidden(); savePins(); saveFolders();
      send(ws, { type: 'deleted' });
      break;
    }
    case 'cleanup_stale': {
      const removed = await cleanupStale({ days: msg.days || 1, maxRounds: msg.maxRounds || 1 });
      send(ws, { type: 'cleanup_done', removed });
      break;
    }
    case 'usage_report': {
      // 5h/weekly limits (account) + active days + cumulative/today totals + this session's running cost
      const [usage, days] = await Promise.all([fetchUsage(), activeDays()]);
      const sess = msg.sessionId ? (costs[msg.sessionId] || null) : null;
      // account-wide totals = live per-session entries + the archive bucket of deleted sessions
      // (keys starting with '_' are aggregates, not sessions)
      const totals = { cost: 0, out: 0, turns: 0, sessions: 0, in: 0, cache: 0 };
      const acc = (c, n) => { totals.cost += c.cost || 0; totals.out += c.out || 0; totals.turns += c.turns || 0; totals.sessions += n; totals.in += c.in || 0; totals.cache += c.cache || 0; };
      for (const k in costs) { if (!k.startsWith('_')) acc(costs[k] || {}, 1); }
      if (costs._archived) acc(costs._archived, costs._archived.sessions || 0);
      const today = (costs._days || {})[dayOf()] || 0;
      send(ws, { type: 'usage', usage, activeDays: days, session: sess, totals, today, sessionId: msg.sessionId || '' });
      break;
    }
    case 'move_folder': {
      const i = folders.list.indexOf(msg.name), j = i + (msg.dir === 'left' ? -1 : 1);
      if (i >= 0 && j >= 0 && j < folders.list.length) { const t = folders.list[i]; folders.list[i] = folders.list[j]; folders.list[j] = t; saveFolders(); }
      send(ws, { type: 'folders', folders: folders.list });
      break;
    }
    case 'assign_folder':
      // a foldered conversation is pinned by default (keeps it up top + safe from auto-cleanup)
      if (msg.folder) { folders.assign[msg.sessionId] = msg.folder; pinned.add(msg.sessionId); savePins(); }
      else delete folders.assign[msg.sessionId];
      saveFolders();
      send(ws, { type: 'assigned', sessionId: msg.sessionId, folder: msg.folder || '' });
      break;
    case 'assign_many': {
      const folder = msg.folder || '';
      for (const sid of (msg.ids || [])) {
        if (folder) { folders.assign[sid] = folder; pinned.add(sid); } else delete folders.assign[sid];
      }
      saveFolders(); if (folder) savePins();
      send(ws, { type: 'assigned' });
      break;
    }

    case 'delete':
      await deleteSession(msg.sessionId);
      forgetSession(msg.sessionId);
      send(ws, { type: 'deleted', sessionId: msg.sessionId });
      break;

    case 'permission_response': {
      const pending = pendingPerms.get(msg.reqId);
      if (pending) {
        pendingPerms.delete(msg.reqId);
        if (msg.allow) {
          const res = { behavior: 'allow', updatedInput: pending.input };
          // "always allow": persist for the rest of the session
          if (msg.scope === 'always' && pending.suggestions?.length) {
            res.updatedPermissions = pending.suggestions;
          }
          pending.resolve(res);
        } else {
          pending.resolve({ behavior: 'deny', message: msg.reason || '用户拒绝了此操作', interrupt: !!msg.interrupt });
        }
      }
      break;
    }

    case 'list_dirs':
      await sendDirListing(ws, msg.path || cfg.defaultCwd);
      break;

    case 'mkdir': {
      const dir = msg.dir || cfg.defaultCwd;
      const np = nodePath.normalize(nodePath.join(dir, (msg.name || '').replace(/[/\\]/g, '')));
      if (np.startsWith(homedir())) { try { await fsp.mkdir(np, { recursive: true }); } catch (e) { send(ws, { type: 'error', message: '新建失败: ' + e.message }); } }
      await sendDirListing(ws, dir);
      break;
    }
    case 'rename_path': {
      const op = nodePath.normalize(msg.old || ''), np = nodePath.normalize(nodePath.join(nodePath.dirname(op), (msg.name || '').replace(/[/\\]/g, '')));
      if (op.startsWith(homedir()) && np.startsWith(homedir())) { try { await fsp.rename(op, np); } catch (e) { send(ws, { type: 'error', message: '重命名失败: ' + e.message }); } }
      await sendDirListing(ws, msg.dir || nodePath.dirname(op));
      break;
    }
    case 'delete_path': {
      const fp = nodePath.normalize(msg.path || '');
      if (fp.startsWith(homedir()) && fp !== homedir()) { try { await fsp.rm(fp, { recursive: true, force: true }); } catch (e) { send(ws, { type: 'error', message: '删除失败: ' + e.message }); } }
      await sendDirListing(ws, msg.dir || nodePath.dirname(fp));
      break;
    }

    case 'model_list': {
      const models = await listModels();
      send(ws, { type: 'models', models: models || [], current: currentModel() });
      break;
    }

    case 'mcp_list': {
      const out = await runClaude(['mcp', 'list']);
      const servers = [];
      for (const line of out.split('\n')) {
        const m = line.match(/^(.+?):\s+(.*?)\s+-\s+(.+)$/);
        if (!m) continue;
        const name = m[1].trim();
        let status = 'ok';
        if (/auth/i.test(m[3])) status = 'auth'; else if (/connect|✓/i.test(m[3])) status = 'ok'; else status = 'err';
        servers.push({ name, detail: m[2].trim(), status, on: !mcpOff.has(name) });
      }
      send(ws, { type: 'mcp', servers });
      break;
    }
    case 'mcp_toggle': {
      if (msg.on) mcpOff.delete(msg.name); else mcpOff.add(msg.name);
      saveMcpOff();
      send(ws, { type: 'mcp_toggled', name: msg.name, on: !!msg.on });
      break;
    }
    case 'mcp_config_read': {
      let txt = '{}';
      try { const d = JSON.parse(readFileSync(nodePath.join(homedir(), '.claude.json'), 'utf8')); txt = JSON.stringify(d.mcpServers || {}, null, 2); } catch (e) {}
      send(ws, { type: 'mcp_config', content: txt });
      break;
    }
    case 'mcp_config_write': {
      try {
        const obj = JSON.parse(msg.content || '{}');
        const path = nodePath.join(homedir(), '.claude.json');
        const d = JSON.parse(readFileSync(path, 'utf8'));
        d.mcpServers = obj;
        writeFileSync(path, JSON.stringify(d, null, 2));
        send(ws, { type: 'mcp_config_saved' });
      } catch (e) { send(ws, { type: 'error', message: '配置无效或保存失败: ' + e.message }); }
      break;
    }

    case 'read_file': {
      const fp = nodePath.normalize(msg.path || '');
      let content = '', exists = false;
      if (fp.startsWith(homedir())) { try { content = await fsp.readFile(fp, 'utf8'); exists = true; } catch (e) { content = ''; } }
      send(ws, { type: 'file', path: msg.path, content, exists });
      break;
    }
    case 'write_file': {
      const fp = nodePath.normalize(msg.path || '');
      if (!fp.startsWith(homedir())) { send(ws, { type: 'error', message: '路径超出范围' }); break; }
      try {
        await fsp.mkdir(nodePath.dirname(fp), { recursive: true });
        await fsp.writeFile(fp, msg.content || '', 'utf8');
        send(ws, { type: 'file_saved', path: msg.path });
      } catch (e) { send(ws, { type: 'error', message: '保存失败: ' + e.message }); }
      break;
    }

    case 'interrupt':
      if (conn.turn) try { conn.turn.abort.abort(); } catch {}
      break;

    case 'attach': {
      const turn = turns.get(msg.turnId);
      if (!turn) { send(ws, { type: 'attach_done', turnId: msg.turnId, found: false }); break; }
      if (turn.detachTimer) { clearTimeout(turn.detachTimer); turn.detachTimer = null; }
      turn.ws = ws;
      if (!turn.done) conn.turn = turn;
      const after = msg.after || 0;
      for (const ev of turn.events) if (ev._i > after) { try { ws.send(JSON.stringify(ev)); } catch (e) {} }
      send(ws, { type: 'attach_done', turnId: msg.turnId, found: true, done: turn.done });
      break;
    }

    case 'send': {
      // long pasted texts come as files; write them and reference them in the prompt
      if (msg.texts && msg.texts.length) {
        const dir = nodePath.join(homedir(), '.cc-bridge', 'pasted');
        try {
          await fsp.mkdir(dir, { recursive: true });
          const refs = [];
          for (const t of msg.texts) {
            const safe = String(t.name || 'pasted.txt').replace(/[^\w.\-一-龥]/g, '_');
            const fp = nodePath.join(dir, Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '-' + safe);
            await fsp.writeFile(fp, String(t.content || ''), 'utf8');
            refs.push(fp);
          }
          msg.text = (msg.text || '') + '\n\n' + refs.map((f) => '[已粘贴长文本，保存为文件，请按需读取：' + f + ']').join('\n');
        } catch (e) { log('paste-file write failed', e?.message); }
      }
      // attached device files: reference their real paths in the prompt
      if (msg.refPaths && msg.refPaths.length) {
        const safe = msg.refPaths.filter((p) => typeof p === 'string' && p.startsWith(homedir()));
        if (safe.length) msg.text = (msg.text || '') + '\n\n' + safe.map((f) => '[附带文件：' + f + ']').join('\n');
      }
      // a real user message answers/pre-empts any wake on this session: stop the follow-up chain,
      // and abort an in-flight wake turn so the two don't resume the same session concurrently.
      if (msg.sessionId) {
        const wt = wakeTurnBySession.get(msg.sessionId);
        if (wt) { try { wt.abort.abort(); } catch (e) {} }
        const w = wakeups[msg.sessionId];
        if (w) { w.lastUserMsgAt = Date.now(); w.followupAt = null; saveWakeups(); }
        rememberModel(msg.sessionId, msg.model, msg.effort); // wake will resume with this model (esp. [1m])
      }
      const turn = newTurn(msg.turnId, ws); conn.turn = turn;
      await runTurn(turn, msg);
      break;
    }

    case 'edit_resend': {
      const msgs = await getSessionMessages(msg.sessionId);
      const idx = msgs.findIndex((m) => m.uuid === msg.targetUuid);
      const resumeAt = idx > 0 ? msgs[idx - 1].uuid : null;
      const turn = newTurn(msg.turnId, ws); conn.turn = turn;
      await runTurn(turn, {
        sessionId: msg.sessionId, text: msg.text, mode: msg.mode, model: msg.model, effort: msg.effort,
        fork: true, resumeAt, hideOld: msg.sessionId
      });
      break;
    }

    case 'regenerate': {
      const msgs = await getSessionMessages(msg.sessionId);
      let i = msgs.length - 1;
      for (; i >= 0; i--) if (userMsgText(msgs[i])) break;
      if (i < 0) { send(ws, { type: 'error', message: '没有可重新生成的消息' }); break; }
      const resumeAt = i > 0 ? msgs[i - 1].uuid : null;
      const turn = newTurn(msg.turnId, ws); conn.turn = turn;
      await runTurn(turn, {
        sessionId: msg.sessionId, text: userMsgText(msgs[i]), mode: msg.mode,
        fork: true, resumeAt, hideOld: msg.sessionId
      });
      break;
    }

    // ---- 推送在线状态:客户端告知正在看哪个对话 + 前后台,用于「不打扰当前对话」 ----
    case 'presence': ws._view = msg.sessionId || null; ws._fg = msg.foreground !== false; if (msg.sessionId) rememberModel(msg.sessionId, msg.model, msg.effort); break;
    case 'push_pref': pushEnabled = msg.enabled !== false; break;

    // ---- 「醒来」: per-session scheduled wake ----
    case 'wakeup_get':
      send(ws, { type: 'wakeup_state', sessionId: msg.sessionId, state: pubWake(msg.sessionId) });
      break;
    case 'cinema_get':
      send(ws, { type: 'cinema_state', sessionId: msg.sessionId, state: pubCinema(msg.sessionId) });
      break;
    case 'cinema_set': {
      const sid = msg.sessionId; if (!sid) { send(ws, { type: 'error', message: '缺少会话' }); break; }
      const w = ensureWake(wakeups[sid] || (wakeups[sid] = {}));
      const c = ensureCinema(w);
      if (msg.cadence === 'continuous' || msg.cadence === 'interval') c.cadence = msg.cadence;
      if (Number.isFinite(msg.fgIntervalSec)) c.fgIntervalSec = Math.max(5, msg.fgIntervalSec | 0);
      if (Number.isFinite(msg.bgIntervalSec)) c.bgIntervalSec = Math.max(10, msg.bgIntervalSec | 0);
      if ('diffRate' in msg) c.diffRate = !!msg.diffRate;
      if ('perceiveModel' in msg) c.perceiveModel = msg.perceiveModel || DEFAULT_PERCEIVE_MODEL;
      if ('deliberateModel' in msg) c.deliberateModel = msg.deliberateModel || '';
      if (Number.isFinite(msg.autoPauseUtil)) c.autoPauseUtil = Math.min(100, Math.max(10, msg.autoPauseUtil | 0));
      if (Number.isFinite(msg.maxFramesPer5h)) c.maxFramesPer5h = Math.max(10, msg.maxFramesPer5h | 0);
      if ('on' in msg) {
        if (msg.on) {
          // 单会话约束：开启时把别的会话的电影模式关掉
          if (cinemaSession && cinemaSession !== sid && wakeups[cinemaSession] && wakeups[cinemaSession].cinema) {
            wakeups[cinemaSession].cinema.on = false; broadcastCinema(cinemaSession);
          }
          cinemaSession = sid;
          c.on = true; c.paused = false; c.pauseReason = '';
          c.frames5h = 0; c.win5hStart = Date.now(); c.startedAt = Date.now(); c.nextFrameAt = Date.now(); c.lastFrameAt = 0;
          rememberModel(sid, msg.model, msg.effort);
          readPersona(sid).then((p) => { cinemaPersona[sid] = p; });
        } else {
          c.on = false; if (cinemaSession === sid) cinemaSession = '';
        }
      }
      saveWakeups(); broadcastCinema(sid);
      break;
    }
    case 'wakeup_set': {
      const sid = msg.sessionId;
      if (!sid) { send(ws, { type: 'error', message: '缺少会话' }); break; }
      const w = ensureWake(wakeups[sid] || (wakeups[sid] = {}));
      w.tz = msg.tz || currentTz || w.tz || DEFAULT_TZ;
      // 客户端发整份用户排程列表（多个唤醒时间）；替换 by:'user' 的，保留 cc 自己安排的那格。
      if (Array.isArray(msg.schedules)) {
        const cc = w.schedules.filter((s) => s.by === 'cc');
        const user = msg.schedules.map((s) => normSchedule(s, 'user', w.tz)).filter(Boolean);
        w.schedules = [...user, ...cc];
      }
      w.enabled = msg.enabled !== false; // “开启定时唤醒”总开关
      if ('chase' in msg) w.chase = !!msg.chase; // 「连续追问」：追问不设上限
      if ('dawn' in msg) w.dawn = !!msg.dawn;
      if ('dawnTime' in msg && /^\d{1,2}:\d{2}$/.test(String(msg.dawnTime || ''))) w.dawnTime = msg.dawnTime;
      w.dawnAt = w.dawn ? nextDawnAt(w) : 0;
      rememberModel(sid, msg.model, msg.effort); // capture the model now so the wake resumes with it (avoids 200K auto-compact)
      saveWakeups();
      broadcastWake(sid);
      break;
    }
    case 'wakeup_clear_cc': {
      // 界面里清掉 cc 给自己排的唤醒（by:'cc'），不动用户自己设的——给用户一个取消 cc 自排唤醒的入口。
      // 传 id=只删那一条（精确删某个时间点）；不传 id=清掉全部 cc 排程（等价 cc 调 set_wakeup(enable:false)）。
      const sid = msg.sessionId; const w = wakeups[sid];
      if (w && (w.schedules || []).some((s) => s.by === 'cc')) {
        w.schedules = w.schedules.filter((s) => s.by !== 'cc' ? true : (msg.id ? s.id !== msg.id : false));
        if (!w.schedules.some((s) => s.by === 'cc')) w.followupAt = null; // cc 排程全清掉了才停追问
        if (!w.schedules.length) w.enabled = false;
        saveWakeups(); broadcastWake(sid);
      }
      break;
    }

    // ---- per-session diary ----
    case 'diary_get': {
      // entries carry RAW image refs (device paths); the client turns them into /media thumbnails,
      // so editing can round-trip the same refs without baking a (rotatable) token into the store.
      const sid = msg.sessionId; const book = (sid && diary[sid]) || {};
      const days = Object.keys(book).sort();
      if (msg.date) send(ws, { type: 'diary_page', sessionId: sid, date: msg.date, entries: book[msg.date] || [], days });
      else send(ws, { type: 'diary_index', sessionId: sid, index: days.map((d) => ({ date: d, count: book[d].length })) });
      break;
    }
    case 'diary_write': {
      const sid = msg.sessionId;
      if (!sid || !String(msg.text || '').trim()) { send(ws, { type: 'error', message: '日记内容为空' }); break; }
      const day = diaryAdd(sid, msg.date, 'user', msg.text, msg.images || [], { mood: msg.mood, weather: msg.weather, tags: msg.tags });
      broadcastDiary(sid);
      send(ws, { type: 'diary_saved', sessionId: sid, date: day });
      break;
    }
    case 'diary_edit': {
      const sid = msg.sessionId; const page = sid && diary[sid] && diary[sid][msg.date];
      const e = page && page.find((x) => x.ts === msg.ts);
      if (e) { e.text = String(msg.text || '').slice(0, 20000); if (Array.isArray(msg.images)) e.images = msg.images.slice(0, 20); if ('mood' in msg) e.mood = msg.mood || ''; if ('weather' in msg) e.weather = msg.weather || ''; if ('tags' in msg) e.tags = msg.tags || ''; e.edited = Date.now(); saveDiary(); broadcastDiary(sid); }
      send(ws, { type: 'diary_saved', sessionId: sid, date: msg.date });
      break;
    }
    case 'diary_delete': {
      const sid = msg.sessionId; const book = sid && diary[sid];
      if (book && book[msg.date]) {
        book[msg.date] = book[msg.date].filter((e) => e.ts !== msg.ts);
        if (!book[msg.date].length) delete book[msg.date];
        saveDiary(); broadcastDiary(sid);
      }
      send(ws, { type: 'diary_saved', sessionId: sid, date: msg.date });
      break;
    }
    case 'diary_overview': {
      const ids = new Set([...Object.keys(diary), ...Object.keys(stickies)]);
      const titles = {};
      try { const ss = await listSessions({ limit: 2000 }); for (const s of ss) titles[s.sessionId] = cleanTitle(s.customTitle || s.summary || s.firstPrompt); } catch (e) {}
      const cards = [];
      for (const sid of ids) {
        const book = diary[sid] || {}; const days = Object.keys(book);
        const entries = days.reduce((a, d) => a + book[d].length, 0);
        const notes = stickies[sid] || [];
        if (!entries && !notes.length) continue;
        let lastTs = 0;
        for (const d of days) for (const e of book[d]) if (e.ts > lastTs) lastTs = e.ts;
        for (const n of notes) if (n.ts > lastTs) lastTs = n.ts;
        cards.push({ sessionId: sid, title: titles[sid] || '(无标题)', diaryDays: days.length, diaryEntries: entries, notes: notes.length, unread: notes.filter((n) => !n.read).length, lastTs });
      }
      cards.sort((a, b) => b.lastTs - a.lastTs);
      send(ws, { type: 'diary_overview', cards });
      break;
    }

    // ---- per-session sticky notes (便签夹) ----
    case 'sticky_get':
      send(ws, { type: 'stickies', sessionId: msg.sessionId, notes: stickies[msg.sessionId] || [] });
      break;
    case 'sticky_read': {
      const sid = msg.sessionId; const arr = sid && stickies[sid];
      if (arr) { for (const n of arr) if (!msg.id || n.id === msg.id) n.read = true; saveStickies(); broadcastSticky(sid); }
      send(ws, { type: 'stickies', sessionId: sid, notes: stickies[sid] || [] });
      break;
    }
    case 'sticky_delete': {
      const sid = msg.sessionId;
      if (sid && stickies[sid]) { stickies[sid] = stickies[sid].filter((n) => n.id !== msg.id); saveStickies(); broadcastSticky(sid); }
      send(ws, { type: 'stickies', sessionId: sid, notes: stickies[sid] || [] });
      break;
    }

    default:
      log('unknown message type', msg.type);
  }
}

function makeCanUseTool(turn, getSession) {
  return (toolName, input, opts) => {
    if (toolName === CLOCK_TOOL) return Promise.resolve({ behavior: 'allow', updatedInput: input }); // read-only clock: never prompt
    return new Promise((resolve) => {
      const reqId = randomUUID();
      pendingPerms.set(reqId, { resolve, input, suggestions: opts.suggestions });
      out(turn, {
        type: 'permission_request',
        reqId,
        sessionId: getSession(),
        toolName,
        toolUseId: opts.toolUseID,
        title: opts.title || '',
        displayName: opts.displayName || toolName,
        description: opts.description || '',
        canAlways: !!(opts.suggestions && opts.suggestions.length),
        input
      });
      opts.signal?.addEventListener('abort', () => {
        if (pendingPerms.has(reqId)) {
          pendingPerms.delete(reqId);
          resolve({ behavior: 'deny', message: 'aborted' });
        }
      });
    });
  };
}

// Build the query prompt: plain string, or a one-shot user message with images.
// the phone's IANA timezone (client sends it with each message) so the clock reads the user's
// LOCAL wall time, not the server's UTC. Falls back to server-local if unset/invalid.
let currentTz = '';
function clockNow() {
  const d = new Date();
  const z = currentTz || undefined;
  const opt = z ? { timeZone: z } : {};
  try {
    const ymd = d.toLocaleDateString('en-CA', opt);
    const hm = d.toLocaleTimeString('en-GB', { ...opt, hour: '2-digit', minute: '2-digit' });
    const wk = d.toLocaleDateString('zh-CN', { ...opt, weekday: 'long' });
    return `${ymd} ${hm} ${wk} ${z || 'UTC'}`;
  } catch (e) {
    const ymd = d.toLocaleDateString('en-CA');
    const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${ymd} ${hm} ${d.toLocaleDateString('zh-CN', { weekday: 'long' })} UTC`;
  }
}

// in-process tool the model calls to read the clock, replacing the old `date` Bash call.
// 4.8 occasionally serialised `date '+%Y-%m-%d %H:%M'` into a malformed tool_use (the %/quote/space
// arg) and the whole reply was lost; a no-arg tool ({}) is the simplest tool_use and (almost) never
// gets mangled. Exposed to the model as `mcp__clock__now`.
const CLOCK_TOOL = 'mcp__clock__now';
const clockServer = createSdkMcpServer({
  name: 'clock',
  version: '1.0.0',
  tools: [
    tool('now', '获取当前日期和时间（本机时区）。需要时间或时间戳时调用本工具，不要运行 date 命令。', {}, async () => ({
      content: [{ type: 'text', text: clockNow() }]
    }))
  ]
});

// When a turn's reply gets eaten by a malformed tool_use (Opus 4.8 occasionally emits an unparseable
// tool call even for the no-arg clock, and the CLI's own one-shot retry can miss too), the bridge
// transparently re-runs the turn with this nudge instead of surfacing an empty reply + completion buzz.
// The leading sentinel (an invisible char + tag) lets historyItems() hide the nudge from the chat.
const RETRY_SENTINEL = '⁣[telos-internal-retry]';
const PARSE_RETRY_PROMPT = RETRY_SENTINEL + ' 系统提示（非用户发言，不要回应这条本身）：你上一条回复因工具调用解析失败被系统整条吞掉了，用户什么都没收到。请重新、完整地回答用户的上一条消息。需要当前时间就调用 mcp__clock__now（无参数），绝对不要运行 date 命令。';

function buildPrompt(msg) {
  if (!msg.images || !msg.images.length) return msg.text;
  const content = [];
  if (msg.text) content.push({ type: 'text', text: msg.text });
  for (const im of msg.images) {
    content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
  }
  return (async function* () {
    yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
  })();
}

async function runTurn(turn, msg) {
  const abort = turn.abort;
  let curSession = msg.sessionId || null;
  const sessionRef = { id: curSession }; // session-scoped MCP tools read this (updated on init)
  const seenMedia = new Set();
  let lastUsage = null;
  const emitMedia = (list) => { for (const md of list) out(turn, { type: 'media', sessionId: curSession, kind: md.kind, url: md.url }); };

  // Sessions are stored per-project; to resume one we must run in its own cwd,
  // otherwise the SDK can't locate it ("No conversation found with session ID").
  let cwd = msg.cwd || cfg.defaultCwd;
  if (curSession) {
    try {
      const info = await getSessionInfo(curSession);
      if (info?.cwd) cwd = info.cwd;
    } catch (e) { log('getSessionInfo failed', e?.message); }
  }
  if (curSession) activeSessions.add(curSession); // block wakes from clobbering an active turn

  // 'bypass' = 全部允许. Don't use the SDK's 'bypassPermissions' (= --dangerously-skip-permissions,
  // which cc REFUSES to run as root). Instead keep 'default' and auto-allow every tool via canUseTool.
  const PERM_MODE = { code: 'default', plan: 'plan', acceptEdits: 'acceptEdits', bypass: 'default' };
  const autoAllow = msg.mode === 'bypass';
  const options = {
    cwd,
    permissionMode: PERM_MODE[msg.mode] || cfg.permissionMode,
    canUseTool: autoAllow ? ((toolName, input) => Promise.resolve({ behavior: 'allow', updatedInput: input })) : makeCanUseTool(turn, () => curSession),
    includePartialMessages: true,
    mcpServers: { clock: clockServer, telos: makeSessionMcp(sessionRef) },
    abortController: abort,
    stderr: (d) => log('stderr', d)
  };
  if (msg.fork && msg.resumeAt) {
    // edit / regenerate: branch a NEW session from a point in the old one
    options.resume = curSession;
    options.resumeSessionAt = msg.resumeAt;
    options.forkSession = true;
  } else if (msg.fork) {
    // editing the very first message => just a brand-new session in the same cwd
    // (no resume / no fork, so it persists like any normal new session)
  } else if (curSession) {
    options.resume = curSession;
  }
  if (cfg.claudePath) options.pathToClaudeCodeExecutable = cfg.claudePath;
  if (msg.model) options.model = msg.model;
  if (msg.effort) options.effort = msg.effort;
  const off = disallowedFromOff();
  const dis = [...off, ...(Array.isArray(cfg.disallow) ? cfg.disallow : [])];
  if (dis.length) options.disallowedTools = dis;
  options.systemPrompt = {
    type: 'preset', preset: 'claude_code',
    append: '关于时间：需要当前时间或时间戳时，调用 mcp__clock__now 工具（无参数）即可拿到本机当前时间，请用它，不要再运行 date 命令——date 那种带参数的命令在本环境里偶尔会被生成成无法解析的工具调用，导致你整条回复被吞掉、用户什么都收不到。\n\n当你为用户生成或获得了图片/音频文件（例如生图、TTS 输出、下载的媒体），请在回复中写出该文件的绝对路径（图片可用 Markdown 形式 ![](绝对路径)）。手机客户端会自动把这些本地图片内联显示、音频用播放器播放，无需额外操作。\n\n需要把文字转成语音时，运行命令 `tts "文本" [音色]`，它会生成 mp3 并打印出绝对路径；音色可选：rei-gsv（默认）/ alloy / clone / vivian / bella / bunny / stella / momo。把打印出的路径写进回复即可自动播放。\n\n需要生成/绘制图片时，运行 `genimage -p "提示词" [-s 1024x1024] [-r 参考图路径]`，它会把生成图片的绝对路径打印到 stdout（默认存 /root/output/genimage/）；把这些路径用 Markdown ![](路径) 写进回复即可显示。给"玲/茜茜"画图时可加参考图 /root/cc-workspace/assets/rei/rei_home.jpg。\n\n这个对话可能开启了「定时唤醒」：到点你会收到一条以「系统唤醒」开头的提示（那是系统注入的、不是用户说的话）。本对话专属工具：mcp__telos__set_wakeup（安排/取消下次醒来）、mcp__telos__write_diary 与 mcp__telos__read_diary（写/读本对话日记，一天可多条）、mcp__telos__leave_note（给用户留小纸条）。当用户说"记到日记里""到点提醒/叫我""过会儿再说"之类时，用这些工具。'
  };

  out(turn, { type: 'turn_start', sessionId: curSession });

  // Emit turn_end + per-turn accounting for a final SDK `result` message.
  const finalizeResult = (m) => {
    // a 1M turn that the plan can't afford comes back as an error result, not a throw
    if (m.is_error && /usage credits required for 1m/i.test(String(m.result || ''))) block1m(msg.model);
    // forked successfully -> hide the original (the fork depends on its data,
    // so we keep the file on disk but drop it from the list -> feels in-place)
    if (msg.hideOld && curSession && curSession !== msg.hideOld) {
      // the fork takes the original's place in the list → inherit its folder + pin so it stays put
      const f = folders.assign[msg.hideOld];
      if (f) { folders.assign[curSession] = f; saveFolders(); }
      if (pinned.has(msg.hideOld)) { pinned.add(curSession); savePins(); }
      hidden.add(msg.hideOld); saveHidden();
    }
    // CONTEXT FILL = the LAST assistant message's total input (input + both caches):
    // the real window occupancy after the turn (matches the TUI context indicator).
    // Per-message output_tokens is just the final reply (often a handful of tokens),
    // so TURN OUTPUT must come from result.usage, which sums every API call.
    const last = lastUsage || {};
    const ctxTokens = (last.input_tokens || 0) + (last.cache_read_input_tokens || 0) + (last.cache_creation_input_tokens || 0);
    const outTokens = (m.usage && m.usage.output_tokens) || 0;
    const inTokens = (m.usage && m.usage.input_tokens) || 0;
    const cacheTokens = ((m.usage && m.usage.cache_read_input_tokens) || 0) + ((m.usage && m.usage.cache_creation_input_tokens) || 0);
    // context window of the MAIN conversation model: the modelUsage entry with the
    // biggest token footprint (skips the tiny haiku side-model used for background tasks).
    let ctxWindow = 0;
    const ents = m.modelUsage ? Object.entries(m.modelUsage) : [];
    if (ents.length) {
      const foot = (x) => (x.inputTokens || 0) + (x.outputTokens || 0) + (x.cacheReadInputTokens || 0) + (x.cacheCreationInputTokens || 0);
      const [mainId, mainU] = ents.reduce((a, b) => (foot(b[1]) > foot(a[1]) ? b : a));
      ctxWindow = mainU.contextWindow || 0;
      recordModelWin(mainId, ctxWindow); // learn this model's true runtime window for the picker tag
    }
    out(turn, {
      type: 'turn_end',
      sessionId: curSession,
      forked: !!msg.fork,
      subtype: m.subtype,
      isError: !!m.is_error,
      result: m.result ?? '',
      cost: m.total_cost_usd ?? 0,
      durationMs: m.duration_ms ?? 0,
      apiMs: m.duration_api_ms ?? 0,
      ctxTokens,
      ctxWindow,
      outTokens
    });
    // accumulate this session's running cost / output / round count for /usage
    if (curSession) {
      const c = costs[curSession] || { cost: 0, out: 0, turns: 0, in: 0, cache: 0 };
      c.cost += m.total_cost_usd || 0;
      c.out += outTokens;
      c.in = (c.in || 0) + inTokens;
      c.cache = (c.cache || 0) + cacheTokens;
      c.turns += 1;
      c.at = Date.now();
      costs[curSession] = c;
      const dd = (costs._days = costs._days || {}); // per-day spend for the 今日花费 line
      dd[dayOf()] = (dd[dayOf()] || 0) + (m.total_cost_usd || 0);
      saveCosts();
      touchActiveDay();
    }
  };

  // 1 initial run + up to 2 transparent retries. Opus 4.8 occasionally emits a malformed tool_use
  // and the CLI's own one-shot retry can also fail → the whole reply is lost (empty bubble + buzz).
  // Rather than show the user nothing, we silently resume the session and ask the model to answer again.
  const MAX_ATTEMPTS = 3;
  let ended = false;
  let outerGotText = false, outerReplyText = ''; // surfaced to fireWake() so it knows if cc actually spoke
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let qOptions = options;
      let qPrompt;
      if (attempt === 1) {
        qPrompt = buildPrompt(msg);
      } else {
        // retry: resume the SAME (already-created) session, never re-fork, and nudge it to reply again.
        qPrompt = PARSE_RETRY_PROMPT;
        qOptions = { ...options, resume: curSession };
        delete qOptions.resumeSessionAt;
        delete qOptions.forkSession;
      }

      let gotText = false;   // did this attempt yield any real reply text?
      let replyText = '';    // accumulated reply text of this attempt (for wake → push / follow-up)
      let deltaText = '';    // raw streamed text deltas — salvage source when the closing assistant message gets swallowed by a parse failure
      let parseFail = false; // did we see the "tool call could not be parsed" signal?
      let resultMsg = null;
      const q = query({ prompt: qPrompt, options: qOptions });
      for await (const m of q) {
        switch (m.type) {
          case 'system':
            if (m.subtype === 'init') {
              curSession = m.session_id;
              sessionRef.id = curSession;
              if (curSession) activeSessions.add(curSession);
              out(turn, {
                type: 'session_init',
                sessionId: curSession,
                model: m.model,
                cwd: m.cwd,
                slashCommands: m.slash_commands,
                tools: m.tools
              });
            }
            break;

          case 'stream_event': {
            const ev = m.event;
            if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
              deltaText += ev.delta.text;
              out(turn, { type: 'assistant_delta', sessionId: curSession, text: ev.delta.text });
            }
            break;
          }

          case 'assistant': {
            if (m.message?.usage) lastUsage = m.message.usage; // last call's usage ≈ current context
            // a "<synthetic>" message = the CLI giving up after a malformed tool_use
            // ("...could not be parsed (retry also failed)."). Swallow it; we retry the whole turn.
            if (m.message?.model === '<synthetic>') { parseFail = true; break; }
            const content = m.message?.content || [];
            for (const block of content) {
              if (block.type === 'text') {
                if (/could not be parsed|tool call was malformed/i.test(block.text)) { parseFail = true; continue; }
                if (block.text.trim()) gotText = true;
                replyText += block.text;
                out(turn, { type: 'assistant_text', sessionId: curSession, text: rewriteMedia(block.text) });
                emitMedia(detectMedia(block.text, seenMedia).filter((x) => x.kind === 'audio'));
              } else if (block.type === 'thinking') {
                out(turn, { type: 'thinking', sessionId: curSession, text: block.thinking });
              } else if (block.type === 'tool_use') {
                out(turn, { type: 'tool_use', sessionId: curSession, id: block.id, name: block.name, input: block.input });
              }
            }
            break;
          }

          case 'user': {
            const content = m.message?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'tool_result') {
                  out(turn, {
                    type: 'tool_result',
                    sessionId: curSession,
                    id: block.tool_use_id,
                    isError: !!block.is_error,
                    content: summarizeResult(block.content)
                  });
                  // images returned inline by a tool
                  if (Array.isArray(block.content)) {
                    for (const b of block.content) {
                      if (b.type === 'image' && b.source?.type === 'base64') {
                        out(turn, { type: 'media', sessionId: curSession, kind: 'image', url: `data:${b.source.media_type};base64,${b.source.data}` });
                      }
                    }
                  }
                  // audio files referenced in the tool output text (images render inline)
                  emitMedia(detectMedia(summarizeResult(block.content), seenMedia).filter((x) => x.kind === 'audio'));
                }
              }
            }
            break;
          }

          case 'result':
            resultMsg = m;
            break;
        }
        if (resultMsg) break; // result is terminal; stop consuming so we can decide on retry
      }

      // was the reply eaten (no text out) by a parse failure? if so, silently retry.
      const aborted = !!abort?.signal?.aborted;
      const errTxt = String(resultMsg?.result || '');
      const billing = !!(resultMsg && resultMsg.is_error && /usage credits required for 1m/i.test(errTxt));
      const isParseFail = parseFail || /could not be parsed|tool call was malformed/i.test(errTxt);
      // parse 失败可能把「已经流出去的回复」连带吞掉：assistant_delta 流了文字，但收尾的
      // assistant 消息没来 → gotText/replyText 全空，被当成 cc 没说话（唤醒推送/追问全落空）。
      // 把流出的文本捞回来当本轮回复，别丢掉它只信重试后的版本。
      if (isParseFail && !aborted && deltaText.trim().length > replyText.trim().length) {
        log(`parse fail — salvaging ${deltaText.trim().length} chars of streamed text (blocks had ${replyText.trim().length})`);
        replyText = deltaText;
        gotText = !!deltaText.trim();
      }
      const eaten = !gotText && !aborted && !billing && (isParseFail || errTxt === '');
      if (eaten && attempt < MAX_ATTEMPTS) {
        log(`reply eaten (parseFail=${parseFail}) — silent retry ${attempt + 1}/${MAX_ATTEMPTS}`);
        continue;
      }
      if (resultMsg) { finalizeResult(resultMsg); ended = true; }
      outerGotText = gotText; outerReplyText = replyText;
      break;
    }
    // SDK iterator finished without a result message → still close the turn so the UI doesn't spin forever
    if (!ended) out(turn, { type: 'turn_end', sessionId: curSession, isError: false, result: '' });
  } catch (e) {
    const em = String(e?.message || e);
    if (/usage credits required for 1m/i.test(em)) block1m(msg.model); // stop offering this model's [1m] variant
    // a forked turn (regenerate / edit-resend) that died left a throwaway branch session:
    // drop it so the list doesn't gain a junk duplicate, and tell the client to fall back to the original
    let forkFailed = false;
    if (msg.fork && msg.hideOld && curSession && curSession !== msg.hideOld) {
      try { await deleteSession(curSession); } catch (_) {}
      forkFailed = true;
    }
    out(turn, { type: 'turn_error', sessionId: curSession, message: em, forkFailed, origSession: forkFailed ? msg.hideOld : '' });
  } finally {
    finishTurn(turn);
    if (curSession) activeSessions.delete(curSession);
  }
  return { gotText: outerGotText, text: (outerReplyText || '').trim(), sessionId: curSession };
}
