'use strict';

/* ============ storage ============ */
const LS = {
  get url() { return localStorage.getItem('cc_url') || ''; }, set url(v) { localStorage.setItem('cc_url', v); },
  get token() { return localStorage.getItem('cc_token') || ''; }, set token(v) { localStorage.setItem('cc_token', v); },
  get cwd() { return localStorage.getItem('cc_cwd') || ''; }, set cwd(v) { localStorage.setItem('cc_cwd', v); },
  get model() { return localStorage.getItem('cc_model') || ''; }, set model(v) { localStorage.setItem('cc_model', v); },
  get effort() { return localStorage.getItem('cc_effort') || ''; }, set effort(v) { localStorage.setItem('cc_effort', v); },
  get mode() { return localStorage.getItem('cc_mode') || 'code'; }, set mode(v) { localStorage.setItem('cc_mode', v); },
  clear() { ['cc_url', 'cc_token', 'cc_cwd', 'cc_model', 'cc_effort', 'cc_mode'].forEach((k) => localStorage.removeItem(k)); }
};

/* app preferences (separate from connection config; survive 清除配置) */
let APP_VERSION = '1.1.1';
try { if (window.Android && Android.appVersion) APP_VERSION = Android.appVersion() || APP_VERSION; } catch (e) {}
const PREF_DEFAULTS = {
  fontSize: 1, fontFamily: 'client', showModel: true, showTokens: true,
  interruptOnLeave: false, autoScroll: true, pasteAsFile: true, pasteThreshold: 1200, timezone: '',
  haptics: true, genHaptic: false, updateNotify: true, showStatusBar: true, discFx: true, discBlink: false,
  autoCleanup: true, wakePush: true, compactPrompt: '',
  theme: 'warm', accent: 'brick', foldersCollapsed: false
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
function md(t) { try { return window.marked ? marked.parse(t || '') : esc(t); } catch (e) { return esc(t); } }
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
  doc: _sv('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>')
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
const SCREENS = ['setup', 'list', 'chat', 'settings', 'setSub', 'files', 'import', 'diary', 'diaryWrite', 'cinema'];
function show(name) {
  SCREENS.forEach((s) => $(s).classList.toggle('active', s === name));
  state.screen = name;
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
const SCRIMS = ['permScrim', 'modelScrim', 'promptScrim', 'toolsScrim', 'modeScrim', 'sessScrim', 'folderScrim', 'claudeScrim', 'folderActScrim', 'pathActScrim', 'mcpScrim', 'mcpCfgScrim', 'connScrim', 'wakeScrim', 'stickyScrim', 'compactScrim'];
const DRAG_SCRIMS = ['modelScrim', 'toolsScrim', 'modeScrim', 'claudeScrim', 'mcpCfgScrim', 'compactScrim'];
function anyOverlay() { return SCRIMS.some((s) => $(s).classList.contains('show')) || $('menuPop').classList.contains('show'); }
function openScrim(id) {
  const s = $(id); s._openedAt = Date.now(); s.classList.add('show'); if (s._open) s._open();
  syncAtRoot();
  // briefly block taps so a quick release after a long-press doesn't fall through onto an item
  const sheet = s.querySelector('.sheet'); if (sheet) { sheet.style.pointerEvents = 'none'; clearTimeout(s._peT); s._peT = setTimeout(() => { sheet.style.pointerEvents = ''; }, 350); }
}
function closeScrim(id) { const s = $(id); if (s._close) s._close(); else s.classList.remove('show'); syncAtRoot(); }
function closeOverlays() { SCRIMS.forEach(closeScrim); closeMenu(); }

/* draggable two-stage bottom sheet (normal <-> full), draggable from anywhere */
function setupDrag(id) {
  const scrim = $(id); const sheet = scrim.querySelector('.sheet.drag'); if (!sheet) return;
  const body = sheet.querySelector('.sheetbody');
  let H = 0, halfY = 0, startY = 0, startT = 0, t = 0, lastY = 0, lastTime = 0, vel = 0, dragging = false, mode = null, startOnHeader = false, startOnField = false;
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
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const y = e.touches[0].clientY, dy = y - startY;
    if (mode === null) {
      const atFull = t <= 1;
      const atTop = body.scrollTop <= 0;
      const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
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
  if (state.screen === 'cinema') { show('list'); wsend({ type: 'list_sessions' }); return; }
  if (state.screen === 'diary') { diaryBack(); return; }
  if (state.screen === 'import') show(state.importReturn || 'files');
  else if (state.screen === 'files') closeFiles();
  else if (state.screen === 'chat') goListAnimated();
  else if (state.screen === 'setSub') show('settings');
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
}

/* ============ state ============ */
const state = {
  screen: 'setup', ws: null, connected: false, authed: false, defaultCwd: '',
  sessions: [], currentSession: null, cwd: '', sessionModel: 'Claude', lastModel: '',
  model: '', effort: '', modelMine: false, mode: 'code', live: null, busy: false,
  pendingPerm: null, reconnectTimer: null, dirPath: '', promptCb: null,
  turnTools: [], toolRow: null, folders: [], sessTarget: null, folderTarget: null, activeFolder: null,
  pendingFiles: [], origin: '', dirMode: 'cwd', activeTurn: null,
  searchActive: false, plusOpen: false, plusH: 0,
  prefs: {}, pendingTexts: [], setCat: null,
  discActive: false, discCollapsed: false, discRaf: null, discT0: 0, discShowTimer: null,
  availModels: [], modelDefault: '', uploading: 0, filesReturn: 'list', searchScope: 'chat',
  selectMode: false, selected: new Set(),
  importItems: [], importSel: new Set(), importPath: '', everAuthed: false,
  lastRx: 0, pendingHistory: null, pendingSticky: null, liveTimer: null
};

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
function sendPresence() { wsend({ type: 'presence', sessionId: state.screen === 'chat' ? state.currentSession : null, foreground: document.visibilityState === 'visible', model: state.modelMine ? state.model : undefined, effort: state.modelMine ? state.effort : undefined }); }
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

/* splash: hide once the app is ready (list rendered / setup shown), with a min on-screen time */
const SPLASH_MIN_MS = 650;
function hideSplash() {
  const sp = document.getElementById('splash'); if (!sp || sp.classList.contains('hide')) return;
  const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - (window._bootAt || 0)));
  setTimeout(() => { sp.classList.add('hide'); setTimeout(() => sp.remove(), 500); }, wait);
}

/* ============ message handling ============ */
function handle(m) {
  // track buffered-event sequence for the active turn (for resume-on-reconnect)
  if (m._i != null && state.activeTurn && !state.activeTurn.done) state.activeTurn.lastI = Math.max(state.activeTurn.lastI || 0, m._i);
  // 一旦 cc 产出可见内容（正文/工具/媒体），就标记「已开口」——之后的打断不再回退消息
  if (state.activeTurn && (m.type === 'assistant_delta' || m.type === 'assistant_text' || m.type === 'tool_use' || m.type === 'tool_result' || m.type === 'media')) state.activeTurn.spoke = true;
  switch (m.type) {
    case 'auth_ok':
      state.authed = true; state.everAuthed = true; state.defaultCwd = m.defaultCwd || ''; connbar(''); hideDisc();
      state.lastRx = Date.now(); startLiveness();
      checkUpdate(false); wsend({ type: 'model_list' });
      if (state.screen === 'setup') show('list');
      wsend({ type: 'list_sessions' });
      sendPushPref(); sendPresence(); applyNativeNotify();
      if (P('autoCleanup') && !state._cleaned) { state._cleaned = true; wsend({ type: 'cleanup_stale' }); }  // once per launch
      // re-fetch history/sticky that got dropped because we tapped into the chat before auth landed
      if (state.pendingHistory) { wsend({ type: 'get_history', sessionId: state.pendingHistory }); state.pendingHistory = null; }
      if (state.pendingSticky) { wsend({ type: 'sticky_get', sessionId: state.pendingSticky }); state.pendingSticky = null; }
      // resume an in-flight turn after a reconnect
      if (state.activeTurn && !state.activeTurn.done) { startStatus(); wsend({ type: 'attach', turnId: state.activeTurn.id, after: state.activeTurn.lastI || 0 }); }
      if ($('usageFull').classList.contains('show')) reqUsage(); // 用量页开着断线重连 → 自动刷新
      break;
    case 'pong': break; // liveness reply — lastRx already bumped in onmessage
    case 'attach_done':
      if (!m.found) { if (state.activeTurn) state.activeTurn.done = true; state.busy = false; stopStatus(); updateSend(); }
      break;
    case 'auth_fail':
      // if we authed successfully before, a fail is almost always a transient reconnect race —
      // don't cry "token 不正确" / dump to settings; just let the reconnect loop retry.
      if (state.everAuthed) connbar('重连中…', true);
      else { connbar('鉴权失败：token 不对', true); toast('Token 不正确'); show('settings'); }
      break;
    case 'sessions': state.sessions = m.sessions || []; if (m.folders) state.folders = m.folders; renderSessions(); break;
    case 'usage': state.usage = m; renderUsageStrip(); if ($('usageFull').classList.contains('show')) renderUsageFull(); break;
    case 'app_update': onAppUpdate(m); break;
    case 'folders':
      state.folders = m.folders || [];
      if (state.activeFolder && !state.folders.includes(state.activeFolder)) state.activeFolder = null;
      renderSessions(); break;
    case 'assigned': wsend({ type: 'list_sessions' }); break;
    case 'history': renderHistory(m); break;
    case 'dirs': renderDirs(m); break;
    case 'turn_start': state.busy = true; state.turnTools = []; state.toolRow = null; startStatus(); updateSend(); break;
    case 'session_init':
      if (state.expectFork || !state.currentSession) state.currentSession = m.sessionId;
      state.lastModel = m.model || state.lastModel; syncModelSub(); // SDK 报的才是这回合真正跑的模型
      if (m.cwd) state.cwd = m.cwd;
      sendPresence(); // 新会话/fork 刚拿到 sid：顺手把本对话的模型记到服务端（唤醒按它选模型）
      updateHeader(); break;
    case 'assistant_delta': appendDelta(m.text); break;
    case 'assistant_text': finalizeText(m.text); break;
    case 'thinking': addThinking(m.text); break;
    case 'tool_use': addTool(m); break;
    case 'tool_result': updateTool(m); break;
    case 'media': addMedia(m.kind, m.url); break;
    case 'file': if (state.editingClaude && m.path === state.claudePath) { $('claudeText').value = m.content || ''; openScrim('claudeScrim'); } break;
    case 'file_saved': toast('CLAUDE.md 已保存'); break;
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
    case 'turn_end': endTurn(m); break;
    case 'turn_error': {
      stopStatus(); finalizeLive(); state.busy = false; updateSend(); state.expectFork = false;
      if (state.activeTurn) state.activeTurn.done = true;
      const orig = m.origSession || state.forkFrom;
      if (orig) {                       // a regenerate / edit-resend died: drop the dead branch, restore the original
        state.forkFrom = null; toast('重新生成失败，已保留原对话');
        state.currentSession = orig; wsend({ type: 'get_history', sessionId: orig });
      } else addError(m.message);
      wsend({ type: 'list_sessions' });
      break;
    }
    case 'renamed': case 'deleted': case 'pinned': wsend({ type: 'list_sessions' }); break;
    case 'cleanup_done': if (m.removed) toast('已清理 ' + m.removed + ' 个废弃对话'); wsend({ type: 'list_sessions' }); break;
    // ---- 醒来 / 日记 / 便签 ----
    case 'wakeup_state': onWakeState(m); break;
    case 'cinema_state': onCinemaState(m); break;
    case 'cinema_notice': toast(m.text || '电影模式已暂停'); break;
    case 'wake_typing':
      if (m.on) state.cinemaTyping = m.sessionId; else if (state.cinemaTyping === m.sessionId) state.cinemaTyping = '';
      updateCinemaBar(); break;
    case 'wake_message':
      // late = 重连补发的错过消息——正文已经在会话历史里了，往打开的对话里再插会重复显示
      if (m.late) { toast((m.title ? '「' + m.title + '」' : '') + '有错过的醒来留言'); wsend({ type: 'list_sessions' }); break; }
      if (state.screen === 'chat' && state.currentSession === m.sessionId) { addAssistantText(m.text); buzz(18); scrollThreadAuto(); }
      else { toast((m.title ? '「' + m.title + '」' : '') + 'cc 醒来留言了'); wsend({ type: 'list_sessions' }); }
      break;
    case 'diary_page':
      if (state.screen === 'diary' && state.diaryView === 'detail' && m.sessionId === state.diarySession) { state.diaryPage = m; renderDiaryDetail(); }
      break;
    case 'diary_index': break; // (client always reads a specific day; days come with diary_page)
    case 'diary_saved':
      toast('已保存到日记');
      if (state.screen === 'diary' && state.diaryView === 'detail' && m.sessionId === state.diarySession) wsend({ type: 'diary_get', sessionId: state.diarySession, date: state.diaryDay });
      break;
    case 'diary_overview': if (state.screen === 'diary' && state.diaryView === 'overview') renderDiaryOverview(m.cards || []); break;
    case 'stickies': onStickies(m); break;
    case 'diary_changed':
      if (state.screen === 'diary' && state.diaryView === 'detail' && m.sessionId === state.diarySession) wsend({ type: 'diary_get', sessionId: state.diarySession, date: state.diaryDay });
      else if (state.screen === 'diary' && state.diaryView === 'overview') wsend({ type: 'diary_overview' });
      break;
    case 'sticky_changed':
      if (state.screen === 'diary' && state.diaryView === 'detail' && m.sessionId === state.diarySession) wsend({ type: 'sticky_get', sessionId: state.diarySession });
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
// 只有存在文件夹时才出现三角；收起时回到「全部」，免得过滤生效却看不见 chip。
function syncFoldCaret() {
  const hasFolders = (state.folders || []).length > 0;
  const collapsed = hasFolders && P('foldersCollapsed');
  if (collapsed && state.activeFolder) state.activeFolder = null;
  const caret = $('foldCaret');
  if (!caret) return;
  caret.style.display = hasFolders ? '' : 'none';
  caret.textContent = collapsed ? '▸' : '▾';
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
  openPrompt('输入「删除」确认删除选中的 ' + n + ' 个会话（不可恢复）', '', (v) => {
    if (v === '删除') { wsend({ type: 'delete_many', ids: [...state.selected] }); exitSelect(); } else toast('已取消');
  });
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
function clearThread() { if (searchOpen()) closeSearch(); stopStatus(); $('thread').innerHTML = ''; state.live = null; state.turnTools = []; state.toolRow = null; }
function scrollThread() { const t = $('thread'); t.scrollTop = t.scrollHeight; }
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
  if (uuid) { b.classList.add('editable'); b.addEventListener('click', () => editMessage(uuid, text)); }
  $('thread').appendChild(m); scrollThread();
  return b;
}
function editMessage(uuid, current) {
  if (!state.currentSession) return;
  openPrompt('编辑并重发', current, (text) => {
    if (!text || text === current) return;
    state.forkFrom = state.currentSession; state.expectFork = true; clearThread(); addUser(text);
    state.activeTurn = { id: genId(), lastI: 0, done: false };
    const msg = { type: 'edit_resend', sessionId: state.currentSession, targetUuid: uuid, text, mode: state.mode, turnId: state.activeTurn.id };
    if (state.model) msg.model = state.model; if (state.effort) msg.effort = state.effort;
    wsend(msg);
  });
}
function regenerate() {
  if (!state.currentSession) { toast('新会话无需重新生成'); return; }
  state.forkFrom = state.currentSession; state.expectFork = true; clearThread();
  state.activeTurn = { id: genId(), lastI: 0, done: false };
  wsend({ type: 'regenerate', sessionId: state.currentSession, mode: state.mode, turnId: state.activeTurn.id });
  toast('重新生成中…');
}
function ensureLive() { if (state.live) return state.live; const m = el('div', 'msg assistant'); const t = el('div', 'text cursor'); m.appendChild(t); $('thread').appendChild(m); state.live = t; return t; }
function appendDelta(text) { const t = ensureLive(); t.textContent += text; scrollThreadAuto(); }
function finalizeText(full) { const t = ensureLive(); t.classList.remove('cursor', 'text'); t.classList.add('md'); t.innerHTML = md(full); state.live = null; scrollThreadAuto(); }
function finalizeLive() { if (state.live) { state.live.classList.remove('cursor'); state.live = null; } }
function addAssistantText(full) { const m = el('div', 'msg assistant'); const t = el('div', 'md'); t.innerHTML = md(full); m.appendChild(t); $('thread').appendChild(m); }
function addThinking(text) { finalizeLive(); const d = el('div', 'thinking'); const inner = el('div', 'md'); inner.innerHTML = md(text); d.appendChild(inner); d.addEventListener('click', () => d.classList.toggle('collapsed')); $('thread').appendChild(d); scrollThreadAuto(); }

/* ---- animated "thinking" status line, Claude Code style ---- */
const SL_FRAMES = ['·', '✢', '✳', '∗', '✻', '✽', '✻', '∗', '✳', '✢'];
const SL_WORDS = ['Thinking', 'Pondering', 'Cogitating', 'Musing', 'Ruminating', 'Noodling',
  'Percolating', 'Simmering', 'Brewing', 'Churning', 'Conjuring', 'Crafting', 'Deliberating',
  'Computing', 'Synthesizing', 'Mulling', 'Marinating', 'Working', 'Forging', 'Hatching',
  'Reticulating', 'Vibing', 'Honking', 'Schlepping', 'Spinning', 'Manifesting', 'Cooking'];
function slWord() { return SL_WORDS[(Math.random() * SL_WORDS.length) | 0]; }
function startStatus() {
  if (state.statusTimer) return;
  state.statusStart = Date.now();
  state.statusWord = slWord();
  state.statusFrame = 0;
  state.statusNextWord = 2500 + Math.random() * 2500;
  let sl = document.getElementById('statusline');
  if (!sl) {
    sl = el('div', 'statusline'); sl.id = 'statusline';
    sl.innerHTML = '<span class="sl-glyph">✻</span><span class="sl-word"></span><span class="sl-meta"></span>';
    $('thread').appendChild(sl);
  }
  scrollThread();
  state.statusTimer = setInterval(() => {
    const s = document.getElementById('statusline'); if (!s) return;
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
  $('thread').appendChild(m); scrollThreadAuto();
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
  state.toolRow.querySelector('.tr-text').textContent = state.busy && !state._turnDone ? `正在使用工具…（${n}）` : `Used ${n} tools, ran ${cmds} commands`;
}
function addTool(m) { ensureToolRow(); state.turnTools.push({ id: m.id, name: m.name, input: m.input, isError: null }); updateToolRow(); scrollThreadAuto(); }
function updateTool(m) { const t = state.turnTools.find((x) => x.id === m.id); if (t) { t.isError = m.isError; t.content = m.content; } }
function addError(msg) { const d = el('div', 'msg assistant'); const t = el('div', 'md'); t.style.color = 'var(--err)'; t.textContent = '⚠ ' + msg; d.appendChild(t); $('thread').appendChild(d); scrollThread(); }
function fmtTok(n) { n = n || 0; if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'; return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n); }
function endTurn(m) {
  // 这条 turn 已被「思考阶段打断」回退过：吞掉它迟到的收尾，别再震动/出统计
  if (state.activeTurn && state.activeTurn.rolledBack) { stopStatus(); state.busy = false; updateSend(); return; }
  stopStatus(); finalizeLive(); state.busy = false; state._turnDone = true; state.forkFrom = null; if (state.activeTurn) state.activeTurn.done = true; updateToolRow(); updateSend();
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
  if (state.expectFork) { state.expectFork = false; wsend({ type: 'get_history', sessionId: state.currentSession }); }
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
function updateHeader() {
  $('chatTitle').textContent = state.currentSession ? (state.curTitle || 'Claude Code') : '新会话';
  if (P('showModel') && state.currentSession) { $('chatSub').textContent = state.sessionModel || 'Claude'; $('chatSub').style.display = 'block'; }
  else $('chatSub').style.display = 'none';
  // dir chip only matters for a brand-new session (where you can still choose the dir)
  $('dirChip').style.display = state.currentSession ? 'none' : 'inline-flex';
  $('dirChipLabel').textContent = shortCwd(state.cwd || state.defaultCwd);
}
function applyMode() {
  const md = MODES.find((x) => x.id === state.mode) || MODES[0];
  $('modeLabel').textContent = md.name;
  const chip = $('modeChip'); chip.classList.remove('plan', 'auto', 'bypass');
  if (state.mode === 'plan') chip.classList.add('plan');
  else if (state.mode === 'acceptEdits') chip.classList.add('auto');
  else if (state.mode === 'bypass') chip.classList.add('bypass');
}
function openSession(s) {
  // re-entering the session whose turn is still running → keep the live view (message +
  // spinner + partial reply); don't clobber it with stale history that lacks the in-flight turn
  if (state.currentSession === s.id && state.activeTurn && !state.activeTurn.done) { show('chat'); return; }
  state.currentSession = s.id; state.cwd = s.cwd || ''; state.curTitle = s.title; state.sessionModel = 'Claude'; state.lastModel = '';
  // 模型/effort 是每对话一份的（服务端 sessmodel.json）：先拿全局默认占位，等 history 带回这个对话
  // 记住的 pref 再切过去；占位期间 modelMine=false → presence 不带 model，不会盖掉服务端那份。
  // [1m] 这类运行时变体也存在 pref 里，重开对话不会掉回 200K 底座被自动 compact。
  state.model = LS.model; state.effort = LS.effort; state.modelMine = false; state.mode = LS.mode; applyMode();
  clearThread(); updateHeader(); show('chat'); removeSuggestions();
  // if not authed yet (slow/just-reconnecting), the send is dropped — remember to retry on auth_ok
  state.pendingHistory = wsend({ type: 'get_history', sessionId: s.id }) ? null : s.id;
  wsend({ type: 'cinema_get', sessionId: s.id }); // 知道这个对话有没有开电影模式 → 顶部「时间流动中」横幅
  state.stickyPopupFor = s.id;
  state.pendingSticky = wsend({ type: 'sticky_get', sessionId: s.id }) ? null : s.id; // show 小纸条 popup if any unread
}
function newSession() {
  state.currentSession = null; state.cwd = LS.cwd || state.defaultCwd; state.curTitle = ''; state.sessionModel = 'Claude'; state.lastModel = '';
  state.model = LS.model; state.effort = LS.effort; state.modelMine = true; state.mode = LS.mode; applyMode(); // 新对话从全局默认起步，这份就算它自己的选择
  clearThread(); updateHeader(); show('chat'); showSuggestions();
  setTimeout(() => $('composer').focus(), 80);
}
function goList() { if (P('interruptOnLeave') && state.busy) wsend({ type: 'interrupt' }); show('list'); wsend({ type: 'list_sessions' }); }
function renderHistory(m) {
  clearThread(); removeSuggestions();
  if (m.cwd) { state.cwd = m.cwd; } if (m.title) state.curTitle = m.title; updateHeader();
  // 切到这个对话记住的模型/effort（没记过就是 ''=默认）；用户手快已经先选了的话（modelMine）不抢
  if (m.sessionId === state.currentSession && !state.modelMine) {
    const p = m.pref || {};
    state.model = p.model || ''; state.effort = p.effort || ''; state.modelMine = true;
  }
  if (m.sessionId === state.currentSession) { state.lastModel = m.lastModel || ''; syncModelSub(); }
  let group = null, userB = null; // userB: 最近的用户气泡——它的附图回填成气泡内缩略图，而不是 cc 侧大图
  (m.items || []).forEach((it) => {
    if (it.kind === 'text') { group = null; if (it.role === 'user') userB = addUser(it.text, it.uuid); else { userB = null; addAssistantText(it.text); } }
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
        $('thread').appendChild(g.row); group = g;
      }
      group.tools.push({ id: it.id, name: it.name, input: it.input, isError: false });
      group.row.querySelector('.tr-text').textContent = `Used ${group.tools.length} tools, ran ${group.tools.filter((t) => t.name === 'Bash').length} commands`;
    } else if (it.kind === 'tool_result') { if (group) { const t = group.tools.find((x) => x.id === it.id); if (t) { t.isError = it.isError; t.content = it.content; } } }
  });
  scrollThread();
}

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
function openModelSheet() {
  closeMenu();
  const mo = $('modelOpts'); mo.innerHTML = '';
  modelList().forEach((x) => {
    const o = el('button', 'opt' + (state.model === x.id ? ' on' : ''));
    const tag = x.ctx >= 1000000 ? ' <span class="tag1m">1M</span>' : '';
    o.innerHTML = `<div><div>${x.name}${tag}</div>${x.sub ? `<div class="osub">${x.sub}</div>` : ''}</div><span class="check">✓</span>`;
    o.addEventListener('click', () => { state.model = x.id; state.modelMine = true; if (state.currentSession) { sendPresence(); syncModelSub(); } else LS.model = x.id; openModelSheet(); });
    mo.appendChild(o);
  });
  // hide effort if the chosen model declares it unsupported
  const chosen = (state.availModels || []).find((x) => x.id === state.model);
  const showEffort = !chosen || chosen.effort;
  const eo = $('effortOpts'); eo.innerHTML = '';
  $('effortOpts').parentElement.querySelector('.sub2').style.display = showEffort ? '' : 'none';
  if (showEffort) EFFORTS.forEach((x) => { const o = el('button', 'opt' + (state.effort === x.id ? ' on' : '')); o.innerHTML = `<div><div>${x.name}</div>${x.sub ? `<div class="osub">${x.sub}</div>` : ''}</div><span class="check">✓</span>`; o.addEventListener('click', () => { state.effort = x.id; state.modelMine = true; if (state.currentSession) sendPresence(); else LS.effort = x.id; openModelSheet(); }); eo.appendChild(o); });
  openScrim('modelScrim');
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
function closeFiles() { show(state.filesReturn || 'list'); }
function renderDirs(m) {
  state.dirPath = m.path; $('dirCurrent').textContent = m.path;
  const list = $('dirList'); list.innerHTML = '';
  // toolbar: upload + new folder (upload only in manager modes)
  const bar = el('div', 'dirtool');
  if (state.dirMode === 'attach' || state.dirMode === 'browse') {
    const up = el('button', 'btn btn-ghost'); up.textContent = '⬆ 上传到这里';
    up.addEventListener('click', () => $('fileUpMgr').click());
    bar.appendChild(up);
  }
  const nf = el('button', 'btn btn-ghost'); nf.textContent = '＋ 新建文件夹';
  nf.addEventListener('click', () => openPrompt('新建文件夹', '', (name) => { if (name) wsend({ type: 'mkdir', dir: state.dirPath, name }); }));
  bar.appendChild(nf); list.appendChild(bar);
  if (m.parent && m.parent !== m.path) { const up = el('div', 'diritem up'); up.innerHTML = '<span class="ico">' + ICON.up + '</span>'; up.appendChild(document.createTextNode(' ..')); up.addEventListener('click', () => wsend({ type: 'list_dirs', path: m.parent })); list.appendChild(up); }
  (m.dirs || []).forEach((d) => {
    const it = el('div', 'diritem'); it.innerHTML = '<span class="ico">' + ICON.folder + '</span>'; it.appendChild(document.createTextNode(' ' + d.split('/').pop()));
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
      bindEntry(it, () => onFileTap(f), f);
      list.appendChild(it);
    });
  }
  if (!(m.dirs || []).length && !(state.dirMode !== 'cwd' && (m.files || []).length)) { const e = el('div', 'diritem'); e.style.color = 'var(--muted)'; e.textContent = '（空）'; list.appendChild(e); }
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
// tap = action(), long-press = manage (rename/delete/download)
function bindEntry(node, onTap, path) {
  let lp = false, timer = null;
  node.addEventListener('click', () => { if (lp) { lp = false; return; } onTap(); });
  const start = () => { lp = false; timer = setTimeout(() => { lp = true; buzz(12); openPathActions(path); }, 500); };
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
// quick upload from the + panel: to the session cwd, progress shown in the attach strip, auto-attach
function quickUpload(fileList) {
  const dir = state.cwd || state.defaultCwd;
  Array.from(fileList || []).forEach((file) => {
    const item = { name: file.name, isImage: (file.type || '').startsWith('image/') || isImagePath(file.name), status: 'uploading', pct: 0, speed: 0 };
    state.pendingFiles.push(item); renderAttachStrip(); updateSend();
    uploadOne(file, dir, (pct, sp) => { item.pct = pct; item.speed = sp; renderAttachStrip(); })
      .then((r) => { item.status = 'ready'; item.path = r.path; item.name = r.name || item.name; if (item.isImage && r.path) item.url = mediaUrlC(r.path); renderAttachStrip(); updateSend(); })
      .catch((e) => { const i = state.pendingFiles.indexOf(item); if (i >= 0) state.pendingFiles.splice(i, 1); renderAttachStrip(); updateSend(); toast('上传失败：' + e.message); });
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

/* ============ prompt sheet ============ */
function openPrompt(title, value, cb, placeholder) { $('promptTitle').textContent = title; $('promptInput').value = value || ''; $('promptInput').placeholder = placeholder || ''; state.promptCb = cb; openScrim('promptScrim'); setTimeout(() => $('promptInput').focus(), 100); }

/* ============ compact history ============ */
function openCompactPrompt() { $('compactText').value = P('compactPrompt') || ''; openScrim('compactScrim'); }
function doCompact(extra) {
  if (!state.currentSession) return;
  const ins = (extra && extra.trim()) ? extra.trim() : (P('compactPrompt') || '').trim(); // 留空时用设置里的默认压缩提示词
  const text = '/compact' + (ins ? ' ' + ins : '');
  state.activeTurn = { id: genId(), lastI: 0, done: false };
  wsend({ type: 'send', sessionId: state.currentSession, text, mode: state.mode, turnId: state.activeTurn.id });
  toast('压缩中…');
}

/* ============ + panel (tools sheet at the bottom; the dock rides up, dims the rest) ============ */
function togglePlus() { if (state.plusOpen) closePlus(); else openPlus(); }
function openPlus() {
  $('composer').blur();
  const dock = $('dock'), panel = $('plusPanel'), pb = $('plusBack');
  clearTimeout(pb._hideT); pb.classList.add('show'); requestAnimationFrame(() => pb.classList.add('in'));
  panel.style.display = 'block';
  const h = panel.offsetHeight + 8;                 // tools height + the margin gap
  state.plusH = h; state.plusOpen = true;
  dock.style.transition = 'none'; dock.style.transform = 'translateY(' + h + 'px)';  // start with tools off-screen, input at the bottom
  requestAnimationFrame(() => { dock.style.transition = 'transform .27s cubic-bezier(.32,.72,0,1)'; dock.style.transform = 'translateY(0)'; });
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
  setTimeout(() => { if (!state.plusOpen) { panel.style.display = 'none'; dock.style.transition = 'none'; dock.style.transform = ''; } }, 290);
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

/* ============ ⋮ menu (reveals top-down, collapses bottom-up) ============ */
function openMenu() {
  const mb = $('menuback'), mp = $('menuPop');
  // CLAUDE.md / model / MCP / copy-dir work for a brand-new session too (they act on the
  // chosen working dir / globally); only hide the items that need an existing session.
  const newSess = !state.currentSession;
  ['mRegen', 'mRename', 'mDelete'].forEach((id) => { $(id).style.display = newSess ? 'none' : ''; });
  clearTimeout(mp._hideT);
  mb.classList.add('show'); mp.classList.add('show');
  requestAnimationFrame(() => { mb.classList.add('in'); mp.classList.add('in'); });
}
function closeMenu() {
  const mb = $('menuback'), mp = $('menuPop');
  if (!mp.classList.contains('show')) return;
  mb.classList.remove('in'); mp.classList.remove('in');
  mp._hideT = setTimeout(() => { mb.classList.remove('show'); mp.classList.remove('show'); }, 260);
}

function buzz(ms) { if (!P('haptics')) return; try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

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
function cinSeg(label, val, opts, onPick) {
  const row = el('div', 'setitem segrow'); const lab = el('span', 'seg-label'); lab.textContent = label; row.appendChild(lab);
  const seg = el('div', 'segment');
  opts.forEach(([v, n]) => { const b = el('button', 'seg' + (val === v ? ' on' : '')); b.textContent = n; b.addEventListener('click', () => { seg.querySelectorAll('.seg').forEach((x) => x.classList.remove('on')); b.classList.add('on'); onPick(v); }); seg.appendChild(b); });
  row.appendChild(seg); return row;
}
function cinSlider(label, val, min, max, step, fmt, onDone) {
  const row = el('div', 'setitem sliderrow');
  const top = el('div', 'sl-top'); const lab = el('span'); lab.textContent = label; const sv = el('span', 'sl-val'); sv.textContent = fmt(val);
  top.appendChild(lab); top.appendChild(sv); row.appendChild(top);
  const r = document.createElement('input'); r.type = 'range'; r.className = 'slider'; r.min = min; r.max = max; r.step = step; r.value = val;
  r.addEventListener('input', () => { sv.textContent = fmt(parseInt(r.value)); });
  r.addEventListener('change', () => onDone(parseInt(r.value)));
  row.appendChild(r); return row;
}
function cinPick(label, val, opts, onPick) {
  const row = el('div', 'setitem pickrow'); const lab = el('span', 'seg-label'); lab.textContent = label; row.appendChild(lab);
  const list = el('div', 'picklist');
  opts.forEach(([v, n]) => { const o = el('button', 'pickopt' + (val === v ? ' on' : '')); o.innerHTML = '<span>' + esc(n) + '</span><span class="pickck">✓</span>'; o.addEventListener('click', () => { list.querySelectorAll('.pickopt').forEach((x) => x.classList.remove('on')); o.classList.add('on'); onPick(v); }); list.appendChild(o); });
  row.appendChild(list); return row;
}
function openCinema(s) {
  state.cinTarget = s;
  if (!state.cin || state.cin._sid !== s.id) state.cin = null;
  show('cinema'); renderCinema();
  wsend({ type: 'cinema_get', sessionId: s.id });
}
function cinNoteHTML(c) {
  const on = !!c.on; const s = state.cinTarget; const otherHolder = c.holder && s && c.holder !== s.id ? c.holder : '';
  if (c.paused) return '⏸ 已自动暂停：' + esc(c.pauseReason || '') + '<br>调整后重新打开开关即可继续。';
  if (on) return '时间正在流动。cc 周期性「看一眼」此刻，无聊或想说话时才真的开口；真回复会推送给你。本窗口已 ' + (c.frames5h || 0) + ' 帧。';
  if (otherHolder) return '另一个对话正开着电影模式（同一时间只能开一个）。在这里打开会自动关掉那个。';
  return '开启后这个对话获得连续时间感：cc 周期性感知此刻（haiku 廉价、用完即弃、不留痕），只有生出冲动时才升级成真回复并推送。开着期间这个对话的定时唤醒会自动暂停。';
}
function syncCinemaLive() {
  if (state.screen !== 'cinema') return;
  const c = state.cin || {};
  const note = $('cinStatus'); if (note) note.innerHTML = cinNoteHTML(c);
  const sw = $('cinToggleSw'); if (sw) sw.classList.toggle('on', !!c.on);
}
function renderCinema() {
  const body = $('cinemaBody'); if (!body) return; body.innerHTML = '';
  const c = state.cin || {}; const s = state.cinTarget; const on = !!c.on;
  const head = el('div', 'cinhead'); const tt = el('div', 'cintitle'); tt.textContent = s ? (s.title || '这个对话') : ''; head.appendChild(tt); body.appendChild(head);
  const card0 = el('div', 'setmenu'); const trow = el('div', 'setitem togglerow'); const tlab = el('span'); tlab.textContent = '开启电影模式';
  const sw = el('button', 'switch' + (on ? ' on' : '')); sw.id = 'cinToggleSw'; sw.innerHTML = '<span class="knob"></span>';
  sw.addEventListener('click', () => { buzz(12); cinSend({ on: !((state.cin || {}).on) }); });
  trow.appendChild(tlab); trow.appendChild(sw); card0.appendChild(trow); body.appendChild(card0);
  const note = el('div', 'cinnote'); note.id = 'cinStatus'; note.innerHTML = cinNoteHTML(c); body.appendChild(note);
  const cfg = el('div', 'setmenu');
  cfg.appendChild(cinSeg('节奏', c.cadence || 'continuous', [['continuous', '连续'], ['interval', '按间隔']], (v) => cinSend({ cadence: v })));
  cfg.appendChild(cinToggle('前台 / 后台不同节奏', !!c.diffRate, () => cinSend({ diffRate: !c.diffRate })));
  cfg.appendChild(cinSlider('前台间隔（按间隔时生效）', c.fgIntervalSec || 25, 5, 120, 5, (v) => v + ' 秒', (v) => cinSend({ fgIntervalSec: v })));
  cfg.appendChild(cinSlider('后台间隔（开了不同节奏才用）', c.bgIntervalSec || 90, 10, 600, 10, (v) => v + ' 秒', (v) => cinSend({ bgIntervalSec: v })));
  cfg.appendChild(cinSlider('额度到多少 % 自动暂停', c.autoPauseUtil || 85, 50, 100, 1, (v) => v + ' %', (v) => cinSend({ autoPauseUtil: v })));
  cfg.appendChild(cinSlider('每 5 小时帧数上限', c.maxFramesPer5h || 400, 50, 1000, 50, (v) => v + ' 帧', (v) => cinSend({ maxFramesPer5h: v })));
  body.appendChild(cfg);
  const models = (state.availModels || []).map((x) => [x.id, x.name || x.id]);
  const aliases = [['haiku', 'haiku（最省）'], ['sonnet', 'sonnet'], ['opus', 'opus']];
  const mcard = el('div', 'setmenu');
  mcard.appendChild(cinPick('感知模型（意识层，便宜）', c.perceiveModel || 'haiku', [...aliases, ...models], (v) => cinSend({ perceiveModel: v })));
  mcard.appendChild(cinPick('审议模型（开口 / 做事）', c.deliberateModel || '', [['', '跟随对话默认'], ...aliases, ...models], (v) => cinSend({ deliberateModel: v })));
  body.appendChild(mcard);
}
function onCinemaState(m) {
  const st = m.state || {};
  state.cinemaOnSid = st.holder || '';
  if (state.cinTarget && state.cinTarget.id === m.sessionId) {
    const hadCfg = !!state.cin; state.cin = { _sid: m.sessionId, ...st };
    // 首次拿到状态要整渲染（填好控件）；之后的周期广播只更新状态行/开关，别打断正在操作的控件
    if (state.screen === 'cinema') { if (!hadCfg) renderCinema(); else syncCinemaLive(); }
  }
  updateCinemaBar();
}
function updateCinemaBar() {
  const bar = $('cinemaBar'); if (!bar) return;
  const onHere = state.screen === 'chat' && state.currentSession && state.cinemaOnSid === state.currentSession;
  if (!onHere) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const typing = state.cinemaTyping === state.currentSession;
  $('cinemaBarText').textContent = typing ? '输入中…' : '时间流动中';
  bar.classList.toggle('typing', typing);
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
    enabled: !!st.enabled, chase: !!st.chase, dawn: !!st.dawn,
    dawnH: (+dp[0] || 0), dawnM: (+dp[1] || 0),
    list: (st.schedules || []).filter((s) => s.by !== 'cc' && (s.nextAt || s.repeat)).map((s) => ({ nextAt: s.nextAt || 0, repeat: s.repeat || null })),
    cc: (st.schedules || []).filter((s) => s.by === 'cc').map((s) => ({ id: s.id, nextAt: s.nextAt || 0, repeat: s.repeat || null })),
    eMode: 'daily', eDate: todayLocalStr(), eHour: (now.getHours() + 1) % 24, eMin: 0, eEvery: 180,
  };
  closeWakeEditor();
  renderWakeForm();
}
function renderWakeForm() {
  const w = state.wk; if (!w) return;
  $('wkEnable').classList.toggle('on', w.enabled);
  $('wkChase').classList.toggle('on', w.chase);
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
    if (sch.repeat && sch.repeat.kind === 'every' && sch.nextAt) { const sub = el('div', 'wki-sub'); sub.textContent = '下次 ' + wakeLabel(sch.nextAt); main.appendChild(sub); }
    it.appendChild(main);
    const del = el('button', 'wki-del'); del.textContent = '×'; del.addEventListener('click', () => { w.list.splice(i, 1); renderWakeForm(); }); it.appendChild(del);
    box.appendChild(it);
  });
  (w.cc || []).forEach((sch) => {
    const it = el('div', 'wkitem');
    const main = el('div', 'wki-main');
    const wh = el('div', 'wki-when'); wh.textContent = scheduleLabel(sch); main.appendChild(wh);
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
  const hours = []; for (let h = 0; h < 24; h++) hours.push(h);
  const mins = []; for (let m = 0; m < 60; m++) mins.push(m);
  box.appendChild(wkTimeRow('时', hours, () => w.dawnH, (v) => pad2(v), (v) => { w.dawnH = v; }));
  box.appendChild(wkTimeRow('分', mins, () => w.dawnM, (v) => pad2(v), (v) => { w.dawnM = v; }));
}
function openWakeEditor() {
  const w = state.wk; if (!w) return; const now = new Date();
  w.eMode = 'daily'; w.eDate = todayLocalStr(); w.eHour = (now.getHours() + 1) % 24; w.eMin = 0; w.eEvery = 180;
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
  w.list.push(item); closeWakeEditor(); renderWakeForm();
}
function wkChip(label, on, cb) { const b = el('button', 'wkt' + (on ? ' on' : '')); b.textContent = label; b.addEventListener('click', cb); return b; }
function wkTimeRow(label, values, getSel, fmt, cb) {
  const row = el('div', 'wktrow'); const l = el('div', 'wktrl'); l.textContent = label; row.appendChild(l);
  const sc = el('div', 'wkscroll');
  values.forEach((v) => { const c = wkChip(fmt(v), v === getSel(), () => { cb(v); sc.querySelectorAll('.wkt').forEach((x) => x.classList.toggle('on', x === c)); }); sc.appendChild(c); });
  row.appendChild(sc);
  setTimeout(() => { const on = sc.querySelector('.wkt.on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' }); }, 0);
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
    const lbl = el('div', 'wklabel'); lbl.textContent = '日期'; box.appendChild(lbl);
    const base = new Date(); base.setHours(0, 0, 0, 0);
    const dates = []; for (let i = 0; i < 60; i++) { const d = new Date(base.getTime() + i * 86400000); dates.push(d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())); }
    box.appendChild(wkTimeRow('', dates, () => w.eDate, (v) => dateChipLabel(v), (v) => { w.eDate = v; }));
  }
  const tl = el('div', 'wklabel'); tl.textContent = '时间'; box.appendChild(tl);
  const hours = []; for (let h = 0; h < 24; h++) hours.push(h);
  const mins = []; for (let m = 0; m < 60; m++) mins.push(m);
  box.appendChild(wkTimeRow('时', hours, () => w.eHour, (v) => pad2(v), (v) => { w.eHour = v; }));
  box.appendChild(wkTimeRow('分', mins, () => w.eMin, (v) => pad2(v), (v) => { w.eMin = v; }));
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
  const schedules = w.list.map((sch) => ({ nextAt: sch.nextAt || 0, repeat: sch.repeat || null }));
  wsend({ type: 'wakeup_set', sessionId: s.id, enabled: w.enabled, schedules, chase: w.chase, dawn: w.dawn, dawnTime });
  closeScrim('wakeScrim');
  if (!w.enabled) { toast(w.dawn ? '已关闭唤醒 · 仅定时写日记 ' + dawnTime : '已关闭定时唤醒'); return; }
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
  if (state.screen === 'diary' && state.diaryView === 'detail' && m.sessionId === state.diarySession) { state.diaryStickies = m.notes || []; renderDiaryDetail(); }
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

/* ---- 日记 / 便签夹 页面 ---- */
function openDiaryOverview() {
  state.diaryView = 'overview'; state.diarySession = null; state.diaryReturn = 'list';
  $('diaryTitle').textContent = '日记 / 便签夹';
  $('diaryBody').innerHTML = '<div class="dempty">加载中…</div>';
  show('diary'); wsend({ type: 'diary_overview' });
}
function openDiaryFor(sid, title, from) {
  state.diaryView = 'detail'; state.diarySession = sid; state.diaryFrom = from || 'chat';
  const now = new Date(); state.diaryMonthY = now.getFullYear(); state.diaryMonthM = now.getMonth();
  state.diaryDay = todayLocalStr(); state.diaryPage = null; state.diaryStickies = null;
  $('diaryTitle').textContent = title || '日记 / 便签夹';
  $('diaryBody').innerHTML = '<div class="dempty">加载中…</div>';
  show('diary');
  wsend({ type: 'diary_get', sessionId: sid, date: state.diaryDay });
  wsend({ type: 'sticky_get', sessionId: sid });
}
function diaryBack() {
  if (state.diaryView === 'detail' && state.diaryFrom === 'overview') { openDiaryOverview(); return; }
  if (state.diaryView === 'detail' && state.diaryFrom === 'chat') { show('chat'); return; }
  show('list'); wsend({ type: 'list_sessions' });
}
function buildCalendar(daysWithContent, selected) {
  const set = new Set(daysWithContent || []);
  const wrap = el('div', 'cal');
  const Y = state.diaryMonthY, M = state.diaryMonthM;
  const head = el('div', 'cal-head');
  const prev = el('button', 'cal-nav'); prev.textContent = '‹'; prev.onclick = () => { let m = M - 1, y = Y; if (m < 0) { m = 11; y--; } state.diaryMonthM = m; state.diaryMonthY = y; renderDiaryDetail(); };
  const lbl = el('div', 'cal-lbl'); lbl.textContent = Y + '年' + (M + 1) + '月';
  const next = el('button', 'cal-nav'); next.textContent = '›'; next.onclick = () => { let m = M + 1, y = Y; if (m > 11) { m = 0; y++; } state.diaryMonthM = m; state.diaryMonthY = y; renderDiaryDetail(); };
  head.append(prev, lbl, next); wrap.appendChild(head);
  const grid = el('div', 'cal-grid');
  ['日', '一', '二', '三', '四', '五', '六'].forEach((w) => { const c = el('div', 'cal-w'); c.textContent = w; grid.appendChild(c); });
  const first = new Date(Y, M, 1).getDay(), dim = new Date(Y, M + 1, 0).getDate();
  for (let i = 0; i < first; i++) grid.appendChild(el('div', 'cal-cell other'));
  for (let d = 1; d <= dim; d++) {
    const ds = Y + '-' + pad2(M + 1) + '-' + pad2(d);
    const cell = el('div', 'cal-cell' + (ds === selected ? ' sel' : ''));
    cell.appendChild(document.createTextNode(String(d)));
    if (set.has(ds)) cell.appendChild(el('span', 'cal-dot'));
    cell.onclick = () => { if (state.diaryDay === ds) return; state.diaryDay = ds; grid.querySelectorAll('.cal-cell').forEach((c) => c.classList.remove('sel')); cell.classList.add('sel'); wsend({ type: 'diary_get', sessionId: state.diarySession, date: ds }); };
    grid.appendChild(cell);
  }
  wrap.appendChild(grid); return wrap;
}
function renderNote(n) {
  const it = el('div', 'noteitem' + (n.read ? '' : ' unread'));
  const top = el('div', 'note-top');
  const tx = el('div', 'note-text'); tx.textContent = n.text;
  const tm = el('div', 'note-time'); tm.textContent = fmtDateClock(n.ts);
  top.append(tx, tm); it.appendChild(top);
  const acts = el('div', 'note-acts');
  if (!n.read) { const rd = el('button', 'note-act'); rd.textContent = '标记已读'; rd.addEventListener('click', (e) => { e.stopPropagation(); wsend({ type: 'sticky_read', sessionId: state.diarySession, id: n.id }); }); acts.appendChild(rd); }
  const del = el('button', 'note-act danger'); del.textContent = '删除'; del.addEventListener('click', (e) => { e.stopPropagation(); wsend({ type: 'sticky_delete', sessionId: state.diarySession, id: n.id }); }); acts.appendChild(del);
  it.appendChild(acts);
  it.addEventListener('click', () => it.classList.toggle('open'));
  return it;
}
function renderDiaryDetail() {
  if (state.screen !== 'diary' || state.diaryView !== 'detail') return;
  const body = $('diaryBody'); body.innerHTML = '';
  const page = state.diaryPage || { entries: [], days: [], date: state.diaryDay };
  const h1 = el('div', 'dsection'); h1.textContent = '日记'; body.appendChild(h1);
  body.appendChild(buildCalendar(page.days || [], state.diaryDay));
  const wb = el('button', 'dwritebtn'); wb.textContent = '＋ 给 ' + state.diaryDay + ' 写一条'; wb.addEventListener('click', () => openDiaryWrite()); body.appendChild(wb);
  if (!(page.entries || []).length) { const e = el('div', 'dempty'); e.textContent = '这天还没有日记。'; body.appendChild(e); }
  (page.entries || []).forEach((en) => {
    const row = el('div', 'dentry' + (en.author === 'cc' ? ' cc' : ''));
    const tcol = el('div', 'dtime'); tcol.textContent = fmtClock(en.ts);
    const bd = el('div', 'dbody');
    const meta = el('div', 'dmeta');
    const tags = []; if (en.mood) tags.push(en.mood); if (en.weather) tags.push(en.weather);
    tags.push(en.author === 'cc' ? 'cc' : '我'); if (en.tags) tags.push('#' + en.tags); if (en.edited) tags.push('已编辑');
    meta.textContent = tags.join('  ');
    const tx = el('div', 'dtext md'); tx.innerHTML = md(en.text);
    bd.append(meta, tx);
    const imgs = en.images || [];
    if (imgs.length) { const box = el('div', 'dentimgs'); imgs.forEach((u) => { const url = diaryImgUrl(u); const im = el('img', 'dthumb' + (imgs.length > 1 ? ' multi' : '')); im.src = url; im.addEventListener('click', (e) => { e.stopPropagation(); openLightbox(url); }); box.appendChild(im); }); bd.appendChild(box); }
    let held = false;
    bindHold(bd, () => { held = true; openPrompt('删除这条日记？输入「删除」确认', '', (v) => { if (v === '删除') wsend({ type: 'diary_delete', sessionId: state.diarySession, date: state.diaryDay, ts: en.ts }); }); });
    bd.addEventListener('click', () => { if (held) { held = false; return; } openDiaryWrite(en); }); // 点进编辑;长按删除
    row.append(tcol, bd);
    body.appendChild(row);
  });
  const h2 = el('div', 'dsection'); h2.textContent = '便签夹'; body.appendChild(h2);
  const notes = state.diaryStickies || [];
  if (!notes.length) { const e = el('div', 'dempty'); e.textContent = '还没有小纸条。'; body.appendChild(e); }
  notes.slice().reverse().forEach((n) => body.appendChild(renderNote(n)));
}
function renderDiaryOverview(cards) {
  const body = $('diaryBody'); body.innerHTML = '';
  if (!cards.length) { const e = el('div', 'dempty'); e.innerHTML = '还没有任何日记或便签。<br>在对话「+」面板里打开「日记 / 便签夹」开始记，或长按会话开「定时唤醒」让 cc 自己写。'; body.appendChild(e); return; }
  cards.forEach((c) => {
    const card = el('div', 'dcard');
    const t = el('div', 'dcard-title'); t.textContent = c.title || '(无标题)';
    if (c.unread) { const b = el('span', 'scard-badge'); b.textContent = c.unread; t.appendChild(b); }
    const sub = el('div', 'dcard-sub'); const bits = [];
    if (c.diaryEntries) bits.push('日记 ' + c.diaryEntries + ' 条 / ' + c.diaryDays + ' 天');
    if (c.notes) bits.push('便签 ' + c.notes + ' 张' + (c.unread ? '（' + c.unread + ' 未读）' : ''));
    sub.textContent = bits.join('  ·  ') || '空';
    card.append(t, sub);
    card.addEventListener('click', () => openDiaryFor(c.sessionId, c.title, 'overview'));
    body.appendChild(card);
  });
}
function diaryImgDir() { return (((state.defaultCwd || state.cwd || '').replace(/\/$/, '')) || '') + '/.telos-diary'; }
// open the write/edit page. pass an entry to edit it, omit to write a new one.
function diaryHead(ds) { const p = (ds || '').split('-'); const d = new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); return { day: (+p[2] || 1), wk: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()], ym: (p[0] || '') + '.' + (+p[1] || 1) }; }
function dwUpdateCount() { $('dwCount').textContent = $('dwText').value.length + ' 字'; }
function openDiaryWrite(entry) {
  state.dwEditing = entry || null;
  state.dwImages = (entry && Array.isArray(entry.images)) ? entry.images.slice() : [];
  state.dwMood = entry ? (entry.mood || '') : '';
  state.dwWeather = entry ? (entry.weather || '') : '';
  state.dwTags = entry ? (entry.tags || '') : '';
  $('dwText').value = entry ? (entry.text || '') : '';
  const h = diaryHead(state.diaryDay); $('dwDay').textContent = h.day; $('dwWk').textContent = h.wk; $('dwYm').textContent = h.ym;
  closeDwPicker(); renderDwImgs(); updateDwMoodWeather(); dwUpdateCount();
  show('diaryWrite');
  setTimeout(() => $('dwText').focus(), 150);
}
function updateDwMoodWeather() {
  $('dwMoodVal').textContent = state.dwMood || '';
  $('dwWeatherVal').textContent = state.dwWeather || '';
  $('dwTagsVal').textContent = state.dwTags || '';
}
const DW_MOODS = ['😊', '🙂', '😌', '🥰', '😍', '😎', '🤔', '😪', '😔', '😢', '😭', '😡', '🥹', '🤒', '😴'];
const DW_WEATHERS = ['☀️', '🌤️', '⛅', '☁️', '🌧️', '⛈️', '🌩️', '❄️', '🌫️', '🌈', '🌙', '💨'];
function closeDwPicker() { const p = document.querySelector('.dwpicker'); if (p) p.remove(); state.dwPickerKind = null; }
function toggleDwPicker(kind) {
  if (document.querySelector('.dwpicker') && state.dwPickerKind === kind) { closeDwPicker(); return; }
  closeDwPicker(); state.dwPickerKind = kind;
  const cur = kind === 'mood' ? state.dwMood : state.dwWeather;
  const opts = kind === 'mood' ? DW_MOODS : DW_WEATHERS;
  const p = el('div', 'dwpicker');
  const clr = el('button'); clr.textContent = '✕'; clr.style.fontSize = '15px';
  clr.addEventListener('click', () => { if (kind === 'mood') state.dwMood = ''; else state.dwWeather = ''; updateDwMoodWeather(); closeDwPicker(); });
  p.appendChild(clr);
  opts.forEach((emo) => { const b = el('button'); b.textContent = emo; if (emo === cur) b.style.background = 'var(--surface-2)'; b.addEventListener('click', () => { if (kind === 'mood') state.dwMood = emo; else state.dwWeather = emo; updateDwMoodWeather(); closeDwPicker(); }); p.appendChild(b); });
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
  const base = { sessionId: state.diarySession, date: state.diaryDay, text: text || '（图片）', images: state.dwImages.slice(), mood: state.dwMood || '', weather: state.dwWeather || '', tags: state.dwTags || '' };
  if (state.dwEditing) wsend({ type: 'diary_edit', ts: state.dwEditing.ts, ...base });
  else wsend({ type: 'diary_write', ...base });
  state.dwEditing = null; closeDwPicker();
  show('diary');
}

/* ============ left settings/app drawer ============ */
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
const SET_CATS = {
  appearance: { name: '外观', items: [
    { type: 'segment', key: 'theme', name: '主题', opts: [['warm', '暖调'], ['gray', '灰白'], ['dark', '夜间']], onChange: applyTheme },
    { type: 'swatch', key: 'accent', name: '强调色', opts: [['brick', '#c2613f'], ['rose', '#c0506b'], ['amber', '#b07636'], ['green', '#4a7c59'], ['teal', '#2f7d8f'], ['indigo', '#3a6ea5'], ['violet', '#7a5cc6'], ['slate', '#5d6b78']], onChange: applyTheme },
    { type: 'slider', key: 'fontSize', name: '字体大小', min: 0.8, max: 1.4, step: 0.05, fmt: (v) => Math.round(v * 100) + '%', onChange: applyFont },
    { type: 'segment', key: 'fontFamily', name: '字体', opts: [['client', '客户端字体'], ['system', '系统字体']], onChange: applyFont },
    { type: 'toggle', key: 'showModel', name: '显示模型名称', onChange: updateHeader },
    { type: 'toggle', key: 'showTokens', name: '显示 Token 统计' },
    { type: 'toggle', key: 'showStatusBar', name: '显示状态栏', onChange: applyStatusBar },
    { type: 'toggle', key: 'discFx', name: '断联动画（关则只显示横幅）', onChange: applyDiscFx },
    { type: 'toggle', key: 'discBlink', name: '断联闪烁', onChange: applyDiscBlink }
  ] },
  chat: { name: '对话', items: [
    { type: 'toggle', key: 'interruptOnLeave', name: '退出对话时中断回复' },
    { type: 'toggle', key: 'autoScroll', name: '生成时自动滚到底部' },
    { type: 'toggle', key: 'pasteAsFile', name: '长文本粘贴为文件' },
    { type: 'slider', key: 'pasteThreshold', name: '文本长度阈值', min: 200, max: 8000, step: 100, fmt: (v) => v + ' 字', dep: 'pasteAsFile' },
    { type: 'toggle', key: 'autoCleanup', name: '自动清理一天前的单轮对话', onChange: cleanupNow },
    { type: 'toggle', key: 'wakePush', name: '后台唤醒通知', onChange: onWakePushToggle },
    { type: 'pick', key: 'timezone', name: 'cc 读到的时区', opts: [['', '自动（跟随手机）'], ['Asia/Tokyo', '东京 UTC+9'], ['Asia/Shanghai', '北京 / 上海 UTC+8'], ['Asia/Hong_Kong', '香港 UTC+8'], ['Asia/Taipei', '台北 UTC+8'], ['Asia/Singapore', '新加坡 UTC+8'], ['America/Los_Angeles', '洛杉矶'], ['America/New_York', '纽约'], ['Europe/London', '伦敦'], ['UTC', 'UTC']], onChange: sendPresence },
    { type: 'button', name: '编辑压缩提示词', action: openCompactPrompt }
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
  $('setAppearDesc').textContent = ({ warm: '暖调', gray: '灰白', dark: '夜间' }[P('theme')] || '暖调') + ' · 字体 ' + Math.round(P('fontSize') * 100) + '%';
  $('setChatDesc').textContent = (P('interruptOnLeave') ? '退出中断 · ' : '') + (P('autoScroll') ? '自动滚动' : '不自动滚动');
  $('setHapticDesc').textContent = P('haptics') ? '开' : '关';
  $('setUpdateDesc').textContent = P('updateNotify') ? '接受推送' : '不接受';
}
function openConn() {
  $('set_url').value = LS.url; $('set_token').value = LS.token; $('set_cwd').value = LS.cwd;
  $('conn_status').textContent = state.connected ? (state.authed ? '已连接 · ' + (LS.url || '') : '连接中…') : '未连接';
  openScrim('connScrim');
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
      it.opts.forEach(([v, n]) => { const b = el('button', 'seg' + (P(it.key) === v ? ' on' : '')); b.textContent = n; b.addEventListener('click', () => { setPref(it.key, v); if (it.onChange) it.onChange(); renderSetSub(); refreshSettingsRows(); }); seg.appendChild(b); });
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
  if (P('interruptOnLeave') && state.busy) wsend({ type: 'interrupt' });
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
const SEARCH_PH = ['where did you go…', 'where were we…', 'what are you looking for…', 'find your way back…', 'retrace the thread…'];
function openSearch() {
  const ov = $('searchOverlay');
  $('searchInput').placeholder = SEARCH_PH[Math.floor(Math.random() * SEARCH_PH.length)];
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
  const ql = q.toLowerCase(); let n = 0;
  if (state.searchScope === 'list') {
    // search the session list (title + preview); tap a result to open it
    (state.sessions || []).forEach((s) => {
      const hay = ((s.title || '') + '　' + (s.preview || '')).trim();
      if (!hay.toLowerCase().includes(ql)) return;
      n++;
      const card = el('div', 'searchcard');
      const title = el('div', 'sc-title'); title.textContent = s.title || '未命名会话'; card.appendChild(title);
      const snip = el('div', 'sc-snippet'); snip.appendChild(hlSnippet(hay, q)); card.appendChild(snip);
      card.addEventListener('click', () => { closeSearch(); setTimeout(() => openSession(s), 220); });
      results.appendChild(card);
    });
  } else {
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
  }
  if (!n) results.innerHTML = '<div class="search-empty">没有找到「' + q.replace(/</g, '&lt;') + '」</div>';
}
function openListSearch() { state.searchScope = 'list'; openSearch(); }

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
      if (dx > BACK_TRIG()) { buzz(14); if (P('interruptOnLeave') && state.busy) wsend({ type: 'interrupt' }); chat.style.transition = 'transform .26s cubic-bezier(.32,.72,0,1)'; chat.style.transform = 'translateX(100%)'; setTimeout(() => { show('list'); resetChatSlide(); wsend({ type: 'list_sessions' }); }, 270); }
      else { chat.style.transition = 'transform .24s cubic-bezier(.32,.72,0,1)'; chat.style.transform = 'translateX(0)'; setTimeout(() => { resetChatSlide(); $('list').classList.remove('active'); }, 250); }
    } else if (dir === 'search') {
      if (-dx > SEARCH_TRIG()) { buzz(14); state.searchScope = 'chat'; openSearch(); }
      else closeSearch();
    }
    dir = null;
  });
}

/* ============ usage (用量) ============ */
function reqUsage() { wsend({ type: 'usage_report', sessionId: state.currentSession || '' }); }
function ubar(pct, n) { n = n || 10; const f = Math.max(0, Math.min(n, Math.round((pct || 0) / 100 * n))); return '▓'.repeat(f) + '░'.repeat(n - f); }
function fmtReset(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return '';
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  const sameDay = d.toDateString() === now.toDateString();
  return (sameDay ? '今天 ' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + hh + ':' + mm;
}
function renderUsageStrip() {
  const strip = $('usageStrip'); if (!strip) return;
  const u = state.usage;
  if (!u || !u.usage) { strip.style.display = 'none'; return; }
  strip.style.display = '';
  const pct = (x) => (x && x.utilization != null) ? Math.round(x.utilization) + '%' : '—';
  const f = u.usage.five_hour, w = u.usage.seven_day, t = u.totals;
  // session scope only while actually inside a conversation — on the list screen currentSession is
  // just "the last chat I had open", showing its cost as 本会话 there reads like a duplicated number
  const s = state.screen === 'chat' ? u.session : null;
  $('usLine').innerHTML = `<span>5h <b>${pct(f)}</b></span><span>周 <b>${pct(w)}</b></span>` +
    (s ? `<span>本会话 <b>$${(s.cost || 0).toFixed(2)}</b></span>`
       : (t ? `<span>累计 <b>$${(t.cost || 0).toFixed(2)}</b></span>` : '')) +
    `<span class="us-caret">▾</span>`;
  $('usDetail').innerHTML = (s
    ? `<div><span class="lbl">本会话花费</span>　<b>$${(s.cost || 0).toFixed(2)}</b></div>` +
      `<div><span class="lbl">输出 token</span>　${fmtTok(s.out || 0)}　·　${s.turns || 0} 轮</div>`
    : (state.screen === 'chat' ? `<div class="lbl">新会话 · 暂无花费记录</div>` : '') +
      `<div><span class="lbl">累计花费</span>　<b>$${((t && t.cost) || 0).toFixed(2)}</b>　·　${(t && t.sessions) || 0} 会话</div>`) +
    `<div><span class="lbl">活跃天数</span>　${u.activeDays || 0} 天</div>`;
}
function renderUsageFull() {
  const term = $('usageTerm'); if (!term) return;
  const u = state.usage;
  if (!u) { term.textContent = state.connected && state.authed ? ' 读取中…' : ' 未连接 · 重连后自动刷新'; return; }
  if (!u.usage) { term.textContent = ' 用量读取失败\n 请检查与世界的连接 / 登录态'; return; }
  const U = u.usage, L = [];
  L.push(' claude · 用量');
  L.push(' ' + '─'.repeat(22));
  const row = (g, lbl) => {
    if (!g) return;
    L.push(' ' + ubar(g.utilization) + ' ' + lbl + ' ' + Math.round(g.utilization || 0) + '%');
    if (g.resets_at) L.push('   重置 ' + fmtReset(g.resets_at));
  };
  row(U.five_hour, '5 小时');
  row(U.seven_day, '本周');
  if (U.seven_day_opus) row(U.seven_day_opus, 'Opus 周');
  if (U.seven_day_sonnet && U.seven_day_sonnet.utilization != null) row(U.seven_day_sonnet, 'Sonnet 周');
  L.push(' ' + '─'.repeat(22));
  const xu = U.extra_usage;
  if (xu && xu.is_enabled) L.push(' 额度信用  $' + (xu.used_credits || 0) + ' / $' + (xu.monthly_limit || 0));
  // account scope only — the per-session number lives in the in-conversation strip
  const t = u.totals;
  if (t) L.push(' 累计花费  $' + (t.cost || 0).toFixed(2) + ' · ' + (t.sessions || 0) + ' 会话 · ' + (t.turns || 0) + ' 轮');
  if (u.today != null) L.push(' 今日花费  $' + (u.today || 0).toFixed(2));
  L.push(' 活跃天数  ' + (u.activeDays || 0) + ' 天');
  term.textContent = L.join('\n');
}
function openUsageFull() { $('usageFull').classList.add('show'); syncAtRoot(); renderUsageFull(); reqUsage(); }
function closeUsageFull() { $('usageFull').classList.remove('show'); syncAtRoot(); }

/* ============ composer ============ */
// keep the conversation clear of the input dock: the dock is bottom-anchored and grows upward
// (tall textarea, repochip, attachments), so pad the thread to its live height instead of a fixed guess.
function syncDockPad() {
  const dock = $('dock'), thread = $('thread');
  if (!dock || !thread) return;
  const atBottom = thread.scrollTop + thread.clientHeight >= thread.scrollHeight - 4;
  thread.style.paddingBottom = (dock.offsetHeight + 22) + 'px';
  if (atBottom) thread.scrollTop = thread.scrollHeight;
}
function resizeComposer() { const c = $('composer'); c.style.height = 'auto'; c.style.height = Math.min(c.scrollHeight, 140) + 'px'; syncDockPad(); }
function updateSend() {
  const btn = $('sendBtn');
  if (state.busy) { btn.disabled = false; btn.classList.add('stop'); btn.textContent = '■'; return; }
  btn.classList.remove('stop'); btn.textContent = '↑';
  const has = $('composer').value.trim().length > 0 || state.pendingFiles.length > 0 || state.pendingTexts.length > 0;
  btn.disabled = !(has && state.authed);
}
function sendMessage() {
  if (state.busy) {
    wsend({ type: 'interrupt' }); stopStatus();
    const at = state.activeTurn;
    // cc 还没开口（只是在想）就打断 → 撤回这条消息、把文字退回输入框，省一次重生成
    if (at && !at.spoke && at.userMsgEl) {
      let n = at.userMsgEl.nextSibling; while (n) { const nx = n.nextSibling; n.remove(); n = nx; }
      at.userMsgEl.remove();
      const c = $('composer'); if (at.draft) { c.value = at.draft; resizeComposer(); c.focus(); }
      at.rolledBack = true; at.done = true; buzz(12);
    }
    state.busy = false; updateSend();
    return;
  }
  if (state.pendingFiles.some((f) => f.status === 'uploading')) { toast('还有文件在上传…'); return; }
  const c = $('composer'); const text = c.value.trim();
  const files = state.pendingFiles.filter((f) => f.status === 'ready' && f.path);
  const texts = state.pendingTexts.slice();
  if ((!text && !files.length && !texts.length) || !state.authed) return;
  closePlus(); removeSuggestions();
  const thumbs = files.filter((f) => f.isImage && f.url).map((f) => ({ url: f.url }));
  const fileNotes = files.filter((f) => !(f.isImage && f.url)).map((f) => '📎 ' + f.name)
    .concat(texts.map((t) => '📄 ' + t.name));
  const userShown = text + (fileNotes.length ? (text ? '\n\n' : '') + fileNotes.join('\n') : '');
  const ub = addUser(userShown, null, thumbs);
  state.activeTurn = { id: genId(), lastI: 0, done: false, spoke: false, userMsgEl: ub ? ub.parentElement : null, draft: text };
  const msg = { type: 'send', text, mode: state.mode, turnId: state.activeTurn.id };
  if (files.length) msg.refPaths = files.map((f) => f.path);
  if (texts.length) msg.texts = texts.map((t) => ({ name: t.name, content: t.content }));
  if (state.currentSession) msg.sessionId = state.currentSession; else if (state.cwd) msg.cwd = state.cwd;
  if (state.model) msg.model = state.model;
  if (state.effort) msg.effort = state.effort;
  wsend(msg);
  c.value = ''; state.pendingFiles = []; state.pendingTexts = []; renderAttachStrip(); resizeComposer(); updateSend();
}
function renderAttachStrip() {
  const strip = $('attachStrip'); strip.innerHTML = '';
  state.pendingFiles.forEach((p, i) => {
    const rm = () => { state.pendingFiles.splice(i, 1); renderAttachStrip(); updateSend(); };
    if (p.isImage && p.url && p.status === 'ready') {
      const t = el('div', 'athumb');
      const img = el('img'); img.src = p.url; t.appendChild(img);
      const x = el('button', 'athumb-x'); x.textContent = '×'; x.addEventListener('click', rm);
      t.appendChild(x); strip.appendChild(t); return;
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
    x.addEventListener('click', () => { state.pendingTexts.splice(i, 1); renderAttachStrip(); updateSend(); });
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
  $('searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('searchInput').blur(); runSearch(e.target.value); } });
  $('searchOverlay').addEventListener('click', (e) => { if (e.target === $('searchOverlay') || e.target === $('searchResults')) closeSearch(); });
  $('plusBack').addEventListener('click', closePlus);
  $('discDismiss').addEventListener('click', dismissDisc);
  $('discPill').addEventListener('click', expandDisc);
  $('mRegen').addEventListener('click', () => { closeMenu(); regenerate(); });
  $('mClaude').addEventListener('click', openClaudeMd);
  $('mMcp').addEventListener('click', openMcp);
  $('mcpEdit').addEventListener('click', () => wsend({ type: 'mcp_config_read' }));
  $('mcpCfgSave').addEventListener('click', () => wsend({ type: 'mcp_config_write', content: $('mcpCfgText').value }));
  $('pathImport').addEventListener('click', () => { const p = state.pathTarget; closeScrim('pathActScrim'); if (p) { toast('读取对话列表…'); wsend({ type: 'import_list', path: p }); } });
  $('pathDownload').addEventListener('click', () => { const p = state.pathTarget; closeScrim('pathActScrim'); if (p) fmDownload(p); });
  $('pathAttach').addEventListener('click', () => { const p = state.pathTarget; closeScrim('pathActScrim'); if (p) fmAttach(p); });
  $('pathRename').addEventListener('click', () => { const p = state.pathTarget; closeScrim('pathActScrim'); if (p) openPrompt('重命名', p.split('/').pop(), (name) => { if (name) wsend({ type: 'rename_path', old: p, name, dir: state.dirPath }); }); });
  $('pathDelete').addEventListener('click', () => { const p = state.pathTarget; closeScrim('pathActScrim'); if (p) openPrompt('输入「删除」确认删除「' + p.split('/').pop() + '」（不可恢复）', '', (v) => { if (v === '删除') wsend({ type: 'delete_path', path: p, dir: state.dirPath }); else toast('已取消'); }); });
  $('folderLeft').addEventListener('click', () => { const f = state.folderActTarget; closeScrim('folderActScrim'); if (f) wsend({ type: 'move_folder', name: f, dir: 'left' }); });
  $('folderRight').addEventListener('click', () => { const f = state.folderActTarget; closeScrim('folderActScrim'); if (f) wsend({ type: 'move_folder', name: f, dir: 'right' }); });
  $('folderRename').addEventListener('click', () => { const f = state.folderActTarget; closeScrim('folderActScrim'); if (f) openPrompt('重命名文件夹', f, (name) => { if (name && name !== f) wsend({ type: 'rename_folder', old: f, name }); }); });
  $('folderDelete').addEventListener('click', () => { const f = state.folderActTarget; closeScrim('folderActScrim'); if (f) openPrompt('输入「删除」确认删除文件夹（里面的会话保留、只移出）', '', (v) => { if (v === '删除') wsend({ type: 'delete_folder', name: f }); else toast('已取消'); }); });
  $('folderDeleteAll').addEventListener('click', () => { const f = state.folderActTarget; closeScrim('folderActScrim'); if (f) openPrompt('输入「删除」连同「' + f + '」里的所有对话一起删除（不可恢复）', '', (v) => { if (v === '删除') wsend({ type: 'delete_folder', name: f, withSessions: true }); else toast('已取消'); }); });
  $('claudeSave').addEventListener('click', saveClaudeMd);
  $('claudePrev').addEventListener('click', () => setClaudePreview($('claudeView').style.display === 'none'));
  $('compactSave').addEventListener('click', () => { setPref('compactPrompt', $('compactText').value); closeScrim('compactScrim'); toast('压缩提示词已保存'); });
  $('mModel').addEventListener('click', openModelSheet);
  $('mRename').addEventListener('click', () => { closeMenu(); openPrompt('重命名会话', state.curTitle || '', (name) => { if (name) wsend({ type: 'rename', sessionId: state.currentSession, title: name }); }); });
  $('mCopyDir').addEventListener('click', () => { closeMenu(); navigator.clipboard && navigator.clipboard.writeText(state.cwd || ''); toast('已复制目录'); });
  $('mDelete').addEventListener('click', () => { closeMenu(); openPrompt('输入「删除」确认', '', (v) => { if (v === '删除') { wsend({ type: 'delete', sessionId: state.currentSession }); goList(); } else toast('已取消'); }); });

  $('dirChip').addEventListener('click', openDirPicker);
  $('modeChip').addEventListener('click', openModeSheet);

  $('plusBtn').addEventListener('click', togglePlus);
  $('atUpload').addEventListener('click', () => { closePlus(); $('fileUp').click(); });
  $('fileUp').addEventListener('change', (e) => { quickUpload(e.target.files); e.target.value = ''; });
  $('atFileMgr').addEventListener('click', () => { closePlus(); openFileManager('attach'); });
  $('fileUpMgr').addEventListener('change', (e) => { managerUpload(e.target.files); e.target.value = ''; });
  $('drFiles').addEventListener('click', () => { closeDrawer(); openFileManager('browse'); });
  $('drUsage').addEventListener('click', () => { closeDrawer(); openUsageFull(); });
  $('drDiary').addEventListener('click', () => { closeDrawer(); openDiaryOverview(); });
  // 醒来 / 小纸条 / 日记 wiring
  $('sessWake').addEventListener('click', () => { const s = state.sessTarget; closeScrim('sessScrim'); if (s) openWakeConfig(s); });
  $('sessCinema').addEventListener('click', () => { const s = state.sessTarget; closeScrim('sessScrim'); if (s) openCinema(s); });
  $('cinemaBack').addEventListener('click', () => { show('list'); wsend({ type: 'list_sessions' }); });
  $('wkEnable').addEventListener('click', () => { if (state.wk) { state.wk.enabled = !state.wk.enabled; if (!state.wk.enabled) closeWakeEditor(); renderWakeForm(); } });
  $('wkDawn').addEventListener('click', () => { if (state.wk) { state.wk.dawn = !state.wk.dawn; renderWakeForm(); } });
  $('wkChase').addEventListener('click', () => { if (state.wk) { state.wk.chase = !state.wk.chase; renderWakeForm(); } });
  $('wkMode').addEventListener('click', (e) => { const b = e.target.closest('button[data-m]'); if (!b || !state.wk) return; state.wk.eMode = b.dataset.m; document.querySelectorAll('#wkMode button').forEach((x) => x.classList.toggle('on', x === b)); renderWakeModeArea(); });
  $('wkAdd').addEventListener('click', openWakeEditor);
  $('wkEditCancel').addEventListener('click', () => { closeWakeEditor(); });
  $('wkEditAdd').addEventListener('click', addFromEditor);
  $('wkSave').addEventListener('click', saveWake);
  $('stkRead').addEventListener('click', () => stickyAck(true));
  $('stkSkip').addEventListener('click', () => stickyAck(false));
  $('atDiary').addEventListener('click', () => { closePlus(); if (!state.currentSession) { toast('新会话还没有日记'); return; } openDiaryFor(state.currentSession, state.curTitle, 'chat'); });
  $('diaryBack').addEventListener('click', diaryBack);
  $('dwBack').addEventListener('click', () => { closeDwPicker(); show('diary'); });
  $('dwAddImg').addEventListener('click', () => $('dwFile').click());
  $('dwFile').addEventListener('change', (e) => { dwAddImages(e.target.files); e.target.value = ''; });
  $('dwSave').addEventListener('click', saveDiaryEntry);
  $('dwMood').addEventListener('click', () => toggleDwPicker('mood'));
  $('dwWeather').addEventListener('click', () => toggleDwPicker('weather'));
  $('dwTags').addEventListener('click', () => openPrompt('标签', state.dwTags || '', (v) => { state.dwTags = (v || '').trim(); updateDwMoodWeather(); }, '逗号分隔'));
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
    openPrompt('压缩上下文', '', (extra) => doCompact(extra), '留空＝用设置里的压缩提示词');
  });
  // expand to fullscreen editor (expandBtn pointerdown wired below)
  $('composeBack').addEventListener('click', () => closeCompose(false));
  $('composeSave').addEventListener('click', () => closeCompose(true));

  const c = $('composer');
  c.addEventListener('input', () => { resizeComposer(); updateSend(); updateExpandBtn(); });
  // long paste -> attach as a text file (if enabled)
  c.addEventListener('paste', (e) => {
    if (!P('pasteAsFile')) return;
    const txt = (e.clipboardData || window.clipboardData).getData('text');
    if (!txt || txt.length <= P('pasteThreshold')) return;
    e.preventDefault();
    state.pendingTexts.push({ name: '粘贴文本-' + (state.pendingTexts.length + 1) + '.txt', content: txt });
    renderAttachStrip(); updateSend(); buzz(12); toast('已作为文件附上（' + txt.length + ' 字）');
  });
  c.addEventListener('focus', () => { state.composerFocused = true; closePlus(); updateExpandBtn(); });
  c.addEventListener('blur', () => { state.composerFocused = false; updateExpandBtn(); });
  $('sendBtn').addEventListener('click', sendMessage);
  // expand: use pointerdown so it fires before the composer blur hides the button
  $('expandBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); openCompose(); });
  $('thread').addEventListener('click', (e) => { closePlus(); const t = e.target; if (t && t.tagName === 'IMG' && t.closest && t.closest('.md')) openLightbox(t.src); });
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
  $('sessRename').addEventListener('click', () => { const s = state.sessTarget; closeScrim('sessScrim'); if (s) openPrompt('重命名会话', s.title || '', (name) => { if (name) wsend({ type: 'rename', sessionId: s.id, title: name }); }); });
  $('sessDelete').addEventListener('click', () => { const s = state.sessTarget; closeScrim('sessScrim'); if (s) openPrompt('输入「删除」确认删除', '', (v) => { if (v === '删除') wsend({ type: 'delete', sessionId: s.id }); else toast('已取消'); }); });
  $('promptOk').addEventListener('click', () => { const v = $('promptInput').value.trim(); const cb = state.promptCb; closeScrim('promptScrim'); state.promptCb = null; if (cb) cb(v); });
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
    if (!state.discActive && P('discFx')) { clearTimeout(state.discShowTimer); if (!state.connected) state.discShowTimer = setTimeout(showDisc, 3000); }
  });

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
