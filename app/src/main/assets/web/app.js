'use strict';

/* ============ storage ============ */
const LS = {
  get url() { return localStorage.getItem('cc_url') || ''; }, set url(v) { localStorage.setItem('cc_url', v); },
  get token() { return localStorage.getItem('cc_token') || ''; }, set token(v) { localStorage.setItem('cc_token', v); },
  get cwd() { return localStorage.getItem('cc_cwd') || ''; }, set cwd(v) { localStorage.setItem('cc_cwd', v); },
  get model() { return localStorage.getItem('cc_model') || ''; }, set model(v) { localStorage.setItem('cc_model', v); },
  get effort() { return localStorage.getItem('cc_effort') || ''; }, set effort(v) { localStorage.setItem('cc_effort', v); },
  get mode() { return localStorage.getItem('cc_mode') || 'code'; }, set mode(v) { localStorage.setItem('cc_mode', v); },
  get lastSid() { return localStorage.getItem('cc_last_sid') || ''; }, set lastSid(v) { localStorage.setItem('cc_last_sid', v || ''); },
  clear() { ['cc_url', 'cc_token', 'cc_cwd', 'cc_model', 'cc_effort', 'cc_mode'].forEach((k) => localStorage.removeItem(k)); }
};

/* app preferences (separate from connection config; survive 清除配置) */
let APP_VERSION = '1.1.1';
try { if (window.Android && Android.appVersion) APP_VERSION = Android.appVersion() || APP_VERSION; } catch (e) {}
const PREF_DEFAULTS = {
  fontSize: 1, fontFamily: 'client', showModel: true, showTokens: true,
  interruptOnLeave: false, autoScroll: true, pasteAsFile: true, pasteThreshold: 800, timezone: '',
  haptics: true, genHaptic: false, updateNotify: true, showStatusBar: true, discFx: true, discBlink: false,
  autoCleanup: true, wakePush: true, compactPrompt: '', viewMode: 'strip',
  theme: 'gray', accent: 'slate', foldersCollapsed: false, autoOpenLast: false
};
function loadPrefs() {
  const p = { ...PREF_DEFAULTS };
  for (const k in p) {
    const v = localStorage.getItem('cc_pref_' + k); if (v == null) continue;
    p[k] = typeof PREF_DEFAULTS[k] === 'boolean' ? v === '1' : typeof PREF_DEFAULTS[k] === 'number' ? parseFloat(v) : v;
  }
  return p;
}
function setPref(k, v) { state.prefs[k] = v; localStorage.setItem('cc_pref_' + k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v)); }
function P(k) { return state.prefs && state.prefs[k] !== undefined ? state.prefs[k] : PREF_DEFAULTS[k]; }

const $ = (id) => document.getElementById(id);
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
if (window.marked) marked.setOptions({ gfm: true, breaks: true });
function md(t) {
  try {
    let html = window.marked ? marked.parse(t || '') : esc(t);
    // bundled UI is a file:// page — marked emits relative `/media` img srcs that resolve to
    // file:///media (404). Prepend the bridge origin so inline images actually load.
    if (state.origin) html = html.replace(/(<img\b[^>]*\bsrc=["'])\/(?!\/)/gi, '$1' + state.origin + '/');
    // 围栏代码块包一层、右上角吊复制按钮（点击在 boot 的全局委托里处理，对话/回忆录等 md 渲染处通用）
    if (html.includes('<pre><code')) {
      html = html.replace(/<pre><code/g, '<div class="codewrap"><button class="codecopy" type="button" aria-label="复制">' + ICON.copy + '</button><pre><code')
        .replace(/<\/code><\/pre>/g, '</code></pre></div>');
    }
    return html;
  } catch (e) { return esc(t); }
}
function esc(s) { return (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

/* ============ inline line icons ============ */
const _sv = (p, w) => `<svg viewBox="0 0 24 24" width="${w || 16}" height="${w || 16}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  cloud: _sv('<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>', 13),
  pin: _sv('<line x1="12" y1="17" x2="12" y2="22"/><path d="M9 2h6l-1 7 3 3v2H7v-2l3-3-1-7z"/>', 13),
  folder: _sv('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  up: _sv('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'),
  term: _sv('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>', 18),
  tool: _sv('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>', 18),
  doc: _sv('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'),
  copy: _sv('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', 15)
};
function toolIconSvg(name) { return name === 'Bash' ? ICON.term : ICON.tool; }

/* ============ models / efforts ============ */
const MODELS = [
  { id: '', name: '默认（继承会话）', sub: '用会话/服务器当前模型' },
  { id: 'claude-opus-4-8', name: 'Opus 4.8', sub: '最强' },
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', sub: '均衡' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', sub: '最快' }
];
const EFFORTS = [
  { id: '', name: '默认', sub: '' }, { id: 'low', name: 'Low', sub: '快' },
  { id: 'medium', name: 'Medium', sub: '均衡' }, { id: 'high', name: 'High', sub: '深入' },
  { id: 'xhigh', name: 'X-High', sub: '更深' }, { id: 'max', name: 'Max', sub: 'ultrathink' }
];

/* ============ navigation ============ */
const SCREENS = ['setup', 'list', 'chat', 'settings', 'setSub', 'files', 'import', 'diary', 'stickies', 'diaryWrite', 'favorites', 'cinema', 'cinemaLog', 'memMgr', 'memEdit', 'bookPage', 'fpick', 'bookToc', 'apiPage'];
function show(name) {
  const leavingChat = state.screen === 'chat' && name !== 'chat';
  SCREENS.forEach((s) => $(s).classList.toggle('active', s === name));
  state.screen = name;
  if (name !== 'chat' && typeof hideSelBar === 'function') hideSelBar();   // 离开对话屏收起选词浮条
  if (name !== 'chat' && typeof cancelEdit === 'function') cancelEdit();   // 离开对话＝取消「编辑中」
  if (leavingChat && typeof saveDraft === 'function') saveDraft();         // 输入框草稿各归各家
  if (name === 'chat' && typeof resizeComposer === 'function') resizeComposer(); // 草稿是在屏还藏着时装填的，那会儿量不到高度——进屏补量
  syncAtRoot();
  if (typeof updateCinemaBar === 'function') updateCinemaBar();
  sendPresence(); // tell bridge which conversation I'm on (for wake-push 不打扰)
}
// anything floating above the current screen that hardware-back should close first
function overlayUp() {
  return anyOverlay() || drawerOpen() || searchOpen() || !!state.selectMode || !!state.plusOpen ||
    $('usageFull').classList.contains('show') || $('composeOver').classList.contains('show') ||
    !!document.querySelector('.lightbox') || (state.discActive && !state.discCollapsed);
}
// tell native whether hardware-back should exit the app. Only a TRUE root counts: list/setup screen
// with nothing floating above it — a stale "at root" while e.g. the usage page / drawer / a long-press
// menu is open makes the back key quit to the launcher instead of closing the overlay (user-reported).
// Synced on every screen change + key overlay opens, with a 300ms interval as the catch-all so any
// close path (animated, swiped, future additions) converges without per-call-site bookkeeping.
function syncAtRoot() { try { window.Android && Android.setAtRoot((state.screen === 'list' || state.screen === 'setup') && !overlayUp()); } catch (e) {} }
setInterval(syncAtRoot, 300);
const SCRIMS = ['permScrim', 'modelScrim', 'promptScrim', 'toolsScrim', 'modeScrim', 'sessScrim', 'folderScrim', 'claudeScrim', 'folderActScrim', 'pathActScrim', 'mcpScrim', 'mcpCfgScrim', 'memScrim', 'connScrim', 'wakeScrim', 'stickyScrim', 'compactScrim', 'confirmScrim', 'msgActScrim', 'tplScrim'];
const DRAG_SCRIMS = ['modelScrim', 'toolsScrim', 'modeScrim', 'claudeScrim', 'mcpCfgScrim', 'compactScrim', 'tplScrim'];
function anyOverlay() { return SCRIMS.some((s) => $(s).classList.contains('show')) || $('menuPop').classList.contains('show'); }
function openScrim(id) {
  const s = $(id); s._openedAt = Date.now(); s.classList.add('show'); if (s._open) s._open();
  syncAtRoot();
  // briefly block taps so a quick release after a long-press doesn't fall through onto an item
  const sheet = s.querySelector('.sheet, .cdlg'); if (sheet) { sheet.style.pointerEvents = 'none'; clearTimeout(s._peT); s._peT = setTimeout(() => { sheet.style.pointerEvents = ''; }, 350); }
}
function closeScrim(id) { const s = $(id); if (s._close) s._close(); else s.classList.remove('show'); syncAtRoot(); }
function closeOverlays() { SCRIMS.forEach(closeScrim); closeMenu(); }

/* draggable two-stage bottom sheet (normal <-> full), draggable from anywhere */
function setupDrag(id) {
  const scrim = $(id); const sheet = scrim.querySelector('.sheet.drag'); if (!sheet) return;
  const body = sheet.querySelector('.sheetbody');
  let H = 0, halfY = 0, startY = 0, startT = 0, t = 0, lastY = 0, lastTime = 0, vel = 0, dragging = false, mode = null, startOnHeader = false, startOnField = false, scroller = body;
  // 找触点下「真正在滚的」元素：预览/编辑区(.edita 等)自带 overflow 滚动、不是 .sheetbody 在滚——
  // 否则在预览里下滑会被当成「拉动关闭」（body.scrollTop 恒为 0、永远判成在顶部）。
  const scrollerFor = (target) => {
    let n = target;
    while (n && n !== sheet) {
      if (n.scrollHeight > n.clientHeight + 1) { const oy = getComputedStyle(n).overflowY; if (oy === 'auto' || oy === 'scroll') return n; }
      n = n.parentElement;
    }
    return body;
  };
  const EASE = 'transform .26s cubic-bezier(.32,.72,0,1)';
  const setT = (y) => { t = y; sheet.style.transform = `translateY(${y}px)`; };
  const detents = () => { H = window.innerHeight; halfY = H * 0.30; };
  scrim._open = () => { detents(); sheet.style.transition = 'none'; setT(H); requestAnimationFrame(() => { sheet.style.transition = EASE; setT(halfY); }); };
  scrim._close = () => { sheet.style.transition = EASE; setT(H || window.innerHeight); setTimeout(() => scrim.classList.remove('show'), 220); };
  function snap() {
    sheet.style.transition = EASE;
    if (vel < -0.28) { setT(0); return; }                              // flick up -> full
    if (vel > 0.45) { if (t > halfY * 0.4) scrim._close(); else setT(halfY); return; } // flick down
    if (t < halfY * 0.72) setT(0);                                     // small up -> full
    else if (t > halfY + H * 0.10) scrim._close();                     // small down -> close
    else setT(halfY);
  }
  sheet.addEventListener('touchstart', (e) => {
    startY = lastY = e.touches[0].clientY; lastTime = Date.now(); startT = t; vel = 0; mode = null; dragging = true;
    startOnHeader = !!(e.target.closest && e.target.closest('.sheethdr'));
    startOnField = !!(e.target.closest && e.target.closest('textarea, input'));  // editor textareas scroll themselves
    scroller = scrollerFor(e.target);                                            // 预览/长内容自带滚动容器：下滑先滚它、到顶才关
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const y = e.touches[0].clientY, dy = y - startY;
    if (mode === null) {
      const atFull = t <= 1;
      const atTop = scroller.scrollTop <= 0;
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      if (startOnHeader) mode = 'sheet';                       // grip/header always drags
      else if (startOnField) mode = 'scroll';                  // textarea/input scrolls itself; drag the sheet from the grip
      else if (dy > 0 && atTop) mode = 'sheet';                // pull down at top -> collapse/close
      else if (dy < 0 && !atFull && atBottom) mode = 'sheet';  // pull up at bottom (not full) -> expand
      else mode = 'scroll';                                    // normal content scroll
    }
    if (mode === 'scroll') return;
    e.preventDefault();
    let ny = startT + dy; ny = Math.max(0, Math.min(ny, H));
    sheet.style.transition = 'none'; setT(ny);
    const now = Date.now(); if (now > lastTime) { vel = (y - lastY) / (now - lastTime); lastY = y; lastTime = now; }
  }, { passive: false });
  sheet.addEventListener('touchend', () => { if (!dragging) return; dragging = false; if (mode === 'sheet') snap(); mode = null; });
}
window.onAndroidBack = () => {
  if (state.discActive && !state.discCollapsed) { dismissDisc(); return; }
  if (document.querySelector('.lightbox')) { closeLightbox(); return; }
  if (state.selectMode) { exitSelect(); return; }
  if (searchOpen()) { closeSearch(); return; }
  if (state.plusOpen) { closePlus(); return; }
  if (drawerOpen()) { closeDrawer(); return; }
  if ($('usageFull').classList.contains('show')) { closeUsageFull(); return; }
  if ($('composeOver').classList.contains('show')) { closeCompose(false); return; }
  if ($('permScrim').classList.contains('show')) { closePerm(true); return; }
  if (anyOverlay()) { closeOverlays(); return; }
  if (state.screen === 'diaryWrite') { if (document.querySelector('.dwpicker')) { closeDwPicker(); return; } show('diary'); return; }
  if (state.screen === 'cinemaLog') { show('cinema'); return; }
  if (state.screen === 'cinema') { cinemaBack(); return; }
  if (state.screen === 'bookPage') {
    if ($('bookPage').classList.contains('editing')) { bookEditClose(false); return; }
    if ($('bookFind').classList.contains('show')) { toggleBookFind(false); return; }
    show(state.bookBack || (state.currentSession ? 'chat' : 'list')); return;
  }
  if (state.screen === 'fpick') { show(state.fpickBack || (state.currentSession ? 'chat' : 'list')); return; }
  if (state.screen === 'bookToc') { show('bookPage'); return; }
  if (state.screen === 'memEdit') { if (document.querySelector('.mepicker')) { closeMemTypePicker(); return; } show('memMgr'); return; }
  if (state.screen === 'memMgr') { show(state.currentSession ? 'chat' : 'list'); return; }
  if (state.screen === 'stickies') { show('diary'); return; }
  if (state.screen === 'diary') { diaryBack(); return; }
  if (state.screen === 'import') show(state.importReturn || 'files');
  else if (state.screen === 'files') { if (state.fmSel) exitFmSel(); else closeFiles(); }
  else if (state.screen === 'chat') goListAnimated();
  else if (state.screen === 'setSub') show('settings');
  else if (state.screen === 'apiPage') show('settings');
  else if (state.screen === 'settings') show('list');
};

let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400); }

/* ---- external links ----
 * Chat links are plain <a href> (from marked). Letting the WebView navigate to them replaces the
 * whole chat UI with no way back (user had to kill+reopen). So we intercept CROSS-ORIGIN http(s)
 * links and hand them off: to the system browser via the native bridge if present, else copy to
 * the clipboard as a stopgap. Same-origin links (file download / APK update <a>) are left alone so
 * the native DownloadListener still fires. */
function copyText(text, ok) {
  const done = () => toast(ok || '链接已复制，去浏览器打开');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, () => legacyCopy(text, done)); return; }
  } catch (e) {}
  legacyCopy(text, done);
}
function legacyCopy(text, cb) {
  try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy'); ta.remove(); cb && cb(); }
  catch (e) { toast('无法打开链接'); }
}
function openExternal(url) {
  try { if (window.Android && typeof window.Android.openUrl === 'function') { window.Android.openUrl(url); return; } } catch (e) {}
  copyText(url);
}
function initLinkHandler() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    let u; try { u = new URL(a.getAttribute('href'), location.href); } catch (_) { return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return; // mailto:/tel:/… → native shouldOverrideUrlLoading
    if (u.host === location.host) return; // same-origin (download / APK / media) → leave to DownloadListener
    e.preventDefault();
    openExternal(u.href);
  }, true);
  // tap an inline (markdown) image in a message/thinking block -> lightbox
  document.addEventListener('click', (e) => {
    const im = e.target.closest && e.target.closest('.md img');
    if (im && im.src) { e.preventDefault(); openLightbox(im.src); }
  });
}

/* ============ state ============ */
const state = {
  screen: 'setup', ws: null, connected: false, authed: false, defaultCwd: '',
  sessions: [], currentSession: null, cwd: '', sessionModel: 'Claude', lastModel: '',
  model: '', effort: '', modelMine: false, mode: 'code', live: null,
  pendingPerm: null, reconnectTimer: null, dirPath: '', promptCb: null,
  turnTools: [], toolRow: null, folders: [], sessTarget: null, folderTarget: null, activeFolder: null,
  pendingFiles: [], origin: '', dirMode: 'cwd',
  turns: new Map(), viewTurnId: null, // 并发对话：turn 状态每对话各记各的（turnId → tr），viewTurnId=当前对话屏正在直播的 turn
  drafts: {}, draftKey: null,         // 输入框草稿也各记各的（sessionId / '~new' → {text,files,texts}）
  localDrafts: {},                    // 还没上传的附件（File 对象）只能留在内存里，按同一把 key 各归各家
  searchActive: false, plusOpen: false, plusH: 0,
  prefs: {}, pendingTexts: [], setCat: null,
  discActive: false, discCollapsed: false, discRaf: null, discT0: 0, discShowTimer: null,
  availModels: [], modelDefault: '', uploading: 0, filesReturn: 'list', searchScope: 'chat',
  selectMode: false, selected: new Set(),
  importItems: [], importSel: new Set(), importPath: '', everAuthed: false,
  lastRx: 0, pendingHistory: null, pendingSticky: null, liveTimer: null,
  aName: localStorage.getItem('cc_aname') || 'TA' // 助手显示名：服务器 config 下发，公开仓只有中性默认
};

/* ---- 并发对话：per-turn 状态 ---- */
function newLocalTurn(fields) {
  const now = Date.now(); // 收尾超过 10 分钟的旧 turn 顺手清掉（留着是为了给迟到事件路由）
  for (const [id, t] of state.turns) if (t.done && t.doneAt && now - t.doneAt > 600000) state.turns.delete(id);
  const tr = { id: genId(), sessionId: state.currentSession || null, lastI: 0, done: false, spoke: false, userMsgEl: null, draft: '', ...(fields || {}) };
  state.turns.set(tr.id, tr);
  state.viewTurnId = tr.id;
  return tr;
}
function markDone(tr) { if (tr && !tr.done) { tr.done = true; tr.doneAt = Date.now(); } }
function liveTurnFor(sid) { for (const t of state.turns.values()) if (!t.done && (sid ? t.sessionId === sid : !t.sessionId)) return t; return null; }
function viewTurn() { return state.viewTurnId ? (state.turns.get(state.viewTurnId) || null) : null; }
function viewBusy() { const t = viewTurn(); return !!(t && !t.done); }
function sessTitle(sid) { const s = state.sessions.find((x) => x.id === sid); return (s && s.title) || '对话'; }

/* ---- 每对话独立输入框：草稿（文字+附件）切换对话各记各的，文字落 localStorage ---- */
const DRAFTS_LS = 'cc_drafts';
function loadDraftStore() { try { state.drafts = JSON.parse(localStorage.getItem(DRAFTS_LS) || '{}') || {}; } catch (e) { state.drafts = {}; } }
function persistDrafts() {
  try {
    const keys = Object.keys(state.drafts);
    if (keys.length > 30) { keys.sort((a, b) => (state.drafts[a].ts || 0) - (state.drafts[b].ts || 0)); while (keys.length > 30) delete state.drafts[keys.shift()]; }
    localStorage.setItem(DRAFTS_LS, JSON.stringify(state.drafts));
  } catch (e) {}
}
function saveDraft() {
  const k = state.draftKey; if (!k) return;
  if (state.editTarget) return; // 编辑中的文本是编辑缓冲，不算草稿（进入编辑那刻草稿已存好）
  const text = $('composer').value;
  const files = state.pendingFiles.filter((f) => f.status === 'ready');
  const local = state.pendingFiles.filter((f) => f.status !== 'ready');   // 没传的（含传到一半的）留内存
  const texts = state.pendingTexts;
  if (local.length) state.localDrafts[k] = local; else delete state.localDrafts[k];
  if (!text.trim() && !files.length && !texts.length) { if (state.drafts[k]) { delete state.drafts[k]; persistDrafts(); } return; }
  state.drafts[k] = { text, files, texts, ts: Date.now() };
  persistDrafts();
}
function loadDraft(k) {
  state.draftKey = k || '~new';
  const d = state.drafts[state.draftKey] || {};
  $('composer').value = d.text || '';
  const local = state.localDrafts[state.draftKey] || [];
  state.pendingFiles = (d.files || []).filter((f) => !local.some((l) => l.path && l.path === f.path)).concat(local);
  state.pendingTexts = (d.texts || []).slice();
  renderAttachStrip(); resizeComposer(); updateSend();
}
function draftDirty() { clearTimeout(state._draftT); state._draftT = setTimeout(saveDraft, 500); }
loadDraftStore();

/* ============ websocket ============ */
function connbar(text, isErr) { const b = $('connbar'); if (!text) { b.classList.remove('show'); return; } b.textContent = text; b.classList.toggle('err', !!isErr); b.classList.add('show'); }

/* ============ disconnect screen ============ */
function showDisc() {
  state.discActive = true;
  $('discScreen').classList.add('show'); $('discScreen').classList.toggle('collapsed', state.discCollapsed);
  $('discPill').classList.toggle('show', state.discCollapsed);
  startDiscTel();
}
function dismissDisc() { state.discCollapsed = true; $('discScreen').classList.add('collapsed'); $('discPill').classList.add('show'); }
function expandDisc() { state.discCollapsed = false; $('discScreen').classList.remove('collapsed'); $('discPill').classList.remove('show'); }
function hideDisc() {
  clearTimeout(state.discShowTimer);
  state.discActive = false; state.discCollapsed = false;
  $('discScreen').classList.remove('show', 'collapsed'); $('discPill').classList.remove('show');
  stopDiscTel();
}
function startDiscTel() {
  if (state.discRaf) return;
  state.discT0 = performance.now();
  const g = 9.8, H = 0.5 * g * 60 * 60;
  const tick = () => {
    let t = (performance.now() - state.discT0) / 1000;
    if (t > 60) { state.discT0 = performance.now(); t = 0; }
    const alt = Math.max(0, H - 0.5 * g * t * t), v = Math.min(g * t, g * 60);
    const e = $('discTel'); if (e) e.textContent = 'ALT ▼ ' + Math.round(alt).toLocaleString() + ' m · ' + Math.round(v) + ' m/s';
    state.discRaf = requestAnimationFrame(tick);
  };
  state.discRaf = requestAnimationFrame(tick);
}
function stopDiscTel() { if (state.discRaf) { cancelAnimationFrame(state.discRaf); state.discRaf = null; } }
function defaultWsUrl() {
  if (location.protocol === 'https:') return 'wss://' + location.host;
  if (location.protocol === 'http:') return 'ws://' + location.host;
  return ''; // bundled/offline: no default host — the user fills 设置→连接 with their own bridge
}
function connect() {
  const url = LS.url || defaultWsUrl();
  state.origin = url.replace(/^ws/, 'http'); // wss://host -> https://host (for /media)
  // a pending auto-reconnect would fire on top of the socket we're about to open and churn it once
  clearTimeout(state.reconnectTimer);
  // detach the old socket's handlers BEFORE closing it — otherwise its onclose fires async and
  // schedules another connect() 2500ms later, which then closes THIS socket… → permanent 2.5s churn
  if (state.ws) { try { const old = state.ws; old.onopen = old.onmessage = old.onerror = old.onclose = null; old.close(); } catch (e) {} }
  connbar('连接中…', false);
  let ws; try { ws = new WebSocket(url); } catch (e) { connbar('地址无效', true); return; }
  state.ws = ws; state.authed = false;
  ws.onopen = () => { state.connected = true; state.lastRx = Date.now(); ws.send(JSON.stringify({ type: 'auth', token: LS.token })); };
  ws.onmessage = (ev) => { state.lastRx = Date.now(); let m; try { m = JSON.parse(ev.data); } catch (e) { return; } handle(m); };
  ws.onclose = () => {
    state.connected = false; state.authed = false;
    clearTimeout(state.reconnectTimer); state.reconnectTimer = setTimeout(connect, 2500);
    // show the disconnect UI, but only if a quick reconnect doesn't beat it. 隧道/NAT 掐空闲连接的
    // 瞬断通常 2.5s 自动接回，宽限必须长于重连(3000>2500)，否则每次空闲小瞬断都闪一下提示。
    // even longer while uploads are in flight (the socket churns then)
    if (state.screen === 'setup') return;
    const grace = state.uploading > 0 ? 9000 : 3000;
    clearTimeout(state.discShowTimer);
    if (!P('discFx')) { state.discShowTimer = setTimeout(() => { if (!state.connected) connbar('已断开，重连中…', true); }, grace); return; }   // banner-only mode
    if (!state.discActive) state.discShowTimer = setTimeout(showDisc, grace);
  };
  ws.onerror = () => {};
}
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } })();
function wsend(o) { if (state.ws && state.connected && state.authed) { const z = (state.prefs ? P('timezone') : '') || TZ; if (z && !o.tz) o.tz = z; state.ws.send(JSON.stringify(o)); return true; } return false; }
// kick a reconnect immediately if we're not already connected/connecting (e.g. back to foreground
// after the OS froze the reconnect timer in the background — don't wait out the throttled delay)
function ensureConnected() {
  if (state.connected && state.authed) return;
  const rs = state.ws ? state.ws.readyState : 3; // 0 CONNECTING / 1 OPEN
  if (rs === 0 || rs === 1) return; // a connect is already in flight / socket open and authing
  clearTimeout(state.reconnectTimer); connect();
}
// app-level liveness: a half-open WS (peer gone through Cloudflare) still shows OPEN, so sends
// vanish and nothing comes back ("发了收不到"). Ping every 15s; if NOTHING has arrived for 60s,
// the path is dead — drop it and reconnect. lastRx is bumped on every received frame incl. pong.
function startLiveness() {
  if (state.liveTimer) return;
  state.liveTimer = setInterval(() => {
    if (!state.connected || !state.authed) return;
    if (state.lastRx && Date.now() - state.lastRx > 60000) {
      // path is dead — connect() cleanly supersedes the old socket (detaches its handlers first)
      state.connected = false; state.authed = false; connect(); return;
    }
    try { state.ws.send(JSON.stringify({ type: 'ping', t: Date.now() })); } catch (e) {}
  }, 15000);
}
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
// presence → bridge: which conversation I'm viewing + foreground (so wake push skips the one I'm looking at)
// model/effort 只在确属本对话的选择时带上（modelMine）——刚进对话、还没读回它记住的模型前不带，
// 免得用别的对话/全局默认把服务端的 per-session 记忆盖掉（唤醒就是按那份记忆选模型的）
function sendPresence() { wsend({ type: 'presence', sessionId: state.screen === 'chat' ? state.currentSession : null, foreground: document.visibilityState === 'visible', model: (state.modelMine && state.model) ? state.model : undefined, effort: (state.modelMine && state.effort) ? state.effort : undefined }); }
function sendPushPref() { wsend({ type: 'push_pref', enabled: P('wakePush') }); }
// hand creds to the native background service + start/stop it per the 后台唤醒通知 toggle
function applyNativeNotify() {
  try {
    if (window.Android && Android.saveCreds) Android.saveCreds(LS.url || defaultWsUrl(), LS.token);
    if (window.Android && Android.setNotify) Android.setNotify(P('wakePush'));
  } catch (e) {}
}
function onWakePushToggle() { sendPushPref(); applyNativeNotify(); }
// open a conversation by id (used by a tapped wake notification, possibly before sessions loaded)
window.__openConv = function (sid) {
  if (!sid) return;
  const go = () => { const s = (state.sessions || []).find((x) => x.id === sid) || { id: sid, title: '', cwd: '' }; openSession(s); };
  if (state.authed) { go(); return; }
  let n = 0; const t = setInterval(() => { if (state.authed || n++ > 50) { clearInterval(t); if (state.authed) go(); } }, 150);
};

// 系统分享进来的文件/文字（原生壳 handleShareIntent → 这里）：落到当前对话、不在对话里就打开上一个对话，
// 文件先挂附件条本地预览，发送时才上传。文件本体经原生壳的 share.telos.local 假域取回（见 MainActivity）
window.__onShared = function (json) {
  let p; try { p = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return; }
  if (!p || (!(p.files || []).length && !p.text)) return;
  const go = () => {
    if (state.screen !== 'chat') {
      const sid = LS.lastSid;
      const s = (state.sessions || []).find((x) => x.id === sid) || (state.sessions || [])[0];
      if (!s) { toast('还没有对话，先建一个再分享'); return; }
      openSession(s);
    }
    if (p.text) { const c = $('composer'); c.value = (c.value ? c.value + '\n' : '') + p.text; resizeComposer(); updateSend(); draftDirty(); }
    (p.files || []).forEach((f) => {
      fetch('https://share.telos.local/' + encodeURIComponent(f.id) + '?mime=' + encodeURIComponent(f.mime || ''))
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
        .then((b) => {
          attachLocal([new File([b], f.name || '分享文件', { type: f.mime || b.type || '' })]);
          try { window.Android && Android.shareDone && Android.shareDone(f.id); } catch (e) {}
        })
        .catch((e) => toast('接收分享失败：' + e.message));
    });
    buzz(12);
  };
  if (state.authed && (state.sessions || []).length) { go(); return; }
  let n = 0; const t = setInterval(() => { if ((state.authed && (state.sessions || []).length) || n++ > 60) { clearInterval(t); if (state.authed) go(); } }, 150);
};

/* splash: hide once the app is ready (list rendered / setup shown), with a min on-screen time */
const SPLASH_MIN_MS = 650;
function hideSplash() {
  const sp = document.getElementById('splash'); if (!sp || sp.classList.contains('hide')) return;
  const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - (window._bootAt || 0)));
  setTimeout(() => { sp.classList.add('hide'); setTimeout(() => sp.remove(), 500); }, wait);
}

/* ============ message handling ============ */
function handle(m) {
  // 并发对话：事件先按 turnId 找到自己的 turn；trVis = 这个 turn 正在当前对话屏直播（才许上屏）。
  // 没带 turnId 的（旧桥/广播类）退回按 sessionId 判断，行为同旧版。
  const tr = m.turnId ? state.turns.get(m.turnId) : null;
  const trVis = tr ? tr.id === state.viewTurnId : (m.sessionId == null || m.sessionId === state.currentSession);
  if (tr && m._i != null && !tr.done) tr.lastI = Math.max(tr.lastI || 0, m._i);
  // 一旦 cc 产出可见内容（正文/工具/媒体），就标记「已开口」——之后的打断不再回退消息
  if (tr && (m.type === 'assistant_delta' || m.type === 'assistant_text' || m.type === 'tool_use' || m.type === 'tool_result' || m.type === 'media')) tr.spoke = true;
  switch (m.type) {
    case 'auth_ok':
      state.authed = true; state.everAuthed = true; state.defaultCwd = m.defaultCwd || ''; connbar(''); hideDisc();
      if (m.assistantName) { state.aName = m.assistantName; try { localStorage.setItem('cc_aname', m.assistantName); } catch (e) {} }
      state.lastRx = Date.now(); startLiveness();
      checkUpdate(false); wsend({ type: 'model_list' }); wsend({ type: 'cache_ttl_get' });
      if (state.screen === 'setup') show('list');
      wsend({ type: 'list_sessions' });
      sendPushPref(); sendPresence(); applyNativeNotify();
      if (m.userStatus) { state.userStatus = m.userStatus; renderUserStatus(); }
      if (P('autoCleanup') && !state._cleaned) { state._cleaned = true; wsend({ type: 'cleanup_stale' }); }  // once per launch
      // re-fetch history/sticky that got dropped because we tapped into the chat before auth landed
      if (state.pendingHistory) { wsend({ type: 'history_window', sessionId: state.pendingHistory, limit: 60 }); state.pendingHistory = null; }
      if (state.pendingSticky) { wsend({ type: 'sticky_get', sessionId: state.pendingSticky }); state.pendingSticky = null; }
      // 断线时错过 wake_typing off 会让标题旁的「…」永远跳（now 唤醒踩过）——重连先清零，
      // 真还在打字的话服务端 auth 后会立刻补发 on
      state.cinemaTyping = ''; updateCinemaBar();
      // resume in-flight turns after a reconnect（并发：每个没跑完的都接回）
      for (const t of state.turns.values()) if (!t.done) wsend({ type: 'attach', turnId: t.id, after: t.lastI || 0 });
      if (viewBusy()) startStatus();
      if ($('usageFull').classList.contains('show')) reqUsage(); // 用量页开着断线重连 → 自动刷新
      break;
    case 'pong': break; // liveness reply — lastRx already bumped in onmessage
    case 'attach_done':
      if (!m.found) { markDone(tr); if (trVis) { stopStatus(); updateSend(); } }
      break;
    case 'auth_fail':
      // if we authed successfully before, a fail is almost always a transient reconnect race —
      // don't cry "token 不正确" / dump to settings; just let the reconnect loop retry.
      if (state.everAuthed) connbar('重连中…', true);
      else { connbar('鉴权失败：token 不对', true); toast('Token 不正确'); show('settings'); }
      break;
    case 'sessions': state.sessions = m.sessions || []; if (m.folders) state.folders = m.folders; renderSessions(); maybeAutoOpen(); prefetchSeed(state.sessions); break;
    case 'usage': state.usage = m; renderUsageStrip(); if ($('usageFull').classList.contains('show')) renderUsageFull(); break;
    case 'app_update': onAppUpdate(m); break;
    case 'folders':
      state.folders = m.folders || [];
      if (state.activeFolder && !state.folders.includes(state.activeFolder)) state.activeFolder = null;
      renderSessions(); break;
    case 'assigned': wsend({ type: 'list_sessions' }); break;
    case 'history': if (m.prefetch) onPrefetchHistory(m); else renderHistory(m); if (viewBusy()) startStatus(); break;
    case 'template': onTemplate(m); break;
    case 'template_error': toast(m.message || '模板没存上'); break;
    case 'template_preview': renderTplPreview(m); break;
    case 'history_window': onHistoryWindow(m); if (!m.prefetch && viewBusy()) startStatus(); break; // 历史渲染的 clearThread 会捎带灭掉转圈——还在跑就重新点上
    case 'history_full': onHistoryFull(m); if (viewBusy()) startStatus(); break;
    case 'paths_done': {
      const verb = { delete: '已删除', move: '已移动', copy: '已复制' }[m.op] || '完成';
      toast(verb + ' ' + m.done + ' 项' + (m.fail ? '，' + m.fail + ' 项失败' : ''));
      break;
    }
    case 'api_info': renderApiInfo(m); break;
    case 'api_test_result': {
      const o = $('apiTestOut'); o.className = 'apitest ' + (m.ok ? 'ok' : 'err'); o.textContent = m.message || '';
      break;
    }
    case 'user_uuid': {
      // 现场发的气泡补上消息 id → 不用退出重进就能点「编辑重发」
      const t = tr || viewTurn();
      if (m.sessionId === state.currentSession && t && t.userMsgEl && t.userMsgEl.isConnected) {
        const b = t.userMsgEl.querySelector('.bubble');
        if (b && !b._uuid) bindUserBubble(b, m.uuid, t.draft || '');
      }
      break;
    }
    case 'dirs':
      if (state.fpickWait && m.path === state.fpickWait) { state.fpickWait = null; state.fpickDir = m.path; renderFilePick(m); break; }
      renderDirs(m); break;
    case 'turn_start':
      if (trVis) { state.turnTools = []; state.toolRow = null; startStatus(); updateSend(); }
      else if (state.screen === 'list') renderSessions(); // 列表行「正在回复」标记
      break;
    case 'session_init': {
      const wasNew = tr && !tr.sessionId;
      if (tr) tr.sessionId = m.sessionId;   // 新对话 / fork：turn 拿到真正的 sessionId
      if (!trVis) { if (state.screen === 'list') renderSessions(); break; }
      if ((tr && (tr.expectFork || wasNew)) || !state.currentSession) {
        state.currentSession = m.sessionId;
        // 对话换了身份（新对话 ~new 拿到 sid / 编辑重发 fork 成新 id）：草稿跟着搬家
        const ok = state.draftKey;
        if (ok && ok !== m.sessionId) { state.draftKey = m.sessionId; if (state.drafts[ok]) { state.drafts[m.sessionId] = state.drafts[ok]; delete state.drafts[ok]; persistDrafts(); } }
      }
      state.lastModel = m.model || state.lastModel; syncModelSub(); // SDK 报的才是这回合真正跑的模型
      if (m.cwd) state.cwd = m.cwd;
      sendPresence(); // 新会话/fork 刚拿到 sid：顺手把本对话的模型记到服务端（唤醒按它选模型）
      updateHeader(); break;
    }
    case 'assistant_delta': if (trVis) appendDelta(m.text); break;
    case 'assistant_text': if (trVis) finalizeText(m.text); break;
    case 'injected': if (tr) tr.inj = { pre: m.pre || '', post: m.post || '' }; if (trVis && tr && tr.userMsgEl) attachInj(tr.userMsgEl, m.pre, m.post); break;   // 透视：这条消息实际带了什么
    case 'mood_line': if (trVis) attachMoodLine(m.text); break;                                                                                     // 透视：回复里被剥掉的 [mood] 行
    case 'thinking': if (trVis) addThinking(m.text); break;
    case 'tool_use': if (trVis) addTool(m); break;
    case 'tool_result': if (trVis) updateTool(m); break;
    case 'media': if (trVis) addMedia(m.kind, m.url); break;
    case 'file':
      if (state.bookWait && m.path === state.bookWait) { renderBook(m); break; }
      if (state.editingClaude && m.path === state.claudePath) { $('claudeText').value = m.content || ''; openScrim('claudeScrim'); }
      break;
    case 'file_saved': toast('已保存'); break;
    case 'import_list':
      if (!m.ok) { toast('读取失败：' + (m.error || '')); break; }
      openImportScreen(m.path, m.items || []); break;
    case 'import_progress': toast('导入中 ' + m.done + '/' + m.total + '…'); break;
    case 'import_done':
      if (m.ok) { toast('已导入 ' + m.count + ' 个对话（「导入」文件夹）'); wsend({ type: 'list_sessions' }); }
      else toast('导入失败：' + (m.error || '未知错误'));
      break;
    case 'models': state.availModels = m.models || []; state.modelDefault = m.current || ''; if ($('modelScrim').classList.contains('show')) openModelSheet(); if (state.currentSession) syncModelSub(); break;
    case 'mcp': renderMcpList(m.servers || []); break;
    case 'mcp_toggled': toast('已' + (m.on ? '启用' : '关闭') + '：' + m.name); break;
    case 'mcp_config': $('mcpCfgText').value = m.content || '{}'; openScrim('mcpCfgScrim'); break;
    case 'mcp_config_saved': toast('MCP 配置已保存'); closeScrim('mcpCfgScrim'); break;
    case 'permission_request': openPerm(m); break;
    case 'turn_end': endTurn(m, tr, trVis); break;
    case 'turn_error': {
      if (tr) { tr.errored = true; markDone(tr); }
      if (!trVis) { // 后台对话出错/被拦：轻提示，正文不动当前屏
        toast('「' + sessTitle((tr && tr.sessionId) || m.sessionId) + '」' + (m.message || '出错了'));
        wsend({ type: 'list_sessions' });
        break;
      }
      stopStatus(); finalizeLive(); updateSend();
      const orig = m.origSession || (tr && tr.forkFrom);
      if (tr) { tr.expectFork = false; tr.forkFrom = null; }
      if (orig) {                       // a regenerate / edit-resend died: drop the dead branch, restore the original
        toast('重新生成失败，已保留原对话');
        state.currentSession = orig; wsend({ type: 'history_window', sessionId: orig, limit: 60 });
      } else addError(m.message);
      wsend({ type: 'list_sessions' });
      break;
    }
    case 'renamed': case 'deleted': case 'pinned': wsend({ type: 'list_sessions' }); break;
    case 'cloned': if (m.error) { toast('复制失败：' + m.error); } else { toast('已复制为新窗口'); wsend({ type: 'list_sessions' }); } break;
    case 'exported': {
      if (m.error) { toast('转出失败：' + m.error); break; }
      const cmd = 'claude --resume ' + m.sessionId;   // 克隆已藏出列表，不用刷新
      openConfirm('已转到终端', cmd, () => copyText(cmd, '已复制'), '复制命令', true);
      break;
    }
    case 'cleanup_done': if (m.removed) toast('已清理 ' + m.removed + ' 个废弃对话'); wsend({ type: 'list_sessions' }); break;
    // ---- 醒来 / 日记 / 便签 ----
    case 'wakeup_state': onWakeState(m); break;
    case 'cinema_state': onCinemaState(m); break;
    case 'mood': if (m.sessionId === state.currentSession) { state.mood = m.mood || null; updateHeader(); syncMoodMenu(); } break;
    case 'memory': onMemory(m); break;
    case 'memory_recover_armed': if (m.sessionId === state.currentSession) { closeScrim('memScrim'); toast('记忆已就位 · 下条消息会带回'); } break;
    case 'memory_list': onMemoryList(m); break;
    case 'memory_edited': if (m.ok === false) toast('保存失败'); break;
    case 'memory_deleted': if (m.ok === false) toast('删除失败'); break;
    case 'dialog_search': onDialogSearch(m); break;
    case 'cinema_log':
      if (state.screen === 'cinemaLog' && state.cinTarget && m.sessionId === state.cinTarget.id) renderCinemaLog(m);
      break;
    case 'cinema_notice': toast(m.text || '电影模式已暂停'); break;
    case 'cache_ttl': state.cacheTtl = m.ttl || '1h'; if (state.screen === 'setSub' && state.setCat === 'chat') renderSetSub(); break;
    case 'wake_typing':
      if (m.on) state.cinemaTyping = m.sessionId; else if (state.cinemaTyping === m.sessionId) state.cinemaTyping = '';
      updateCinemaBar(); break;
    case 'wake_message':
      // late = 重连补发的错过消息——正文已经在会话历史里了，往打开的对话里再插会重复显示
      if (m.late) { toast((m.title ? '「' + m.title + '」' : '') + '有错过的醒来留言'); wsend({ type: 'list_sessions' }); break; }
      if (state.screen === 'chat' && state.currentSession === m.sessionId) { addAssistantText(m.text); buzz(18); scrollThreadAuto(); }
      else { toast((m.title ? '「' + m.title + '」' : '') + 'cc 醒来留言了'); wsend({ type: 'list_sessions' }); }
      break;
    // ---- 总日历（全局）----
    case 'calendar': onCalendar(m); break;
    case 'day': onDay(m); break;
    case 'todos': onTodos(m); break;
    case 'calendar_changed':
      if (state.screen === 'diary') { reqCalendar(); if (state.selDay) reqDay(state.selDay); wsend({ type: 'todos_get' }); }
      break;
    case 'diary_saved':
      toast('已保存到日记');
      break;
    case 'user_status': state.userStatus = { text: m.text || '', at: m.at || 0 }; renderUserStatus(); break;   // 自设状态改了（本端或别端），抽屉里那眼跟着更新
    case 'diary_page': case 'diary_index': case 'diary_overview': case 'diary_changed': break; // 旧的逐对话日记协议，已并入总日历
    case 'stickies': onStickies(m); break;
    case 'stickies_all': onStickiesAll(m); break;
    case 'favorites': onFavorites(m); break;
    case 'stickies_changed':
      if (state.screen === 'stickies' || state.screen === 'diary') wsend({ type: 'sticky_all' });
      break;
    case 'sticky_changed':
      // refresh the unread badge on the list
      { const s = state.sessions.find((x) => x.id === m.sessionId); if (s) { s.unreadNotes = m.unread || 0; if (state.screen === 'list') renderSessions(); } }
      break;
    case 'error': toast(m.message || '出错了'); break;
  }
}

/* ============ session list ============ */
function relTime(ms) { if (!ms) return ''; const d = Date.now() - ms, min = Math.floor(d / 60000); if (min < 1) return 'now'; if (min < 60) return min + 'm'; const h = Math.floor(min / 60); if (h < 24) return h + 'h'; const dy = Math.floor(h / 24); return dy < 30 ? dy + 'd' : Math.floor(dy / 30) + 'mo'; }
function shortCwd(p) { if (!p) return '~'; return p.replace(/^\/root\/?/, (m) => m.length > 6 ? '~/' : '~').replace(/^\/home\/[^/]+\//, '~/'); }
function initials(s) { s = (s || '').trim(); return s ? s.slice(0, 2) : '··'; }
function dayLabel(ms) { if (!ms) return ''; const d = new Date(ms), n = new Date(); if (d.toDateString() === n.toDateString()) return 'Today'; const y = new Date(n); y.setDate(n.getDate() - 1); if (d.toDateString() === y.toDateString()) return 'Yesterday'; return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }); }
function renderTabs() {
  const tabs = $('tabs'); tabs.innerHTML = '';
  const mk = (label, key, count, isFolder) => {
    const b = el('button', 'tab' + (state.activeFolder === key ? ' on' : ''));
    b.innerHTML = (isFolder ? ICON.folder + ' ' : '') + label + ` <span class="count">${count}</span>`;
    let lp = false, timer = null;
    b.addEventListener('click', () => { if (lp) { lp = false; return; } state.activeFolder = key; renderSessions(); });
    if (isFolder) {
      const start = () => { lp = false; timer = setTimeout(() => { lp = true; if (navigator.vibrate) navigator.vibrate(12); openFolderActions(key); }, 500); };
      const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
      b.addEventListener('touchstart', start, { passive: true });
      b.addEventListener('touchend', cancel); b.addEventListener('touchmove', cancel);
    }
    tabs.appendChild(b);
  };
  mk('All', null, state.sessions.length, false);
  (state.folders || []).forEach((f) => mk(esc(f), f, state.sessions.filter((s) => s.folder === f).length, true));
}
// 文件夹收起：由 Telos 标题旁的小三角控制整条 #tabs 显隐（像命令一样可收起）。
// 只有存在文件夹时才出现三角；收起时**停在当前文件夹**（不再弹回「全部」），三角后显示当前夹名免得不知身在哪。
function syncFoldCaret() {
  const hasFolders = (state.folders || []).length > 0;
  const collapsed = hasFolders && P('foldersCollapsed');
  const caret = $('foldCaret');
  if (!caret) return;
  caret.style.display = hasFolders ? '' : 'none';
  const name = (collapsed && state.activeFolder) ? state.activeFolder : '';
  caret.innerHTML = (collapsed ? '▸' : '▾') + (name ? ' <span class="foldcur">' + esc(name) + '</span>' : '');
  $('tabs').style.display = collapsed ? 'none' : '';
}
function renderSessions() {
  hideSplash();
  syncFoldCaret();
  renderTabs();
  const list = $('sessionList'); list.innerHTML = '';
  let items = state.sessions;
  if (state.activeFolder) items = items.filter((s) => s.folder === state.activeFolder);
  if (!items.length) {
    const e = el('div', 'empty');
    e.innerHTML = state.activeFolder ? '这个文件夹还没有会话。<br>长按会话「移到文件夹」放进来。' : '还没有会话。<br>点下面 ＋ New session 开始第一个。';
    list.appendChild(e); return;
  }
  const groupHeader = (text, html) => { const g = el('div', 'daygroup'); if (html) g.innerHTML = html; else g.textContent = text; list.appendChild(g); };
  let lastDay = '', pinnedDone = false;
  items.forEach((s) => {
    if (s.pinned && !pinnedDone) { groupHeader(null, ICON.pin + ' 置顶'); pinnedDone = true; lastDay = '__pin__'; }
    if (!s.pinned) { const day = dayLabel(s.updatedAt); if (day !== lastDay) { lastDay = day; groupHeader(day); } }
    addCard(s);
  });
  function addCard(s) {
    const card = el('div', 'scard' + (s.pinned ? ' pinned' : '') + (state.selectMode && state.selected.has(s.id) ? ' selected' : ''));
    const head = el('div', 'scard-head');
    const meta = el('div', 'scard-meta');
    const t = el('div', 'scard-title'); t.textContent = s.title || '(无标题)';
    const repo = el('div', 'scard-repo'); repo.innerHTML = ICON.cloud;
    const rl = el('span'); rl.textContent = shortCwd(s.cwd) + (s.gitBranch ? ' · ' + s.gitBranch : ''); repo.appendChild(rl);
    meta.appendChild(t); meta.appendChild(repo);
    if (s.wakeAt) { const wk = el('div', 'scard-wake'); wk.textContent = wakeLabel(s.wakeAt) + ' 醒来'; meta.appendChild(wk); }
    if (liveTurnFor(s.id)) { // 这个对话的 turn 还在跑（并发对话）
      const bz = el('div', 'scard-busy'); bz.innerHTML = '<span class="sb-dot"></span><span>正在回复…</span>'; meta.appendChild(bz);
    }
    if (s.id === state.cinemaOnSid) { // 守夜中：时间流动指示挪到列表行（冷场久了转冷色）
      const ci = el('div', 'scard-cinema'); const info = (state.cinemaInfo && state.cinemaInfo.sid === s.id) ? state.cinemaInfo : null;
      const coldMin = info ? Math.round((Date.now() - (info.lastSpokeAt || info.startedAt || Date.now())) / 60000) : 0;
      ci.classList.toggle('cold', coldMin >= 120);
      ci.innerHTML = '<span class="cb-dot"></span><span>时间流动中' + (info && info.wakes ? ' · 醒 ' + info.wakes + ' 次' : '') + '</span>';
      meta.appendChild(ci);
    }
    if (s.unreadNotes) { const b = el('span', 'scard-badge'); b.textContent = s.unreadNotes; t.appendChild(b); }
    const time = el('div', 'scard-time'); time.textContent = relTime(s.updatedAt);
    head.appendChild(meta);
    if (s.pinned) { const p = el('div', 'scard-pin'); p.innerHTML = ICON.pin; head.appendChild(p); }
    head.appendChild(time); card.appendChild(head);
    if (s.preview) { const pv = el('div', 'scard-preview'); pv.textContent = s.preview; card.appendChild(pv); }
    bindCard(card, s);
    list.appendChild(card);
  }
}
function bindCard(card, s) {
  let timer = null, longPressed = false;
  const start = () => { if (state.selectMode) return; longPressed = false; timer = setTimeout(() => { longPressed = true; buzz(12); openSessActions(s); }, 500); };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  card.addEventListener('touchstart', start, { passive: true });
  card.addEventListener('touchend', cancel);
  card.addEventListener('touchmove', cancel);
  card.addEventListener('click', () => { if (state.selectMode) { toggleSelect(s.id, card); return; } if (longPressed) { longPressed = false; return; } openSession(s); });
}
function toggleSelect(id, card) { if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id); if (card) card.classList.toggle('selected', state.selected.has(id)); updateSelectBar(); }
function enterSelect(s) { state.selectMode = true; state.selected = new Set(s ? [s.id] : []); $('selectBar').classList.add('show'); $('newBtn').style.display = 'none'; renderSessions(); updateSelectBar(); syncAtRoot(); }
function exitSelect() { state.selectMode = false; state.selected.clear(); $('selectBar').classList.remove('show'); $('newBtn').style.display = ''; renderSessions(); }
function updateSelectBar() { const n = state.selected.size; $('selCount').textContent = n; $('selDelete').disabled = !n; $('selFolder').disabled = !n; }
function selectAllVisible() {
  let items = state.sessions; if (state.activeFolder) items = items.filter((s) => s.folder === state.activeFolder);
  const all = items.every((s) => state.selected.has(s.id));
  items.forEach((s) => { if (all) state.selected.delete(s.id); else state.selected.add(s.id); });
  renderSessions(); updateSelectBar();
}
function deleteSelected() {
  if (!state.selected.size) return;
  const n = state.selected.size;
  openConfirm('删除 ' + n + ' 个对话？', '不可恢复', () => { wsend({ type: 'delete_many', ids: [...state.selected] }); exitSelect(); });
}
function togglePin(s) { wsend({ type: 'pin', sessionId: s.id, pinned: !s.pinned }); toast(s.pinned ? '已取消置顶' : '已置顶'); }
function openSessActions(s) {
  state.sessTarget = s;
  $('sessTitle').textContent = s.title || '会话';
  $('sessPin').textContent = s.pinned ? '取消置顶' : '置顶';
  openScrim('sessScrim');
}
function assignSelectedToFolder(folder) {
  if (!state.selected.size || !folder) return;
  wsend({ type: 'assign_many', ids: [...state.selected], folder });
  toast('已加入「' + folder + '」（' + state.selected.size + '）');
  exitSelect();
}
// batch: add the multi-selected conversations to a folder (they get pinned by default)
function openFolderPickerBatch() {
  if (!state.selected.size) return;
  const list = $('folderList'); list.innerHTML = '';
  (state.folders || []).forEach((f) => {
    const o = el('button', 'opt'); o.innerHTML = `<div>${esc(f)}</div>`;
    o.addEventListener('click', () => { closeScrim('folderScrim'); assignSelectedToFolder(f); });
    list.appendChild(o);
  });
  const nf = el('button', 'opt'); nf.innerHTML = '<div style="color:var(--accent)">＋ 新建文件夹</div>';
  nf.addEventListener('click', () => {
    closeScrim('folderScrim');
    openPrompt('新建文件夹', '', (name) => { if (name) { wsend({ type: 'create_folder', name }); assignSelectedToFolder(name); } });
  });
  list.appendChild(nf);
  openScrim('folderScrim');
}
function openFolderPicker(s) {
  const list = $('folderList'); list.innerHTML = '';
  (state.folders || []).forEach((f) => {
    const o = el('button', 'opt' + (s.folder === f ? ' on' : ''));
    o.innerHTML = `<div>${esc(f)}</div><span class="check">✓</span>`;
    o.addEventListener('click', () => { wsend({ type: 'assign_folder', sessionId: s.id, folder: f }); closeScrim('folderScrim'); });
    list.appendChild(o);
  });
  if (s.folder) {
    const o = el('button', 'opt'); o.innerHTML = '<div>移出文件夹</div>';
    o.addEventListener('click', () => { wsend({ type: 'assign_folder', sessionId: s.id, folder: '' }); closeScrim('folderScrim'); });
    list.appendChild(o);
  }
  const nf = el('button', 'opt'); nf.innerHTML = '<div style="color:var(--accent)">＋ 新建文件夹</div>';
  nf.addEventListener('click', () => {
    closeScrim('folderScrim');
    openPrompt('新建文件夹', '', (name) => { if (name) { wsend({ type: 'create_folder', name }); wsend({ type: 'assign_folder', sessionId: s.id, folder: name }); } });
  });
  list.appendChild(nf);
  openScrim('folderScrim');
}

/* ============ chat rendering ============ */
// 渲染落点：默认写进 #thread；prepend 旧消息时临时切到一个 fragment（见 prependWindow），所以渲染函数用 rt() 取落点。
let RT = null;
function rt() { return RT || $('thread'); }
function clearThread() { if (searchOpen()) closeSearch(); stopStatus(); $('thread').innerHTML = ''; state.live = null; state.turnTools = []; state.toolRow = null; }
// 正圈着字（选区落在消息流里）就不许自动滚——选区被拽飞根本没法复制
function threadSelActive() {
  const s = window.getSelection();
  if (!s || s.isCollapsed || !s.rangeCount) return false;
  const n = s.anchorNode, e0 = n && (n.nodeType === 1 ? n : n.parentElement);
  return !!(e0 && e0.closest && e0.closest('#thread'));
}
// 贴底只在「本来就贴着底」时维持（threadStick 由滚动监听维护，翻上去=false）；
// force=用户自己的动作（发送/进对话）才强制回底
function scrollThread(force) {
  if (RT) return; // prepend 期间(RT 非空)不滚
  if (!force && (state.threadStick === false || threadSelActive())) return;
  const t = $('thread'); t.scrollTop = t.scrollHeight; state.threadStick = true;
}
function scrollThreadAuto() { if (P('autoScroll')) scrollThread(); }
function addUser(text, uuid, images) {
  const m = el('div', 'msg user'); const b = el('div', 'bubble');
  if (images && images.length) {
    const ig = el('div', 'bubimgs');
    images.forEach((p) => {
      const im = el('img'); im.src = fullUrl(p.url) || ('data:' + p.media_type + ';base64,' + p.data);
      im.addEventListener('click', (e) => { e.stopPropagation(); openLightbox(im.src); });
      ig.appendChild(im);
    });
    b.appendChild(ig);
  }
  if (text) { const tx = el('div'); tx.textContent = text; b.appendChild(tx); }
  m.appendChild(b);
  bindUserBubble(b, uuid || null, text);
  rt().appendChild(m); scrollThread(true);
  return b;
}
// 自己的气泡：轻点=编辑重发（有 uuid 才行——现场发的先没有，turn 结束后 user_uuid 事件补上）；
// 长按=弹窗菜单。长按会撞安卓原生选词 → 用户气泡关掉原生选择（全文复制在菜单里）。
function bindUserBubble(b, uuid, text) {
  b._uuid = uuid; b._raw = text || '';
  if (b._ubound) return;
  b._ubound = true;
  b.classList.add('editable');
  b.addEventListener('click', () => { if (b._uuid) editMessage(b._uuid, b._raw); });
  bindHold(b, () => openMsgActions(b));
}
function openMsgActions(b) {
  state.msgTarget = b;
  $('msgEdit').style.display = b._uuid ? '' : 'none';
  openScrim('msgActScrim');
}
// 编辑重发＝「编辑中」模式（主流聊天 App 的编辑交互）：原文进输入框、输入框上方亮「编辑中」条，
// 发送=从那条消息 fork 重跑；✕ 或离开对话取消。
function editMessage(uuid, current) {
  if (!state.currentSession || !uuid) return;
  saveDraft(); // 输入框里已有的草稿先存好，编辑缓冲不覆盖它
  state.editTarget = uuid;
  $('editStrip').classList.add('show');
  const c = $('composer'); c.value = current || '';
  resizeComposer(); updateSend();
  c.focus();
}
function cancelEdit() {
  if (!state.editTarget) return;
  state.editTarget = null; $('editStrip').classList.remove('show');
  const d = state.drafts[state.draftKey]; // 退出编辑：把之前的草稿放回输入框
  const c = $('composer'); c.value = (d && d.text) || ''; resizeComposer(); updateSend();
}
function regenerate() {
  if (!state.currentSession) { toast('新会话无需重新生成'); return; }
  clearThread();
  const t = newLocalTurn({ expectFork: true, forkFrom: state.currentSession });
  wsend({ type: 'regenerate', sessionId: state.currentSession, mode: state.mode, turnId: t.id });
  toast('重新生成中…');
}
function ensureLive() { if (state.live) return state.live; const m = el('div', 'msg assistant'); const t = el('div', 'text cursor'); m.appendChild(t); $('thread').appendChild(m); state.live = t; return t; }
function appendDelta(text) { const t = ensureLive(); t.textContent += text; scrollThreadAuto(); }
function finalizeText(full) { const t = ensureLive(); t.classList.remove('cursor', 'text'); t.classList.add('md'); t.innerHTML = md(full); state.lastAsst = t.parentElement; state.live = null; scrollThreadAuto(); }
function finalizeLive() { if (state.live) { state.live.classList.remove('cursor'); state.live = null; } }
function addAssistantText(full) { const m = el('div', 'msg assistant'); const t = el('div', 'md'); t.innerHTML = md(full); m.appendChild(t); rt().appendChild(m); state.lastAsst = m; }
// ---- 注入显示（设置→对话→注入显示：剥离/透视/全显）----
// 透视：她的气泡下面挂一块灰字，列出这条消息实际带给模型的隐藏块（上）和注记（下）；回复下面挂被剥掉的 [mood] 行；
// 整条都是系统注入的消息（唤醒提示、压缩恢复块、静默回复…）当灰字块显示。全显：直接把原文塞进气泡。
function injBlock(title, text) {
  const d = el('div', 'inj collapsed');
  const h = el('div', 'inj-h'); h.textContent = title; d.appendChild(h);
  const b = el('div', 'inj-b'); b.textContent = text; d.appendChild(b);
  d.addEventListener('click', () => d.classList.toggle('collapsed'));
  return d;
}
function attachInj(userMsgEl, pre, post) {
  if (!userMsgEl || (!pre && !post)) return;
  if (P('viewMode') === 'strip') return;
  const old = userMsgEl.querySelector(':scope > .inj'); if (old) old.remove();
  const parts = []; if (pre) parts.push('▲ 上面\n' + pre); if (post) parts.push('▼ 下面\n' + post);
  userMsgEl.appendChild(injBlock('注入', parts.join('\n\n')));
}
function attachMoodLine(text) {
  if (!text || P('viewMode') === 'strip') return;
  const host = state.lastAsst || (state.live && state.live.parentElement); if (!host) return;
  const old = host.querySelector(':scope > .inj'); if (old) old.remove();
  host.appendChild(injBlock('剥掉的', text));
}
function addHidden(text, from) {
  const d = injBlock(from === 'assistant' ? '她的（隐藏）' : '系统', text || '');
  d.classList.add('inj-msg'); rt().appendChild(d);
}
function rerenderThread() {
  if (state.screen !== 'chat' || !state.hist || !state.hist.items) return;
  const t = $('thread'); const atBot = t.scrollTop + t.clientHeight >= t.scrollHeight - 60;
  clearThread(); appendWindow(state.hist.items); if (atBot) scrollThread(true);
}
// ---- 消息模板编辑页（设置→对话→编辑消息模板）----
function openMsgTemplate() { state.tplOpen = true; $('tplText').value = ''; $('tplPreview').textContent = '…'; wsend({ type: 'template_get' }); openScrim('tplScrim'); }
function onTemplate(m) {
  state.tplDef = m.def || ''; state.tplVars = m.vars || [];
  if (m.saved) { toast('消息模板已保存'); if (state.tplOpen && !$('tplScrim').classList.contains('show')) return; }
  if (!$('tplScrim').classList.contains('show')) return;
  if (!m.saved || $('tplText').value.trim() === '') $('tplText').value = m.text || '';
  const box = $('tplVars'); box.innerHTML = '';
  (m.vars || []).forEach(([k, desc]) => {
    const c = el('button', 'tplchip'); c.textContent = '{{' + k + '}}'; c.title = desc;
    const sub = el('span', 'tplchip-d'); sub.textContent = desc; c.appendChild(sub);
    c.addEventListener('click', () => { const ta = $('tplText'); const a = ta.selectionStart != null ? ta.selectionStart : ta.value.length, b = ta.selectionEnd != null ? ta.selectionEnd : a; ta.value = ta.value.slice(0, a) + '{{' + k + '}}' + ta.value.slice(b); ta.selectionStart = ta.selectionEnd = a + k.length + 4; ta.focus(); buzz(8); tplPreviewSoon(); });
    box.appendChild(c);
  });
  tplPreviewSoon();
}
function tplPreviewSoon() { clearTimeout(state._tplT); state._tplT = setTimeout(() => wsend({ type: 'template_preview', text: $('tplText').value, sessionId: state.currentSession || LS.lastSid || '' }), 350); }
function renderTplPreview(m) {
  const box = $('tplPreview'); box.innerHTML = '';
  const seg = (cls, label, text) => { const d = el('div', 'tplp ' + cls); const h = el('div', 'tplp-h'); h.textContent = label; d.appendChild(h); const b = el('div', 'tplp-b'); b.textContent = text; d.appendChild(b); box.appendChild(d); };
  if (m.pre) seg('pre', '上面（隐藏块）', m.pre);
  seg('msg', '你的话', '你好啊');
  if (m.post) seg('post', '下面（注记）', m.post);
  if (!m.pre && !m.post) seg('none', '', '（什么都不带，只有你的话）');
}
function addThinking(text) { finalizeLive(); const d = el('div', 'thinking collapsed'); const inner = el('div', 'md'); inner.innerHTML = md(text); d.appendChild(inner); d.addEventListener('click', () => d.classList.toggle('collapsed')); rt().appendChild(d); scrollThreadAuto(); }

/* ---- animated "thinking" status line, Claude Code style ---- */
const SL_FRAMES = ['·', '✢', '✳', '∗', '✻', '✽', '✻', '∗', '✳', '✢'];
const SL_WORDS = ['Thinking', 'Pondering', 'Cogitating', 'Musing', 'Ruminating', 'Noodling',
  'Percolating', 'Simmering', 'Brewing', 'Churning', 'Conjuring', 'Crafting', 'Deliberating',
  'Computing', 'Synthesizing', 'Mulling', 'Marinating', 'Working', 'Forging', 'Hatching',
  'Reticulating', 'Vibing', 'Honking', 'Schlepping', 'Spinning', 'Manifesting', 'Cooking'];
function slWord() { return SL_WORDS[(Math.random() * SL_WORDS.length) | 0]; }
function mkStatusline() {
  const sl = el('div', 'statusline'); sl.id = 'statusline';
  sl.innerHTML = '<span class="sl-glyph">✻</span><span class="sl-word"></span><span class="sl-meta"></span>';
  $('thread').appendChild(sl);
  return sl;
}
function startStatus() {
  if (state.statusTimer) return;
  state.statusStart = Date.now();
  state.statusWord = slWord();
  state.statusFrame = 0;
  state.statusNextWord = 2500 + Math.random() * 2500;
  if (!document.getElementById('statusline')) mkStatusline();
  scrollThread();
  state.statusTimer = setInterval(() => {
    // 历史渲染会整个重画 thread（进入还在跑的对话时）——转圈被抹掉就重建
    const s = document.getElementById('statusline') || mkStatusline();
    if (s !== $('thread').lastChild) $('thread').appendChild(s);
    state.statusFrame = (state.statusFrame + 1) % SL_FRAMES.length;
    const elapsed = Date.now() - state.statusStart;
    if (elapsed > state.statusNextWord) { state.statusWord = slWord(); state.statusNextWord = elapsed + 2500 + Math.random() * 2500; }
    s.querySelector('.sl-glyph').textContent = SL_FRAMES[state.statusFrame];
    s.querySelector('.sl-word').textContent = state.statusWord + '…';
    s.querySelector('.sl-meta').textContent = '(' + Math.floor(elapsed / 1000) + 's)';
  }, 420);
}
function stopStatus() {
  if (state.statusTimer) { clearInterval(state.statusTimer); state.statusTimer = null; }
  const s = document.getElementById('statusline'); if (s) s.remove();
}
function fullUrl(u) { return (u && u[0] === '/') ? (state.origin + u) : u; }
function addMedia(kind, url) {
  finalizeLive();
  const src = fullUrl(url);
  const m = el('div', 'msg assistant');
  if (kind === 'audio') {
    const a = document.createElement('audio'); a.controls = true; a.src = src; a.preload = 'metadata';
    m.appendChild(a);
  } else {
    const img = el('img', 'chatmedia'); img.src = src; img.loading = 'lazy';
    img.addEventListener('click', () => openLightbox(src));
    m.appendChild(img);
  }
  rt().appendChild(m); scrollThreadAuto();
}
function closeLightbox() { document.querySelectorAll('.lightbox').forEach((l) => l.remove()); syncAtRoot(); }
function openLightbox(src) {
  const lb = el('div', 'lightbox'); const im = el('img'); im.src = src; lb.appendChild(im);
  lb.addEventListener('click', closeLightbox);
  document.body.appendChild(lb);
  syncAtRoot(); // not-at-root now, so hardware back closes the image instead of quitting the app
}

/* tool group: one collapsible row per turn, opens a sheet */
function ensureToolRow() {
  if (state.toolRow) return state.toolRow;
  finalizeLive();
  const row = el('div', 'toolrow');
  row.innerHTML = '<span class="tr-text">正在使用工具…</span><span class="chev3">›</span>';
  const tools = state.turnTools; // stable reference for this turn
  row.addEventListener('click', () => openToolsSheet(tools));
  $('thread').appendChild(row); state.toolRow = row; return row;
}
function updateToolRow() {
  if (!state.toolRow) return;
  const n = state.turnTools.length, cmds = state.turnTools.filter((t) => t.name === 'Bash').length;
  state.toolRow.querySelector('.tr-text').textContent = viewBusy() ? `正在使用工具…（${n}）` : `Used ${n} tools, ran ${cmds} commands`;
}
function addTool(m) { ensureToolRow(); state.turnTools.push({ id: m.id, name: m.name, input: m.input, isError: null }); updateToolRow(); scrollThreadAuto(); }
function updateTool(m) { const t = state.turnTools.find((x) => x.id === m.id); if (t) { t.isError = m.isError; t.content = m.content; } }
function addError(msg) { const d = el('div', 'msg assistant'); const t = el('div', 'md'); t.style.color = 'var(--err)'; t.textContent = '⚠ ' + msg; d.appendChild(t); $('thread').appendChild(d); scrollThread(); }
function fmtTok(n) { n = n || 0; if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'; return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n); }
function endTurn(m, tr, trVis) {
  markDone(tr);
  if (!trVis) { // 后台对话跑完：轻提示 + 刷列表（正文已落历史，进对话即见）
    if (tr && tr.spoke && !tr.rolledBack && !tr.interrupted && !tr.errored && !m.isError) {
      toast('「' + sessTitle(tr.sessionId) + '」回复好了'); if (P('genHaptic')) buzz(14);
    }
    if (state.screen === 'list') renderSessions();
    updateSend(); wsend({ type: 'list_sessions' });
    return;
  }
  // 这条 turn 已被「思考阶段打断」回退过：吞掉它迟到的收尾，别再震动/出统计
  if (tr && tr.rolledBack) { stopStatus(); updateSend(); return; }
  stopStatus(); finalizeLive(); if (tr) tr.forkFrom = null; updateToolRow(); updateSend();
  if (P('genHaptic')) buzz(18);
  if (m.isError) addError(typeof m.result === 'string' && m.result.trim() ? m.result : '本轮出错了（可重试或换个说法）');
  // stats line under the last message: ↑ context fill/window (%) · ↓ output · tok/s · time
  if (P('showTokens') && (m.ctxTokens || m.outTokens)) {
    const parts = [];
    if (m.ctxTokens) {
      let ctx = '↑ ' + fmtTok(m.ctxTokens);
      if (m.ctxWindow) ctx += '/' + fmtTok(m.ctxWindow) + '（' + Math.round((m.ctxTokens / m.ctxWindow) * 100) + '%）';
      parts.push(ctx);
    }
    if (m.outTokens) parts.push('↓ ' + fmtTok(m.outTokens));
    const secs = (m.apiMs || m.durationMs || 0) / 1000;
    if (secs > 0 && m.outTokens) parts.push((m.outTokens / secs).toFixed(1) + ' tok/s');
    if (m.durationMs) parts.push((m.durationMs / 1000).toFixed(1) + 's');
    const info = el('div', 'turninfo'); info.textContent = parts.join('  ·  ');
    $('thread').appendChild(info);
  }
  scrollThreadAuto();
  wsend({ type: 'list_sessions' });
  if (tr && tr.expectFork) {
    tr.expectFork = false;
    const sid = state.currentSession;
    // fork 刚收尾时 jsonl 可能还没写全（真踩过：history 只回用户消息 total=1，把现场已渲染的回复整个刷没）
    // → 缓 1 秒再拉，且期间没切走才渲染
    setTimeout(() => { if (state.currentSession === sid) wsend({ type: 'history_window', sessionId: sid, limit: 60 }); }, 1000);
  }
}

function toolArgSummary(name, input) {
  if (!input) return '';
  if (name === 'Bash') return input.command || input.description || '';
  return Object.keys(input).join(', ');
}
// level 1: list of tools (name + dim args); tap a tool -> level 2 detail
function openToolsSheet(tools) {
  state.toolsList = tools; state.toolsLevel = 1;
  renderToolsLevel1();
  openScrim('toolsScrim');
}
function renderToolsLevel1() {
  state.toolsLevel = 1;
  const tools = state.toolsList || [];
  $('toolsLeft').style.visibility = 'hidden'; $('toolsLeft').textContent = '';
  $('toolsTitle').textContent = `Used ${tools.length} tools, ran ${tools.filter((t) => t.name === 'Bash').length} commands`;
  $('toolsSub').textContent = '';
  const body = $('toolsBody'); body.innerHTML = '';
  const list = el('div', 'toollist');
  tools.forEach((t) => {
    const r = el('div', 'trow' + (t.isError ? ' err' : ''));
    const head = el('div', 'trhead');
    const ic = el('div', 'ti'); ic.innerHTML = toolIconSvg(t.name);
    const nm = el('div', 'tn'); nm.textContent = t.name;
    const ar = el('div', 'ta'); ar.textContent = toolArgSummary(t.name, t.input);
    const cv = el('div', 'chev3'); cv.textContent = '›';
    head.appendChild(ic); head.appendChild(nm); if (ar.textContent) head.appendChild(ar); head.appendChild(cv);
    head.addEventListener('click', () => showToolDetail(t));
    r.appendChild(head); list.appendChild(r);
  });
  body.appendChild(list);
}
function showToolDetail(t) {
  state.toolsLevel = 2;
  $('toolsLeft').style.visibility = 'visible'; $('toolsLeft').textContent = '‹';
  $('toolsTitle').textContent = t.name;
  $('toolsSub').textContent = t.isError ? '失败' : '完成';
  const body = $('toolsBody'); body.innerHTML = '';
  const isBash = t.name === 'Bash';
  const inLabel = isBash ? 'Command' : '输入';
  const inText = isBash ? (t.input && t.input.command) || '' : (() => { try { return JSON.stringify(t.input, null, 2); } catch (e) { return String(t.input); } })();
  const outText = (t.content && String(t.content)) || '（无输出）';
  body.appendChild(detailSection(inLabel, inText));
  body.appendChild(detailSection(isBash ? 'Output' : '结果', outText));
}
function detailSection(label, text) {
  const wrap = el('div', 'tsection');
  const lb = el('div', 'tslabel'); lb.textContent = label;
  const bx = el('div', 'tsbox'); bx.textContent = text;
  wrap.appendChild(lb); wrap.appendChild(bx); return wrap;
}
function toolsLeftAction() {
  if (state.toolsLevel === 2) renderToolsLevel1();
  else closeScrim('toolsScrim');
}

/* ============ open / new / history ============ */
/* 心情→颜色：色相=情绪类别、深浅=强度k(0..1)。词典包含匹配、先具体后泛化；未识别=中性米灰（颜色即含义，选择器chip带字当图例） */
const MOOD_CATS = [
  { key: '低落', hue: 215, re: /绝望|痛苦|崩溃/, k: 0.9 },
  { key: '开心', hue: 48, re: /雀跃|兴奋|狂喜/, k: 0.8 },
  { key: '平静', hue: 160, re: /平静|安宁|安稳|淡然|平和|宁静|踏实|安心|放松/, k: 0.35 },
  { key: '开心', hue: 48, re: /开心|快乐|愉快|轻松|明朗|满足|甜|幸福|欢喜|喜/, k: 0.55 },
  { key: '想念', hue: 330, re: /想念|惦记|温暖|期待|柔软|依恋|温柔|心动/, k: 0.5 },
  { key: '害羞', hue: 305, re: /害羞|羞涩|脸红|不好意思|难为情|害臊/, k: 0.5 },
  { key: '惆怅', hue: 280, re: /惆怅|怅然|淡淡|微凉|怀念|感伤|怔忡|空落/, k: 0.45 },
  { key: '低落', hue: 215, re: /低落|难过|失落|沮丧|委屈|孤独|寂寞|疲惫|累|困倦|乏|哭/, k: 0.55 },
  { key: '不安', hue: 35, re: /不安|忐忑|担心|焦虑|紧张|害怕|慌|忧/, k: 0.6 },
  { key: '烦躁', hue: 20, re: /烦躁|烦|郁闷|不爽|别扭|闷|急/, k: 0.6 },
  { key: '生气', hue: 357, re: /生气|愤怒|气炸|暴躁|恼/, k: 0.75 },
];
function moodCat(word) { const w = String(word || '').trim(); if (!w) return null; for (const c of MOOD_CATS) if (c.re.test(w)) return c; return null; }
function moodK01(v) { return Math.max(0, Math.min(1, +v || 0)); }
// 实色（色点/选择器chip）
function moodTint(word, k) {
  const c = moodCat(word); const kk = moodK01(k != null ? k : (c ? c.k : 0.4));
  if (!c) return 'hsl(45, 8%, ' + Math.round(72 - 14 * kk) + '%)';
  return 'hsl(' + c.hue + ', ' + Math.round(40 + 30 * kk) + '%, ' + Math.round(76 - 24 * kk) + '%)';
}
// 浅印（日记卡/日历格底色）：同色相近白，k 只轻微加深
function moodWash(word, k) {
  const c = moodCat(word); const kk = moodK01(k != null ? k : (c ? c.k : 0.4));
  if (!c) return 'hsl(45, 12%, ' + Math.round(94 - 5 * kk) + '%)';
  return 'hsl(' + c.hue + ', ' + Math.round(45 + 15 * kk) + '%, ' + Math.round(93 - 10 * kk) + '%)';
}
function updateHeader() {
  $('chatTitle').textContent = state.currentSession ? (state.curTitle || 'Claude Code') : '新会话';
  const md = state.mood, hasMood = !!(md && md.on && md.label);
  if (state.currentSession && (P('showModel') || hasMood)) {
    // 有心情就让它独占这行：隐藏模型名腾出全宽 + 允许换行，省得长情绪被省略号截断；没心情才显模型名
    const html = hasMood
      ? '<span class="mood-dot" style="background:' + moodTint(md.label) + '"></span><span class="mood-lab">' + esc(md.label) + '</span>'
      : esc(state.sessionModel || 'Claude');
    $('chatSub').innerHTML = html;
    $('chatSub').classList.toggle('mood', hasMood);
    $('chatSub').classList.remove('expanded');   // 每次刷新先收起，点一下才展开看全
    $('chatSub').style.display = 'block';
  } else $('chatSub').style.display = 'none';
  // dir chip only matters for a brand-new session (where you can still choose the dir)
  $('dirChip').style.display = state.currentSession ? 'none' : 'inline-flex';
  $('dirChipLabel').textContent = shortCwd(state.cwd || state.defaultCwd);
  updateTitleTyping(); // 设了 textContent 会清掉省略号，重新贴一次
}
function applyMode() {
  const md = MODES.find((x) => x.id === state.mode) || MODES[0];
  $('modeLabel').textContent = md.name;
  const chip = $('modeChip'); chip.classList.remove('plan', 'auto', 'bypass');
  if (state.mode === 'plan') chip.classList.add('plan');
  else if (state.mode === 'acceptEdits') chip.classList.add('auto');
  else if (state.mode === 'bypass') chip.classList.add('bypass');
}
// 启动后第一份会话列表到手时，若开了「自动进入上个对话」且还停在列表屏，直接打开缓存里的那个对话。只跑一次/启动。
function maybeAutoOpen() {
  if (state._autoOpened) return;
  state._autoOpened = true;
  if (!P('autoOpenLast') || state.screen !== 'list') return;
  const sid = LS.lastSid; if (!sid) return;
  const s = (state.sessions || []).find((x) => x.id === sid);
  if (s) openSession(s);
}
/* ---- 本地历史缓存（IndexedDB）：大对话秒开 + 离线翻看；任一环出错都当没缓存、退回全量 ---- */
let _idbP = null;
function idbDB() {
  if (_idbP) return _idbP;
  _idbP = new Promise((res) => {
    try {
      const rq = indexedDB.open('telos', 1);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore('hist'); } catch (e) {} };
      rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
  return _idbP;
}
function idbGet(key) {
  return idbDB().then((db) => db && new Promise((res) => {
    try { const r = db.transaction('hist', 'readonly').objectStore('hist').get(key); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }
    catch (e) { res(null); }
  })).catch(() => null);
}
function idbPut(key, val) {
  return idbDB().then((db) => { if (db) try { db.transaction('hist', 'readwrite').objectStore('hist').put(val, key); } catch (e) {} }).catch(() => {});
}
// ---- 全量历史本地化（近期+按需）：后台悄悄把最近一批对话预缓存到本地，其余打开时缓存；都永久留存、可离线翻、版本号增量更新 ----
const PREFETCH_RECENT = 24;   // 后台预缓存最近这么多个对话；更旧的等你打开时再缓存
function prefetchSeed(sessions) {
  if (!Array.isArray(sessions) || !sessions.length) return;
  state.pfQueue = sessions.slice(0, PREFETCH_RECENT).map((s) => s.id).filter(Boolean); // 列表已按最近活跃排序
  clearTimeout(state.pfStart); state.pfStart = setTimeout(prefetchKick, 3000); // 延后起跑：先让你打开对话，别让后台预缓存抢着把 bridge 卡住
}
function prefetchKick() {
  if (state.pfBusy) return;
  if (document.visibilityState !== 'visible') return;   // 后台/冻结就暂停，回前台再续
  const q = state.pfQueue || [];
  let id; while ((id = q.shift())) { if (id !== state.currentSession) break; }  // 跳过正打开的（openSession 自己会取）
  if (!id) return;
  state.pfBusy = true;
  idbGet('win2:' + id).then((c) => {
    if (!wsend({ type: 'history_window', sessionId: id, prefetch: true, knownVer: (c && c.ver) || null })) { state.pfBusy = false; q.unshift(id); } // 没连上：放回队首，等回连/可见再续
  }).catch(() => { state.pfBusy = false; });
}
function onPrefetchHistory(m) {
  state.pfBusy = false;
  if (!m.unchanged && m.sessionId && m.items) idbPut('h:' + m.sessionId, { ver: m.ver, items: m.items, cwd: m.cwd, title: m.title, pref: m.pref, lastModel: m.lastModel, mood: m.mood });
  setTimeout(prefetchKick, 200);   // 串行 + 间隔，别一次性把带宽/服务器打满
}
function openSession(s) {
  LS.lastSid = s.id; // 客户端缓存「上一个打开的对话」，供「进入应用自动进入上个对话」用（服务端按最新回复会乱，故存本地）
  const lt = liveTurnFor(s.id);
  // re-entering the session whose turn is still running & still on screen → keep the live view (message +
  // spinner + partial reply); don't clobber it with stale history that lacks the in-flight turn
  if (state.currentSession === s.id && lt && state.viewTurnId === lt.id) { show('chat'); return; }
  saveDraft(); // 上一个对话的输入框内容各归各家
  state.currentSession = s.id; state.cwd = s.cwd || ''; state.curTitle = s.title; state.sessionModel = 'Claude'; state.lastModel = ''; state.mood = null;
  // 这个对话有 turn 还在跑（从别的对话切回来）：接上直播——历史打底、转圈接续，
  // 中间漏掉的流靠收尾的全文替换补齐；现场气泡已不在，回退/编辑锚点作废
  state.viewTurnId = lt ? lt.id : null;
  if (lt) lt.userMsgEl = null;
  // 模型/effort 是每对话一份的（服务端 sessmodel.json）：先拿全局默认占位，等 history 带回这个对话
  // 记住的 pref 再切过去；占位期间 modelMine=false → presence 不带 model，不会盖掉服务端那份。
  // [1m] 这类运行时变体也存在 pref 里，重开对话不会掉回 200K 底座被自动 compact。
  state.model = LS.model; state.effort = LS.effort; state.modelMine = false; state.mode = LS.mode; applyMode();
  clearThread(); loadDraft(s.id); updateHeader(); show('chat'); removeSuggestions();
  if (lt) startStatus(); // 还在跑：转圈接上（statusline 自己会待在最底部）
  // 历史走「全量存档·分段窗口」：先秒显缓存的末尾窗，再带 ver 同步（没变→unchanged 秒回）。上滑到顶自动补旧段（含压缩前）。
  state.hist = null;
  const findReq = (state.pendingFind && state.pendingFind.sid === s.id) ? state.pendingFind : null;
  state.pendingFind = null;
  if (findReq) { // 搜索定位：直接拉命中那段窗（不读末尾缓存，免先闪到底再跳）
    state.pendingHistory = wsend({ type: 'history_find', sessionId: s.id, needle: findReq.needle, limit: 80 }) ? null : s.id;
  } else if (lt) {
    // 对话还在直播：跳过「缓存秒显+增量 append」——append 会把补出来的历史压到直播气泡下面（真踩过），
    // 直接拉一次全量末尾窗打底，后续增量流接着往下画
    state.pendingHistory = wsend({ type: 'history_window', sessionId: s.id, limit: 60 }) ? null : s.id;
  } else {
    idbGet('win2:' + s.id).then((cached) => {
      if (state.currentSession !== s.id) return;
      if (cached && cached.items) {
        state.hist = { sid: s.id, top: cached.top || 0, bottom: (cached.top || 0) + cached.items.length, total: cached.total || cached.items.length, atTop: !!cached.atTop, atBottom: true, ver: cached.ver || null, loading: false, local: null, items: cached.items.slice() };
        try { renderInitWindow({ ...cached, sessionId: s.id }, false, true); refreshHistInd(); } catch (e) {} // tentative：模型先临时套缓存值、等服务端权威覆盖
      }
    }).catch(() => {}).then(() => {
      if (state.currentSession !== s.id) return;
      const h = state.hist;
      // 带上缓存的 ver + 段总数/段起点：服务端据此只回新增那几条（小 payload），不重传整段
      state.pendingHistory = wsend({ type: 'history_window', sessionId: s.id, knownVer: (h && h.ver) || null, knownTotal: h ? h.total : undefined, knownTop: h ? h.top : undefined }) ? null : s.id;
    });
  }
  wsend({ type: 'cinema_get', sessionId: s.id }); // 知道这个对话在不在守夜（列表行「时间流动中」+ 标题旁「输入中」）
  state.stickyPopupFor = s.id;
  state.pendingSticky = wsend({ type: 'sticky_get', sessionId: s.id }) ? null : s.id; // show 小纸条 popup if any unread
}
function newSession() {
  saveDraft();
  state.currentSession = null; state.cwd = LS.cwd || state.defaultCwd; state.curTitle = ''; state.sessionModel = 'Claude'; state.lastModel = '';
  state.model = LS.model; state.effort = LS.effort; state.modelMine = true; state.mode = LS.mode; applyMode(); // 新对话从全局默认起步，这份就算它自己的选择
  state.viewTurnId = null;
  clearThread(); loadDraft('~new'); updateHeader(); show('chat'); showSuggestions();
  setTimeout(() => $('composer').focus(), 80);
}
function goList() { if (P('interruptOnLeave') && viewBusy()) wsend({ type: 'interrupt', turnId: state.viewTurnId }); show('list'); wsend({ type: 'list_sessions' }); }
function renderHistory(m) {
  if (m.unchanged) { if (m.sessionId === state.currentSession) { scrollThread(true); tryPendingJump(); } return; }   // 文件没变：缓存即最新、已渲染，不重渲
  if (m.sessionId && m.sessionId !== state.currentSession) return; // 迟到的历史别画进别的对话
  clearThread(); removeSuggestions();
  if (m.cwd) { state.cwd = m.cwd; } if (m.title) state.curTitle = m.title; updateHeader();
  // 切到这个对话记住的模型/effort（没记过就是 ''=默认）；用户手快已经先选了的话（modelMine）不抢
  if (m.sessionId === state.currentSession && !state.modelMine) {
    const p = m.pref || {};
    state.model = p.model || ''; state.effort = p.effort || ''; state.modelMine = true;
  }
  if (m.sessionId === state.currentSession) { state.lastModel = m.lastModel || ''; syncModelSub(); state.mood = m.mood || null; updateHeader(); }
  renderItems(m.items);
  scrollThread(true);
  tryPendingJump();   // 搜索结果点进来的 → 滚到命中那条
  // bridge 全量历史 → 存本地缓存供下次秒开（缓存自身渲染时 _cache=true，跳过避免回写）
  if (!m._cache && m.sessionId && m.items) idbPut('h:' + m.sessionId, { ver: m.ver, items: m.items, cwd: m.cwd, title: m.title, pref: m.pref, lastModel: m.lastModel, mood: m.mood });
}
// 把一批 items 渲染进当前落点 rt()（默认 #thread；prepend 时是 fragment）。含压缩分隔线。
function renderItems(items) {
  let group = null, userB = null; // userB: 最近的用户气泡——它的附图回填成气泡内缩略图，而不是 cc 侧大图
  (items || []).forEach((it) => {
    if (it.kind === 'compact') { group = null; userB = null; const d = el('div', 'hist-compact'); d.innerHTML = '<span>压缩</span>'; rt().appendChild(d); return; }
    if (it.kind === 'text') {
      group = null;
      const vm = P('viewMode');
      if (it.role === 'user') {
        userB = addUser(vm === 'full' && it.raw ? it.raw : it.text, it.uuid);
        if (vm === 'xray' && it.inj) attachInj(userB.parentElement, it.inj.pre, it.inj.post);
      } else {
        userB = null; addAssistantText(vm === 'full' && it.raw ? it.raw : it.text);
        if (vm === 'xray' && it.moodLine) attachMoodLine(it.moodLine);
      }
    }
    else if (it.kind === 'hidden') { group = null; userB = null; if (P('viewMode') !== 'strip') addHidden(it.text, it.from); }
    else if (it.kind === 'media') {
      group = null;
      if (it.role === 'user' && it.mediaKind === 'image') {
        if (!userB) userB = addUser('', null, []);
        let ig = userB.querySelector('.bubimgs');
        if (!ig) { ig = el('div', 'bubimgs'); userB.insertBefore(ig, userB.firstChild); }
        const im = el('img'); im.src = fullUrl(it.url);
        im.addEventListener('click', (e) => { e.stopPropagation(); openLightbox(im.src); });
        ig.appendChild(im);
      } else { userB = null; addMedia(it.mediaKind, it.url); }
    }
    else if (it.kind === 'thinking') { group = null; userB = null; addThinking(it.text); }
    else if (it.kind === 'tool_use') {
      userB = null;
      if (!group) {
        const g = { tools: [], row: el('div', 'toolrow') };
        g.row.innerHTML = '<span class="tr-text"></span><span class="chev3">›</span>';
        g.row.addEventListener('click', () => openToolsSheet(g.tools)); // capture stable const
        rt().appendChild(g.row); group = g;
      }
      group.tools.push({ id: it.id, name: it.name, input: it.input, isError: false });
      group.row.querySelector('.tr-text').textContent = `Used ${group.tools.length} tools, ran ${group.tools.filter((t) => t.name === 'Bash').length} commands`;
    } else if (it.kind === 'tool_result') { if (group) { const t = group.tools.find((x) => x.id === it.id); if (t) { t.isError = it.isError; t.content = it.content; } } }
  });
}
// 全量存档·分段窗口引擎：openSession 用 history_window 取末尾窗渲染，上滑到顶/下滑到底分块补。
// state.hist = { sid, top, total, atTop, atBottom, ver, loading, local(全量缓存数组|null) }
function applyHistMeta(m, tentative) {
  if (m.sessionId !== state.currentSession) return;
  if (m.cwd) state.cwd = m.cwd; if (m.title) state.curTitle = m.title;
  // 模型/effort pref：缓存渲染先临时套上当显示、但**不锁 modelMine**；服务端响应(权威)才锁，
  // 这样过期缓存里的旧模型会被服务端的当前 pref 覆盖 → 修「重进对话模型变回普通」(1M 丢失)。
  if (!state.modelMine) { const p = m.pref || {}; state.model = p.model || ''; state.effort = p.effort || ''; if (!tentative) state.modelMine = true; }
  state.lastModel = m.lastModel || ''; state.mood = m.mood || null; syncModelSub(); updateHeader();
}
function prependWindow(items) {
  const t = $('thread'); const frag = document.createDocumentFragment();
  RT = frag; try { renderItems(items); } finally { RT = null; }
  const prevH = t.scrollHeight; t.insertBefore(frag, t.firstChild); t.scrollTop += t.scrollHeight - prevH; // 锚住位置，不跳
}
function appendWindow(items) { renderItems(items); bumpLiveToBottom(); } // 落点默认 thread
// 直播气泡/转圈永远保持在最底：历史增量 append 会落到它们后面（并发对话重进时真踩过）
function bumpLiveToBottom() {
  const th = $('thread');
  if (state.live) { const m = state.live.closest('.msg'); if (m && m.parentElement === th) th.appendChild(m); }
  const sl = document.getElementById('statusline'); if (sl && sl.parentElement === th) th.appendChild(sl);
}
function renderInitWindow(m, isFind, tentative) {
  clearThread(); removeSuggestions();
  applyHistMeta(m, tentative);
  appendWindow(m.items || []);
  if (!isFind) scrollThread(true);   // find：不滚到底，交给 tryPendingJump 滚到命中那条
}
const PRELOAD_ROUNDS = 60;      // 历史全文每段补这么多「轮」（一来一回）
const RT_ITEM_CAP = 400;        // 长独白段（守夜/电影模式连说很多条）兜底：一段最多这么多条，免一次拉爆
function roundStartBefore(items, anchor, n) { // 本地模式上滑：往回数 n 轮的起点（用户消息为一轮之首）
  let users = 0; const floor = Math.max(0, anchor - RT_ITEM_CAP);
  for (let i = anchor - 1; i >= floor; i--) { const it = items[i]; if (it && it.kind === 'text' && it.role === 'user') { if (++users >= n) return i; } }
  return floor;
}
function roundEndAfter(items, anchor, n) {
  let users = 0; const cap = Math.min(items.length, anchor + RT_ITEM_CAP);
  for (let i = anchor; i < cap; i++) { const it = items[i]; if (it && it.kind === 'text' && it.role === 'user') { if (++users > n) return i; } }
  return cap;
}
function loadMoreUp() {
  const h = state.hist; if (!h || h.atTop || h.loading) return;
  if (h.local) { // 已存全量到本地 → 直接按轮切片，秒滑、可离线
    const start = roundStartBefore(h.local, h.top, PRELOAD_ROUNDS); if (start >= h.top) { h.atTop = true; return; }
    const slice = h.local.slice(start, h.top); h.top = start; h.atTop = start === 0;
    prependWindow(slice); refreshHistInd(); return;
  }
  h.loading = true;
  if (!wsend({ type: 'history_window', sessionId: h.sid, dir: 'up', anchor: h.top, rounds: PRELOAD_ROUNDS })) h.loading = false;
}
function loadMoreDown() {
  const h = state.hist; if (!h || h.atBottom || h.loading) return;
  if (h.downGuard && Date.now() < h.downGuard) return; // find 跳转后短暂抑制：免 scrollIntoView 沉降把命中点到结尾一次性全拉下来
  if (h.local) {
    const end = roundEndAfter(h.local, h.bottom, PRELOAD_ROUNDS); if (end <= h.bottom) { h.atBottom = true; return; }
    const slice = h.local.slice(h.bottom, end); h.bottom = end; h.atBottom = end >= h.local.length;
    appendWindow(slice); return;
  }
  h.loading = true;
  if (!wsend({ type: 'history_window', sessionId: h.sid, dir: 'down', anchor: h.bottom, rounds: PRELOAD_ROUNDS })) h.loading = false;
}
function onHistoryWindow(m) {
  if (m.prefetch) { // 后台预缓存末尾窗（不渲染）
    if (!m.unchanged && m.sessionId && m.items) idbPut('win2:' + m.sessionId, { ver: m.ver, items: m.items, top: m.start, total: m.total, atTop: m.atTop, cwd: m.cwd, title: m.title, pref: m.pref, lastModel: m.lastModel, mood: m.mood });
    state.pfBusy = false; setTimeout(prefetchKick, 600); return; // 慢一点，给你的开会话让路
  }
  if (m.sessionId !== state.currentSession) return;
  const h = state.hist;
  if (m.unchanged) { // 末尾窗没变：缓存即最新、已渲染；但仍套一遍服务端权威 meta（模型 pref 等），覆盖过期缓存值
    if (h) { h.total = m.total; }
    applyHistMeta(m, false);
    scrollThread(true); tryPendingJump(); return;
  }
  if (m.dir === 'append') { // 服务端只回了「缓存之后新增的那几条」(小 payload) → 直接追加到底部，不重渲整段
    if (h && h.sid === m.sessionId && h.items) {
      const t = $('thread'); const atBot = t.scrollTop + t.clientHeight >= t.scrollHeight - 60;
      if (m.items && m.items.length) { appendWindow(m.items); if (atBot) scrollThread(); }
      h.items = h.items.concat(m.items || []); h.total = m.total; h.bottom = h.top + h.items.length; h.atBottom = true; h.ver = m.ver;
      applyHistMeta(m, false);
      idbPut('win2:' + m.sessionId, { ver: m.ver, items: h.items, top: h.top, total: m.total, atTop: h.atTop, cwd: m.cwd, title: m.title, pref: m.pref, lastModel: m.lastModel, mood: m.mood });
      idbGet('arc:' + m.sessionId).then((arc) => { if (arc && arc.ver === m.ver && state.hist && state.hist.sid === m.sessionId) { state.hist.local = arc.items; state.hist.total = arc.items.length; } refreshHistInd(); });
      refreshHistInd();
    }
    return;
  }
  if (m.dir === 'up') { if (!h) return; h.loading = false; h.top = m.start; h.atTop = m.atTop; prependWindow(m.items || []); refreshHistInd(); return; }
  if (m.dir === 'down') { if (!h) return; h.loading = false; h.bottom = m.end; h.atBottom = m.atBottom; appendWindow(m.items || []); refreshHistInd(); return; }
  // init / find：整窗渲染
  const isFind = m.dir === 'find';
  // 平滑增量：开会话时缓存已渲染同一段、只是尾部多了几条新消息 → **只追加新尾，不清屏重渲整段**
  //（修「先显示本地旧对话、卡一两秒再整段重刷」——本地秒显，新消息直接接到底部）。
  if (!isFind && h && h.sid === m.sessionId && m.start === h.top && m.total >= h.total && !h.local) {
    const rendered = Math.max(0, h.bottom - h.top);
    const tail = (m.items || []).slice(rendered);
    const t = $('thread'); const atBot = t.scrollTop + t.clientHeight >= t.scrollHeight - 60;
    if (tail.length) { appendWindow(tail); if (atBot) scrollThread(); }
    h.total = m.total; h.bottom = m.end; h.atTop = m.atTop; h.atBottom = m.atBottom; h.ver = m.ver; h.items = (m.items || []).slice();
    applyHistMeta(m, false);
    idbPut('win2:' + m.sessionId, { ver: m.ver, items: m.items, top: m.start, total: m.total, atTop: m.atTop, cwd: m.cwd, title: m.title, pref: m.pref, lastModel: m.lastModel, mood: m.mood });
    idbGet('arc:' + m.sessionId).then((arc) => { if (arc && arc.ver === m.ver && state.hist && state.hist.sid === m.sessionId) { state.hist.local = arc.items; state.hist.total = arc.items.length; } refreshHistInd(); });
    refreshHistInd(); return;
  }
  state.hist = { sid: m.sessionId, top: m.start, bottom: m.end, total: m.total, atTop: m.atTop, atBottom: m.atBottom, ver: m.ver, loading: false, local: null, items: isFind ? null : (m.items || []).slice() };
  if (isFind) state.hist.downGuard = Date.now() + 1000; // 跳转沉降期间不自动往下补
  renderInitWindow(m, isFind, false);   // 服务端权威 → 套准模型 pref（非 tentative）
  if (!isFind) idbPut('win2:' + m.sessionId, { ver: m.ver, items: m.items, top: m.start, total: m.total, atTop: m.atTop, cwd: m.cwd, title: m.title, pref: m.pref, lastModel: m.lastModel, mood: m.mood }); // 只缓存末尾窗，find 的中段窗不当首屏缓存
  tryPendingJump();   // find：滚到含 needle 那条；普通开会话 pendingJump 为空、无副作用
  // 进对话后若本地已存全量且 ver 一致 → 切到本地模式（上下滑秒切、离线可翻）
  idbGet('arc:' + m.sessionId).then((arc) => {
    if (arc && arc.ver === m.ver && state.hist && state.hist.sid === m.sessionId) { state.hist.local = arc.items; state.hist.total = arc.items.length; }
    refreshHistInd();
  });
  refreshHistInd();
}
// 「存全量到本地」：把整条全量转录拉下来缓存，之后上下滑走本地、可离线翻
function storeFullArchive() {
  const h = state.hist; if (!h || h.local || h.archiving) return;
  h.archiving = true; toast('正在存全量到本地…');
  if (!wsend({ type: 'history_full', sessionId: h.sid })) { h.archiving = false; toast('未连接'); }
}
function onHistoryFull(m) {
  if (!m.items) return;
  idbPut('arc:' + m.sessionId, { ver: m.ver, items: m.items });
  if (state.hist && state.hist.sid === m.sessionId) { state.hist.local = m.items; state.hist.total = m.items.length; state.hist.archiving = false; }
  toast('已存全量 · ' + (m.total || m.items.length) + ' 条');
  refreshHistInd();
}
// 缓存状态：回答「这条对话本地存了多少」（按「轮」）
function countRounds(items) { let n = 0; for (const it of (items || [])) if (it && it.kind === 'text' && it.role === 'user') n++; return n; }
function histArchInfo() {
  const h = state.hist; if (!h) return null;
  if (h.local) return { full: true, label: '已存全量 · ' + countRounds(h.local) + ' 轮' };
  return { full: false, label: '点此存全量到本地' };
}
function refreshHistInd() { const strip = $('usageStrip'); if (strip && strip.classList.contains('open')) renderUsageStrip(); }

/* ============ suggestions ============ */
const SUGGESTIONS = [
  { html: 'Create or update my <code>CLAUDE.md</code> file', text: '创建或更新我的 CLAUDE.md 文件' },
  { html: 'Search for a <code>TODO</code> comment and fix it', text: '找一个 TODO 注释并修复它' },
  { html: 'Recommend areas to improve our tests', text: '建议哪些地方可以改进测试' }
];
function showSuggestions() {
  removeSuggestions();
  const wrap = el('div', 'suggwrap'); wrap.id = 'suggwrap';
  const lbl = el('div', 'sugg-label'); lbl.textContent = 'Suggestions'; wrap.appendChild(lbl);
  SUGGESTIONS.forEach((s) => { const b = el('div', 'sugg'); b.innerHTML = s.html; b.addEventListener('click', () => { $('composer').value = s.text; resizeComposer(); updateSend(); $('composer').focus(); }); wrap.appendChild(b); });
  $('thread').appendChild(wrap);
}
function removeSuggestions() { const w = $('suggwrap'); if (w) w.remove(); }

/* ============ permission ============ */
function prettyInput(toolName, input) {
  if (!input) return '';
  if (toolName === 'Bash' && input.command) return input.command;
  if ((toolName === 'Write' || toolName === 'Edit') && input.file_path) {
    let s = input.file_path;
    if (input.content) s += '\n\n' + String(input.content).slice(0, 1500);
    if (input.old_string) s += '\n\n- ' + String(input.old_string).slice(0, 500) + '\n+ ' + String(input.new_string || '').slice(0, 500);
    return s;
  }
  try { return JSON.stringify(input, null, 2); } catch (e) { return String(input); }
}
function openPerm(m) {
  state.pendingPerm = { reqId: m.reqId };
  $('permTitle').textContent = m.title || (m.displayName ? `允许 ${m.displayName}？` : `允许使用 ${m.toolName}？`);
  $('permDesc').textContent = m.description || `Claude 想使用 ${m.toolName} 工具`;
  $('permDetail').textContent = prettyInput(m.toolName, m.input);
  $('permAlways').style.display = m.canAlways ? '' : 'none';
  openScrim('permScrim');
}
function answerPerm(allow, scope) { if (state.pendingPerm) wsend({ type: 'permission_response', reqId: state.pendingPerm.reqId, allow, scope }); state.pendingPerm = null; closeScrim('permScrim'); }
function closePerm(deny) { if (deny) answerPerm(false); else { state.pendingPerm = null; closeScrim('permScrim'); } }

/* ============ model sheet ============ */
function modelList() {
  // scanned list from the bridge if available, else the bundled fallback
  const scanned = state.availModels && state.availModels.length ? state.availModels : null;
  const def = { id: '', name: '默认（继承会话）', sub: state.modelDefault ? '当前 ' + (modelDisplay(state.modelDefault)) : '用会话/服务器当前模型' };
  if (scanned) return [def, ...scanned.map((m) => ({ id: m.id, name: m.name, ctx: m.ctx || 0, sub: m.effort ? '' : '不支持思考度', effort: m.effort }))];
  return MODELS;
}
function modelDisplay(id) {
  const L = state.availModels || [];
  const m = L.find((x) => x.id === id) || L.find((x) => x.id.startsWith(id + '-')); // 无日期别名（如 claude-haiku-4-5）→ 带日期的正式 id
  return m ? m.name : id;
}
// 标题下的模型小字：本对话选的 → 历史上实际跑的 → 服务器默认，开页就能看、不用先发一句话
function syncModelSub() {
  const id = state.model || state.lastModel || state.modelDefault || '';
  const base = id.replace('[1m]', '');
  state.sessionModel = base ? modelDisplay(base) + (base === id ? '' : ' 1M') : 'Claude';
  updateHeader();
}
// 模型按系列归组：claude-<family>-… → Fable/Opus/Sonnet/Haiku，其余归「其他」
function familyOf(id) { const m = /^claude-([a-z]+)/.exec(id || ''); return ({ fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' })[m ? m[1] : ''] || '其他'; }
function pickModel(id) { state.model = id; state.modelMine = true; if (state.currentSession) { sendPresence(); syncModelSub(); } else LS.model = id; openModelSheet(); }
// 电影模式「醒来用哪个模型」复用同一套系列分组选择器：只换「当前值/默认项文案/落点」，不显示思考度
function openCinModelSheet() {
  state.modelFam = '';
  state.modelCtx = {
    cur: () => (state.cin || {}).deliberateModel || '',
    defLabel: '跟随对话默认',
    onPick: (id) => { if (state.cin) state.cin.deliberateModel = id; cinSend({ deliberateModel: id }); openModelSheet(); },
  };
  openModelSheet();
}
function openModelSheet() {
  closeMenu();
  const ctx = state.modelCtx || null;
  const curModel = ctx ? ctx.cur() : state.model;
  const onPick = ctx ? ctx.onPick : pickModel;
  const mo = $('modelOpts'); mo.innerHTML = '';
  const list = modelList(); const hasDef = !!(list[0] && list[0].id === '');
  const def = ctx ? { id: '', name: ctx.defLabel, sub: '' } : (hasDef ? list[0] : { id: '', name: '默认（继承会话）', sub: '' });
  const models = hasDef ? list.slice(1) : list;
  const mkOpt = (x, checked) => { const o = el('button', 'opt' + (checked ? ' on' : '')); const tag = x && x.ctx >= 1000000 ? ' <span class="tag1m">1M</span>' : ''; o.innerHTML = `<div><div>${x.name}${tag}</div>${x && x.sub ? `<div class="osub">${x.sub}</div>` : ''}</div><span class="check">✓</span>`; return o; };
  const fam = state.modelFam || '';
  if (!fam) {
    const od = mkOpt(def, curModel === ''); od.addEventListener('click', () => onPick('')); mo.appendChild(od);
    const groups = {}; models.forEach((m) => { const f = familyOf(m.id); (groups[f] = groups[f] || []).push(m); });
    ['Fable', 'Opus', 'Sonnet', 'Haiku', '其他'].forEach((f) => {
      const g = groups[f]; if (!g) return;
      const sel = g.find((m) => m.id === curModel);
      const o = el('button', 'opt' + (sel ? ' on' : ''));
      const sub = sel ? modelDisplay(sel.id.replace('[1m]', '')) + (/\[1m\]$/.test(sel.id) ? ' 1M' : '') : g.length + ' 个';
      o.innerHTML = `<div><div>${f}</div><div class="osub">${sub}</div></div><span class="check chev">›</span>`;
      o.addEventListener('click', () => { state.modelFam = f; openModelSheet(); });
      mo.appendChild(o);
    });
  } else {
    const back = el('button', 'opt opt-back'); back.innerHTML = '<div>‹ 返回</div>'; back.addEventListener('click', () => { state.modelFam = ''; openModelSheet(); }); mo.appendChild(back);
    models.filter((m) => familyOf(m.id) === fam).forEach((x) => { const o = mkOpt(x, curModel === x.id); o.addEventListener('click', () => onPick(x.id)); mo.appendChild(o); });
  }
  const eb = $('effortOpts'); const t2 = eb.parentElement.querySelector('.sub2');
  if (ctx) { eb.innerHTML = ''; eb.style.display = 'none'; if (t2) t2.style.display = 'none'; }
  else renderEffortSlider();
  openScrim('modelScrim');
}
// 思考度：带刻度点的滑块（默认→low→medium→high→x-high→max）
function renderEffortSlider() {
  const box = $('effortOpts'); box.innerHTML = '';
  const chosen = (state.availModels || []).find((x) => x.id === state.model);
  const showEffort = !chosen || chosen.effort;
  const t2 = box.parentElement.querySelector('.sub2'); if (t2) t2.style.display = showEffort ? '' : 'none';
  box.style.display = showEffort ? '' : 'none'; if (!showEffort) return;
  let cur = EFFORTS.findIndex((e) => e.id === (state.effort || '')); if (cur < 0) cur = 0;
  const wrap = el('div', 'effslider');
  const val = el('div', 'eff-val'); val.textContent = EFFORTS[cur].name + (EFFORTS[cur].sub ? ' · ' + EFFORTS[cur].sub : ''); wrap.appendChild(val);
  const r = document.createElement('input'); r.type = 'range'; r.className = 'slider'; r.min = 0; r.max = EFFORTS.length - 1; r.step = 1; r.value = cur;
  r.addEventListener('input', () => { const e = EFFORTS[+r.value]; val.textContent = e.name + (e.sub ? ' · ' + e.sub : ''); });
  r.addEventListener('change', () => { const e = EFFORTS[+r.value].id; state.effort = e; state.modelMine = true; if (state.currentSession) sendPresence(); else LS.effort = e; });
  wrap.appendChild(r);
  const ticks = el('div', 'eff-ticks'); EFFORTS.forEach((e, i) => { const s = el('span', 'eff-tick' + (i === cur ? ' on' : '')); ticks.appendChild(s); }); wrap.appendChild(ticks);
  const ends = el('div', 'eff-ends'); ends.innerHTML = '<span>默认</span><span>max</span>'; wrap.appendChild(ends);
  box.appendChild(wrap);
}

/* ============ mode sheet ============ */
const MODES = [
  { id: 'code', name: 'Code', desc: '改文件、跑命令都先问你', icon: '<span class="micon code">&lt;/&gt;</span>' },
  { id: 'acceptEdits', name: 'Accept Edits', desc: '自动接受改文件，命令仍先问', icon: '<span class="micon auto">✓</span>' },
  { id: 'plan', name: 'Plan', desc: '先探索、给方案再动手', icon: '<span class="micon plan"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg></span>' },
  { id: 'bypass', name: 'Auto', desc: '全部自动执行，不再询问', icon: '<span class="micon bypass">⚡</span>' }
];
function openModeSheet() {
  const box = $('modeOpts'); box.innerHTML = '';
  MODES.forEach((md) => {
    const row = el('button', 'moderow');
    row.innerHTML = '<span class="mbody"><span class="mname">' + md.name + '</span><span class="mdesc">' + md.desc + '</span></span><span class="radio' + (state.mode === md.id ? ' on' : '') + '"></span>';
    row.addEventListener('click', () => setMode(md.id));
    box.appendChild(row);
  });
  openScrim('modeScrim');
}
function setMode(m) { state.mode = m; LS.mode = m; applyMode(); closeScrim('modeScrim'); }

/* ============ file manager (browse / attach / pick-cwd) ============ */
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)$/i;
function isImagePath(p) { return IMG_RE.test(p || ''); }
function mediaUrlC(path) { return state.origin + '/media?p=' + encodeURIComponent(path) + '&t=' + encodeURIComponent(LS.token); }
function fmtBytes(n) { n = n || 0; if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(0) + ' KB'; if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'; return (n / 1073741824).toFixed(2) + ' GB'; }
function fmtSpeed(bps) { return fmtBytes(bps) + '/s'; }

function openDirPicker() {
  if (state.currentSession) { toast('已有会话的目录不可改'); return; }
  state.dirMode = 'cwd'; state.dirPath = state.cwd || state.defaultCwd; state.filesReturn = state.screen;
  $('dirTitle').textContent = '选择工作目录'; $('dirPick').style.display = '';
  $('fmProgress').innerHTML = ''; wsend({ type: 'list_dirs', path: state.dirPath }); show('files');
}
function openFileManager(mode) {
  state.dirMode = mode; // 'attach' | 'browse'
  state.dirPath = state.cwd || state.defaultCwd; state.filesReturn = state.screen;
  $('dirTitle').textContent = mode === 'attach' ? '选择文件 · 附加' : '文件管理';
  $('dirPick').style.display = 'none';
  $('fmProgress').innerHTML = ''; wsend({ type: 'list_dirs', path: state.dirPath }); show('files');
}
function closeFiles() { if (state.fmSel) exitFmSel(); show(state.filesReturn || 'list'); }
function renderDirs(m) {
  state.dirPath = m.path; state._lastDirs = m; $('dirCurrent').textContent = m.path;
  const list = $('dirList'); list.innerHTML = '';
  // toolbar: upload + new folder (upload only in manager modes) + paste (剪贴板有东西时)
  const bar = el('div', 'dirtool');
  if (state.dirMode === 'attach' || state.dirMode === 'browse') {
    const up = el('button', 'btn btn-ghost'); up.textContent = '⬆ 上传到这里';
    up.addEventListener('click', () => $('fileUpMgr').click());
    bar.appendChild(up);
  }
  const nf = el('button', 'btn btn-ghost'); nf.textContent = '＋ 新建文件夹';
  nf.addEventListener('click', () => openPrompt('新建文件夹', '', (name) => { if (name) wsend({ type: 'mkdir', dir: state.dirPath, name }); }));
  bar.appendChild(nf);
  if (state.fmClip && state.fmClip.paths.length) {
    // 剪贴板有货 → 工具栏一个粘贴符号（点=贴到当前目录，长按=清空）
    const pc = el('button', 'pastebtn');
    pc.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>';
    pc.addEventListener('click', () => {
      const c = state.fmClip; if (!c) return;
      state.fmClip = null;
      wsend({ type: 'paths_op', op: c.op, paths: c.paths, dest: state.dirPath, dir: state.dirPath });
    });
    bindHold(pc, () => { state.fmClip = null; rerenderDirs(); toast('已清空剪贴板'); });
    bar.appendChild(pc);
  }
  list.appendChild(bar);
  if (m.parent && m.parent !== m.path) { const up = el('div', 'diritem up'); up.innerHTML = '<span class="ico">' + ICON.up + '</span>'; up.appendChild(document.createTextNode(' ..')); up.addEventListener('click', () => { if (!state.fmSel) wsend({ type: 'list_dirs', path: m.parent }); }); list.appendChild(up); }
  (m.dirs || []).forEach((d) => {
    const it = el('div', 'diritem'); it.innerHTML = '<span class="ico">' + ICON.folder + '</span>'; it.appendChild(document.createTextNode(' ' + d.split('/').pop()));
    fmDecorate(it, d);
    bindEntry(it, () => wsend({ type: 'list_dirs', path: d }), d);
    list.appendChild(it);
  });
  if (state.dirMode !== 'cwd') {
    (m.files || []).forEach((fe) => {
      const f = typeof fe === 'string' ? fe : fe.path; const size = typeof fe === 'string' ? 0 : fe.size;
      const it = el('div', 'diritem fileitem');
      const ico = isImagePath(f) ? '<img class="fmthumb" src="' + mediaUrlC(f) + '" loading="lazy">' : '<span class="ico">' + ICON.doc + '</span>';
      it.innerHTML = ico + '<span class="fm-n"></span><span class="fm-sz">' + fmtBytes(size) + '</span>';
      it.querySelector('.fm-n').textContent = f.split('/').pop();
      fmDecorate(it, f);
      bindEntry(it, () => onFileTap(f), f);
      list.appendChild(it);
    });
  }
  if (!(m.dirs || []).length && !(state.dirMode !== 'cwd' && (m.files || []).length)) { const e = el('div', 'diritem'); e.style.color = 'var(--muted)'; e.textContent = '（空）'; list.appendChild(e); }
}
function rerenderDirs() { if (state._lastDirs) renderDirs(state._lastDirs); }
// 多选态：选中只用底色表示（不加勾选圈，保持行干净）
function fmDecorate(it, path) {
  if (state.fmSel && state.fmSel.has(path)) it.classList.add('sel');
}
function enterFmSel(path) {
  state.fmSel = new Set(path ? [path] : []);
  $('fmSelBar').classList.add('show'); updateFmSelBar(); rerenderDirs();
}
function exitFmSel() { state.fmSel = null; $('fmSelBar').classList.remove('show'); rerenderDirs(); }
function updateFmSelBar() { $('fmSelN').textContent = (state.fmSel ? state.fmSel.size : 0) + ' 项'; }
function fmClipFromSel(op) {
  if (!state.fmSel || !state.fmSel.size) return;
  state.fmClip = { op, paths: [...state.fmSel] };
  const n = state.fmSel.size; exitFmSel();
  toast((op === 'move' ? '已剪切 ' : '已复制 ') + n + ' 项，去目标目录粘贴');
}
function onFileTap(path) {
  if (state.dirMode === 'attach') fmAttach(path);
  else if (isImagePath(path)) openLightbox(mediaUrlC(path));
  else fmDownload(path);
}
function fmAttach(path) {
  const name = path.split('/').pop(), img = isImagePath(path);
  state.pendingFiles.push({ name, isImage: img, status: 'ready', path, url: img ? mediaUrlC(path) : '' });
  renderAttachStrip(); updateSend(); buzz(12); toast('已附加 ' + name);
}
// 系统下载管理器优先——bundled 模式下 <a> 导航会被壳丢给外部浏览器；纯浏览器环境才走 <a>
function nativeDownload(url, name) {
  try { if (window.Android && Android.download) { Android.download(url, name || ''); return true; } } catch (e) {}
  return false;
}
function fmDownload(path) {
  const url = state.origin + '/download?t=' + encodeURIComponent(LS.token) + '&p=' + encodeURIComponent(path);
  if (nativeDownload(url, path.split('/').pop())) return;
  const a = document.createElement('a'); a.href = url; a.download = path.split('/').pop(); document.body.appendChild(a); a.click(); a.remove();
}
// tap = action()（多选态改为勾选）, long-press = 弹窗菜单（多选态禁用）
function bindEntry(node, onTap, path) {
  let lp = false, timer = null;
  node.addEventListener('click', () => {
    if (lp) { lp = false; return; }
    if (state.fmSel) {
      if (state.fmSel.has(path)) state.fmSel.delete(path); else state.fmSel.add(path);
      node.classList.toggle('sel', state.fmSel.has(path)); updateFmSelBar(); buzz(8);
      return;
    }
    onTap();
  });
  const start = () => { if (state.fmSel) return; lp = false; timer = setTimeout(() => { lp = true; buzz(12); openPathActions(path); }, 500); };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  node.addEventListener('touchstart', start, { passive: true });
  node.addEventListener('touchend', cancel); node.addEventListener('touchmove', cancel);
}
function openPathActions(path) { state.pathTarget = path; $('pathActTitle').textContent = path.split('/').pop(); $('pathImport').style.display = /\.json$/i.test(path) ? '' : 'none'; openScrim('pathActScrim'); }
function pickDir() { state.cwd = state.dirPath; LS.cwd = state.dirPath; updateHeader(); closeFiles(); }

/* ---- uploads (XHR with progress) ---- */
function uploadOne(file, dir, onProg) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', state.origin + '/upload?t=' + encodeURIComponent(LS.token) + '&dir=' + encodeURIComponent(dir) + '&name=' + encodeURIComponent(file.name));
    const t0 = Date.now();
    state.uploading++;
    const done = () => { state.uploading = Math.max(0, state.uploading - 1); };
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProg(e.loaded / e.total, e.loaded / Math.max(0.05, (Date.now() - t0) / 1000)); };
    xhr.onload = () => { done(); if (xhr.status === 200) { try { resolve(JSON.parse(xhr.responseText)); } catch (e) { resolve({}); } } else reject(new Error('HTTP ' + xhr.status)); };
    xhr.onerror = () => { done(); reject(new Error('network')); };
    xhr.send(file);
  });
}
// 选/贴/分享进来的文件先只挂在附件条上（本地预览），真正点发送时才上传（用户 0906 定）
// dir 留空 = 服务端统一归档进上传文件夹（telos-uploads），不再散落在各会话 cwd
function attachLocal(fileList) {
  Array.from(fileList || []).forEach((file) => {
    const isImage = (file.type || '').startsWith('image/') || isImagePath(file.name);
    state.pendingFiles.push({ name: file.name, isImage, status: 'local', file, url: isImage ? URL.createObjectURL(file) : '' });
  });
  renderAttachStrip(); updateSend(); draftDirty();
}
// 发送那一刻把附件条里还没传的全传上去；全成功 → true。中途切走了对话就不代发：传好的挂回那个对话的草稿等她回来
function uploadPending() {
  const key = state.draftKey;
  const locals = state.pendingFiles.filter((f) => f.status === 'local');
  if (!locals.length) return Promise.resolve(true);
  locals.forEach((it) => { it.status = 'uploading'; it.pct = 0; it.speed = 0; });
  renderAttachStrip(); updateSend();
  return Promise.all(locals.map((item) => uploadOne(item.file, '', (pct, sp) => { item.pct = pct; item.speed = sp; renderAttachStrip(); })
    .then((r) => {
      item.status = 'ready'; item.path = r.path; item.name = r.name || item.name; delete item.file; delete item.err;
      if (item.url) { try { URL.revokeObjectURL(item.url); } catch (e) {} }
      item.url = item.isImage && r.path ? mediaUrlC(r.path) : '';
    })
    .catch((e) => { item.status = 'local'; item.err = e.message; })
  )).then(() => {
    const failed = locals.filter((f) => f.status === 'local');
    renderAttachStrip(); updateSend(); saveDraft();
    if (state.draftKey !== key) { toast('文件传好了，回到那个对话再发'); return false; }
    if (failed.length) { toast('上传失败：' + (failed[0].err || '') + '，再点一次发送重试'); return false; }
    return true;
  });
}
// manager upload: into the folder you're viewing, progress in #fmProgress, refresh listing
function managerUpload(fileList) {
  const dir = state.dirPath;
  Array.from(fileList || []).forEach((file) => {
    const row = el('div', 'fmprow'); row.innerHTML = '<span class="fmp-n"></span><div class="fmp-bar"><i></i></div><span class="fmp-s">0%</span>';
    row.querySelector('.fmp-n').textContent = file.name;
    $('fmProgress').appendChild(row);
    uploadOne(file, dir, (pct, sp) => { row.querySelector('.fmp-bar i').style.width = (pct * 100).toFixed(0) + '%'; row.querySelector('.fmp-s').textContent = (pct * 100 | 0) + '% · ' + fmtSpeed(sp); })
      .then(() => { row.remove(); if (state.dirPath === dir) wsend({ type: 'list_dirs', path: state.dirPath }); toast('已上传 ' + file.name); })
      .catch((e) => { row.querySelector('.fmp-s').textContent = '失败'; toast('上传失败：' + e.message); });
  });
}

/* ============ 居中确认弹窗：一次点击代替「输入删除确认」（各处删除共用） ============ */
function openConfirm(title, sub, cb, okText, plain) {
  $('confirmTitle').textContent = title;
  const s = $('confirmSub'); s.textContent = sub || ''; s.style.display = sub ? '' : 'none';
  $('confirmYes').textContent = okText || '删除';
  $('confirmYes').classList.toggle('danger', !plain);   // plain = 非破坏性动作，不用红
  state.confirmCb = cb;
  openScrim('confirmScrim');
}

/* ============ prompt sheet ============ */
function syncPromptGo() { const inp = $('promptInput'); $('promptOk').classList.toggle('show', !!inp.value.trim() || state.promptAllowEmpty); }   // 有字（或允许空）才显 →
function openPrompt(title, value, cb, placeholder, opts) {
  opts = opts || {};
  const danger = opts.danger !== undefined ? opts.danger : /删除/.test(title || '');   // 删除类 → 红色 → 键、要真打「删除」
  const inp = $('promptInput'), btn = $('promptOk');
  inp.value = value || '';
  inp.placeholder = placeholder || (danger ? '输入“删除”确认删除' : title) || '';   // 提示放进框里
  btn.classList.toggle('danger', danger);   // → 键：危险红 / 普通强调色（仅箭头、无底纹）
  state.promptCb = cb; state.promptAllowEmpty = !!opts.allowEmpty;
  syncPromptGo();
  openScrim('promptScrim');
  setTimeout(() => { inp.focus(); inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, window.innerHeight * 0.38) + 'px'; }, 100);
}

/* ============ compact history ============ */
function openCompactPrompt() { $('compactText').value = P('compactPrompt') || ''; openScrim('compactScrim'); }
function doCompact(extra) {
  if (!state.currentSession) return;
  const ins = (extra && extra.trim()) ? extra.trim() : (P('compactPrompt') || '').trim(); // 留空时用设置里的默认压缩提示词
  const text = '/compact' + (ins ? ' ' + ins : '');
  const t = newLocalTurn({});
  wsend({ type: 'send', sessionId: state.currentSession, text, mode: state.mode, turnId: t.id });
  toast('压缩中…');
}

/* ============ + panel (tools sheet at the bottom; the dock rides up, dims the rest) ============ */
function togglePlus() { if (state.plusOpen) closePlus(); else openPlus(); }
function openPlus() {
  $('composer').blur();
  const dock = $('dock'), panel = $('plusPanel'), pb = $('plusBack');
  clearTimeout(pb._hideT); pb.classList.add('show'); requestAnimationFrame(() => pb.classList.add('in'));
  panel.style.display = 'block';
  const h = panel.offsetHeight + 8;                 // 面板（含间隙）高度
  state.plusH = h; state.plusOpen = true;
  // 面板还在底部、像原来那样滑出；但 syncDockPad 会把面板高度排除掉 → 对话记录原地不动
  dock.style.transition = 'none'; dock.style.transform = 'translateY(' + h + 'px)';
  requestAnimationFrame(() => { dock.style.transition = 'transform .27s cubic-bezier(.32,.72,0,1)'; dock.style.transform = 'translateY(0)'; syncDockPad(); });
  $('plusBtn').classList.add('open');
}
function closePlus() {
  if (!state.plusOpen) return;
  const dock = $('dock'), panel = $('plusPanel'), pb = $('plusBack');
  pb.classList.remove('in'); pb._hideT = setTimeout(() => pb.classList.remove('show'), 240);
  state.plusOpen = false;
  dock.style.transition = 'transform .27s cubic-bezier(.32,.72,0,1)';
  dock.style.transform = 'translateY(' + (state.plusH || 0) + 'px)';
  $('plusBtn').classList.remove('open');
  setTimeout(() => { if (!state.plusOpen) { panel.style.display = 'none'; dock.style.transition = 'none'; dock.style.transform = ''; syncDockPad(); } }, 290);
}

/* ============ expand button visibility ============ */
function updateExpandBtn() {
  const show = $('composer').value.trim().length > 0 || state.composerFocused;
  $('expandBtn').style.display = show ? 'flex' : 'none';
}

/* ============ fullscreen compose ============ */
function openCompose() { $('composeText').value = $('composer').value; $('composeOver').classList.add('show'); setTimeout(() => $('composeText').focus(), 60); }
function closeCompose(save) {
  if (save) { $('composer').value = $('composeText').value; resizeComposer(); updateSend(); }
  // 写作页里粘的长文被取消 → 占位符没落回输入框，把对应的孤儿附件一并清掉（老路径无 ph 的不动）
  if (!save && state.pendingTexts.some((p) => p.ph && !$('composer').value.includes(p.ph))) {
    state.pendingTexts = state.pendingTexts.filter((p) => !p.ph || $('composer').value.includes(p.ph));
    renderAttachStrip(); updateSend();
  }
  $('composeOver').classList.remove('show');
  if (save) setTimeout(() => $('composer').focus(), 60);
}

/* ============ MCP servers ============ */
function openMcp() { closeMenu(); $('mcpList').innerHTML = '<div style="color:var(--muted);padding:12px 4px;">加载中…</div>'; wsend({ type: 'mcp_list' }); openScrim('mcpScrim'); }
function renderMcpList(servers) {
  const list = $('mcpList'); list.innerHTML = '';
  if (!servers.length) { list.innerHTML = '<div style="color:var(--muted);padding:12px 4px;">（无 MCP 服务器）</div>'; return; }
  servers.forEach((s) => {
    const row = el('div', 'mcprow');
    const meta = el('div', 'mcpmeta');
    const nm = el('div', 'mcpname'); nm.textContent = s.name;
    const st = el('div', 'mcpstatus'); st.className = 'mcpstatus ' + s.status;
    st.textContent = s.status === 'ok' ? '已连接' : (s.status === 'auth' ? '需认证' : '未连接');
    meta.appendChild(nm); meta.appendChild(st);
    const sw = el('button', 'switch' + (s.on ? ' on' : '')); sw.innerHTML = '<span class="knob"></span>';
    sw.addEventListener('click', () => { const on = !sw.classList.contains('on'); sw.classList.toggle('on', on); wsend({ type: 'mcp_toggle', name: s.name, on }); });
    row.appendChild(meta); row.appendChild(sw);
    list.appendChild(row);
  });
}

/* ============ folder (tab) actions ============ */
function openFolderActions(name) {
  state.folderActTarget = name;
  $('folderActTitle').textContent = name;
  openScrim('folderActScrim');
}

/* ============ CLAUDE.md editor ============ */
function openClaudeMd() {
  closeMenu();
  const dir = state.cwd || state.defaultCwd;
  if (!dir) { toast('未知工作目录'); return; }
  state.claudePath = dir.replace(/\/$/, '') + '/CLAUDE.md';
  state.editingClaude = true;
  $('claudePath').textContent = state.claudePath;
  $('claudeText').value = '';
  setClaudePreview(false);
  wsend({ type: 'read_file', path: state.claudePath });
}
function saveClaudeMd() {
  if (!state.claudePath) return;
  wsend({ type: 'write_file', path: state.claudePath, content: $('claudeText').value });
  closeScrim('claudeScrim'); state.editingClaude = false;
}
function setClaudePreview(on) {
  const ta = $('claudeText'), pv = $('claudeView'), btn = $('claudePrev');
  if (on) { pv.innerHTML = md(ta.value); ta.style.display = 'none'; pv.style.display = 'block'; btn.textContent = '编辑'; }
  else { ta.style.display = 'block'; pv.style.display = 'none'; btn.textContent = '预览'; }
}

/* ============ 文件编辑 · 电子书阅读器 ============
 * 工作目录里的文本文件在这里像电子书一样翻和改：先在「文件编辑」抽屉里选文件，
 * md 走衬线书排版（章节目录抽屉/页内搜索/阅读进度），其它文本走等宽 pre；✎ 切整页编辑。
 * 手势与全 App 同语言：左滑=搜索、右滑=返回（无返回箭头）。纯前端，走现成 read_file/write_file。 */
const FPICK_EXT = /\.(md|txt|json|jsonl|ya?ml|toml|ini|conf|cfg|log|csv|js|mjs|cjs|ts|py|sh|html?|css|xml)$/i;
function openFilePick() {
  const dir = (state.cwd || state.defaultCwd || '').replace(/\/$/, '');
  if (!dir) { toast('未知工作目录'); return; }
  state.fpickDir = dir;            // 每次从对话目录出发；页内可切到 home 里任何目录
  state.fpickWait = dir;
  state.fpickBack = state.screen;
  $('filePickSub').textContent = '';
  $('filePickBody').innerHTML = '<div class="cl-empty">读取中…</div>';
  show('fpick');
  wsend({ type: 'list_dirs', path: dir });
}
function fpickGo(dir) {
  state.fpickWait = dir;
  wsend({ type: 'list_dirs', path: dir });
}
function renderFilePick(m) {
  const box = $('filePickBody'); box.innerHTML = '';
  const files = (m.files || []).filter((f) => FPICK_EXT.test(f.path));
  const short = (m.path || '').replace(/^\/(root|home\/[^/]+)/, '~');
  $('filePickSub').textContent = short + (files.length ? ' · ' + files.length + ' 个文本文件' : '');
  // 目录导航：.. + 子目录，普通横栏（和文件管理同款），能翻到 home 里任何文件夹
  const navs = [];
  if (m.parent && m.parent !== m.path) navs.push(['上一级', m.parent, true]);
  (m.dirs || []).forEach((d) => navs.push([d.split('/').pop(), d, false]));
  if (navs.length) {
    const card = el('div', 'fpick-card');
    navs.forEach(([nm, d, up]) => {
      const row = el('button', 'fpick-row');
      const ico = el('span', 'fpick-ico' + (up ? ' fpup' : ''));
      ico.innerHTML = _sv(up ? '<polyline points="15 18 9 12 15 6"/>' : '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>', 18);
      row.appendChild(ico);
      const main = el('span', 'fpick-main'); const l1 = el('span', 'fpick-line1');
      const n = el('span', 'fpick-name'); n.textContent = nm; l1.appendChild(n); main.appendChild(l1); row.appendChild(main);
      row.addEventListener('click', () => fpickGo(d));
      card.appendChild(row);
    });
    box.appendChild(card);
  }
  if (!files.length) { const e = el('div', 'cl-empty'); e.textContent = '这个目录里还没有可编辑的文本文件。'; box.appendChild(e); return; }
  const fmtSz = (s) => s > 1048576 ? (s / 1048576).toFixed(1) + ' MB' : s > 1024 ? Math.round(s / 1024) + ' KB' : (s || 0) + ' B';
  const fmtDt = (t) => {
    if (!t) return '';
    const d = new Date(t), n = new Date();
    if (d.toDateString() === n.toDateString()) return '今天 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (d.getFullYear() === n.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
  };
  // 图标按文件身份区分：书(回忆录) / 指令(CLAUDE.md) / md / 代码 / 纯文本
  const kindOf = (nm) => nm === '回忆录.md' ? 'book' : nm === 'CLAUDE.md' ? 'gear'
    : /\.md$/i.test(nm) ? 'md' : /\.(js|mjs|cjs|ts|py|sh|json|jsonl|ya?ml|toml|xml|html?|css)$/i.test(nm) ? 'code' : 'txt';
  const FICO = {
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    gear: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    md: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>',
    code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    txt: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'
  };
  const isTop = (f) => { const nm = f.path.split('/').pop(); return nm === '回忆录.md' || nm === 'CLAUDE.md'; };
  const groups = [
    ['常用', files.filter(isTop).sort((a) => a.path.endsWith('回忆录.md') ? -1 : 1)],
    ['其他文本', files.filter((f) => !isTop(f)).sort((a, b) => (b.mtime || 0) - (a.mtime || 0))],
  ];
  for (const [label, list] of groups) {
    if (!list.length) continue;
    const lab = el('div', 'fpick-part'); lab.textContent = label; box.appendChild(lab);
    const card = el('div', 'fpick-card');
    for (const f of list) {
      const name = f.path.split('/').pop();
      const k = kindOf(name);
      const row = el('button', 'fpick-row');
      const ico = el('span', 'fpick-ico' + (k === 'book' ? ' book' : '')); ico.innerHTML = _sv(FICO[k], 18); row.appendChild(ico);
      const main = el('span', 'fpick-main');
      const l1 = el('span', 'fpick-line1');
      const nm = el('span', 'fpick-name'); nm.textContent = name; l1.appendChild(nm);
      const tag = name === '回忆录.md' ? '书' : name === 'CLAUDE.md' ? '指令' : '';
      if (tag) { const t = el('span', 'fpick-tag'); t.textContent = tag; l1.appendChild(t); }
      main.appendChild(l1);
      const meta = el('span', 'fpick-meta');
      meta.textContent = fmtSz(f.size) + (f.mtime ? ' · ' + fmtDt(f.mtime) : '');
      main.appendChild(meta);
      row.appendChild(main);
      row.addEventListener('click', () => openBook(f.path));   // state.screen='fpick' → 阅读页返回会回到这
      card.appendChild(row);
    }
    box.appendChild(card);
  }
}
function openBook(path) {
  if (!path) {
    const dir = (state.cwd || state.defaultCwd || '').replace(/\/$/, '');
    if (!dir) { toast('未知工作目录'); return; }
    path = dir + '/回忆录.md';
  }
  state.bookWait = path;
  if (state.screen !== 'bookPage') state.bookBack = state.screen;
  wsend({ type: 'read_file', path });
}
function renderBook(m) {
  state.bookWait = null;
  state.bookPath = m.path;
  state.bookRaw = m.exists ? (m.content || '') : '';
  const body = $('bookBody');
  bookFindClear();
  if ($('bookPage').classList.contains('editing')) bookEditClose(false);
  const name = (m.path || '').split('/').pop();
  const isMd = /\.md$/i.test(name);
  const text = state.bookRaw;
  let title = name || '文件';
  if (isMd) { const tm = text.match(/^#\s+(.+?)\s*$/m); if (tm) title = tm[1].replace(/^《/, '').replace(/》$/, ''); }
  $('bookBarTitle').textContent = title;
  if (!text.trim()) {
    body.innerHTML = name === '回忆录.md'
      ? '<div class="bookempty">这个对话还没有《回忆录》。<br><span>书是她自己养的——让她动笔就有了。</span></div>'
      : '<div class="bookempty">（空文件）<br><span>点右上的笔开始写。</span></div>';
    state.bookToc = [];
  } else if (isMd) {
    // 分界线注释 → 可见的装饰分隔（也是目录里「头部/编年史」的分界）
    const shown = text.replace(/<!--\s*以下按需翻阅\s*-->/, '\n\n<div class="bookcut"><span>❦</span>以下按需翻阅<span>❦</span></div>\n\n');
    body.innerHTML = md(shown);
    const toc = [];
    let after = false;
    body.querySelectorAll('h1, h2, div.bookcut').forEach((h, i) => {
      if (h.classList && h.classList.contains('bookcut')) { after = true; return; }
      h.id = 'bk' + i;
      if (h.tagName === 'H1') return;   // 扉页书名不进目录
      toc.push({ id: h.id, text: h.textContent, part: after ? '编年史' : '头部' });
    });
    state.bookToc = toc;
  } else {
    const pre = document.createElement('pre'); pre.className = 'bookplain'; pre.textContent = text;
    body.innerHTML = ''; body.appendChild(pre);
    state.bookToc = [];
  }
  show('bookPage');
  $('bookScroll').scrollTop = 0;
  bookOnScroll();
}
/* ---- 整页编辑（✎ 进、保存/✕ 出；保存走 write_file，成功 toast 由 file_saved 统一发） ---- */
function bookEditOpen() {
  if (state.bookWait || !state.bookPath) return;
  $('bookEditTa').value = state.bookRaw || '';
  $('bookPage').classList.add('editing');
  $('bookEdit').classList.add('show');
  $('bookEditBtn').style.display = 'none'; $('bookTocBtn').style.display = 'none';
  $('bookEditSave').style.display = ''; $('bookEditCancel').style.display = '';
}
function bookEditClose(save) {
  if (save) {
    const txt = $('bookEditTa').value;
    wsend({ type: 'write_file', path: state.bookPath, content: txt });
    state.bookRaw = txt;
  }
  $('bookPage').classList.remove('editing');
  $('bookEdit').classList.remove('show');
  $('bookEditBtn').style.display = ''; $('bookTocBtn').style.display = '';
  $('bookEditSave').style.display = 'none'; $('bookEditCancel').style.display = 'none';
  if (save) renderBook({ exists: true, content: state.bookRaw, path: state.bookPath });
}
/* ---- 手势（与对话屏同语言）：右滑=返回、左滑=呼出书内搜索 ---- */
function initBookSwipe() {
  const sc = $('bookScroll');
  let sx = 0, sy = 0, dir = null, active = false, W = 0;
  sc.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { active = false; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; dir = null; active = true; W = window.innerWidth;
  }, { passive: true });
  sc.addEventListener('touchmove', (e) => {
    if (!active || dir) return;
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    dir = Math.abs(dx) > Math.abs(dy) * 1.3 ? (dx > 0 ? 'back' : 'search') : 'scroll';
  }, { passive: true });
  sc.addEventListener('touchend', (e) => {
    if (!active) return; active = false;
    const dx = e.changedTouches[0].clientX - sx;
    const TRIG = Math.min(120, W * 0.32);
    if (dir === 'back' && dx > TRIG) { buzz(14); show(state.bookBack || (state.currentSession ? 'chat' : 'list')); }
    else if (dir === 'search' && -dx > TRIG) { buzz(14); toggleBookFind(true); }
    dir = null;
  });
}
function bookCurrentChapter() {
  const y = $('bookScroll').scrollTop + 90;
  let cur = null;
  for (const t of state.bookToc || []) {
    const h = document.getElementById(t.id);
    if (!h) continue;
    if (h.offsetTop <= y) cur = t.id; else break;
  }
  return cur;
}
let _bookRaf = null;
function bookOnScroll() {
  if (_bookRaf) return;
  _bookRaf = requestAnimationFrame(() => {
    _bookRaf = null;
    const sc = $('bookScroll');
    const max = sc.scrollHeight - sc.clientHeight;
    const pct = max > 2 ? Math.min(1, sc.scrollTop / max) : 1;
    $('bookProgFill').style.width = (pct * 100).toFixed(1) + '%';
    $('bookFootPct').textContent = Math.round(pct * 100) + '%';
    const t = (state.bookToc || []).find((x) => x.id === bookCurrentChapter());
    $('bookFootCh').textContent = t ? t.text : '';
  });
}
function bookJump(id) {
  const h = document.getElementById(id); if (!h) return;
  $('bookScroll').scrollTo({ top: Math.max(0, h.offsetTop - 64), behavior: 'smooth' });
}
function openBookToc() {
  const box = $('bookTocBody'); box.innerHTML = '';
  const toc = state.bookToc || [];
  const nCh = toc.filter((t) => t.part === '编年史').length;
  $('bookTocSub').textContent = ($('bookBarTitle').textContent || '') + (nCh ? ' · ' + nCh + ' 章' : '');
  if (!toc.length) {
    box.innerHTML = '<div class="cl-empty">还没有章节。</div>';
    show('bookToc'); return;
  }
  // 书的目录就该像书：纯衬线素排，不做卡片、不做"当前章"高亮（用户：就只是一个目录）
  const col = el('div', 'btoc-col'); box.appendChild(col);
  let part = '';
  toc.forEach((t) => {
    if (t.part !== part) {
      part = t.part;
      const lab = el('div', 'btoc-part'); lab.textContent = part; col.appendChild(lab);
    }
    const row = el('button', 'btoc-row');
    row.textContent = t.text;
    row.addEventListener('click', () => {
      show('bookPage');
      requestAnimationFrame(() => bookJump(t.id));   // 回到阅读页、排版就位后再跳
    });
    col.appendChild(row);
  });
  show('bookToc');
  box.scrollTop = 0;
}
/* ---- 页内搜索：TreeWalker 抓文本节点、splitText 包 <mark>，上下键循环跳 ---- */
function bookFindClear() {
  $('bookBody').querySelectorAll('mark.bkm').forEach((mk) => {
    const p = mk.parentNode; if (!p) return;
    p.replaceChild(document.createTextNode(mk.textContent), mk); p.normalize();
  });
  state.bookHits = []; state.bookHitI = -1;
  $('bookFindCount').textContent = '';
}
function bookFindRun(q) {
  bookFindClear();
  q = (q || '').trim();
  if (!q) return;
  const ql = q.toLowerCase();
  const walker = document.createTreeWalker($('bookBody'), NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const hits = [];
  outer: for (const nd of nodes) {
    let node = nd, idx;
    while (node && (idx = node.textContent.toLowerCase().indexOf(ql)) >= 0) {
      const hit = node.splitText(idx);
      const rest = hit.splitText(q.length);
      const mk = document.createElement('mark');
      mk.className = 'bkm'; mk.textContent = hit.textContent;
      hit.parentNode.replaceChild(mk, hit);
      hits.push(mk);
      node = rest;
      if (hits.length >= 500) break outer;   // 疯狂短词兜底
    }
  }
  state.bookHits = hits;
  if (!hits.length) { $('bookFindCount').textContent = '0'; return; }
  bookFindGoto(0);
}
function bookFindGoto(i) {
  const hits = state.bookHits || []; if (!hits.length) return;
  i = ((i % hits.length) + hits.length) % hits.length;
  if (state.bookHitI >= 0 && hits[state.bookHitI]) hits[state.bookHitI].classList.remove('cur');
  state.bookHitI = i;
  hits[i].classList.add('cur');
  $('bookFindCount').textContent = (i + 1) + '/' + hits.length;
  const sc = $('bookScroll');
  sc.scrollTo({ top: Math.max(0, hits[i].offsetTop - sc.clientHeight * 0.35), behavior: 'smooth' });
}
function toggleBookFind(on) {
  const bar = $('bookFind');
  const want = on != null ? on : !bar.classList.contains('show');
  bar.classList.toggle('show', want);
  if (want) setTimeout(() => $('bookFindInput').focus(), 60);
  else { $('bookFindInput').value = ''; bookFindClear(); $('bookFindInput').blur(); }
}

/* ============ ⋮ menu (reveals top-down, collapses bottom-up) ============ */
function openMenu() {
  const mb = $('menuback'), mp = $('menuPop');
  // CLAUDE.md / model / MCP / copy-dir work for a brand-new session too (they act on the
  // chosen working dir / globally); only hide the items that need an existing session.
  const newSess = !state.currentSession;
  // 这些都依赖一个已存在的会话；新会话时连同「对话设置」分区标题一起隐藏（菜单设置那组对新会话仍可用）
  ['mRegen', 'mDelete', 'mMood', 'mWake', 'mCinema'].forEach((id) => { $(id).style.display = newSess ? 'none' : ''; });
  syncMoodMenu();
  clearTimeout(mp._hideT);
  mb.classList.add('show'); mp.classList.add('show');
  requestAnimationFrame(() => { mb.classList.add('in'); mp.classList.add('in'); });
}
function syncMoodMenu() {
  const dot = $('mMoodDot'); if (!dot) return;
  const on = !!(state.mood && state.mood.on);
  dot.classList.toggle('on', on);
  dot.style.background = on ? (state.mood.label ? moodTint(state.mood.label) : 'var(--accent)') : '';
}
// 每对话「情绪」开关：开了她会带着常驻心情回应（标签由模型自己写）。默认关、不动现有对话。
function toggleMood() {
  if (!state.currentSession) return;
  const on = !(state.mood && state.mood.on);
  state.mood = { ...(state.mood || {}), on };   // 乐观更新
  wsend({ type: 'mood_set', sessionId: state.currentSession, on });
  updateHeader(); syncMoodMenu();
  toast(on ? '情绪已开：她会带着心情回应' : '情绪已关');
}
function closeMenu() {
  const mb = $('menuback'), mp = $('menuPop');
  if (!mp.classList.contains('show')) return;
  mb.classList.remove('in'); mp.classList.remove('in');
  mp._hideT = setTimeout(() => { mb.classList.remove('show'); mp.classList.remove('show'); }, 260);
}

function buzz(ms) { if (!P('haptics')) return; try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

/* ============ 记忆（Mnemosyne 长期记忆）============ */
// 当前对话对象：定时唤醒/电影模式两个现成页面都吃一个 session 对象（要 id/title，唤醒还看 wakeAt）。
// 在对话里没有列表项时兜一个最小对象，wakeAt 仅作初值、随后 wakeup_get 会带回权威状态。
function curSess() {
  return (state.sessions || []).find((x) => x.id === state.currentSession)
    || { id: state.currentSession, title: state.curTitle || '', wakeAt: 0 };
}
function openMemory() {
  closeMenu();
  if (!state.currentSession) return;
  state.mem = null; renderMemory();          // 加载态
  openScrim('memScrim');
  wsend({ type: 'memory_get', sessionId: state.currentSession });
}
function onMemory(m) {
  if (m.sessionId && m.sessionId !== state.currentSession) return;
  state.mem = { available: !!m.available, on: !!m.on, stats: m.stats || null, recentN: m.recentN, maxTok: m.maxTok,
                book: !!m.book, memoir: !!m.memoir };
  renderMemory();
}
function renderMemory() {
  const sw = $('memOn'), sub = $('memSub'), reco = $('memReco'); if (!sw) return;
  const mem = state.mem;
  const swRow = sw.closest('.wkrow'), tokRow = $('memMaxTok') && $('memMaxTok').closest('.memreco-row'), mgrBtn = $('memMgrOpen');
  if (!mem) { sw.classList.remove('on'); sub.textContent = '读取中…'; if (reco) reco.style.display = 'none'; return; }
  if (!mem.available) {
    sw.classList.remove('on'); sw.disabled = true; sw.style.opacity = '.4';
    sub.textContent = '服务器没装记忆模块';
    if (reco) reco.style.display = 'none'; return;
  }
  if (mem.book) {
    // 书时代：记忆=《回忆录》，这里只剩「恢复」——回看轮数 + 立即恢复
    if (swRow) swRow.style.display = 'none';
    if (tokRow) tokRow.style.display = 'none';
    if (mgrBtn) mgrBtn.style.display = 'none';
    sub.textContent = mem.memoir ? '恢复＝回忆录头部＋最近对话' : '恢复＝最近对话（这个对话还没有书）';
    if (reco) {
      reco.style.display = '';
      if (document.activeElement !== $('memRecentN')) $('memRecentN').value = (mem.recentN != null ? mem.recentN : 8);
    }
    return;
  }
  if (swRow) swRow.style.display = '';
  if (tokRow) tokRow.style.display = '';
  if (mgrBtn) mgrBtn.style.display = '';
  sw.disabled = false; sw.style.opacity = '';
  sw.classList.toggle('on', mem.on);
  const s = mem.stats || {}; let mems = 0; if (s.memories) for (const k in s.memories) mems += (s.memories[k].count || 0);
  sub.textContent = mems + ' 条记忆 · ' + (s.dialog_turns || 0) + ' 轮归档';
  if (reco) {
    reco.style.display = '';
    if (document.activeElement !== $('memRecentN')) $('memRecentN').value = (mem.recentN != null ? mem.recentN : 8);
    if (document.activeElement !== $('memMaxTok')) $('memMaxTok').value = (mem.maxTok != null ? mem.maxTok : 3000);
  }
}

/* ---- 记忆管理页（翻看 / 归档精炼记忆）---- */
const MEM_FILTERS = [['', '全部'], ['pinned', '钉选'], ['pending', '未了结'], ['archived', '已归档']];
const MEM_TYPE = { experience: '经历', persona: '自我', emotion: '情感', knowledge: '知识', secret: '秘密' };
function openMemMgr() {
  state.memMgr = { filter: '', items: [], offset: 0, total: 0 };
  show('memMgr'); renderMemMgrFilters();
  $('memMgrBody').innerHTML = '<div class="cl-empty">读取中…</div>';
  wsend({ type: 'memory_list', filter: '', offset: 0 });
}
function loadMemMgr(filter) {
  state.memMgr.filter = filter; state.memMgr.offset = 0;
  renderMemMgrFilters();
  $('memMgrBody').innerHTML = '<div class="cl-empty">读取中…</div>';
  wsend({ type: 'memory_list', filter, offset: 0 });
}
function renderMemMgrFilters() {
  const wrap = $('memMgrFilters'); if (!wrap) return; wrap.innerHTML = '';
  for (const [f, lab] of MEM_FILTERS) {
    const chip = el('button', 'memf' + (state.memMgr.filter === f ? ' on' : '')); chip.textContent = lab;
    chip.addEventListener('click', () => loadMemMgr(f));
    wrap.appendChild(chip);
  }
}
function onMemoryList(m) {
  if (state.screen !== 'memMgr' || !state.memMgr) return;
  if ((m.filter || '') !== state.memMgr.filter) return;   // 旧请求回包，丢弃
  state.memMgr.items = m.items || []; state.memMgr.total = m.total || 0;
  renderMemMgr();
}
function renderMemMgr() {
  const box = $('memMgrBody'); if (!box) return;
  const items = (state.memMgr && state.memMgr.items) || [];
  if (!items.length) { box.innerHTML = '<div class="cl-empty">这里还没有记忆。</div>'; return; }
  box.innerHTML = '';
  const archView = state.memMgr.filter === 'archived';
  for (const it of items) {
    const card = el('div', 'memcard tappable');
    // 正文(content)才是记忆实体；summary 只是标题、且 Ombre 正文已内嵌【标题】，不重复显示
    const text = el('div', 'memcard-text'); text.textContent = it.content || it.summary || '(空)'; card.appendChild(text);
    const meta = el('div', 'memcard-meta');
    if (it.pinned) meta.appendChild(el('span', 'mempin'));
    meta.appendChild(document.createTextNode((MEM_TYPE[it.memory_type] || it.memory_type || '?') + ' · ' + (it.importance != null ? it.importance : '?')
      + (it.resolved === 0 ? ' · 未了结' : '') + (it.domain ? ' · ' + it.domain : '')));
    card.appendChild(meta);
    card.addEventListener('click', () => openMemEdit(it, archView)); // 归档/删除都在编辑页里
    box.appendChild(card);
  }
}

/* ---- 编辑单条精炼记忆（独立一页·仿日记） ---- */
const ME_ICON = {
  type: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  imp: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  pin: '<path d="M9 4h6l-1 7 3 3v2H7v-2l3-3z"/><line x1="12" y1="16" x2="12" y2="21"/>',
  pending: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  arch: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>',
  del: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
};
function openMemEdit(it, archived) {
  state.memEdit = { id: it.id, domain: it.domain || '', type: it.memory_type || 'experience',
    importance: it.importance != null ? it.importance : 5, pinned: !!it.pinned, resolved: it.resolved !== 0, archived: !!archived };
  state._memDelArm = null;
  $('memEditText').value = it.content || it.summary || '';
  $('memEditSub').textContent = 'id ' + it.id + (it.domain ? ' · ' + it.domain : '');
  closeMemTypePicker(); renderMemEditList();
  show('memEdit');
}
// 仿日记 .dwitem 行：图标 + 标签 + 右侧值/控件
function meRow(icon, label, valNode, onClick, danger) {
  const r = el(onClick ? 'button' : 'div', 'dwitem' + (danger ? ' medel' : ''));
  r.innerHTML = _sv(icon, 20);
  const l = el('span', 'dwlbl'); l.textContent = label; r.appendChild(l);
  if (valNode != null) { if (typeof valNode === 'string') { const v = el('span', 'dwval'); v.textContent = valNode; r.appendChild(v); } else { valNode.classList.add('me-right'); r.appendChild(valNode); } }
  if (onClick) r.addEventListener('click', onClick);
  return r;
}
function meSwitch(on, onToggle) {
  const sw = el('button', 'switch' + (on ? ' on' : '')); sw.innerHTML = '<span class="knob"></span>';
  sw.addEventListener('click', () => { const nv = !sw.classList.contains('on'); sw.classList.toggle('on', nv); buzz(12); onToggle(nv); });
  return sw;
}
function renderMemEditList() {
  const box = $('memEditList'); if (!box) return; box.innerHTML = '';
  const e = state.memEdit;
  // 类型
  box.appendChild(meRow(ME_ICON.type, '类型', MEM_TYPE[e.type] || e.type, () => toggleMemTypePicker()));
  // 重要度：电影模式那种行内可编辑数字（1–10）
  const valw = el('span', 'dwval'); const inp = document.createElement('input');
  inp.className = 'cin-numinp'; inp.type = 'text'; inp.inputMode = 'numeric'; inp.setAttribute('enterkeyhint', 'done');
  const size = () => { inp.style.width = (Math.max(1, inp.value.length) + 0.6) + 'ch'; };
  inp.value = String(e.importance | 0); size();
  inp.addEventListener('input', size);
  const commit = () => { let v = parseInt(inp.value, 10); if (isNaN(v)) { inp.value = String(e.importance | 0); size(); return; } v = Math.max(1, Math.min(10, v)); inp.value = String(v); size(); e.importance = v; };
  inp.addEventListener('change', commit);
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') inp.blur(); });
  valw.appendChild(inp);
  box.appendChild(meRow(ME_ICON.imp, '重要度', valw));
  // 钉选 / 未了结
  box.appendChild(meRow(ME_ICON.pin, '钉选', meSwitch(e.pinned, (v) => { e.pinned = v; })));
  box.appendChild(meRow(ME_ICON.pending, '未了结', meSwitch(!e.resolved, (v) => { e.resolved = !v; })));
  // 归档（软删）/ 删除（两步确认）
  box.appendChild(meRow(ME_ICON.arch, e.archived ? '取消归档' : '归档', null, toggleMemArchive));
  box.appendChild(meRow(ME_ICON.del, state._memDelArm === e.id ? '确认删除？不可恢复' : '删除', null, deleteMemEdit, true));
}
function toggleMemArchive() {
  const e = state.memEdit; if (!e) return;
  wsend({ type: 'memory_archive', id: e.id, archived: !e.archived });
  state.memMgr.items = (state.memMgr.items || []).filter((x) => x.id !== e.id);   // 乐观移出当前视图
  renderMemMgr();
  closeMemTypePicker(); show('memMgr'); buzz(12); toast(e.archived ? '已取消归档' : '已归档');
}
const ME_TYPES = [['experience', '经历'], ['persona', '自我'], ['emotion', '情感'], ['knowledge', '知识'], ['secret', '秘密']];
function closeMemTypePicker() { const p = document.querySelector('.mepicker'); if (p) p.remove(); }
function toggleMemTypePicker() {
  if (document.querySelector('.mepicker')) { closeMemTypePicker(); return; }
  const p = el('div', 'mepicker');
  ME_TYPES.forEach(([k, lab]) => {
    const b = el('button'); b.textContent = lab; if (k === state.memEdit.type) b.style.background = 'var(--surface-2)';
    b.addEventListener('click', () => { state.memEdit.type = k; closeMemTypePicker(); renderMemEditList(); buzz(8); });
    p.appendChild(b);
  });
  $('memEdit').appendChild(p);
}
function saveMemEdit() {
  const e = state.memEdit; if (!e) return;
  const content = $('memEditText').value.trim();
  if (!content) { toast('正文不能为空'); return; }
  wsend({ type: 'memory_edit', id: e.id, content, memory_type: e.type, importance: e.importance, pinned: e.pinned, resolved: e.resolved });
  const it = (state.memMgr.items || []).find((x) => x.id === e.id);
  if (it) { it.content = content; it.memory_type = e.type; it.importance = e.importance; it.pinned = e.pinned ? 1 : 0; it.resolved = e.resolved ? 1 : 0; }
  renderMemMgr();
  closeMemTypePicker(); show('memMgr'); buzz(12); toast('已保存');
}
function deleteMemEdit() {
  const e = state.memEdit; if (!e) return;
  if (state._memDelArm !== e.id) {
    state._memDelArm = e.id; renderMemEditList();
    setTimeout(() => { if (state._memDelArm === e.id) { state._memDelArm = null; if (state.screen === 'memEdit') renderMemEditList(); } }, 3000);
    return;
  }
  state._memDelArm = null;
  wsend({ type: 'memory_delete', id: e.id });
  state.memMgr.items = (state.memMgr.items || []).filter((x) => x.id !== e.id);
  state.memMgr.total = Math.max(0, (state.memMgr.total || 1) - 1);
  renderMemMgr();
  closeMemTypePicker(); show('memMgr'); buzz(20); toast('已删除');
}

/* ============ 醒来 / 小纸条 / 日记 ============ */
function pad2(n) { return String(n).padStart(2, '0'); }
function todayLocalStr() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function fmtClock(ts) { const d = new Date(ts); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function fmtDateClock(ts) { const d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + fmtClock(ts); }
function wakeLabel(ms) { const d = new Date(ms), n = new Date(); const same = d.toDateString() === n.toDateString(); return (same ? '今天 ' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + fmtClock(ms); }
function fmtWhenLocal(ms) { const d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function hhmmFromMs(ms) { const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function parseEveryClient(v) { const m = String(v).match(/every\s+(\d+)\s*m/); return m ? { kind: 'every', minutes: +m[1] } : null; }
function diaryImgUrl(v) { return /^(https?:|data:)/.test(v) ? v : mediaUrlC(v); } // raw device path -> served /media url
function bindHold(node, cb) { let t = null; const s = () => { t = setTimeout(() => { buzz(12); cb(); }, 500); }; const c = () => { if (t) { clearTimeout(t); t = null; } }; node.addEventListener('touchstart', s, { passive: true }); node.addEventListener('touchend', c); node.addEventListener('touchmove', c); }

/* ---- 定时唤醒 ---- */
function onWakeState(m) {
  const st = m.state || {};
  const s = state.sessions.find((x) => x.id === m.sessionId);
  if (s) { s.wakeAt = (st.enabled && st.nextAt) ? st.nextAt : 0; if (state.screen === 'list') renderSessions(); }
  if (state.wakeTarget && state.wakeTarget.id === m.sessionId && $('wakeScrim').classList.contains('show')) fillWakeForm(st);
}

/* ---- 电影模式 ---- */
function cinSend(patch) { const s = state.cinTarget; if (!s) return; wsend({ type: 'cinema_set', sessionId: s.id, ...patch }); }
function cinToggle(label, on, onClick) {
  const row = el('div', 'setitem togglerow'); const lab = el('span'); lab.textContent = label;
  const sw = el('button', 'switch' + (on ? ' on' : '')); sw.innerHTML = '<span class="knob"></span>';
  sw.addEventListener('click', () => { sw.classList.toggle('on'); buzz(12); onClick(); });
  row.appendChild(lab); row.appendChild(sw); return row;
}
// 披露式设置行：平时只显「标签 + 当前值」，点一下露出**数字输入框**单独调这一项（一次只展开一个）
// dec=true 收小数（如花费 $0.5）；min/max 夹紧；回车或失焦提交。
// 行内可编辑数值：点数字直接在原地改（不冒输入框、不动字体字号），单位保留为静态文字
function cinSet(key, label, unit, dispVal, min, max, dec, onCommit) {
  const row = el('div', 'setitem cin-numrow');
  const lab = el('span', 'cin-setlab'); lab.textContent = label;
  const valw = el('span', 'cin-numval');
  const inp = document.createElement('input');
  inp.className = 'cin-numinp'; inp.type = 'text'; inp.inputMode = dec ? 'decimal' : 'numeric'; inp.setAttribute('enterkeyhint', 'done');
  const fmtNum = (v) => dec ? String(+(+v).toFixed(1)).replace(/\.0$/, '') : String(v | 0);   // 整数不显小数点
  const size = () => { inp.style.width = (Math.max(1, inp.value.length) + 0.6) + 'ch'; };   // +0.6ch 余量，单字符「0」不会被截掉右半
  inp.value = fmtNum(dispVal); size();
  const u = el('span', 'cin-numunit'); u.textContent = ' ' + unit;
  inp.addEventListener('input', size);
  const commit = () => {
    let v = dec ? parseFloat(inp.value) : parseInt(inp.value, 10);
    if (isNaN(v)) { inp.value = fmtNum(dispVal); size(); return; }   // 乱输还原
    v = Math.max(min, Math.min(max, v));                              // 夹到范围
    inp.value = fmtNum(v); size(); onCommit(v);
  };
  inp.addEventListener('change', commit);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
  valw.appendChild(inp); valw.appendChild(u);
  row.appendChild(lab); row.appendChild(valw);
  return row;
}
function openCinema(s) {
  state.cinemaReturn = state.screen;   // 从哪进来的（现在只从对话内 ⋮ 进 → 返回回到对话，不退出）
  state.cinTarget = s; state.cinAdv = false; state.cinOpen = null;   // 每次进来高级设置默认收起、各项也收起
  if (!state.cin || state.cin._sid !== s.id) state.cin = null;
  show('cinema'); renderCinema();
  wsend({ type: 'cinema_get', sessionId: s.id });
}
function cinemaBack() {
  if (state.cinemaReturn === 'chat' && state.currentSession) { show('chat'); }
  else { show('list'); wsend({ type: 'list_sessions' }); }
}
// 时间线：电影模式里左滑进入，单独一页，看她这段时间的记录
function openCinemaLog() {
  const s = state.cinTarget; if (!s) return;
  $('cinemaLogBody').innerHTML = '<div class="cl-empty">…</div>';
  showForward('cinemaLog', 'cinema');   // 时间线从右滑入，电影模式页垫在底下退出去（对称、符合直觉）
  wsend({ type: 'cinema_log_get', sessionId: s.id });
}
function renderCinemaLog(m) {
  const box = $('cinemaLogBody'); if (!box) return;
  const items = (m && m.items) || [];
  if (!items.length) { box.innerHTML = '<div class="cl-empty">还没有记录。<br>开启电影模式后，她在这段时间里的动静会记在这里。</div>'; return; }
  let html = '', lastDay = '';
  for (const it of items) {
    if (it.kind === 'quiet') continue;        // 旧的"没说话"噪音，不显示
    const d = new Date(it.at);
    const day = d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
    if (day !== lastDay) { html += '<div class="cl-day">' + esc(day) + '</div>'; lastDay = day; }
    const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    let cls = 'cl-evt', txt = it.text || '';
    if (it.kind === 'said') cls = 'cl-said';
    else if (it.kind === 'mood') { cls = 'cl-mood'; txt = '心情 · ' + txt; }
    else if (it.kind === 'here') { cls = 'cl-dim'; txt = '回到对话'; }
    else if (it.kind === 'away') { cls = 'cl-dim'; txt = '离开'; }
    else if (it.kind === 'watch') { cls = 'cl-watch'; txt = '醒了一下，没出声'; }   // 守夜/到点醒来但选择沉默 → 留一笔暗痕
    else if (it.kind === 'dream') { cls = 'cl-watch'; txt = '做了个梦'; }          // 凌晨的梦：露痕迹不露内容，色点=她给明天定的底色
    let meta = '';
    if (it.trigger === 'self') meta = '你定的时间';        // 她自己定的下次时间到了
    else if (it.trigger === 'mark') meta = '守夜';         // 守夜的坎兜底叫起
    const dotHtml = (it.kind !== 'mood' && it.mood) ? '<span class="cl-dot" style="background:' + moodTint(it.mood) + '" title="' + esc(it.mood) + '"></span>' : '';
    html += '<div class="cl-row ' + cls + '"><span class="cl-t">' + hm + '</span>' + dotHtml
      + '<span class="cl-x">' + esc(txt) + '</span>'
      + (meta ? '<span class="cl-meta">' + meta + '</span>' : '') + '</div>';
  }
  if (!html) { box.innerHTML = '<div class="cl-empty">还没有记录。<br>开启电影模式后，她在这段时间里的动静会记在这里。</div>'; return; }
  box.innerHTML = html;
  requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}
function fmtDur(sec) { sec = sec | 0; if (sec < 60) return sec + ' 秒'; const m = sec / 60; return (sec % 60 === 0 ? m : m.toFixed(1)) + ' 分钟'; }
function fmtSpan(ms) { const m = Math.round(ms / 60000); if (m < 60) return m + ' 分钟'; const h = Math.floor(m / 60), r = m % 60; return h + ' 小时' + (r ? ' ' + r + ' 分' : ''); }
function cinNoteHTML(c) {
  const on = !!c.on; const s = state.cinTarget; const otherHolder = c.holder && s && c.holder !== s.id ? c.holder : '';
  if (c.paused) return '已暂停：' + esc(c.pauseReason || '') + '。重新打开开关即可继续。';
  if (on) {
    const md = c.mood; let now = '';
    if (md && md.label) now = '此刻 <span class="mood-dot" style="background:' + moodTint(md.label) + '"></span><span class="mood-lab">' + esc(md.label) + '</span><span class="mood-sep">·</span>';
    return '<span class="cin-hint">' + now + '左滑查看时间线</span>';
  }
  if (otherHolder) return '另一个对话正开着（同一时间只能开一个），在这里打开会关掉那个。';
  return '开启后，你在这个对话里时她会和你一起；你离开后她会偶尔留意这段时间。';
}
function renderCinReceipt() {
  const box = $('cinReceipt'); if (!box) return;
  const c = state.cin || {};
  if (!c.on || !c.startedAt) { box.innerHTML = ''; return; }
  let inner = rcRow('ITEM', '这一程', 'rc-head');
  inner += rcRow('时长', fmtSpan(Date.now() - c.startedAt)) + rcRow('醒来', (c.wakes || 0) + ' 次') + rcRow('开口', (c.spoke || 0) + ' 次');
  inner += RC_RULE + rcRow('花费', '$' + (c.cost || 0).toFixed(2), 'rc-total');
  box.innerHTML = '<div class="receipt mini">' + inner + '<div class="rc-barcode"></div></div>';
}
function syncCinemaLive() {
  if (state.screen !== 'cinema') return;
  const c = state.cin || {};
  const note = $('cinStatus'); if (note) note.innerHTML = cinNoteHTML(c);
  const sw = $('cinToggleSw'); if (sw) sw.classList.toggle('on', !!c.on);
  renderCinReceipt();
}
function renderCinema() {
  const body = $('cinemaBody'); if (!body) return; body.innerHTML = '';
  const c = state.cin || {}; const s = state.cinTarget; const on = !!c.on;
  const head = el('div', 'cinhead'); const tt = el('div', 'cintitle'); tt.textContent = s ? (s.title || '这个对话') : ''; head.appendChild(tt); body.appendChild(head);
  const card0 = el('div', 'setmenu'); const trow = el('div', 'setitem togglerow'); const tlab = el('span'); tlab.textContent = '时间同步';
  const sw = el('button', 'switch' + (on ? ' on' : '')); sw.id = 'cinToggleSw'; sw.innerHTML = '<span class="knob"></span>';
  sw.addEventListener('click', () => { buzz(12); cinSend({ on: !((state.cin || {}).on) }); });
  trow.appendChild(tlab); trow.appendChild(sw); card0.appendChild(trow); body.appendChild(card0);
  const note = el('div', 'cinnote'); note.id = 'cinStatus'; note.innerHTML = cinNoteHTML(c); body.appendChild(note);
  const rc = el('div'); rc.id = 'cinReceipt'; body.appendChild(rc); // 这一程的小票

  // —— 高级设置：默认收起；点开后按「节奏 / 用量与刹车 / 模型」分组成卡片，不再一长条平铺 ——
  const adv = el('div', 'setmenu');
  const ah = el('div', 'setitem cin-advhead' + (state.cinAdv ? ' open' : ''));
  ah.innerHTML = '<span>高级设置</span><span class="cin-caret">›</span>';
  ah.addEventListener('click', () => { state.cinAdv = !state.cinAdv; renderCinema(); });
  adv.appendChild(ah); body.appendChild(adv);
  if (state.cinAdv) {
    const cap = (typeof c.maxCostPer5h === 'number') ? c.maxCostPer5h : 1.5; // 0=关熔断（不限）
    body.appendChild(cinGroup('节奏',
      cinSet('fg', '最短间隔（你在看时）', '分钟', (c.fgIntervalSec || 180) / 60, 0.5, 30, true, (v) => cinSend({ fgIntervalSec: Math.round(v * 60) })),
      cinSet('bg', '离开后最短间隔', '分钟', (c.bgIntervalSec || 600) / 60, 1, 60, true, (v) => cinSend({ bgIntervalSec: Math.round(v * 60) })),
      cinToggle('离开后放慢节奏', !!c.diffRate, () => cinSend({ diffRate: !c.diffRate }))));
    body.appendChild(cinGroup('用量与刹车',
      cinSet('cost', '花费上限（每 5 小时，0=不限）', '美元', cap, 0, 50, true, (v) => cinSend({ maxCostPer5h: v })),
      cinSet('wakes', '每 5 小时最多醒几次', '次', c.maxWakesPer5h || 30, 5, 120, false, (v) => cinSend({ maxWakesPer5h: v })),
      cinSet('pause', '额度到多少 % 自动停', '%', c.autoPauseUtil || 85, 50, 100, false, (v) => cinSend({ autoPauseUtil: v }))));
    body.appendChild(cinGroup('模型', cinModelRow(c)));
  }
  renderCinReceipt();
}
function cinGroup(title) {
  const card = el('div', 'setmenu cin-group');
  const h = el('div', 'cin-grouphd'); h.textContent = title; card.appendChild(h);
  for (let i = 1; i < arguments.length; i++) if (arguments[i]) card.appendChild(arguments[i]);
  return card;
}
function cinModelRow(c) {
  const row = el('div', 'setitem cin-modelrow');
  const lab = el('span', 'seg-label'); lab.textContent = '醒来用哪个模型'; row.appendChild(lab);
  const id = c.deliberateModel || '';
  const val = el('span', 'cin-modelval');
  val.textContent = id ? (modelDisplay(id.replace('[1m]', '')) + (/\[1m\]$/.test(id) ? ' 1M' : '')) : '跟随对话默认';
  row.appendChild(val);
  const chev = el('span', 'cin-modelchev'); chev.textContent = '›'; row.appendChild(chev);
  row.addEventListener('click', openCinModelSheet);
  return row;
}
function onCinemaState(m) {
  const st = m.state || {};
  state.cinemaOnSid = st.holder || '';
  // holder 的周期广播带着这一程的全量账 → 存一份给对话列表行用（时间流动中 · 醒 N 次 / 冷场着色）
  if (st.holder && m.sessionId === st.holder && st.on) state.cinemaInfo = { sid: m.sessionId, wakes: st.wakes || 0, spoke: st.spoke || 0, lastSpokeAt: st.lastSpokeAt || 0, startedAt: st.startedAt || 0 };
  else if (!st.holder) state.cinemaInfo = null;
  if (state.cinTarget && state.cinTarget.id === m.sessionId) {
    const hadCfg = !!state.cin; state.cin = { _sid: m.sessionId, ...st };
    // 首次拿到状态要整渲染（填好控件）；之后的周期广播只更新状态行/小票/开关，别打断正在操作的控件
    if (state.screen === 'cinema') { if (!hadCfg) renderCinema(); else syncCinemaLive(); }
  }
  updateCinemaBar();
  if (state.screen === 'list') renderSessions();
}
// 旧的聊天页横幅退役：「时间流动中」改到对话列表行，「输入中」改成标题旁的省略号动画。
function updateTitleTyping() {
  const t = $('chatTitle'); if (!t) return;
  const typing = state.screen === 'chat' && state.currentSession && state.cinemaTyping === state.currentSession;
  let dots = t.querySelector('.typing-dots');
  if (typing && !dots) { dots = el('span', 'typing-dots'); dots.innerHTML = '<i></i><i></i><i></i>'; t.appendChild(dots); }
  else if (!typing && dots) dots.remove();
}
function updateCinemaBar() {
  const bar = $('cinemaBar'); if (bar) bar.style.display = 'none';
  updateTitleTyping();
}
function openWakeConfig(s) {
  state.wakeTarget = s;
  $('wakeSub').textContent = s.title || '';
  fillWakeForm({ enabled: !!s.wakeAt, nextAt: s.wakeAt || 0 });
  openScrim('wakeScrim');
  wsend({ type: 'wakeup_get', sessionId: s.id }); // authoritative state → fillWakeForm
}
function fillWakeForm(st) {
  const now = new Date();
  const dp = String(st.dawnTime || '04:00').split(':');
  const w = state.wk = {
    enabled: !!st.enabled, chase: !!st.chase, wakeOnEnter: !!st.wakeOnEnter, dawn: !!st.dawn,
    dawnH: (+dp[0] || 0), dawnM: (+dp[1] || 0),
    list: (st.schedules || []).filter((s) => s.by !== 'cc' && (s.nextAt || s.repeat)).map((s) => ({ nextAt: s.nextAt || 0, repeat: s.repeat || null, note: s.note || '' })),
    cc: (st.schedules || []).filter((s) => s.by === 'cc').map((s) => ({ id: s.id, nextAt: s.nextAt || 0, repeat: s.repeat || null, note: s.note || '' })),
    eMode: 'daily', eDate: todayLocalStr(), eHour: (now.getHours() + 1) % 24, eMin: 0, eEvery: 180,
  };
  closeWakeEditor();
  renderWakeForm();
}
function renderWakeForm() {
  const w = state.wk; if (!w) return;
  $('wkEnable').classList.toggle('on', w.enabled);
  $('wkChase').classList.toggle('on', w.chase);
  $('wkEnter').classList.toggle('on', w.wakeOnEnter);
  $('wkDawn').classList.toggle('on', w.dawn);
  $('wkConfig').style.display = w.enabled ? '' : 'none';
  $('wkDawnCfg').style.display = w.dawn ? '' : 'none';
  renderWakeList();
  renderDawnArea();
  if ($('wkEditor').style.display !== 'none') { document.querySelectorAll('#wkMode button').forEach((b) => b.classList.toggle('on', b.dataset.m === w.eMode)); renderWakeModeArea(); }
}
function humanizeEvery(min) { return (min % 60 === 0) ? (min / 60) + ' 小时' : min + ' 分钟'; }
function scheduleLabel(sch) {
  if (sch.repeat && sch.repeat.kind === 'daily') return '每天 ' + (sch.repeat.at || '');
  if (sch.repeat && sch.repeat.kind === 'every') return '每隔 ' + humanizeEvery(sch.repeat.minutes || 0);
  return wakeLabel(sch.nextAt);
}
function renderWakeList() {
  const w = state.wk; const box = $('wkList'); box.innerHTML = '';
  if (!w.list.length && !(w.cc || []).length) { const e = el('div', 'wkempty'); e.textContent = '还没有唤醒时间，点下面添加。'; box.appendChild(e); }
  w.list.forEach((sch, i) => {
    const it = el('div', 'wkitem');
    const main = el('div', 'wki-main');
    const wh = el('div', 'wki-when'); wh.textContent = scheduleLabel(sch); main.appendChild(wh);
    if (sch.note) { const nb = el('div', 'wki-sub'); nb.textContent = sch.note; main.appendChild(nb); }
    if (sch.repeat && sch.repeat.kind === 'every' && sch.nextAt) { const sub = el('div', 'wki-sub'); sub.textContent = '下次 ' + wakeLabel(sch.nextAt); main.appendChild(sub); }
    it.appendChild(main);
    const del = el('button', 'wki-del'); del.textContent = '×'; del.addEventListener('click', () => { w.list.splice(i, 1); renderWakeForm(); }); it.appendChild(del);
    box.appendChild(it);
  });
  (w.cc || []).forEach((sch) => {
    const it = el('div', 'wkitem');
    const main = el('div', 'wki-main');
    const wh = el('div', 'wki-when'); wh.textContent = scheduleLabel(sch); main.appendChild(wh);
    if (sch.note) { const nb = el('div', 'wki-sub'); nb.textContent = sch.note; main.appendChild(nb); }
    if (sch.repeat && sch.repeat.kind === 'every' && sch.nextAt) { const sub = el('div', 'wki-sub'); sub.textContent = '下次 ' + wakeLabel(sch.nextAt); main.appendChild(sub); }
    it.appendChild(main);
    const tag = el('div', 'wki-cc'); tag.textContent = 'cc'; it.appendChild(tag);
    const del = el('button', 'wki-del'); del.textContent = '×';
    del.addEventListener('click', () => {
      const s = state.wakeTarget; if (!s) return;
      wsend({ type: 'wakeup_clear_cc', sessionId: s.id, id: sch.id });
      w.cc = (w.cc || []).filter((x) => x.id !== sch.id); renderWakeForm();
    });
    it.appendChild(del);
    box.appendChild(it);
  });
  if ((w.cc || []).length > 1) {
    const clr = el('button', 'wkcc-clear'); clr.textContent = '清除全部 cc 自排的醒来';
    clr.addEventListener('click', () => {
      const s = state.wakeTarget; if (!s) return;
      wsend({ type: 'wakeup_clear_cc', sessionId: s.id });
      w.cc = []; renderWakeForm(); toast('已清掉 cc 自排的醒来');
    });
    box.appendChild(clr);
  }
}
function renderDawnArea() {
  const w = state.wk; const box = $('wkDawnArea'); box.innerHTML = '';
  box.appendChild(wkInline('入睡时间', wkClock(() => w.dawnH, (v) => { w.dawnH = v; }, () => w.dawnM, (v) => { w.dawnM = v; })));
}
function openWakeEditor() {
  const w = state.wk; if (!w) return; const now = new Date();
  w.eMode = 'daily'; w.eDate = todayLocalStr(); w.eHour = (now.getHours() + 1) % 24; w.eMin = 0; w.eEvery = 180;
  $('wkNote').value = '';
  $('wkEditor').style.display = ''; $('wkAdd').style.display = 'none';
  document.querySelectorAll('#wkMode button').forEach((b) => b.classList.toggle('on', b.dataset.m === w.eMode));
  renderWakeModeArea();
}
function closeWakeEditor() { $('wkEditor').style.display = 'none'; $('wkAdd').style.display = ''; }
function addFromEditor() {
  const w = state.wk; let item = null;
  if (w.eMode === 'once') { const t = wkEpochDate(w.eDate, w.eHour, w.eMin); if (t <= Date.now()) { toast('这个时间已经过了，换个更晚的'); return; } item = { nextAt: t, repeat: null }; }
  else if (w.eMode === 'daily') { const at = pad2(w.eHour) + ':' + pad2(w.eMin); if (w.list.some((s) => s.repeat && s.repeat.kind === 'daily' && s.repeat.at === at)) { toast('已经有这个每天时间了'); closeWakeEditor(); renderWakeForm(); return; } item = { nextAt: wkNextDaily(w.eHour, w.eMin), repeat: { kind: 'daily', at } }; }
  else { if (w.list.some((s) => s.repeat && s.repeat.kind === 'every' && s.repeat.minutes === w.eEvery)) { toast('已经有这个间隔了'); closeWakeEditor(); renderWakeForm(); return; } item = { nextAt: Date.now() + w.eEvery * 60000, repeat: { kind: 'every', minutes: w.eEvery } }; }
  item.note = ($('wkNote').value || '').trim().slice(0, 40);
  w.list.push(item); closeWakeEditor(); renderWakeForm();
}
function wkChip(label, on, cb) { const b = el('button', 'wkt' + (on ? ' on' : '')); b.textContent = label; b.addEventListener('click', cb); return b; }
// 闹钟式竖向滚轮：上下滚、吸附居中、可循环。values=值数组，sel=初始下标，fmt(v)=显示，onSel(i)=选中回调
function wkWheel(values, sel, fmt, onSel, loop, vis) {
  const ITEM = 30, VIS = vis || 1, CTR = (VIS - 1) >> 1;   // 默认紧凑：VIS=1 只显当前值、无上下预览（ITEM 改了要同步 .whl-item 高度）
  const n = values.length, COPIES = loop ? 9 : 1, MID = loop ? (COPIES >> 1) : 0;
  const wrap = el('div', 'whl' + (VIS === 1 ? ' whl-flat' : '')); wrap.style.height = (ITEM * VIS) + 'px';
  const scr = el('div', 'whl-scroll'); wrap.appendChild(scr);
  if (VIS > 1) { const band = el('div', 'whl-band'); band.style.top = (ITEM * CTR) + 'px'; band.style.height = ITEM + 'px'; wrap.appendChild(band); }
  const items = [];
  const pad = () => el('div', 'whl-item whl-pad');
  if (!loop) for (let i = 0; i < CTR; i++) scr.appendChild(pad());
  for (let c = 0; c < COPIES; c++) for (let i = 0; i < n; i++) { const d = el('div', 'whl-item'); d.textContent = fmt(values[i]); scr.appendChild(d); items.push(d); }
  if (!loop) for (let i = 0; i < CTR; i++) scr.appendChild(pad());
  let cur = -1;
  const hl = (k) => items.forEach((d, j) => d.classList.toggle('on', j === k));
  function settle() {
    if (loop) {
      let g = Math.round(scr.scrollTop / ITEM) + CTR;
      if (g < n * 2 || g > n * (COPIES - 2)) { const vi = ((g % n) + n) % n; g = MID * n + vi; scr.scrollTop = (g - CTR) * ITEM; }
      const vi = ((g % n) + n) % n; hl(g); if (vi !== cur) { cur = vi; onSel(vi); buzz(6); }
    } else {
      let si = Math.max(0, Math.min(n - 1, Math.round(scr.scrollTop / ITEM))); hl(si); if (si !== cur) { cur = si; onSel(si); buzz(6); }
    }
  }
  let t = null;
  scr.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(settle, 90); });
  setTimeout(() => { const g = loop ? (MID * n + sel) : sel; scr.scrollTop = (loop ? (g - CTR) : g) * ITEM; cur = ((sel % n) + n) % n; hl(loop ? g : sel); }, 0);
  return wrap;
}
// 时:分 两滚轮并排，紧凑 12:00（每格只显当前值、上下滚改、无预览）
function wkClock(getH, setH, getM, setM) {
  const row = el('div', 'wkclock compact');
  const hours = []; for (let h = 0; h < 24; h++) hours.push(h);
  const mins = []; for (let m = 0; m < 60; m++) mins.push(m);
  row.appendChild(wkWheel(hours, getH(), (v) => pad2(v), (i) => setH(i), true, 1));
  const sep = el('div', 'wkclock-sep'); sep.textContent = ':'; row.appendChild(sep);
  row.appendChild(wkWheel(mins, getM(), (v) => pad2(v), (i) => setM(i), true, 1));
  return row;
}
// 标签 + 控件同一行（不再「标签一行、控件单独空一行」）
function wkInline(label, control) {
  const row = el('div', 'wkinline');
  const l = el('div', 'wkinline-l'); l.textContent = label; row.appendChild(l);
  control.classList.add('wkinline-c'); row.appendChild(control);
  return row;
}
function renderWakeModeArea() {
  const w = state.wk; const box = $('wkModeArea'); box.innerHTML = '';
  if (w.eMode === 'every') {
    const lbl = el('div', 'wklabel'); lbl.textContent = '间隔'; box.appendChild(lbl);
    const row = el('div', 'wkgrid');
    [[60, '1 小时'], [120, '2 小时'], [180, '3 小时'], [360, '6 小时'], [720, '12 小时']].forEach((a) => row.appendChild(wkChip(a[1], w.eEvery === a[0], () => { w.eEvery = a[0]; renderWakeModeArea(); })));
    box.appendChild(row); return;
  }
  if (w.eMode === 'once') {
    const base = new Date(); base.setHours(0, 0, 0, 0);
    const dates = []; for (let i = 0; i < 60; i++) { const d = new Date(base.getTime() + i * 86400000); dates.push(d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())); }
    let si = dates.indexOf(w.eDate); if (si < 0) si = 0;
    box.appendChild(wkInline('日期', wkWheel(dates, si, (v) => dateChipLabel(v), (i) => { w.eDate = dates[i]; }, false, 1)));
  }
  box.appendChild(wkInline('时间', wkClock(() => w.eHour, (v) => { w.eHour = v; }, () => w.eMin, (v) => { w.eMin = v; })));
}
function dateChipLabel(ds) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const f = (off) => { const d = new Date(t.getTime() + off * 86400000); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  if (ds === f(0)) return '今天'; if (ds === f(1)) return '明天'; if (ds === f(2)) return '后天';
  const p = ds.split('-'); const d = new Date(+p[0], +p[1] - 1, +p[2]);
  return (+p[1]) + '/' + (+p[2]) + ' ' + ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
}
function wkEpochDate(ds, h, m) { const p = ds.split('-'); const d = new Date(+p[0], +p[1] - 1, +p[2]); d.setHours(h, m, 0, 0); return d.getTime(); }
function wkNextDaily(h, m) { const d = new Date(); d.setHours(h, m, 0, 0); if (d.getTime() <= Date.now() + 1000) d.setDate(d.getDate() + 1); return d.getTime(); }
function saveWake() {
  const s = state.wakeTarget; if (!s) return; const w = state.wk;
  const dawnTime = pad2(w.dawnH) + ':' + pad2(w.dawnM);
  if (w.enabled && !w.list.length) { toast('还没添加唤醒时间，或关掉「开启定时唤醒」'); return; }
  const schedules = w.list.map((sch) => ({ nextAt: sch.nextAt || 0, repeat: sch.repeat || null, note: sch.note || '' }));
  wsend({ type: 'wakeup_set', sessionId: s.id, enabled: w.enabled, schedules, chase: w.chase, wakeOnEnter: w.wakeOnEnter, dawn: w.dawn, dawnTime });
  closeScrim('wakeScrim');
  if (!w.enabled) { toast(w.dawn ? '已关闭唤醒 · 仅定时入睡 ' + dawnTime : '已关闭定时唤醒'); return; }
  const next = schedules.map((x) => x.nextAt).filter(Boolean).sort((a, b) => a - b)[0];
  toast('已设置 · ' + w.list.length + ' 个唤醒时间' + (next ? ' · 下次 ' + wakeLabel(next) : ''));
}

/* ---- 小纸条 ---- */
function onStickies(m) {
  state.stickyCache = state.stickyCache || {};
  state.stickyCache[m.sessionId] = m.notes || [];
  if (state.stickyPopupFor === m.sessionId) {
    state.stickyPopupFor = null;
    const unread = (m.notes || []).filter((n) => !n.read);
    if (unread.length) { state.stickyQueue = unread.slice(); state.stickySess = m.sessionId; openStickyPopup(); }
  }
}
function openStickyPopup() {
  const q = state.stickyQueue;
  if (!q || !q.length) { closeScrim('stickyScrim'); return; }
  $('stkText').textContent = q[0].text;
  $('stkSub').textContent = q.length > 1 ? '还有 ' + (q.length - 1) + ' 张' : '';
  openScrim('stickyScrim');
}
function stickyAck(read) {
  const q = state.stickyQueue || [];
  const n = q.shift();
  if (n && read && state.stickySess) wsend({ type: 'sticky_read', sessionId: state.stickySess, id: n.id });
  closeScrim('stickyScrim');
  if (q.length) setTimeout(openStickyPopup, 260);
}

/* ============ 总日历（全局：日程/待办/心情色/日记 + 便签栏） ============ */
function openCalendar(from) {
  state.calFrom = from || (state.currentSession ? 'chat' : 'list');
  const now = new Date(); state.calY = now.getFullYear(); state.calM = now.getMonth();
  state.selDay = todayLocalStr(); state.calMode = 'cal'; state.calDays = {}; state.dayData = null;
  $('diaryTitle').textContent = '日历';
  show('diary'); renderCalendarScreen();
  reqCalendar(); reqDay(state.selDay); wsend({ type: 'todos_get' }); wsend({ type: 'sticky_all' });
}
function calMonthStr() { return state.calY + '-' + pad2(state.calM + 1); }
function reqCalendar() { wsend({ type: 'calendar_get', month: calMonthStr() }); }
function reqDay(ds) { wsend({ type: 'day_get', date: ds }); }
function calNav(delta) { let m = state.calM + delta, y = state.calY; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } state.calM = m; state.calY = y; state.calDays = {}; reqCalendar(); renderCalGridOnly(); }
function onCalendar(m) { state.calDays = m.days || {}; if (state.screen === 'diary' && state.calMode === 'cal') renderCalGridOnly(); }
function onDay(m) { if (m.date !== state.selDay) return; state.dayData = m; if (state.screen === 'diary') { if (state.calMode === 'cal') renderDayPanel(); else renderDiaryList(); } }
function onTodos(m) { state.allTodos = m.items || []; if (state.screen === 'diary' && state.calMode === 'cal') renderDayPanel(); }
function selectDay(ds) { state.selDay = ds; state.dayData = null; reqDay(ds); renderCalGridOnly(); renderDayPanel(); }
function diaryBack() { const to = state.calFrom === 'chat' ? 'chat' : 'list'; show(to); if (to === 'list') wsend({ type: 'list_sessions' }); }
function renderCalendarScreen() {
  if (state.screen !== 'diary') return;
  const body = $('diaryBody'); body.innerHTML = '';
  const seg = el('div', 'calseg');
  [['cal', '日历'], ['diary', '日记']].forEach(([mode, lbl]) => {
    const b = el('button', 'calseg-b' + (state.calMode === mode ? ' on' : '')); b.textContent = lbl;
    b.onclick = () => { if (state.calMode === mode) return; state.calMode = mode; renderCalendarScreen(); };
    seg.appendChild(b);
  });
  body.appendChild(seg);
  if (state.calMode === 'cal') {
    const wrap = el('div', 'calwrap'); wrap.id = 'calWrap'; body.appendChild(wrap);
    const panel = el('div', 'daypanel'); panel.id = 'dayPanel'; body.appendChild(panel);
    renderCalGridOnly(); renderDayPanel(); renderPinned();
  } else {
    const list = el('div', 'diarylist'); list.id = 'diaryList'; body.appendChild(list);
    renderDiaryList();
  }
}
// 只重建日历网格（不动叠在上面的便签纸片层 .pinlayer）
function renderCalGridOnly() {
  const wrap = $('calWrap'); if (!wrap) return;
  const old = wrap.querySelector('.cal'); if (old) old.remove();
  const cal = el('div', 'cal');
  const Y = state.calY, M = state.calM;
  const head = el('div', 'cal-head');
  const prev = el('button', 'cal-nav'); prev.textContent = '‹'; prev.onclick = () => calNav(-1);
  const lbl = el('div', 'cal-lbl'); lbl.textContent = Y + '年' + (M + 1) + '月';
  const next = el('button', 'cal-nav'); next.textContent = '›'; next.onclick = () => calNav(1);
  head.append(prev, lbl, next); cal.appendChild(head);
  const grid = el('div', 'cal-grid');
  ['日', '一', '二', '三', '四', '五', '六'].forEach((w) => { const c = el('div', 'cal-w'); c.textContent = w; grid.appendChild(c); });
  const first = new Date(Y, M, 1).getDay(), dim = new Date(Y, M + 1, 0).getDate();
  for (let i = 0; i < first; i++) grid.appendChild(el('div', 'cal-cell other'));
  const today = todayLocalStr();
  for (let d = 1; d <= dim; d++) {
    const ds = Y + '-' + pad2(M + 1) + '-' + pad2(d);
    const info = state.calDays[ds] || {};
    const cell = el('div', 'cal-cell' + (ds === state.selDay ? ' sel' : '') + (ds === today ? ' today' : ''));
    if (info.mood != null) { const mo = (typeof info.mood === 'object') ? info.mood : { word: '', level: info.mood }; cell.style.background = moodWash(mo.word, mo.k != null ? mo.k : mo.level); cell.classList.add('hasmood'); }
    cell.appendChild(document.createTextNode(String(d)));
    const marks = el('div', 'cal-marks');
    if (info.diary) marks.appendChild(el('span', 'cm cm-d'));
    if (info.events) marks.appendChild(el('span', 'cm cm-e'));
    if (info.todos) marks.appendChild(el('span', 'cm cm-t'));
    if (marks.childNodes.length) cell.appendChild(marks);
    cell.onclick = () => { if (state.selDay !== ds) selectDay(ds); };
    grid.appendChild(cell);
  }
  cal.appendChild(grid);
  wrap.insertBefore(cal, wrap.firstChild);
}
function dpSec(title, addLabel, onAdd) {
  const r = el('div', 'dp-sec');
  const t = el('div', 'dp-sec-t'); t.textContent = title; r.appendChild(t);
  if (onAdd) { const a = el('button', 'dp-add'); a.textContent = '＋' + (addLabel || ''); a.onclick = onAdd; r.appendChild(a); }
  return r;
}
function dpEmpty(text) { const e = el('div', 'dp-empty'); e.textContent = text; return e; }
function renderDayPanel() {
  const panel = $('dayPanel'); if (!panel) return; panel.innerHTML = '';
  const ds = state.selDay; const d = state.dayData || { events: [], todos: [] };
  const hh = diaryHead(ds);
  const head = el('div', 'dp-head'); head.innerHTML = '<b>' + hh.day + '</b><span>' + hh.wk + ' · ' + hh.ym + '</span>';
  panel.appendChild(head);
  panel.appendChild(dpSec('日程', '日程', () => addEvent(ds)));
  const evs = d.events || [];
  if (!evs.length) panel.appendChild(dpEmpty('这天没有日程'));
  evs.forEach((ev) => panel.appendChild(eventRow(ev)));
  panel.appendChild(dpSec('待办', '待办', () => addTodo(ds)));
  const tds = (state.allTodos || []).filter((t) => t.date === ds || !t.date).sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || a.ts - b.ts);
  if (!tds.length) panel.appendChild(dpEmpty('没有待办'));
  tds.forEach((td) => panel.appendChild(todoRow(td)));
}
// 「日记」标签：只看选中那天（默认今天）的日记，缩略卡片（有图放缩略图 + 文字 3 行）
function renderDiaryList() {
  const list = $('diaryList'); if (!list) return; list.innerHTML = '';
  const ds = state.selDay; const d = state.dayData || { diary: [], mood: null };
  const hh = diaryHead(ds);
  const head = el('div', 'dp-head'); head.innerHTML = '<b>' + hh.day + '</b><span>' + hh.wk + ' · ' + hh.ym + '</span>';
  list.appendChild(head);
  const add = el('button', 'dwritebtn'); add.textContent = '＋ 写日记'; add.onclick = () => writeDiaryFor(ds); list.appendChild(add);
  const items = d.diary || [];
  if (!items.length) { list.appendChild(dpEmpty('这天还没有日记')); return; }
  items.forEach((en) => list.appendChild(diaryPreview(en)));
}
function agCheck(done, onTap) { const ck = el('button', 'agck' + (done ? ' on' : '')); ck.textContent = done ? '✓' : ''; ck.onclick = (e) => { e.stopPropagation(); onTap(); }; return ck; }
function eventRow(ev) {
  const r = el('div', 'agrow' + (ev.done ? ' done' : ''));
  r.appendChild(agCheck(ev.done, () => wsend({ type: 'event_update', id: ev.id, done: !ev.done })));
  const mid = el('div', 'agmid');
  const tl = el('div', 'agtitle'); tl.textContent = (ev.time ? ev.time + '  ' : '') + ev.title;
  if (ev.by === 'cc') { const tag = el('span', 'agby'); tag.textContent = state.aName; tl.appendChild(tag); }
  mid.appendChild(tl);
  if (ev.note) { const nt = el('div', 'agnote'); nt.textContent = ev.note; mid.appendChild(nt); }
  let held = false;
  bindHold(mid, () => { held = true; openConfirm('删除这条日程？', '', () => wsend({ type: 'event_delete', id: ev.id })); });
  mid.addEventListener('click', () => { if (held) { held = false; return; } editEvent(ev); });
  r.appendChild(mid); return r;
}
function todoRow(td) {
  const r = el('div', 'agrow' + (td.done ? ' done' : ''));
  r.appendChild(agCheck(td.done, () => wsend({ type: 'todo_toggle', id: td.id })));
  const mid = el('div', 'agmid');
  const tl = el('div', 'agtitle'); tl.textContent = td.title;
  if (!td.date) { const dt = el('span', 'agdate'); dt.textContent = '不限'; tl.appendChild(dt); }
  if (td.by === 'cc') { const tag = el('span', 'agby'); tag.textContent = state.aName; tl.appendChild(tag); }
  mid.appendChild(tl);
  let held = false;
  bindHold(mid, () => { held = true; openConfirm('删除这条待办？', '', () => wsend({ type: 'todo_delete', id: td.id })); });
  mid.addEventListener('click', () => { if (held) { held = false; return; } editTodo(td); });
  r.appendChild(mid); return r;
}
function parseEvtInput(v) { const m = String(v || '').trim().match(/^(\d{1,2}:\d{2})\s+(.+)$/); return m ? { time: m[1], title: m[2].trim() } : { time: '', title: String(v || '').trim() }; }
function addEvent(ds) { openPrompt('几点·做什么（例：14:00 见导师，时间可省略）', '', (v) => { const p = parseEvtInput(v); if (p.title) wsend({ type: 'event_add', date: ds, time: p.time, title: p.title }); }); }
function editEvent(ev) { openPrompt('改这条日程（开头可写时间，如 14:00 …）', (ev.time ? ev.time + ' ' : '') + ev.title, (v) => { const p = parseEvtInput(v); if (p.title) wsend({ type: 'event_update', id: ev.id, time: p.time, title: p.title }); }); }
function addTodo(ds) { openPrompt('写一条待办', '', (v) => { const t = String(v || '').trim(); if (t) wsend({ type: 'todo_add', title: t, date: ds }); }); }
function editTodo(td) { openPrompt('改这条待办', td.title, (v) => { const t = String(v || '').trim(); if (t) wsend({ type: 'todo_update', id: td.id, title: t }); }); }
function writeDiaryFor(ds) { state.diarySession = '__me'; state.diaryDay = ds; openDiaryWrite(); }
function diaryPreview(en) {
  const card = el('div', 'dprev');
  if (en.mood) card.style.background = moodWash(en.mood, en.moodK); // 单条日记自己的心情，不再共用全天一个色
  const meta = el('div', 'dprev-meta');
  const who = en.author === 'cc' ? (en.sidTitle || state.aName) : '我';
  meta.textContent = fmtClock(en.ts) + ' · ' + who + (en.weather ? ' · ' + en.weather : '') + (en.tags ? ' · #' + en.tags : '');
  card.appendChild(meta);
  const row = el('div', 'dprev-row');
  const tx = el('div', 'dprev-text'); tx.textContent = en.text || '（图片）'; row.appendChild(tx);
  const imgs = en.images || [];
  if (imgs.length) { const im = el('img', 'dprev-thumb'); im.src = diaryImgUrl(imgs[0]); row.appendChild(im); }
  card.appendChild(row);
  // 点缩略 → 打开日记页「只读态」（右上角是「编辑」，点了才能改）
  card.addEventListener('click', () => { state.diarySession = en.sid; state.diaryDay = state.selDay; openDiaryWrite(en, { readonly: true }); });
  return card;
}

/* ---- 便签栏（单独一页，统一管理所有便签；可贴到日历/摘下/收藏） ---- */
function openStickies() { show('stickies'); wsend({ type: 'sticky_all' }); renderStickyPage(); }
function onStickiesAll(m) { state.stickyAll = m.items || []; if (state.screen === 'stickies') renderStickyPage(); if (state.screen === 'diary' && state.calMode === 'cal') renderPinned(); }
function renderStickyPage() {
  const body = $('stickiesBody'); if (!body) return; body.innerHTML = '';
  const items = state.stickyAll || [];
  if (!items.length) { body.appendChild(dpEmpty('还没有便签。')); return; }
  items.forEach((n) => {
    const note = el('div', 'panelnote' + (n.pinned ? ' pinned' : '') + (n.read ? '' : ' unread'));
    const tx = el('div', 'pn-text'); tx.textContent = n.text; note.appendChild(tx);
    const acts = el('div', 'pn-acts');
    const pin = el('button', 'pn-act'); pin.textContent = n.pinned ? '摘下' : '贴到日历'; pin.onclick = () => wsend({ type: n.pinned ? 'sticky_unpin' : 'sticky_pin', sid: n.sid, id: n.id });
    const fav = el('button', 'pn-act'); fav.textContent = '收藏'; fav.onclick = () => { wsend({ type: 'sticky_fav', sid: n.sid, id: n.id }); toast('已放进收藏夹'); };
    const del = el('button', 'pn-act danger'); del.textContent = '删除'; del.onclick = () => wsend({ type: 'sticky_delete', sessionId: n.sid, id: n.id });
    acts.append(pin, fav, del); note.appendChild(acts);
    body.appendChild(note);
  });
}
// 贴在日历上的便利贴层（可拖摆位）
function renderPinned() {
  const wrap = $('calWrap'); if (!wrap) return;
  const oldL = wrap.querySelector('.pinlayer'); if (oldL) oldL.remove();
  const layer = el('div', 'pinlayer');
  (state.stickyAll || []).filter((n) => n.pinned).forEach((n) => {
    const note = el('div', 'pinnote'); note.setAttribute('data-noswipe', '');
    const tx = el('div', 'pinnote-t'); tx.textContent = n.text; note.appendChild(tx);
    const acts = el('div', 'pin-acts');
    const down = el('button', 'pin-a'); down.textContent = '摘下'; down.onclick = (e) => { e.stopPropagation(); wsend({ type: 'sticky_unpin', sid: n.sid, id: n.id }); };
    const fav = el('button', 'pin-a'); fav.textContent = '收藏'; fav.onclick = (e) => { e.stopPropagation(); wsend({ type: 'sticky_fav', sid: n.sid, id: n.id }); toast('已放进收藏夹'); };
    acts.append(down, fav); note.appendChild(acts);
    const pos = n.pos || { x: 0.5, y: 0.4 }; note.style.left = (pos.x * 100) + '%'; note.style.top = (pos.y * 100) + '%';
    bindPinDrag(note, wrap, n);
    layer.appendChild(note);
  });
  wrap.appendChild(layer);
}
function bindPinDrag(note, wrap, n) {
  let sx = 0, sy = 0, moved = false, dragging = false, startL = 0, startT = 0;
  note.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) return; dragging = true; moved = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY; const r = wrap.getBoundingClientRect(), nr = note.getBoundingClientRect(); startL = nr.left - r.left + nr.width / 2; startT = nr.top - r.top + nr.height / 2; note.style.transition = 'none'; note.classList.add('drag'); }, { passive: true });
  note.addEventListener('touchmove', (e) => { if (!dragging) return; const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy; if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true; if (!moved) return; e.preventDefault(); const r = wrap.getBoundingClientRect(); let x = (startL + dx) / r.width, y = (startT + dy) / r.height; x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y)); note.style.left = (x * 100) + '%'; note.style.top = (y * 100) + '%'; note._x = x; note._y = y; }, { passive: false });
  note.addEventListener('touchend', () => { if (!dragging) return; dragging = false; note.style.transition = ''; note.classList.remove('drag'); if (moved && note._x != null) wsend({ type: 'sticky_pin', sid: n.sid, id: n.id, x: note._x, y: note._y }); else if (!moved) note.classList.toggle('open'); });
}
/* ============ 收藏夹（跨对话金句，仿日记 overview） ============ */
function openFavoritesOverview() {
  $('favBody').innerHTML = '<div class="dempty">加载中…</div>';
  show('favorites'); wsend({ type: 'favorites_get' });
}
function onFavorites(m) { state.favs = m.items || []; if (state.screen === 'favorites') renderFavCards(state.favs); }
function favWhen(ts) { const d = new Date(ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function renderFavCards(items) {
  const body = $('favBody'); body.innerHTML = '';
  if (!items.length) { const e = el('div', 'dempty'); e.innerHTML = '还没有收藏。<br>在对话里选中一句话，点浮条上的「收藏」。'; body.appendChild(e); return; }
  items.forEach((it) => {
    const card = el('div', 'dcard'); let held = false;
    const tx = el('div', 'fav-text'); tx.textContent = it.text;
    const sub = el('div', 'dcard-sub'); sub.textContent = (it.title || '（来源对话）') + '  ·  ' + favWhen(it.ts);
    card.append(tx, sub);
    bindHold(card, () => { held = true; openConfirm('删除这条收藏？', '', () => wsend({ type: 'favorites_delete', id: it.id })); });
    card.addEventListener('click', () => { if (held) { held = false; return; } if (it.sessionId) jumpToDialog(it.sessionId, it.text); else toast('这条没有来源对话'); });
    body.appendChild(card);
  });
}
function diaryImgDir() { return (((state.defaultCwd || state.cwd || '').replace(/\/$/, '')) || '') + '/.telos-diary'; }
// open the write/edit page. pass an entry to edit it, omit to write a new one.
function diaryHead(ds) { const p = (ds || '').split('-'); const d = new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); return { day: (+p[2] || 1), wk: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()], ym: (p[0] || '') + '.' + (+p[1] || 1) }; }
function dwUpdateCount() { $('dwCount').textContent = $('dwText').value.length + ' 字'; }
function openDiaryWrite(entry, opts) {
  opts = opts || {};
  state.dwReadonly = !!opts.readonly;
  state.dwEditing = entry || null;
  state.dwImages = (entry && Array.isArray(entry.images)) ? entry.images.slice() : [];
  state.dwMood = entry ? (entry.mood || '') : '';                       // 心情是这条日记自己的，从 entry 回填
  state.dwMoodK = (entry && entry.moodK != null) ? entry.moodK : null;
  state.dwWeather = entry ? (entry.weather || '') : '';
  state.dwTags = entry ? (entry.tags || '') : '';
  $('dwText').value = entry ? (entry.text || '') : '';
  const h = diaryHead(state.diaryDay); $('dwDay').textContent = h.day; $('dwWk').textContent = h.wk; $('dwYm').textContent = h.ym;
  closeDwPicker(); renderDwImgs(); updateDwMoodWeather(); dwUpdateCount(); applyDwMode();
  show('diaryWrite');
  if (!state.dwReadonly) setTimeout(() => $('dwText').focus(), 150);
}
// 只读态：textarea 不可改、右上角按钮是「编辑」、隐藏加图/元数据交互。点「编辑」才转可改。
function applyDwMode() {
  const ro = !!state.dwReadonly;
  $('dwText').readOnly = ro;
  $('dwSave').textContent = ro ? '编辑' : '保存';
  $('diaryWrite').classList.toggle('readonly', ro);
}
function dwSaveClick() {
  if (state.dwReadonly) { state.dwReadonly = false; applyDwMode(); setTimeout(() => $('dwText').focus(), 80); return; }
  saveDiaryEntry();
}
function updateDwMoodWeather() {
  const mv = $('dwMoodVal');
  if (state.dwMood) mv.innerHTML = '<span class="mb-dot" style="background:' + moodTint(state.dwMood, state.dwMoodK) + '"></span><span class="mb-word">' + esc(state.dwMood) + '</span>';
  else mv.textContent = '';
  $('dwWeatherVal').textContent = state.dwWeather || '';
  $('dwTagsVal').textContent = state.dwTags || '';
}
const DW_WEATHERS = ['☀️', '🌤️', '⛅', '☁️', '🌧️', '⛈️', '🌩️', '❄️', '🌫️', '🌈', '🌙', '💨'];
function closeDwPicker() { const p = document.querySelector('.dwpicker'); if (p) p.remove(); state.dwPickerKind = null; }
function toggleDwPicker(kind) {
  if (document.querySelector('.dwpicker') && state.dwPickerKind === kind) { closeDwPicker(); return; }
  closeDwPicker(); state.dwPickerKind = kind;
  const p = el('div', 'dwpicker');
  if (kind === 'mood') {
    p.classList.add('moodpick');
    // 8 类情绪 chip（带字即图例）+ 轻/中/浓 三档深浅；选完不自动关，好接着调深浅
    const render = () => {
      p.innerHTML = '';
      const row = el('div', 'moodsw-row');
      ['平静', '开心', '想念', '害羞', '惆怅', '低落', '不安', '烦躁', '生气'].forEach((w) => {
        const b = el('button', 'moodsw' + (state.dwMood === w ? ' on' : ''));
        b.style.background = moodTint(w, state.dwMoodK);
        const lb = el('span', 'moodsw-lb'); lb.textContent = w; b.appendChild(lb);
        b.addEventListener('click', () => { state.dwMood = w; if (state.dwMoodK == null) state.dwMoodK = 0.6; updateDwMoodWeather(); render(); });
        row.appendChild(b);
      });
      const seg = el('div', 'seg dwseg');
      [['轻', 0.3], ['中', 0.6], ['浓', 0.9]].forEach(([lb, v]) => {
        const b = el('button', state.dwMoodK != null && Math.abs(state.dwMoodK - v) < 0.05 ? 'on' : '');
        b.textContent = lb;
        b.addEventListener('click', () => { state.dwMoodK = v; updateDwMoodWeather(); render(); });
        seg.appendChild(b);
      });
      const clr = el('button', 'dwpick-clr'); clr.textContent = '清除心情'; clr.addEventListener('click', () => { state.dwMood = ''; state.dwMoodK = null; updateDwMoodWeather(); closeDwPicker(); });
      p.append(row, seg, clr);
    };
    render();
  } else {
    const clr = el('button'); clr.textContent = '✕'; clr.style.fontSize = '15px';
    clr.addEventListener('click', () => { state.dwWeather = ''; updateDwMoodWeather(); closeDwPicker(); });
    p.appendChild(clr);
    DW_WEATHERS.forEach((emo) => { const b = el('button'); b.textContent = emo; if (emo === state.dwWeather) b.style.background = 'var(--surface-2)'; b.addEventListener('click', () => { state.dwWeather = emo; updateDwMoodWeather(); closeDwPicker(); }); p.appendChild(b); });
  }
  $('diaryWrite').appendChild(p);
}
function renderDwImgs() {
  const box = $('dwImgs'); box.innerHTML = '';
  state.dwImages.forEach((p, i) => {
    const cell = el('div', 'dwimg'); const im = el('img'); im.src = diaryImgUrl(p); cell.appendChild(im);
    const x = el('div', 'x'); x.textContent = '✕'; x.addEventListener('click', () => { state.dwImages.splice(i, 1); renderDwImgs(); }); cell.appendChild(x);
    box.appendChild(cell);
  });
}
function dwAddImages(fileList) {
  const dir = diaryImgDir();
  Array.from(fileList || []).forEach((file) => {
    const ph = el('div', 'dwimg loading'); $('dwImgs').appendChild(ph);
    uploadOne(file, dir, () => {}).then((r) => { ph.remove(); if (r && r.path) { state.dwImages.push(r.path); renderDwImgs(); } }).catch(() => { ph.remove(); toast('图片上传失败'); });
  });
}
function saveDiaryEntry() {
  const text = $('dwText').value.trim();
  if (!text && !state.dwImages.length) { toast('写点什么吧'); return; }
  const base = { sessionId: state.diarySession || '__me', date: state.diaryDay, text: text || '（图片）', images: state.dwImages.slice(), mood: state.dwMood || '', moodK: state.dwMood ? state.dwMoodK : null, weather: state.dwWeather || '', tags: state.dwTags || '' };
  if (state.dwEditing) wsend({ type: 'diary_edit', ts: state.dwEditing.ts, ...base });
  else wsend({ type: 'diary_write', ...base });
  // daymood_set 不再发：日历天色由后端按「当天最新一条带心情的日记」算
  state.dwEditing = null; closeDwPicker();
  show('diary');
}

/* ============ left settings/app drawer ============ */
// 抽屉「我的状态」条目右侧的一瞥：有状态显示原文，没有就空着（不写"未设置"之类的废话）
function renderUserStatus() {
  const el = $('drStatusNow'); if (!el) return;
  el.textContent = (state.userStatus && state.userStatus.text) || '';
}
function openDrawer() {
  const db = $('drawerBack'), dr = $('drawer');
  $('drawerStatus').textContent = state.connected ? (state.authed ? '已连接 · ' + (LS.url || '') : '连接中…') : '未连接';
  renderUpdatePanel();
  clearTimeout(dr._hideT);
  db.classList.add('show'); dr.classList.add('show');
  requestAnimationFrame(() => { db.classList.add('in'); });
  syncAtRoot();
}
function closeDrawer() {
  const db = $('drawerBack'), dr = $('drawer');
  db.classList.remove('in'); dr.classList.remove('show');
  dr._hideT = setTimeout(() => db.classList.remove('show'), 300);
}
function drawerOpen() { return $('drawer').classList.contains('show'); }
// swipe the drawer left to close it
function initDrawerSwipe() {
  const dr = $('drawer'); let sx = 0, sy = 0, dragging = false, dir = null, W = 0;
  dr.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; dragging = true; dir = null; W = dr.offsetWidth; dr.style.transition = 'none'; }, { passive: true });
  dr.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (dir === null) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; dir = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'h' : 'v'; }
    if (dir !== 'h') return;
    e.preventDefault();
    dr.style.transform = 'translateX(' + Math.min(0, dx) + 'px)';
  }, { passive: false });
  dr.addEventListener('touchend', (e) => {
    if (!dragging) return; dragging = false;
    const dx = e.changedTouches[0].clientX - sx;
    dr.style.transition = 'transform .26s cubic-bezier(.32,.72,0,1)';
    if (dir === 'h' && -dx > W * 0.33) {
      dr.style.transform = 'translateX(-100%)';        // animate the inline transform out (no stutter)
      $('drawerBack').classList.remove('in');
      setTimeout(() => { dr.classList.remove('show'); $('drawerBack').classList.remove('show'); dr.style.transform = ''; dr.style.transition = ''; }, 270);
    } else {
      dr.style.transform = 'translateX(0)';
      setTimeout(() => { dr.style.transform = ''; dr.style.transition = ''; }, 260);
    }
    dir = null;
  });
}

/* ============ settings (连接 + 外观/对话/触感/更新 三级页) ============ */
function applyFont() {
  document.documentElement.style.setProperty('--fs-scale', P('fontSize'));
  document.body.classList.toggle('sysfont', P('fontFamily') === 'system');
}
// 主题 + 强调色：都靠 <html> 上的 data-theme / data-accent 让 CSS 的属性选择器覆盖 token
function applyTheme() {
  // 暖调主题 / 砖橙强调色已下线 → 旧设置迁移到 纸白 / slate
  if (P('theme') === 'warm') setPref('theme', 'gray');
  if (P('accent') === 'brick') setPref('accent', 'slate');
  document.documentElement.setAttribute('data-theme', P('theme'));
  document.documentElement.setAttribute('data-accent', P('accent'));
}
function applyStatusBar() { try { window.Android && Android.setStatusBar && Android.setStatusBar(!!P('showStatusBar')); } catch (e) {} }
function applyDiscFx() {
  if (!P('discFx')) { hideDisc(); if (!state.connected && state.screen !== 'setup') connbar('已断开，重连中…', true); }
  else if (state.connected) connbar('');
}
function applyDiscBlink() { $('discScreen').classList.toggle('noblink', !P('discBlink')); }
function cleanupNow() { if (P('autoCleanup')) wsend({ type: 'cleanup_stale' }); }  // run immediately when toggled on
// 时区按 UTC 偏移手动选；存成合法 IANA 名（Etc/GMT 符号是反的：Etc/GMT-8 = UTC+8），bridge 直接当时区用。
function tzFromOffset(off) { return off === 0 ? 'UTC' : 'Etc/GMT' + (off > 0 ? '-' : '+') + Math.abs(off); }
function tzToOffset(tz) { if (tz === 'UTC') return 0; const m = /^Etc\/GMT([+-])(\d+)$/.exec(tz || ''); return m ? (m[1] === '-' ? 1 : -1) * parseInt(m[2], 10) : null; }
function tzOffLabel(off) { return off === 0 ? 'UTC' : 'UTC' + (off > 0 ? '+' : '-') + Math.abs(off); }
const SET_CATS = {
  appearance: { name: '外观', items: [
    { type: 'segment', key: 'theme', name: '主题', opts: [['gray', '纸白'], ['dark', '夜间']], onChange: applyTheme },
    { type: 'swatch', key: 'accent', name: '强调色', opts: [['rose', '#c0506b'], ['amber', '#b07636'], ['green', '#4a7c59'], ['teal', '#2f7d8f'], ['indigo', '#3a6ea5'], ['violet', '#7a5cc6'], ['slate', '#5d6b78']], onChange: applyTheme },
    { type: 'slider', key: 'fontSize', name: '字体大小', min: 0.8, max: 1.4, step: 0.05, fmt: (v) => Math.round(v * 100) + '%', onChange: applyFont },
    { type: 'segment', key: 'fontFamily', name: '字体', opts: [['client', '客户端字体'], ['system', '系统字体']], onChange: applyFont },
    { type: 'toggle', key: 'showModel', name: '显示模型名称', onChange: updateHeader },
    { type: 'toggle', key: 'showTokens', name: '显示 Token 统计' },
    { type: 'toggle', key: 'showStatusBar', name: '显示状态栏', onChange: applyStatusBar },
    { type: 'toggle', key: 'discFx', name: '断联动画（关则只显示横幅）', onChange: applyDiscFx },
    { type: 'toggle', key: 'discBlink', name: '断联闪烁', onChange: applyDiscBlink }
  ] },
  chat: { name: '对话', items: [
    { type: 'toggle', key: 'autoOpenLast', name: '进入应用自动打开上个对话' },
    { type: 'toggle', key: 'interruptOnLeave', name: '退出对话时中断回复' },
    { type: 'toggle', key: 'autoScroll', name: '生成时自动滚到底部' },
    { type: 'toggle', key: 'pasteAsFile', name: '长文本粘贴为文件' },
    { type: 'slider', key: 'pasteThreshold', name: '文本长度阈值', min: 200, max: 8000, step: 100, fmt: (v) => v + ' 字', dep: 'pasteAsFile' },
    { type: 'toggle', key: 'autoCleanup', name: '自动清理一天前的单轮对话', onChange: cleanupNow },
    { type: 'toggle', key: 'wakePush', name: '后台唤醒通知', onChange: onWakePushToggle },
    { type: 'segment', server: 'cacheTtl', name: '上下文缓存时长', opts: [['1h', '1 小时'], ['5m', '5 分钟']], send: (v) => ({ type: 'cache_ttl_set', ttl: v }) },
    { type: 'tzoff', key: 'timezone', name: 'cc 读到的时区', onChange: sendPresence },
    { type: 'button', name: '编辑压缩提示词', action: openCompactPrompt },
    { type: 'segment', key: 'viewMode', name: '注入显示', opts: [['strip', '剥离'], ['xray', '透视'], ['full', '全显']], onChange: rerenderThread },
    { type: 'button', name: '编辑消息模板', action: openMsgTemplate }
  ] },
  haptics: { name: '触感', items: [
    { type: 'toggle', key: 'haptics', name: '触感反馈（总开关）' },
    { type: 'toggle', key: 'genHaptic', name: '消息生成完成时震动', dep: 'haptics' }
  ] },
  update: { name: '更新', items: [
    { type: 'toggle', key: 'updateNotify', name: '接受后端推送的更新', onChange: renderUpdatePanel },
    { type: 'button', name: '立即检查更新', action: () => checkUpdate(true) },
    { type: 'info', name: '当前版本', value: () => APP_VERSION }
  ] }
};
function refreshSettingsRows() {
  $('setConnDesc').textContent = state.connected ? (state.authed ? '已连接' : '连接中…') : '未连接';
  $('setAppearDesc').textContent = ({ gray: '纸白', dark: '夜间' }[P('theme')] || '纸白') + ' · 字体 ' + Math.round(P('fontSize') * 100) + '%';
  $('setChatDesc').textContent = (P('interruptOnLeave') ? '退出中断 · ' : '') + (P('autoScroll') ? '自动滚动' : '不自动滚动');
  $('setHapticDesc').textContent = P('haptics') ? '开' : '关';
  $('setUpdateDesc').textContent = P('updateNotify') ? '接受推送' : '不接受';
}
function openConn() {
  $('set_url').value = LS.url; $('set_token').value = LS.token; $('set_cwd').value = LS.cwd;
  $('conn_status').textContent = state.connected ? (state.authed ? '已连接 · ' + (LS.url || '') : '连接中…') : '未连接';
  openScrim('connScrim');
}
/* ============ 设置 › API（订阅通路的逃生舱：key 存服务器 config，切换热生效） ============ */
function openApi() {
  $('apiTestOut').textContent = ''; $('apiTestOut').className = 'apitest';
  $('api_key').value = ''; $('api_token').value = '';
  show('apiPage');
  wsend({ type: 'api_get' });
}
function renderApiInfo(m) {
  state.apiInfo = m;
  $('apiOn').classList.toggle('on', !!m.enabled);
  $('api_key').placeholder = m.keyTail ? '已存 ····' + m.keyTail : '未设置';
  $('api_token').placeholder = m.tokenTail ? '已存 ····' + m.tokenTail : '未设置';
  if (document.activeElement !== $('api_base')) $('api_base').value = m.baseUrl || '';
  const src = !m.source ? '尚无记录' : (m.source === 'none' ? '订阅额度' : 'API（' + m.source + '）');
  $('apiStatus').textContent = '最近一轮实际走的通路：' + src;
  $('apiClear').style.display = (m.keyTail || m.tokenTail) ? '' : 'none';
  $('setApiDesc').textContent = m.enabled ? '开 · ' + (m.baseUrl ? '中转' : '官方') : '关 · 订阅额度';
}
function apiFields() {
  const o = {};
  if ($('api_key').value.trim()) o.key = $('api_key').value.trim();
  if ($('api_token').value.trim()) o.authToken = $('api_token').value.trim();
  o.baseUrl = $('api_base').value.trim();
  return o;
}
function openSetSub(catId) {
  const cat = SET_CATS[catId]; if (!cat) return;
  state.setCat = catId; $('setSubTitle').textContent = cat.name; renderSetSub(); show('setSub');
}
function renderSetSub() {
  const cat = SET_CATS[state.setCat]; const body = $('setSubBody'); body.innerHTML = '';
  const card = el('div', 'setmenu');
  cat.items.forEach((it) => {
    const row = el('div', 'setitem');
    const disabled = it.dep && !P(it.dep);
    if (disabled) row.classList.add('disabled');
    if (it.type === 'toggle') {
      row.classList.add('togglerow');
      const lab = el('span'); lab.textContent = it.name;
      const sw = el('button', 'switch' + (P(it.key) ? ' on' : '')); sw.innerHTML = '<span class="knob"></span>';
      sw.addEventListener('click', () => { const on = !P(it.key); setPref(it.key, on); if (it.onChange) it.onChange(); if (on) buzz(12); renderSetSub(); refreshSettingsRows(); });
      row.appendChild(lab); row.appendChild(sw);
    } else if (it.type === 'slider') {
      row.classList.add('sliderrow');
      const top = el('div', 'sl-top'); const lab = el('span'); lab.textContent = it.name; const val = el('span', 'sl-val'); val.textContent = it.fmt(P(it.key));
      top.appendChild(lab); top.appendChild(val); row.appendChild(top);
      const range = document.createElement('input'); range.type = 'range'; range.className = 'slider';
      range.min = it.min; range.max = it.max; range.step = it.step; range.value = P(it.key); range.disabled = !!disabled;
      range.addEventListener('input', () => { const v = parseFloat(range.value); setPref(it.key, v); val.textContent = it.fmt(v); if (it.onChange) it.onChange(); });
      range.addEventListener('change', refreshSettingsRows);
      row.appendChild(range);
    } else if (it.type === 'segment') {
      row.classList.add('segrow');
      const lab = el('span', 'seg-label'); lab.textContent = it.name; row.appendChild(lab);
      const seg = el('div', 'segment');
      const segCur = it.server ? (state[it.server] || it.opts[0][0]) : P(it.key);   // server: 读运行时状态（如缓存时长），不走 localStorage
      it.opts.forEach(([v, n]) => { const b = el('button', 'seg' + (segCur === v ? ' on' : '')); b.textContent = n; b.addEventListener('click', () => { if (it.server) { state[it.server] = v; if (it.send) wsend(it.send(v)); buzz(12); } else setPref(it.key, v); if (it.onChange) it.onChange(); renderSetSub(); refreshSettingsRows(); }); seg.appendChild(b); });
      row.appendChild(seg);
    } else if (it.type === 'swatch') {
      row.classList.add('swatchrow');
      const lab = el('span', 'seg-label'); lab.textContent = it.name; row.appendChild(lab);
      const dots = el('div', 'swatchdots');
      it.opts.forEach(([v, color]) => {
        const b = el('button', 'swatchdot' + (P(it.key) === v ? ' on' : '')); b.style.background = color;
        b.addEventListener('click', () => { setPref(it.key, v); if (it.onChange) it.onChange(); buzz(12); renderSetSub(); refreshSettingsRows(); }); dots.appendChild(b);
      });
      row.appendChild(dots);
    } else if (it.type === 'button') {
      row.classList.add('togglerow');
      const lab = el('span'); lab.textContent = it.name;
      const chev = el('span', 'sr-chev'); chev.textContent = '›';
      row.appendChild(lab); row.appendChild(chev); row.addEventListener('click', it.action);
    } else if (it.type === 'pick') {
      row.classList.add('pickrow');
      const lab = el('span', 'seg-label'); lab.textContent = it.name; row.appendChild(lab);
      const list = el('div', 'picklist');
      it.opts.forEach(([v, n]) => {
        const o = el('button', 'pickopt' + (P(it.key) === v ? ' on' : ''));
        o.innerHTML = '<span>' + n + '</span><span class="pickck">✓</span>';
        o.addEventListener('click', () => { setPref(it.key, v); if (it.onChange) it.onChange(); buzz(12); renderSetSub(); refreshSettingsRows(); });
        list.appendChild(o);
      });
      row.appendChild(list);
    } else if (it.type === 'tzoff') {
      row.classList.add('togglerow');   // 标签左、滚轮右，同一行（不再竖排空一行）
      const lab = el('span'); lab.textContent = it.name; row.appendChild(lab);
      const cur = P(it.key), curOff = tzToOffset(cur);
      const vals = ['']; for (let o = -12; o <= 14; o++) vals.push(o);
      let si = (cur === '') ? 0 : (curOff != null ? vals.indexOf(curOff) : 0); if (si < 0) si = 0;
      const tw = wkWheel(vals, si, (v) => v === '' ? '自动' : tzOffLabel(v), (i) => {
        const v = vals[i]; setPref(it.key, v === '' ? '' : tzFromOffset(v)); if (it.onChange) it.onChange(); refreshSettingsRows();
      }, false, 1);
      tw.classList.add('wkinline-c'); row.appendChild(tw);
    } else if (it.type === 'info') {
      row.classList.add('togglerow'); const lab = el('span'); lab.textContent = it.name; const v = el('span', 'sr-desc'); v.textContent = it.value(); row.appendChild(lab); row.appendChild(v);
    }
    card.appendChild(row);
  });
  body.appendChild(card);
}
// is the published version newer than what's installed? Numeric compare — plain !== prompted an
// "update" for ANY mismatch, including a downgrade to an old/foreign version line.
function verNum(v) { const p = String(v || '').split('.').map((n) => parseInt(n, 10) || 0); return (p[0] || 0) * 1e6 + (p[1] || 0) * 1e3 + (p[2] || 0); }
function updateHasNew() { return !!(state.appUpdate && state.appUpdate.version && verNum(state.appUpdate.version) > verNum(APP_VERSION)); }
// backend push: bridge sends the published version + changelog on connect; gated by the toggle
function onAppUpdate(m) {
  state.appUpdate = { version: m.version, url: m.url, notes: m.notes || '' };
  renderUpdatePanel();
  if (updateHasNew() && P('updateNotify') && !state._updToast) { state._updToast = true; toast('有新版本 ' + m.version + '，菜单里可更新'); }
}
// the update card lives in the drawer; shows only when newer AND the user accepts push updates
function renderUpdatePanel() {
  const box = $('drawerUpdate'); if (!box) return;
  const show = updateHasNew() && P('updateNotify');
  box.style.display = show ? '' : 'none';
  if (show) { $('duVer').textContent = state.appUpdate.version; $('duNotes').textContent = state.appUpdate.notes || '有新版本可更新'; }
}
function downloadUpdate() {
  const v = state.appUpdate && state.appUpdate.version; if (!v) return;
  const url = state.origin + '/telos-' + v + '.apk'; // versioned path beats any download cache
  if (nativeDownload(url, 'telos-' + v + '.apk')) { toast('下载 ' + v + ' 中，完成后点通知安装'); return; }
  const a = document.createElement('a'); a.href = url; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  toast('开始下载 ' + v + '，完成后点通知安装');
}
function checkUpdate(manual) {
  if (!manual && !P('updateNotify')) return;
  fetch(state.origin + '/version', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d || !d.version) { if (manual) toast('无法获取版本信息'); return; }
    state.appUpdate = { version: d.version, url: d.url, notes: d.notes || '' };
    renderUpdatePanel();
    if (updateHasNew()) { if (manual) { toast('有新版本 ' + d.version); if (P('updateNotify')) openDrawer(); } } // card lives in the drawer
    else if (manual) toast('已是最新版本 ' + APP_VERSION);
  }).catch(() => { if (manual) toast('检查更新失败'); });
}

/* ============ animated back: chat slides right, list revealed beneath ============ */
function resetChatSlide() {
  const chat = $('chat'), list = $('list');
  chat.style.transition = ''; chat.style.transform = ''; chat.style.zIndex = ''; chat.style.boxShadow = '';
  list.style.zIndex = '';
}
function goListAnimated() {
  const chat = $('chat'), list = $('list');
  if (state.screen !== 'chat') { goList(); return; }
  closeMenu(); closePlus();
  if (P('interruptOnLeave') && viewBusy()) wsend({ type: 'interrupt', turnId: state.viewTurnId });
  list.classList.add('active'); list.style.zIndex = '1';
  chat.style.zIndex = '2'; chat.style.boxShadow = '-12px 0 40px rgba(40,38,31,.18)';
  chat.style.transition = 'transform .3s cubic-bezier(.32,.72,0,1)';
  requestAnimationFrame(() => { chat.style.transform = 'translateX(100%)'; });
  setTimeout(() => { show('list'); resetChatSlide(); wsend({ type: 'list_sessions' }); }, 300);
}

/* ============ in-conversation search ============
   A bar floats at the top of the conversation; the conversation dims behind it
   and the results float over it. Opened by the left-swipe (threshold tracked). */
function searchOpen() { return !!state.searchActive; }
// p: 0 = closed, 1 = fully open. Drives the dim + the bar drop.
function setSearchProgress(p, anim) {
  const ov = $('searchOverlay'), bar = $('searchBarTop');
  ov.style.transition = anim ? 'opacity .24s ease' : 'none';
  bar.style.transition = anim ? 'transform .26s cubic-bezier(.32,.72,0,1)' : 'none';
  ov.style.opacity = p;
  bar.style.transform = 'translateY(' + (-100 * (1 - p)) + '%)';
}
// 模式提示直接写进输入框（不再放徽标按钮）；双击搜索栏切语义/普通——两种 scope 都行
function searchPlaceholder() {
  const sem = state.searchMode === 'sem';
  if (state.searchScope === 'list') return sem ? '语义搜全部对话，双击切普通' : '普通搜全部对话，双击切语义';
  return sem ? '语义搜本对话，双击切普通' : '查找本对话，双击切语义';
}
function openSearch() {
  const ov = $('searchOverlay');
  $('searchInput').placeholder = searchPlaceholder();
  if (!ov.classList.contains('show')) { ov.classList.add('show'); setSearchProgress(0, false); }
  ov.style.pointerEvents = 'auto';
  requestAnimationFrame(() => setSearchProgress(1, true));
  state.searchActive = true;
  syncAtRoot();
  $('usageStrip').classList.remove('open'); // collapse the session detail each open
  renderUsageStrip(); reqUsage(); // refresh the usage strip every time search opens
  setTimeout(() => $('searchInput').focus(), 240);
}
function closeSearch() {
  const ov = $('searchOverlay');
  if (!ov.classList.contains('show')) return;
  state.searchActive = false;
  $('searchInput').blur();
  setSearchProgress(0, true);
  setTimeout(() => {
    ov.classList.remove('show'); ov.style.pointerEvents = '';
    $('searchResults').innerHTML = ''; $('searchInput').value = '';
  }, 260);
}
// snippet around the first match, the matches wrapped in <mark>
function hlSnippet(text, q) {
  const lower = text.toLowerCase(), ql = q.toLowerCase();
  const hit = lower.indexOf(ql); let start = hit > 56 ? hit - 36 : 0;
  const slice = text.slice(start, start + 420), sl = slice.toLowerCase();
  const frag = document.createDocumentFragment();
  if (start > 0) frag.appendChild(document.createTextNode('…'));
  let last = 0, idx = sl.indexOf(ql);
  while (idx >= 0) {
    if (idx > last) frag.appendChild(document.createTextNode(slice.slice(last, idx)));
    const mk = document.createElement('mark'); mk.textContent = slice.slice(idx, idx + q.length);
    frag.appendChild(mk); last = idx + q.length; idx = sl.indexOf(ql, last);
  }
  if (last < slice.length) frag.appendChild(document.createTextNode(slice.slice(last)));
  return frag;
}
function runSearch(raw) {
  const q = (raw || '').trim();
  const results = $('searchResults'); results.innerHTML = '';
  if (!q) return;
  if (state.searchScope === 'list') {
    // 全库对话搜索：普通(关键词 LIKE)/语义(向量)；结果成对 U/A、点击跳对应对话
    state._searchQ = q;
    results.innerHTML = '<div class="search-empty">搜索中…</div>';
    wsend({ type: 'dialog_search', q, mode: state.searchMode || 'kw', scope: 'list' });
    return;
  }
  if (state.searchMode === 'sem') {
    // 对话内语义：搜本对话的完整归档历史（按当前会话过滤）；没归档的对话后端会回 archived:false → 回退普通
    state._searchQ = q;
    results.innerHTML = '<div class="search-empty">搜索中…</div>';
    wsend({ type: 'dialog_search', q, mode: 'sem', scope: 'chat', session: state.currentSession });
    return;
  }
  localChatSearch(q);
}
// 对话内普通查找：纯本地匹配当前已加载的消息（任何对话都行、即时）
function localChatSearch(q) {
  const results = $('searchResults'); results.innerHTML = '';
  const ql = q.toLowerCase(); let n = 0;
  [...$('thread').querySelectorAll('.msg')].forEach((msg) => {
    const text = (msg.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || !text.toLowerCase().includes(ql)) return;
    n++;
    const card = el('div', 'searchcard');
    const snip = el('div', 'sc-snippet'); snip.appendChild(hlSnippet(text, q));
    card.appendChild(snip);
    // tap = jump to the message, long-press = expand the snippet
    let lpTimer, lp = false, moved = false, sy = 0;
    card.addEventListener('touchstart', (e) => { lp = false; moved = false; sy = e.touches[0].clientY; lpTimer = setTimeout(() => { lp = true; buzz(12); card.classList.toggle('expanded'); }, 480); }, { passive: true });
    card.addEventListener('touchmove', (e) => { if (Math.abs(e.touches[0].clientY - sy) > 8) { moved = true; clearTimeout(lpTimer); } }, { passive: true });
    card.addEventListener('touchend', () => { clearTimeout(lpTimer); if (!lp && !moved) jumpToMessage(msg); });
    results.appendChild(card);
  });
  if (!n) results.innerHTML = '<div class="search-empty">没有找到「' + q.replace(/</g, '&lt;') + '」</div>';
}
function openListSearch() { state.searchScope = 'list'; state.searchMode = 'kw'; openSearch(); }
function setSearchMode(m) {
  state.searchMode = m === 'sem' ? 'sem' : 'kw';
  $('searchInput').placeholder = searchPlaceholder();   // 模式提示就在输入框里
  buzz(10);
  const q = $('searchInput').value.trim(); if (q) runSearch(q);
}
function onDialogSearch(m) {
  if (!searchOpen()) return;
  if ((m.q || '') !== (state._searchQ || '')) return;   // 旧请求回包，丢弃
  // 对话内语义：该对话没归档（archived:false）→ 静默回退本地普通查找
  if (state.searchScope !== 'list' && m.archived === false) { localChatSearch(m.q || ''); return; }
  renderDialogResults(m.hits || [], m.q || '');
}
function renderDialogResults(hits, q) {
  const results = $('searchResults'); if (!results) return; results.innerHTML = '';
  if (!hits.length) { results.innerHTML = '<div class="search-empty">没有找到「' + esc(q) + '」</div>'; return; }
  for (const h of hits) {
    const card = el('div', 'searchcard dlgcard');
    if (h.session_title) { const tt = el('div', 'sc-title'); tt.textContent = h.session_title; card.appendChild(tt); }
    for (const t of (h.context || [])) {
      const isHit = t.turn_index === h.hit_index;
      const row = el('div', 'dlg-turn' + (isHit ? ' hit' : ''));
      const who = el('span', 'dlg-who'); who.textContent = (t.role === 'user' ? '用户' : state.aName) + (t.kind && t.kind !== 'chat' ? '·' + t.kind : '');
      const body = el('span', 'dlg-text'); const txt = (t.content || '').replace(/\s+/g, ' ').trim();
      if (isHit && q) body.appendChild(hlSnippet(txt, q)); else body.textContent = txt.slice(0, 140);
      row.appendChild(who); row.appendChild(body); card.appendChild(row);
    }
    const sid = h.cc_session_id;
    const hitText = ((h.context || []).find((t) => t.turn_index === h.hit_index) || {}).content || '';
    if (sid) card.addEventListener('click', () => jumpToDialog(sid, hitText));
    results.appendChild(card);
  }
}
function jumpToDialog(sid, hitText) {
  closeSearch();
  const needle = (hitText || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  state.pendingJump = needle;
  state.pendingFind = { sid, needle };   // openSession 据此走 history_find，直接拉命中那段窗（含压缩前）
  const s = (state.sessions || []).find((x) => x.id === sid) || { id: sid };
  setTimeout(() => openSession(s), 240);
}
function tryPendingJump() {
  if (!state.pendingJump) return;
  const needle = state.pendingJump.slice(0, 14); state.pendingJump = null;
  if (!needle) return;
  setTimeout(() => {
    const hit = [...$('thread').querySelectorAll('.msg')].find((m) => (m.textContent || '').replace(/\s+/g, ' ').includes(needle));
    if (hit) jumpToMessage(hit);
  }, 140);
}

/* ============ import: pick which conversations ============ */
function openImportScreen(path, items) {
  state.importPath = path; state.importItems = items;
  state.importSel = new Set(items.filter((it) => it.count > 0).map((it) => it.i)); // default: all non-empty
  state.importReturn = state.screen;
  renderImportList();
  show('import');
}
function renderImportList() {
  const wrap = $('importList'); wrap.innerHTML = '';
  if (!state.importItems.length) { wrap.innerHTML = '<div class="empty">这个文件里没有对话。</div>'; }
  state.importItems.forEach((it) => {
    const row = el('div', 'improw' + (state.importSel.has(it.i) ? ' on' : '') + (it.count ? '' : ' dim'));
    const box = el('div', 'impbox'); box.innerHTML = state.importSel.has(it.i) ? '✓' : '';
    const meta = el('div', 'impmeta');
    const nm = el('div', 'impname'); nm.textContent = it.name || '(未命名)';
    const sub = el('div', 'impsub'); sub.textContent = it.count + ' 条' + (it.updated ? ' · ' + relTime(Date.parse(it.updated)) : '');
    meta.appendChild(nm); meta.appendChild(sub);
    row.appendChild(box); row.appendChild(meta);
    if (it.count) row.addEventListener('click', () => { if (state.importSel.has(it.i)) state.importSel.delete(it.i); else state.importSel.add(it.i); renderImportList(); });
    wrap.appendChild(row);
  });
  $('importCount').textContent = state.importSel.size;
}
function importToggleAll() {
  const sel = state.importItems.filter((it) => it.count);
  const all = sel.every((it) => state.importSel.has(it.i));
  state.importSel = all ? new Set() : new Set(sel.map((it) => it.i));
  renderImportList();
}
function doImport() {
  if (!state.importSel.size) { toast('未选择'); return; }
  toast('正在导入 ' + state.importSel.size + ' 个…');
  wsend({ type: 'import_convos', path: state.importPath, indices: [...state.importSel] });
  show('list');
}
// session list: left-swipe = search (like in-chat), right-swipe = open the drawer
function initListSwipe() {
  const list = $('sessionList'); let sx = 0, sy = 0, on = false, W = 0;
  list.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) { on = false; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; on = true; W = window.innerWidth; }, { passive: true });
  list.addEventListener('touchend', (e) => {
    if (!on) return; on = false;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > W * 0.28 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      buzz(14);
      if (dx < 0) openListSearch();
      else openDrawer();
    }
  }, { passive: true });
}
function jumpToMessage(msg) {
  closeSearch();
  setTimeout(() => {
    msg.scrollIntoView({ block: 'center', behavior: 'smooth' });
    msg.classList.add('jumpflash'); setTimeout(() => msg.classList.remove('jumpflash'), 1400);
  }, 280);
}

// true if the touch landed on body content that scrolls horizontally itself
// (code blocks, wide tables) — that content owns the gesture, not back/search.
function hScrollAt(node, root) {
  for (let n = node; n && n !== root && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 2) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

/* ============ chat horizontal swipe: right→back to list, left→search ============ */
function initChatSwipe() {
  const thread = $('thread'), chat = $('chat'), list = $('list'), ov = $('searchOverlay');
  let sx = 0, sy = 0, dir = null, active = false, W = 0;
  const BACK_TRIG = () => Math.min(120, W * 0.32);
  const SEARCH_TRIG = () => Math.min(120, W * 0.32);
  thread.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || searchOpen()) return;
    if (hScrollAt(e.target, thread)) { active = false; return; }  // 正文里的命令行/表格自己横滚，优先级最高
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; dir = null; active = true; W = window.innerWidth;
  }, { passive: true });
  thread.addEventListener('touchmove', (e) => {
    if (!active) return;
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (dir === null) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.3) {
        dir = dx > 0 ? 'back' : 'search';
        if (dir === 'back') { list.classList.add('active'); list.style.zIndex = '1'; chat.style.zIndex = '2'; chat.style.transition = 'none'; chat.style.boxShadow = '-12px 0 40px rgba(40,38,31,.18)'; }
        else { ov.classList.add('show'); ov.style.pointerEvents = 'none'; setSearchProgress(0, false); }
      } else { dir = 'scroll'; }
    }
    if (dir === 'scroll') return;
    e.preventDefault();
    if (dir === 'back') chat.style.transform = 'translateX(' + Math.max(0, dx) + 'px)';
    else setSearchProgress(Math.min(1, Math.max(0, -dx) / SEARCH_TRIG()), false);
  }, { passive: false });
  thread.addEventListener('touchend', (e) => {
    if (!active) return; active = false;
    const dx = e.changedTouches[0].clientX - sx;
    if (dir === 'back') {
      if (dx > BACK_TRIG()) { buzz(14); if (P('interruptOnLeave') && viewBusy()) wsend({ type: 'interrupt', turnId: state.viewTurnId }); chat.style.transition = 'transform .26s cubic-bezier(.32,.72,0,1)'; chat.style.transform = 'translateX(100%)'; setTimeout(() => { show('list'); resetChatSlide(); wsend({ type: 'list_sessions' }); }, 270); }
      else { chat.style.transition = 'transform .24s cubic-bezier(.32,.72,0,1)'; chat.style.transform = 'translateX(0)'; setTimeout(() => { resetChatSlide(); $('list').classList.remove('active'); }, 250); }
    } else if (dir === 'search') {
      if (-dx > SEARCH_TRIG()) { buzz(14); state.searchScope = 'chat'; state.searchMode = 'kw'; openSearch(); }
      else closeSearch();
    }
    dir = null;
  });
}

/* ============ 选词浮条：选中文字后浮在选区上方的小横条（复制/引用/收藏/分享，无遮罩） ============ */
let selBarT = null;
function curSelText() { try { return (window.getSelection() || '').toString(); } catch (e) { return ''; } }
function selInThread() {
  const s = window.getSelection();
  if (!s || s.isCollapsed || !s.rangeCount) return false;
  const n = s.anchorNode, e0 = n && (n.nodeType === 1 ? n : n.parentElement);
  return !!(e0 && e0.closest && e0.closest('#thread .msg'));   // 选区落在某条消息里才算
}
function showSelBar() {
  if (state.screen !== 'chat') { hideSelBar(); return; }
  const txt = curSelText().trim();
  if (!txt || !selInThread()) { hideSelBar(); return; }
  state.selText = txt;
  const bar = $('selBar'); bar.classList.add('show');          // 先显示才量得到尺寸
  let rect; try { rect = window.getSelection().getRangeAt(0).getBoundingClientRect(); } catch (e) { hideSelBar(); return; }
  if (!rect || (!rect.width && !rect.height)) { hideSelBar(); return; }
  const bw = bar.offsetWidth, bh = bar.offsetHeight, M = 8, vw = window.innerWidth;
  let left = Math.max(M, Math.min(rect.left + rect.width / 2 - bw / 2, vw - bw - M));
  let top = rect.top - bh - 8;                                 // 默认浮在选区上方
  if (top < 8) top = rect.bottom + 8;                          // 贴顶则翻到选区下方
  bar.style.left = left + 'px'; bar.style.top = top + 'px';
}
function hideSelBar() { $('selBar').classList.remove('show'); state.selText = ''; }
function clearSelection() { try { const s = window.getSelection(); if (s) s.removeAllRanges(); } catch (e) {} }
function selBarAction(act) {
  const txt = state.selText || curSelText().trim();
  if (!txt) { hideSelBar(); return; }
  if (act === 'copy') copyText(txt, '已复制');
  else if (act === 'quote') {
    const c = $('composer'), q = '> ' + txt.replace(/\n/g, '\n> ') + '\n\n';
    c.value = c.value.trim() ? (c.value.replace(/\s*$/, '') + '\n\n' + q) : q;
    resizeComposer(); updateSend(); c.focus(); toast('已引用到输入框');
  } else if (act === 'fav') {
    if (!state.currentSession) toast('没有当前对话');
    else { wsend({ type: 'favorites_add', sessionId: state.currentSession, title: state.curTitle || '', text: txt }); toast('已收藏'); }
  } else if (act === 'share') {
    try {
      if (window.Android && typeof window.Android.shareText === 'function') window.Android.shareText(txt);
      else copyText(txt, '已复制（系统分享需更新到新版）');
    } catch (e) { copyText(txt, '已复制'); }
  }
  buzz(10); clearSelection(); hideSelBar();
}
function initSelBar() {
  const bar = $('selBar');
  bar.addEventListener('mousedown', (e) => e.preventDefault());          // 点条本身别清掉选区（桌面）
  bar.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  bar.addEventListener('click', (e) => { const b = e.target.closest('button[data-act]'); if (b) { e.preventDefault(); selBarAction(b.dataset.act); } });
  document.addEventListener('selectionchange', () => { clearTimeout(selBarT); selBarT = setTimeout(showSelBar, 130); });
  const thread = $('thread');
  thread.addEventListener('touchend', () => { clearTimeout(selBarT); selBarT = setTimeout(showSelBar, 60); });
  thread.addEventListener('scroll', hideSelBar, { passive: true });
}

/* ============ 通用整页手势：右滑返回(像对话右滑回列表)，可选左滑触发(像对话左滑搜索)。挂在 .screen 上 ============
   opts.under = 上一级的 screen id（字符串或函数）。给了就在右滑时把它垫在底下露出来，跟着手指滑动，
   动作和「对话右滑回列表」一致、看得到上一级；没给则只滑出当前页（保留旧行为）。under 必须等于 onBack 落到的页。 */
function initPageSwipe(screenId, opts) {
  const scr = $(screenId); if (!scr) return;
  const onBack = opts.onBack, onLeft = opts.onLeft;
  const underId = () => { const u = opts.under; return (typeof u === 'function') ? u() : u; };
  let sx = 0, sy = 0, dir = null, active = false, W = 0, under = null;
  const TRIG = () => Math.min(120, W * 0.32);
  const noSwipe = (t) => t && t.closest && t.closest('input, textarea, button, a, .slider, .picklist, .seg, .whl, .cal, [data-noswipe]');
  const reset = () => { scr.style.transition = 'none'; scr.style.transform = ''; scr.style.zIndex = ''; scr.style.boxShadow = ''; };
  scr.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || noSwipe(e.target)) { active = false; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; dir = null; active = true; W = window.innerWidth;
  }, { passive: true });
  scr.addEventListener('touchmove', (e) => {
    if (!active) return;
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (dir === null) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.3) {
        dir = dx > 0 ? 'back' : 'left';
        if (dir === 'back' && onBack) {
          scr.style.transition = 'none'; scr.style.zIndex = '2'; scr.style.boxShadow = '-12px 0 40px rgba(40,38,31,.18)';
          const uid = underId(); const u = uid && $(uid);
          if (u && u !== scr) { u.classList.add('active'); u.style.zIndex = '1'; under = u; }   // 把上一级垫在底下露出来
        }
      } else dir = 'scroll';
    }
    if (dir === 'back' && onBack) { e.preventDefault(); scr.style.transform = 'translateX(' + Math.max(0, dx) + 'px)'; }
  }, { passive: false });
  scr.addEventListener('touchend', (e) => {
    if (!active) return; active = false;
    const dx = e.changedTouches[0].clientX - sx;
    if (dir === 'back' && onBack) {
      if (dx > TRIG()) {                       // 完成返回：onBack() 会 show(上一级)，由它接管 active；这里只清行内样式
        buzz(14); scr.style.transition = 'transform .26s cubic-bezier(.32,.72,0,1)'; scr.style.transform = 'translateX(100%)';
        setTimeout(() => { onBack(); reset(); if (under) { under.style.zIndex = ''; under = null; } }, 260);
      } else {                                 // 取消：弹回，并把临时垫出来的上一级收回（当前页仍是唯一 active）
        scr.style.transition = 'transform .24s cubic-bezier(.32,.72,0,1)'; scr.style.transform = 'translateX(0)';
        setTimeout(() => { reset(); if (under) { under.classList.remove('active'); under.style.zIndex = ''; under = null; } }, 240);
      }
    } else if (dir === 'left' && onLeft) { if (-dx > TRIG()) { buzz(14); onLeft(); } }
    dir = null;
  });
}
// 进入下一级：新页从右侧滑入盖住当前页（与右滑返回方向相反、对称）。立刻 show(目标) 以免动画期间丢消息，
// 来源页临时留在底层垫着，动画结束再收。
function showForward(toId, fromId) {
  const to = $(toId), from = fromId && $(fromId);
  if (!to || !from || from === to) { show(toId); return; }
  show(toId);                                  // state.screen/active/presence 立刻到位
  from.classList.add('active'); from.style.zIndex = '1';
  to.style.zIndex = '6'; to.style.boxShadow = '-12px 0 40px rgba(40,38,31,.18)';
  to.style.transition = 'none'; to.style.transform = 'translateX(100%)';
  requestAnimationFrame(() => {
    to.style.transition = 'transform .26s cubic-bezier(.32,.72,0,1)'; to.style.transform = 'translateX(0)';
    setTimeout(() => { to.style.transition = ''; to.style.transform = ''; to.style.zIndex = ''; to.style.boxShadow = ''; from.classList.remove('active'); from.style.zIndex = ''; }, 270);
  });
}

/* ============ usage (用量) ============ */
function reqUsage() { wsend({ type: 'usage_report', sessionId: state.currentSession || '' }); }
function fmtReset(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return '';
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  const sameDay = d.toDateString() === now.toDateString();
  return (sameDay ? '今天 ' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + hh + ':' + mm;
}
// ---- 小票 (receipt) builders ----
function rcRow(l, r, cls) { return `<div class="rc-row${cls ? ' ' + cls : ''}"><span class="rc-l">${esc(l)}</span><span class="rc-r">${esc(String(r))}</span></div>`; }
const RC_RULE = '<div class="rc-rule"></div>';
function rcNum(n) { return (n || 0).toLocaleString('en-US'); }
function rcCode() { return 'TLS_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '_' + Math.random().toString(16).slice(2, 8).toUpperCase(); }
function rcStamp() { try { return new Date().toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
function rcShell(inner, code) {
  return '<div class="rc-mark"></div><div class="rc-title">TELOS</div>'
    + '<div class="rc-sub">谢谢你今天来过<br>RECEIPT # ' + esc(code || '——') + '<br>' + esc(rcStamp()) + '</div>'
    + RC_RULE + inner + RC_RULE
    + '<div class="rc-foot">墨会淡，账不会。</div>'
    + '<div class="rc-barcode"></div><div class="rc-code">' + esc(code || '') + '</div>';
}
function renderUsageStrip() {
  const strip = $('usageStrip'); if (!strip) return;
  strip.style.display = '';
  const u = state.usage;
  if (!u || !u.usage) {
    $('usLine').innerHTML = '<span>出票中……</span><span class="us-caret">▾</span>';
    $('usDetail').innerHTML = '<div class="rc-loading">出票中……</div>';
    return;
  }
  const pct = (x) => (x && x.utilization != null) ? Math.round(x.utilization) + '%' : '—';
  const f = u.usage.five_hour, w = u.usage.seven_day, t = u.totals || {};
  const s = state.screen === 'chat' ? u.session : null;
  $('usLine').innerHTML = `<span>5h <b>${pct(f)}</b></span><span>周 <b>${pct(w)}</b></span>` +
    (s ? `<span>本会话 <b>$${(s.cost || 0).toFixed(2)}</b></span>`
       : `<span>累计 <b>$${(t.cost || 0).toFixed(2)}</b></span>`) +
    `<span class="us-caret">▾</span>`;
  let inner = '';
  const ai = (state.screen === 'chat') ? histArchInfo() : null;   // 本地存档状态（回答「有没有缓存」）
  if (s) {
    inner += rcRow('ITEM', '数量', 'rc-head');
    inner += rcRow('输入 token', rcNum(s.in)) + rcRow('输出 token', rcNum(s.out)) + rcRow('缓存 token', rcNum(s.cache)) + rcRow('轮次', rcNum(s.turns));
    inner += RC_RULE + rcRow('本会话今日', '$' + (u.sessionToday || 0).toFixed(2)) + rcRow('本会话花费', '$' + (s.cost || 0).toFixed(2), 'rc-total');
  } else {
    inner += rcRow('累计花费', '$' + (t.cost || 0).toFixed(2), 'rc-total') + rcRow('合计会话', rcNum(t.sessions));
  }
  if (ai) inner += RC_RULE + rcRow('本地存档', ai.label, 'us-arc' + (ai.full ? ' on' : ''));
  inner += RC_RULE + rcRow('今日花费', '$' + (u.today || 0).toFixed(2)) + rcRow('活跃天数', (u.activeDays || 0) + ' 天');
  if (f && f.resets_at) inner += rcRow('5h 恢复', fmtReset(f.resets_at), 'rc-dim');
  $('usDetail').innerHTML = '<div class="receipt mini">' + inner + '<div class="rc-barcode"></div></div>';
  if (ai && !ai.full) { const ar = $('usDetail').querySelector('.us-arc'); if (ar) ar.addEventListener('click', storeFullArchive); }
}
function renderUsageFull() {
  const box = $('usageRcpt'); if (!box) return;
  const u = state.usage;
  if (!u) { box.innerHTML = rcShell('<div class="rc-loading">' + (state.connected && state.authed ? '出票中……' : '未连接 · 重连后自动出票') + '</div>', state.ufCode); return; }
  if (!u.usage) { box.innerHTML = rcShell('<div class="rc-loading">出票失败 · 检查连接/登录</div>', state.ufCode); return; }
  const U = u.usage, t = u.totals || {};
  const pctg = (g) => g && g.utilization != null ? Math.round(g.utilization) + '%' : '—';
  let inner = rcRow('PROVIDER', 'ANTHROPIC');
  inner += rcRow('5 小时额度', pctg(U.five_hour));
  if (U.five_hour && U.five_hour.resets_at) inner += rcRow('5 小时恢复', fmtReset(U.five_hour.resets_at), 'rc-dim');
  inner += rcRow('本周额度', pctg(U.seven_day));
  if (U.seven_day && U.seven_day.resets_at) inner += rcRow('本周恢复', fmtReset(U.seven_day.resets_at), 'rc-dim');
  if (U.seven_day_opus && U.seven_day_opus.utilization != null) inner += rcRow('Opus 周', pctg(U.seven_day_opus));
  if (U.seven_day_sonnet && U.seven_day_sonnet.utilization != null) inner += rcRow('Sonnet 周', pctg(U.seven_day_sonnet));
  const xu = U.extra_usage;
  if (xu && xu.is_enabled) inner += rcRow('额度信用', '$' + (xu.used_credits || 0) + '/' + (xu.monthly_limit || 0));
  inner += RC_RULE + rcRow('ITEM', '数量', 'rc-head');
  inner += rcRow('输入 token', rcNum(t.in)) + rcRow('输出 token', rcNum(t.out)) + rcRow('缓存 token', rcNum(t.cache));
  inner += rcRow('轮次', rcNum(t.turns)) + rcRow('活跃天数', (u.activeDays || 0) + ' 天');
  inner += RC_RULE + rcRow('今日花费', '$' + (u.today || 0).toFixed(2)) + rcRow('累计花费', '$' + (t.cost || 0).toFixed(2), 'rc-total') + rcRow('合计会话', rcNum(t.sessions));
  box.innerHTML = rcShell(inner, state.ufCode);
}
function openUsageFull() { state.ufCode = rcCode(); $('usageFull').classList.add('show'); syncAtRoot(); renderUsageFull(); reqUsage(); }
function closeUsageFull() { $('usageFull').classList.remove('show'); syncAtRoot(); }

/* ============ composer ============ */
// keep the conversation clear of the input dock: the dock is bottom-anchored and grows upward
// (tall textarea, repochip, attachments), so pad the thread to its live height instead of a fixed guess.
function syncDockPad() {
  const dock = $('dock'), thread = $('thread');
  if (!dock || !thread) return;
  const atBottom = thread.scrollTop + thread.clientHeight >= thread.scrollHeight - 4;
  const panel = $('plusPanel');
  const panelH = (state.plusOpen && panel) ? panel.offsetHeight + 8 : 0;   // + 面板覆盖在底部、不把记录顶上去
  thread.style.paddingBottom = Math.max(0, dock.offsetHeight - panelH + 22) + 'px';
  if (atBottom) thread.scrollTop = thread.scrollHeight;
}
function resizeComposer() {
  const c = $('composer');
  if (!c.offsetParent) { c.style.height = ''; return; } // 聊天屏还藏着时 scrollHeight=0，写进去输入框会塌扁（草稿装填踩过）；show('chat') 进屏后会再量一次
  c.style.height = 'auto'; c.style.height = Math.min(c.scrollHeight, 140) + 'px'; syncDockPad();
}
function updateSend() {
  const btn = $('sendBtn');
  if (viewBusy()) { btn.disabled = false; btn.classList.add('stop'); btn.textContent = '■'; return; }
  btn.classList.remove('stop'); btn.textContent = '↑';
  const has = $('composer').value.trim().length > 0 || state.pendingFiles.length > 0 || state.pendingTexts.length > 0;
  btn.disabled = !(has && state.authed);
}
function sendMessage() {
  if (viewBusy()) {
    const at = viewTurn();           // ■ 只打断当前对话的 turn，别的对话照跑
    wsend({ type: 'interrupt', turnId: at.id }); stopStatus();
    at.interrupted = true;
    // cc 还没开口（只是在想）就打断 → 撤回这条消息、把文字退回输入框，省一次重生成
    if (!at.spoke && at.userMsgEl && at.userMsgEl.isConnected) {
      let n = at.userMsgEl.nextSibling; while (n) { const nx = n.nextSibling; n.remove(); n = nx; }
      at.userMsgEl.remove();
      const c = $('composer'); if (at.draft) { c.value = at.draft; resizeComposer(); c.focus(); }
      if (at.pendTexts && at.pendTexts.length) { state.pendingTexts = at.pendTexts; renderAttachStrip(); }
      at.rolledBack = true; buzz(12);
    }
    markDone(at); updateSend();
    return;
  }
  if (state.pendingFiles.some((f) => f.status === 'uploading')) { toast('还有文件在上传…'); return; }
  // 附件条里还有没传的 → 现在传，传完自动接着发（编辑模式不带附件，照旧忽略）
  if (!state.editTarget && state.pendingFiles.some((f) => f.status === 'local')) { uploadPending().then((ok) => { if (ok) sendMessage(); }); return; }
  const c = $('composer'); let text = c.value.trim();
  // 「编辑中」模式：发送 = 从那条消息 fork 重跑（同文重发=从那里重新生成）
  if (state.editTarget) {
    if (!text || !state.currentSession || !state.authed) return;
    const uuid = state.editTarget;
    state.editTarget = null; $('editStrip').classList.remove('show');
    closePlus(); removeSuggestions();
    clearThread();
    const eb = addUser(text);
    const et = newLocalTurn({ userMsgEl: eb ? eb.parentElement : null, draft: text, expectFork: true, forkFrom: state.currentSession });
    const emsg = { type: 'edit_resend', sessionId: state.currentSession, targetUuid: uuid, text, mode: state.mode, turnId: et.id };
    if (state.model) emsg.model = state.model; if (state.effort) emsg.effort = state.effort;
    wsend(emsg);
    // 编辑缓冲用完即弃：进入编辑前的草稿放回输入框
    const d0 = state.drafts[state.draftKey]; c.value = (d0 && d0.text) || '';
    resizeComposer(); updateSend();
    return;
  }
  const origText = text;
  const files = state.pendingFiles.filter((f) => f.status === 'ready' && f.path);
  const texts = state.pendingTexts.slice();
  if ((!text && !files.length && !texts.length) || !state.authed) return;
  // 发送时兜底：输入法剪贴板/手打的长文不触发粘贴事件 → 正文（不含占位符）仍超阈值就整条转文件
  if (P('pasteAsFile')) {
    const bare = texts.reduce((s, t) => (t.ph ? s.replace(t.ph, '') : s), text);
    if (bare.length > P('pasteThreshold')) { texts.push({ name: '长文-' + (texts.length + 1) + '.txt', content: text, ph: '' }); text = ''; }
  }
  closePlus(); removeSuggestions();
  const thumbs = files.filter((f) => f.isImage && f.url).map((f) => ({ url: f.url }));
  const fileNotes = files.filter((f) => !(f.isImage && f.url)).map((f) => '📎 ' + f.name)
    .concat(texts.filter((t) => !t.ph).map((t) => '📄 ' + t.name));
  const userShown = origText + (fileNotes.length ? (origText ? '\n\n' : '') + fileNotes.join('\n') : '');
  const ub = addUser(userShown, null, thumbs);
  const st = newLocalTurn({ userMsgEl: ub ? ub.parentElement : null, draft: origText, pendTexts: state.pendingTexts.slice() });
  const msg = { type: 'send', text, mode: state.mode, turnId: st.id };
  if (files.length) msg.refPaths = files.map((f) => f.path);
  if (texts.length) msg.texts = texts.map((t) => ({ name: t.name, content: t.content, ph: t.ph || '' }));
  if (state.currentSession) msg.sessionId = state.currentSession; else if (state.cwd) msg.cwd = state.cwd;
  if (state.model) msg.model = state.model;
  if (state.effort) msg.effort = state.effort;
  wsend(msg);
  c.value = ''; state.pendingFiles = []; state.pendingTexts = []; renderAttachStrip(); resizeComposer(); updateSend(); saveDraft();
}
function renderAttachStrip() {
  const strip = $('attachStrip'); strip.innerHTML = '';
  state.pendingFiles.forEach((p, i) => {
    const rm = () => { if (p.status === 'local' && p.url) { try { URL.revokeObjectURL(p.url); } catch (e) {} } state.pendingFiles.splice(i, 1); renderAttachStrip(); updateSend(); draftDirty(); };
    if (p.isImage && p.url && p.status !== 'uploading') {
      const t = el('div', 'athumb');
      const img = el('img'); img.src = p.url; t.appendChild(img);
      const x = el('button', 'athumb-x'); x.textContent = '×'; x.addEventListener('click', rm);
      t.appendChild(x); strip.appendChild(t); return;
    }
    if (p.isImage && p.url && p.status === 'uploading') {
      const t = el('div', 'athumb');
      const img = el('img'); img.src = p.url; t.appendChild(img);
      const pc = el('div', 'athumb-pct'); pc.textContent = ((p.pct * 100) | 0) + '%'; t.appendChild(pc);
      strip.appendChild(t); return;
    }
    const t = el('div', 'atfile' + (p.status === 'uploading' ? ' up' : ''));
    t.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
    const nm = el('span', 'atfile-n');
    nm.textContent = p.status === 'uploading' ? (p.name + ' · ' + ((p.pct * 100) | 0) + '% ' + fmtSpeed(p.speed || 0)) : p.name;
    t.appendChild(nm);
    if (p.status === 'uploading') { const bar = el('div', 'atfile-bar'); const fill = el('i'); fill.style.width = ((p.pct * 100) | 0) + '%'; bar.appendChild(fill); t.appendChild(bar); }
    const x = el('button', 'athumb-x'); x.textContent = '×'; x.addEventListener('click', rm);
    t.appendChild(x); strip.appendChild(t);
  });
  state.pendingTexts.forEach((p, i) => {
    const t = el('div', 'atfile');
    t.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
    const nm = el('span', 'atfile-n'); nm.textContent = p.name + ' · ' + p.content.length + '字'; t.appendChild(nm);
    const x = el('button', 'athumb-x'); x.textContent = '×';
    x.addEventListener('click', () => {
      if (p.ph) { const ca = $('composer'), ct = $('composeText'); ca.value = ca.value.replace(p.ph, ''); if (ct) ct.value = ct.value.replace(p.ph, ''); resizeComposer(); }
      state.pendingTexts.splice(i, 1); renderAttachStrip(); updateSend();
    });
    t.appendChild(x); strip.appendChild(t);
  });
}

/* ============ wire up ============ */
function boot() {
  initLinkHandler();
  $('su_url').value = LS.url || defaultWsUrl();
  $('su_save').addEventListener('click', () => { const u = $('su_url').value.trim(), t = $('su_token').value.trim(); if (!t) { toast('请填 token'); return; } if (u) LS.url = u; LS.token = t; connect(); });

  $('newBtn').addEventListener('click', newSession);
  $('refreshBtn').addEventListener('click', () => { wsend({ type: 'list_sessions' }); toast('刷新中'); });
  $('foldCaret').addEventListener('click', () => { setPref('foldersCollapsed', !P('foldersCollapsed')); renderSessions(); });
  initListSwipe();
  $('menuBtn').addEventListener('click', openDrawer);
  $('drawerBack').addEventListener('click', closeDrawer);
  $('drSettings').addEventListener('click', () => { closeDrawer(); openSettings(); });

  $('chatBack').addEventListener('click', goListAnimated);
  $('chatMenu').addEventListener('click', openMenu);
  $('menuback').addEventListener('click', closeMenu);

  // in-conversation search (Enter to search; tap blank to close)
  initChatSwipe();
  initBookSwipe();
  initSelBar();
  // 各独立页统一右滑返回；电影模式页另加左滑进入时间线
  initPageSwipe('cinema', { onBack: () => cinemaBack(), onLeft: openCinemaLog, under: () => (state.cinemaReturn === 'chat' && state.currentSession) ? 'chat' : 'list' });
  $('memMgrBack').addEventListener('click', () => show(state.currentSession ? 'chat' : 'list'));
  initPageSwipe('memMgr', { onBack: () => show(state.currentSession ? 'chat' : 'list'), under: () => state.currentSession ? 'chat' : 'list' });
  // 键盘整页被顶修复：edge-to-edge 下 adjustResize 不缩 WebView，改用 visualViewport 把 .screen 钉到可见视口
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const fitVV = () => {
      document.documentElement.style.setProperty('--vvh', vv.height + 'px');
      document.documentElement.style.setProperty('--vvtop', vv.offsetTop + 'px');
      // 键盘开合改变可见视口时，若本来贴着底就重新贴底，免得「拉到底再展开输入」把记录顶上去
      if (state.screen === 'chat' && state.threadStick !== false) { const t = $('thread'); if (t) requestAnimationFrame(() => { t.scrollTop = t.scrollHeight; }); }
    };
    vv.addEventListener('resize', fitVV); vv.addEventListener('scroll', fitVV); fitVV();
  }
  // 真实顶部 inset 以原生为准：WebView 的 env(safe-area-inset-top) 部分 ROM 上虚高/藏状态栏后残留，
  // 顶栏贴不到安全线全因它。原生侧 inset 变化会实时推；这里启动再拉一次，防 WebView 重载丢掉。
  try { if (window.Android && Android.insetTop) { const t = Android.insetTop(); if (t >= 0) document.documentElement.style.setProperty('--safe-top', t + 'px'); } } catch (e) {}
  $('thread').addEventListener('scroll', () => {
    const t = $('thread'); state.threadStick = t.scrollTop + t.clientHeight >= t.scrollHeight - 40;
    if (state.screen === 'chat' && state.hist && state.hist.sid === state.currentSession) {
      if (t.scrollTop < 1500) loadMoreUp();                                                  // 距顶 <~3 屏就提前补旧段（每段 60 轮，含压缩前）
      else if (!state.hist.atBottom && t.scrollHeight - t.scrollTop - t.clientHeight < 1500) loadMoreDown(); // 搜索跳到中段后下滑 → 补新段
    }
  }, { passive: true });
  initPageSwipe('cinemaLog', { onBack: () => show('cinema'), under: 'cinema' });
  initPageSwipe('diary', { onBack: diaryBack, onLeft: openStickies });   // 左滑进便签栏
  initPageSwipe('stickies', { onBack: () => show('diary'), under: 'diary' });
  initPageSwipe('favorites', { onBack: () => show('list'), under: 'list' });
  initPageSwipe('diaryWrite', { onBack: () => { closeDwPicker(); show('diary'); }, under: 'diary' });
  initPageSwipe('files', { onBack: closeFiles, under: () => state.filesReturn || 'list' });
  initPageSwipe('import', { onBack: () => show(state.importReturn || 'files'), under: () => state.importReturn || 'files' });
  initPageSwipe('settings', { onBack: () => show('list'), under: 'list' });
  initPageSwipe('setSub', { onBack: () => show('settings'), under: 'settings' });
  $('searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('searchInput').blur(); runSearch(e.target.value); } });
  let _searchDeb;
  $('searchInput').addEventListener('input', (e) => { clearTimeout(_searchDeb); const v = e.target.value; _searchDeb = setTimeout(() => runSearch(v), 320); });   // 防抖实时搜
  $('searchBarTop').addEventListener('dblclick', () => setSearchMode(state.searchMode === 'sem' ? 'kw' : 'sem'));   // 双击搜索栏切语义/普通（列表+对话内都行）
  $('searchOverlay').addEventListener('click', (e) => { if (e.target === $('searchOverlay') || e.target === $('searchResults')) closeSearch(); });
  $('plusBack').addEventListener('click', closePlus);
  $('discDismiss').addEventListener('click', dismissDisc);
  $('discPill').addEventListener('click', expandDisc);
  $('mRegen').addEventListener('click', () => { closeMenu(); regenerate(); });
  $('mcpEdit').addEventListener('click', () => wsend({ type: 'mcp_config_read' }));
  $('mcpCfgSave').addEventListener('click', () => wsend({ type: 'mcp_config_write', content: $('mcpCfgText').value }));
  $('pathImport').addEventListener('click', () => { const p = state.pathTarget; closeScrim('pathActScrim'); if (p) { toast('读取对话列表…'); wsend({ type: 'import_list', path: p }); } });
  $('pathDownload').addEventListener('click', () => { const p = state.pathTarget; closeScrim('pathActScrim'); if (p) fmDownload(p); });
  $('pathAttach').addEventListener('click', () => { const p = state.pathTarget; closeScrim('pathActScrim'); if (p) fmAttach(p); });
  $('pathRename').addEventListener('click', () => { const p = state.pathTarget; closeScrim('pathActScrim'); if (p) openPrompt('重命名', '', (name) => { if (name) wsend({ type: 'rename_path', old: p, name, dir: state.dirPath }); }, p.split('/').pop()); });
  $('pathDelete').addEventListener('click', () => { const p = state.pathTarget; closeScrim('pathActScrim'); if (p) openConfirm('删除「' + p.split('/').pop() + '」？', '不可恢复', () => wsend({ type: 'delete_path', path: p, dir: state.dirPath })); });
  $('folderLeft').addEventListener('click', () => { const f = state.folderActTarget; closeScrim('folderActScrim'); if (f) wsend({ type: 'move_folder', name: f, dir: 'left' }); });
  $('folderRight').addEventListener('click', () => { const f = state.folderActTarget; closeScrim('folderActScrim'); if (f) wsend({ type: 'move_folder', name: f, dir: 'right' }); });
  $('folderRename').addEventListener('click', () => { const f = state.folderActTarget; closeScrim('folderActScrim'); if (f) openPrompt('重命名文件夹', '', (name) => { if (name && name !== f) wsend({ type: 'rename_folder', old: f, name }); }, f); });
  $('folderDelete').addEventListener('click', () => { const f = state.folderActTarget; closeScrim('folderActScrim'); if (f) openConfirm('删除文件夹「' + f + '」？', '里面的对话保留、只移出', () => wsend({ type: 'delete_folder', name: f })); });
  $('folderDeleteAll').addEventListener('click', () => { const f = state.folderActTarget; closeScrim('folderActScrim'); if (f) openConfirm('删除「' + f + '」和里面的所有对话？', '不可恢复', () => wsend({ type: 'delete_folder', name: f, withSessions: true })); });
  $('claudeSave').addEventListener('click', saveClaudeMd);
  $('claudePrev').addEventListener('click', () => setClaudePreview($('claudeView').style.display === 'none'));
  $('compactSave').addEventListener('click', () => { setPref('compactPrompt', $('compactText').value); closeScrim('compactScrim'); toast('压缩提示词已保存'); });
  $('tplSave').addEventListener('click', () => { const t = $('tplText').value; if (!t.includes('{{message}}')) { toast('模板里必须有 {{message}}'); return; } wsend({ type: 'template_set', text: t }); closeScrim('tplScrim'); });
  $('tplReset').addEventListener('click', () => { $('tplText').value = state.tplDef || ''; tplPreviewSoon(); buzz(12); });
  $('tplText').addEventListener('input', tplPreviewSoon);
  $('mModel').addEventListener('click', () => { state.modelCtx = null; state.modelFam = ''; openModelSheet(); });
  $('mMood').addEventListener('click', toggleMood);
  $('mWake').addEventListener('click', () => { closeMenu(); if (state.currentSession) openWakeConfig(curSess()); });
  $('mCinema').addEventListener('click', () => { closeMenu(); if (state.currentSession) openCinema(curSess()); });
  $('memOn').addEventListener('click', () => { const mem = state.mem; if (!mem || !mem.available || !state.currentSession) return; const on = !mem.on; state.mem = { ...mem, on }; renderMemory(); buzz(12); wsend({ type: 'memory_set', sessionId: state.currentSession, on }); toast(on ? '已纳入长期记忆' : '已移出长期记忆'); });
  // 恢复参数：失焦/回车提交，夹到范围、空则还原
  const commitReco = () => {
    const rn = parseInt($('memRecentN').value, 10), mt = parseInt($('memMaxTok').value, 10);
    if (isNaN(rn) && isNaN(mt)) return;
    wsend({ type: 'memory_cfg_set', sessionId: state.currentSession, recentN: isNaN(rn) ? undefined : rn, maxTok: isNaN(mt) ? undefined : mt });
  };
  ['memRecentN', 'memMaxTok'].forEach((id) => {
    $(id).addEventListener('change', commitReco);
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $(id).blur(); });
  });
  $('memRecoverBtn').addEventListener('click', () => { if (!state.currentSession) return; buzz(12); wsend({ type: 'memory_recover', sessionId: state.currentSession }); });
  $('memMgrOpen').addEventListener('click', () => { closeScrim('memScrim'); openMemMgr(); });
  $('memEditSave').addEventListener('click', saveMemEdit);
  $('memEditBack').addEventListener('click', () => { closeMemTypePicker(); show('memMgr'); });
  initPageSwipe('memEdit', { onBack: () => { closeMemTypePicker(); show('memMgr'); }, under: 'memMgr' });
  // 重命名从菜单挪到「点对话标题」
  $('chatTitle').addEventListener('click', () => { if (!state.currentSession) return; openPrompt('重命名会话', '', (name) => { if (name) wsend({ type: 'rename', sessionId: state.currentSession, title: name }); }, state.curTitle || ''); });
  $('chatSub').addEventListener('click', () => { const cs = $('chatSub'); if (cs.classList.contains('mood')) cs.classList.toggle('expanded'); });   // 点心情展开/收起看全
  $('mDelete').addEventListener('click', () => { closeMenu(); openConfirm('删除这个对话？', '不可恢复', () => { wsend({ type: 'delete', sessionId: state.currentSession }); goList(); }); });
  // 工具类下放到「＋」面板（编辑 CLAUDE.md / 记忆 / MCP 服务器）；复制目录路径并进文件管理
  $('atMemory').addEventListener('click', () => { closePlus(); openMemory(); });
  $('atFiles').addEventListener('click', () => { closePlus(); openFilePick(); });
  $('fpickBack').addEventListener('click', () => show(state.fpickBack || (state.currentSession ? 'chat' : 'list')));
  $('bookTocBack').addEventListener('click', () => show('bookPage'));
  $('bookTocBtn').addEventListener('click', openBookToc);
  $('bookEditBtn').addEventListener('click', bookEditOpen);
  $('bookEditSave').addEventListener('click', () => bookEditClose(true));
  $('bookEditCancel').addEventListener('click', () => bookEditClose(false));
  $('bookFindPrev').addEventListener('click', () => bookFindGoto(state.bookHitI - 1));
  $('bookFindNext').addEventListener('click', () => bookFindGoto(state.bookHitI + 1));
  $('bookFindClose').addEventListener('click', () => toggleBookFind(false));
  let _bfT;
  $('bookFindInput').addEventListener('input', (e) => { clearTimeout(_bfT); _bfT = setTimeout(() => bookFindRun(e.target.value), 220); });
  $('bookFindInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); bookFindGoto(state.bookHitI + 1); } });
  $('bookScroll').addEventListener('scroll', bookOnScroll, { passive: true });
  $('atMcp').addEventListener('click', () => { closePlus(); openMcp(); });
  $('dirCopy').addEventListener('click', () => { navigator.clipboard && navigator.clipboard.writeText(state.dirPath || ''); buzz(12); toast('已复制当前路径'); });

  $('dirChip').addEventListener('click', openDirPicker);
  $('modeChip').addEventListener('click', openModeSheet);

  $('plusBtn').addEventListener('click', togglePlus);
  $('atUpload').addEventListener('click', () => { closePlus(); $('fileUp').click(); });
  $('fileUp').addEventListener('change', (e) => { attachLocal(e.target.files); e.target.value = ''; });
  $('atFileMgr').addEventListener('click', () => { closePlus(); openFileManager('attach'); });
  $('fileUpMgr').addEventListener('change', (e) => { managerUpload(e.target.files); e.target.value = ''; });
  $('drFiles').addEventListener('click', () => { closeDrawer(); openFileManager('browse'); });
  $('drUsage').addEventListener('click', () => { closeDrawer(); openUsageFull(); });
  // 我的状态：写一句「我此刻在做什么」，存服务端、随每条消息/唤醒捎给 cc。留空提交=清掉。
  $('drStatus').addEventListener('click', () => {
    closeDrawer();
    const cur = (state.userStatus && state.userStatus.text) || '';
    openPrompt('我的状态', cur, (t) => {
      wsend({ type: 'user_status', text: t || '' });
      toast(t ? '状态已更新' : '状态已清除');
    }, '此刻在做什么…', { allowEmpty: true });
  });
  $('drDiary').addEventListener('click', () => { closeDrawer(); openCalendar('list'); });
  $('drFavorites').addEventListener('click', () => { closeDrawer(); openFavoritesOverview(); });
  $('favBack').addEventListener('click', () => show('list'));
  // 醒来 / 小纸条 / 日记 wiring
  $('cinemaBack').addEventListener('click', () => { show('list'); wsend({ type: 'list_sessions' }); });
  $('cinemaLogBack').addEventListener('click', () => show('cinema'));
  $('wkEnable').addEventListener('click', () => { if (state.wk) { state.wk.enabled = !state.wk.enabled; if (!state.wk.enabled) closeWakeEditor(); renderWakeForm(); } });
  $('wkDawn').addEventListener('click', () => { if (state.wk) { state.wk.dawn = !state.wk.dawn; renderWakeForm(); } });
  $('wkChase').addEventListener('click', () => { if (state.wk) { state.wk.chase = !state.wk.chase; renderWakeForm(); } });
  $('wkEnter').addEventListener('click', () => { if (state.wk) { state.wk.wakeOnEnter = !state.wk.wakeOnEnter; renderWakeForm(); } });
  $('wkMode').addEventListener('click', (e) => { const b = e.target.closest('button[data-m]'); if (!b || !state.wk) return; state.wk.eMode = b.dataset.m; document.querySelectorAll('#wkMode button').forEach((x) => x.classList.toggle('on', x === b)); renderWakeModeArea(); });
  $('wkAdd').addEventListener('click', openWakeEditor);
  $('wkEditCancel').addEventListener('click', () => { closeWakeEditor(); });
  $('wkEditAdd').addEventListener('click', addFromEditor);
  $('wkSave').addEventListener('click', saveWake);
  $('stkRead').addEventListener('click', () => stickyAck(true));
  $('stkSkip').addEventListener('click', () => stickyAck(false));
  $('atDiary').addEventListener('click', () => { closePlus(); openCalendar('chat'); });
  $('diaryBack').addEventListener('click', diaryBack);
  $('diaryStickyBtn').addEventListener('click', openStickies);
  $('stickiesBack').addEventListener('click', () => show('diary'));
  $('dwBack').addEventListener('click', () => { closeDwPicker(); show('diary'); });
  $('dwAddImg').addEventListener('click', () => $('dwFile').click());
  $('dwFile').addEventListener('change', (e) => { dwAddImages(e.target.files); e.target.value = ''; });
  $('dwSave').addEventListener('click', dwSaveClick);
  $('dwMood').addEventListener('click', () => toggleDwPicker('mood'));
  $('dwWeather').addEventListener('click', () => toggleDwPicker('weather'));
  $('dwTags').addEventListener('click', () => openPrompt('标签', state.dwTags || '', (v) => { state.dwTags = (v || '').trim(); updateDwMoodWeather(); }, '逗号分隔', { allowEmpty: true }));
  $('dwText').addEventListener('input', dwUpdateCount);
  $('duDownload').addEventListener('click', downloadUpdate);
  $('usLine').addEventListener('click', () => $('usageStrip').classList.toggle('open'));
  $('usageBack').addEventListener('click', closeUsageFull);
  $('usageRefresh').addEventListener('click', reqUsage);
  // keep the thread clear of the (bottom-anchored, upward-growing) input dock
  try { new ResizeObserver(syncDockPad).observe($('dock')); } catch (e) {}
  $('atCompact').addEventListener('click', () => {
    closePlus();
    if (!state.currentSession) { toast('新会话无需压缩'); return; }
    openPrompt('压缩上下文', '', (extra) => doCompact(extra), '留空＝用设置里的压缩提示词', { allowEmpty: true });
  });
  // expand to fullscreen editor (expandBtn pointerdown wired below)
  $('composeBack').addEventListener('click', () => closeCompose(false));
  $('composeSave').addEventListener('click', () => closeCompose(true));

  const c = $('composer');
  c.addEventListener('input', () => { resizeComposer(); updateSend(); updateExpandBtn(); draftDirty(); });
  // 长文粘贴 → 光标处留一个占位符，正文发送时由 bridge 存成文件、原位替换成文件引用（指令留在外面）
  const handleLongPaste = (e, ta) => {
    if (!P('pasteAsFile')) return;
    const txt = (e.clipboardData || window.clipboardData).getData('text');
    if (!txt || txt.length <= P('pasteThreshold')) return;
    e.preventDefault();
    const n = state.pendingTexts.length + 1;
    const ph = '〔粘贴文本' + n + '·' + txt.length + '字〕';
    state.pendingTexts.push({ name: '粘贴文本-' + n + '.txt', content: txt, ph });
    const s = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
    const epos = ta.selectionEnd != null ? ta.selectionEnd : s;
    ta.value = ta.value.slice(0, s) + ph + ta.value.slice(epos);
    ta.selectionStart = ta.selectionEnd = s + ph.length;
    if (ta === c) resizeComposer();
    renderAttachStrip(); updateSend(); buzz(12); toast('长文已收起（' + txt.length + ' 字），发送时存为文件');
  };
  // 粘贴图片/文件 → 直接挂到输入框（附件条）先预览，发送时才上传、随消息一起带上
  const handleFilePaste = (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const fs = [];
    for (const it of items) { if (it.kind === 'file') { const f = it.getAsFile(); if (f) fs.push(f); } }
    if (!fs.length) return false;
    e.preventDefault();
    attachLocal(fs.map((f, i) => {
      // 剪贴板图片默认叫 image.png——起个带时间的名，翻上传文件夹时认得出
      if (f.name && !/^image\.\w+$/i.test(f.name)) return f;
      const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
      const ext = ((f.type || '').split('/')[1] || 'png').replace('jpeg', 'jpg');
      return new File([f], '贴图-' + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + (i ? '-' + i : '') + '.' + ext, { type: f.type });
    }));
    buzz(12);
    return true;
  };
  c.addEventListener('paste', (e) => { if (handleFilePaste(e)) return; handleLongPaste(e, c); });
  $('composeText').addEventListener('paste', (e) => { if (handleFilePaste(e)) return; handleLongPaste(e, $('composeText')); });
  c.addEventListener('focus', () => { state.composerFocused = true; closePlus(); updateExpandBtn(); });
  c.addEventListener('blur', () => { state.composerFocused = false; updateExpandBtn(); });
  $('sendBtn').addEventListener('click', sendMessage);
  // expand: use pointerdown so it fires before the composer blur hides the button
  $('expandBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); openCompose(); });
  $('thread').addEventListener('click', (e) => { closePlus(); const t = e.target; if (t && t.tagName === 'IMG' && t.closest && t.closest('.md')) openLightbox(t.src); });
  // 代码块复制按钮（md 渲染处通用：对话/回忆录/日记预览都吃这个委托）
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('.codecopy') : null;
    if (!b) return;
    const code = b.parentElement.querySelector('code');
    copyText(code ? code.textContent : '', '已复制');
    buzz(10);
    if (!b._keep) b._keep = b.innerHTML;
    b.innerHTML = '✓'; b.classList.add('did');
    clearTimeout(b._t); b._t = setTimeout(() => { b.innerHTML = b._keep; b.classList.remove('did'); }, 1100);
  });
  updateExpandBtn();

  // swipe up on the input area opens the + panel, swipe down closes it
  (() => {
    const stack = $('inputStack'); let iy = 0, ix = 0, on = false;
    stack.addEventListener('touchstart', (e) => { const t = e.touches[0]; iy = t.clientY; ix = t.clientX; on = true; }, { passive: true });
    stack.addEventListener('touchend', (e) => {
      if (!on) return; on = false;
      const t = e.changedTouches[0], dy = t.clientY - iy, dx = t.clientX - ix;
      if (Math.abs(dy) > 42 && Math.abs(dy) > Math.abs(dx) * 1.4) {
        if (dy < 0) { if (!state.plusOpen) openPlus(); }
        else if (state.plusOpen) closePlus();
      }
    }, { passive: true });
  })();

  $('permAllow').addEventListener('click', () => answerPerm(true));
  $('permAlways').addEventListener('click', () => answerPerm(true, 'always'));
  $('permDeny').addEventListener('click', () => closePerm(true));

  $('dirPick').addEventListener('click', pickDir);
  $('toolsLeft').addEventListener('click', toolsLeftAction);
  // session long-press actions
  $('sessSelect').addEventListener('click', () => { const s = state.sessTarget; closeScrim('sessScrim'); enterSelect(s); });
  $('selCancel').addEventListener('click', exitSelect);
  $('selAll').addEventListener('click', selectAllVisible);
  $('selFolder').addEventListener('click', openFolderPickerBatch);
  $('selDelete').addEventListener('click', deleteSelected);
  $('sessPin').addEventListener('click', () => { const s = state.sessTarget; closeScrim('sessScrim'); if (s) togglePin(s); });
  $('sessFolder').addEventListener('click', () => { const s = state.sessTarget; closeScrim('sessScrim'); if (s) openFolderPicker(s); });
  $('sessRename').addEventListener('click', () => { const s = state.sessTarget; closeScrim('sessScrim'); if (s) openPrompt('重命名会话', '', (name) => { if (name) wsend({ type: 'rename', sessionId: s.id, title: name }); }, s.title || ''); });
  $('sessClone').addEventListener('click', () => { const s = state.sessTarget; closeScrim('sessScrim'); if (s) { toast('复制中…'); wsend({ type: 'clone_session', sessionId: s.id, title: s.title || '' }); } });
  $('sessExport').addEventListener('click', () => { const s = state.sessTarget; closeScrim('sessScrim'); if (s) { toast('转出中…'); wsend({ type: 'export_terminal', sessionId: s.id }); } });
  $('sessDelete').addEventListener('click', () => { const s = state.sessTarget; closeScrim('sessScrim'); if (s) openConfirm('删除「' + (s.title || '会话') + '」？', '不可恢复', () => wsend({ type: 'delete', sessionId: s.id })); });
  function savePrompt() {
    const inp = $('promptInput'); const raw = inp.value.trim();
    if (!raw && !state.promptAllowEmpty) return;     // 空内容不提交（→ 本就藏着）
    const cb = state.promptCb;
    closeScrim('promptScrim'); state.promptCb = null;
    if (cb) cb(raw);                       // 回传输入值；删除类由各 cb 自行校验 === '删除'
  }
  $('promptOk').addEventListener('click', savePrompt);
  $('promptInput').addEventListener('input', () => { const inp = $('promptInput'); syncPromptGo(); inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, window.innerHeight * 0.38) + 'px'; });
  $('promptInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); savePrompt(); } });
  // generic ✕ / cancel buttons inside sheets
  document.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => { const sc = b.closest('.scrim'); if (sc) closeScrim(sc.id); }));
  document.querySelectorAll('[data-deny]').forEach((b) => b.addEventListener('click', () => closePerm(true)));
  // set up draggable sheets
  DRAG_SCRIMS.forEach(setupDrag);

  $('setBack').addEventListener('click', () => show('list'));
  $('setSubBack').addEventListener('click', () => show('settings'));
  $('filesBack').addEventListener('click', closeFiles);
  $('importBack').addEventListener('click', () => show(state.importReturn || 'files'));
  $('importAll').addEventListener('click', importToggleAll);
  $('importGo').addEventListener('click', doImport);
  $('setConnRow').addEventListener('click', openConn);
  $('setApiRow').addEventListener('click', openApi);
  $('apiBack').addEventListener('click', () => show('settings'));
  $('apiOn').addEventListener('click', () => { const on = !(state.apiInfo && state.apiInfo.enabled); wsend({ type: 'api_set', enabled: on }); buzz(12); });
  $('apiSave').addEventListener('click', () => { wsend({ type: 'api_set', ...apiFields() }); $('api_key').value = ''; $('api_token').value = ''; toast('已保存'); });
  $('apiTest').addEventListener('click', () => { const o = $('apiTestOut'); o.className = 'apitest'; o.textContent = '测试中…'; wsend({ type: 'api_test', ...apiFields() }); });
  $('apiClear').addEventListener('click', () => openConfirm('清除已存的密钥？', 'Key 和 Token 都会清掉', () => wsend({ type: 'api_set', key: '', authToken: '' }), '清除'));
  $('confirmYes').addEventListener('click', () => { const cb = state.confirmCb; state.confirmCb = null; closeScrim('confirmScrim'); if (cb) cb(); });
  $('msgEdit').addEventListener('click', () => { const b = state.msgTarget; closeScrim('msgActScrim'); if (b && b._uuid) editMessage(b._uuid, b._raw || ''); });
  $('editX').addEventListener('click', cancelEdit);
  $('msgCopy').addEventListener('click', () => { const b = state.msgTarget; closeScrim('msgActScrim'); if (b) copyText(b._raw || b.innerText || '', '已复制'); });
  $('pathSelect').addEventListener('click', () => { const p = state.pathTarget; closeScrim('pathActScrim'); if (p) enterFmSel(p); });
  $('pathCut').addEventListener('click', () => { const p = state.pathTarget; closeScrim('pathActScrim'); if (p) { state.fmClip = { op: 'move', paths: [p] }; rerenderDirs(); toast('已剪切，去目标目录粘贴'); } });
  $('pathCopy').addEventListener('click', () => { const p = state.pathTarget; closeScrim('pathActScrim'); if (p) { state.fmClip = { op: 'copy', paths: [p] }; rerenderDirs(); toast('已复制，去目标目录粘贴'); } });
  $('fmSelCut').addEventListener('click', () => fmClipFromSel('move'));
  $('fmSelCopy').addEventListener('click', () => fmClipFromSel('copy'));
  $('fmSelDel').addEventListener('click', () => { if (!state.fmSel || !state.fmSel.size) return; const ps = [...state.fmSel]; openConfirm('删除 ' + ps.length + ' 项？', '不可恢复', () => { wsend({ type: 'paths_op', op: 'delete', paths: ps, dir: state.dirPath }); exitFmSel(); }); });
  $('fmSelX').addEventListener('click', exitFmSel);
  $('setAppearRow').addEventListener('click', () => openSetSub('appearance'));
  $('setChatRow').addEventListener('click', () => openSetSub('chat'));
  $('setHapticRow').addEventListener('click', () => openSetSub('haptics'));
  $('setUpdateRow').addEventListener('click', () => openSetSub('update'));
  $('set_save').addEventListener('click', () => { LS.url = $('set_url').value.trim(); LS.token = $('set_token').value.trim(); LS.cwd = $('set_cwd').value.trim(); toast('已保存，重连中'); closeScrim('connScrim'); connect(); });
  $('set_logout').addEventListener('click', () => { LS.clear(); closeScrim('connScrim'); show('setup'); });
  initDrawerSwipe();
  // returning from the file picker / background: don't flash the disconnect screen — give reconnect a moment
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') { sendPresence(); return; }
    ensureConnected(); // back to foreground → reconnect now, don't wait out a background-throttled timer
    state.lastRx = Date.now(); // reset liveness clock so the watchdog doesn't insta-trip after a frozen background
    sendPresence(); // foreground/background changed → update wake-push 不打扰
    prefetchKick();  // 回前台 → 续上后台预缓存
    if (!state.discActive && P('discFx')) { clearTimeout(state.discShowTimer); if (!state.connected) state.discShowTimer = setTimeout(showDisc, 3000); }
  });
  // 在场心跳：看着对话时每 15s 报一次在场，电影模式据此判断"还在不在"；锁屏/切后台心跳自动停，服务端 ~40s 内翻成守夜
  setInterval(() => { if (document.visibilityState === 'visible' && state.screen === 'chat' && state.currentSession) sendPresence(); }, 15000);

  // tap the dimmed backdrop (outside the sheet) to dismiss
  SCRIMS.forEach((id) => {
    const sc = $(id);
    sc.addEventListener('click', (e) => {
      if (e.target !== sc) return;
      if (Date.now() - (sc._openedAt || 0) < 400) return; // ignore the tap that opened it
      if (id === 'permScrim') closePerm(true); else closeScrim(id);
    });
  });

  state.prefs = loadPrefs(); applyFont(); applyTheme(); applyStatusBar(); applyDiscBlink();
  window._bootAt = Date.now();
  if (LS.token) { show('list'); connect(); setTimeout(hideSplash, 6000); } // 6s fallback if list never loads
  else { show('setup'); hideSplash(); }
}
function openSettings() { refreshSettingsRows(); show('settings'); }

boot();
