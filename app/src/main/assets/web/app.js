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
  interruptOnLeave: false, autoScroll: true, pasteAsFile: true, pasteThreshold: 1200, timezone: '',
  haptics: true, genHaptic: false, updateNotify: true, showStatusBar: true, discFx: true, discBlink: false,
  autoCleanup: true, wakePush: true, compactPrompt: '',
  theme: 'warm', accent: 'brick', foldersCollapsed: false, autoOpenLast: false
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
const SCREENS = ['setup', 'list', 'chat', 'settings', 'setSub', 'files', 'import', 'diary', 'diaryWrite', 'cinema', 'cinemaLog', 'memMgr', 'memEdit'];
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
const SCRIMS = ['permScrim', 'modelScrim', 'promptScrim', 'toolsScrim', 'modeScrim', 'sessScrim', 'folderScrim', 'claudeScrim', 'folderActScrim', 'pathActScrim', 'mcpScrim', 'mcpCfgScrim', 'memScrim', 'connScrim', 'wakeScrim', 'stickyScrim', 'compactScrim'];
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
  if (state.screen === 'memEdit') { if (document.querySelector('.mepicker')) { closeMemTypePicker(); return; } show('memMgr'); return; }
  if (state.screen === 'memMgr') { show(state.currentSession ? 'chat' : 'list'); return; }
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
      checkUpdate(false); wsend({ type: 'model_list' }); wsend({ type: 'cache_ttl_get' });
      if (state.screen === 'setup') show('list');
      wsend({ type: 'list_sessions' });
      sendPushPref(); sendPresence(); applyNativeNotify();
      if (P('autoCleanup') && !state._cleaned) { state._cleaned = true; wsend({ type: 'cleanup_stale' }); }  // once per launch
      // re-fetch history/sticky that got dropped because we tapped into the chat before auth landed
      if (state.pendingHistory) { wsend({ type: 'history_window', sessionId: state.pendingHistory, limit: 60 }); state.pendingHistory = null; }
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
    case 'sessions': state.sessions = m.sessions || []; if (m.folders) state.folders = m.folders; renderSessions(); maybeAutoOpen(); prefetchSeed(state.sessions); break;
    case 'usage': state.usage = m; renderUsageStrip(); if ($('usageFull').classList.contains('show')) renderUsageFull(); break;
    case 'app_update': onAppUpdate(m); break;
    case 'folders':
      state.folders = m.folders || [];
      if (state.activeFolder && !state.folders.includes(state.activeFolder)) state.activeFolder = null;
      renderSessions(); break;
    case 'assigned': wsend({ type: 'list_sessions' }); break;
    case 'history': if (m.prefetch) onPrefetchHistory(m); else renderHistory(m); break;
    case 'history_window': onHistoryWindow(m); break;
    case 'history_full': onHistoryFull(m); break;
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
        state.currentSession = orig; wsend({ type: 'history_window', sessionId: orig, limit: 60 });
      } else addError(m.message);
      wsend({ type: 'list_sessions' });
      break;
    }
    case 'renamed': case 'deleted': case 'pinned': wsend({ type: 'list_sessions' }); break;
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
// 渲染落点：默认写进 #thread；prepend 旧消息时临时切到一个 fragment（见 prependWindow），所以渲染函数用 rt() 取落点。
let RT = null;
function rt() { return RT || $('thread'); }
function clearThread() { if (searchOpen()) closeSearch(); stopStatus(); $('thread').innerHTML = ''; state.live = null; state.turnTools = []; state.toolRow = null; }
function scrollThread() { if (RT) return; const t = $('thread'); t.scrollTop = t.scrollHeight; } // prepend 期间(RT 非空)不滚
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
  rt().appendChild(m); scrollThread();
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
function addAssistantText(full) { const m = el('div', 'msg assistant'); const t = el('div', 'md'); t.innerHTML = md(full); m.appendChild(t); rt().appendChild(m); }
function addThinking(text) { finalizeLive(); const d = el('div', 'thinking'); const inner = el('div', 'md'); inner.innerHTML = md(text); d.appendChild(inner); d.addEventListener('click', () => d.classList.toggle('collapsed')); rt().appendChild(d); scrollThreadAuto(); }

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
  if (state.expectFork) { state.expectFork = false; wsend({ type: 'history_window', sessionId: state.currentSession, limit: 60 }); }
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
function moodHue(s) { let h = 0; for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return 'hsl(' + h + ',52%,56%)'; }
function updateHeader() {
  $('chatTitle').textContent = state.currentSession ? (state.curTitle || 'Claude Code') : '新会话';
  const md = state.mood, hasMood = !!(md && md.on && md.label);
  if (state.currentSession && (P('showModel') || hasMood)) {
    // 有心情就让它独占这行：隐藏模型名腾出全宽 + 允许换行，省得长情绪被省略号截断；没心情才显模型名
    const html = hasMood
      ? '<span class="mood-dot" style="background:' + moodHue(md.label) + '"></span><span class="mood-lab">' + esc(md.label) + '</span>'
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
  // re-entering the session whose turn is still running → keep the live view (message +
  // spinner + partial reply); don't clobber it with stale history that lacks the in-flight turn
  if (state.currentSession === s.id && state.activeTurn && !state.activeTurn.done) { show('chat'); return; }
  state.currentSession = s.id; state.cwd = s.cwd || ''; state.curTitle = s.title; state.sessionModel = 'Claude'; state.lastModel = ''; state.mood = null;
  // 模型/effort 是每对话一份的（服务端 sessmodel.json）：先拿全局默认占位，等 history 带回这个对话
  // 记住的 pref 再切过去；占位期间 modelMine=false → presence 不带 model，不会盖掉服务端那份。
  // [1m] 这类运行时变体也存在 pref 里，重开对话不会掉回 200K 底座被自动 compact。
  state.model = LS.model; state.effort = LS.effort; state.modelMine = false; state.mode = LS.mode; applyMode();
  clearThread(); updateHeader(); show('chat'); removeSuggestions();
  // 历史走「全量存档·分段窗口」：先秒显缓存的末尾窗，再带 ver 同步（没变→unchanged 秒回）。上滑到顶自动补旧段（含压缩前）。
  state.hist = null;
  const findReq = (state.pendingFind && state.pendingFind.sid === s.id) ? state.pendingFind : null;
  state.pendingFind = null;
  if (findReq) { // 搜索定位：直接拉命中那段窗（不读末尾缓存，免先闪到底再跳）
    state.pendingHistory = wsend({ type: 'history_find', sessionId: s.id, needle: findReq.needle, limit: 80 }) ? null : s.id;
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
  state.currentSession = null; state.cwd = LS.cwd || state.defaultCwd; state.curTitle = ''; state.sessionModel = 'Claude'; state.lastModel = '';
  state.model = LS.model; state.effort = LS.effort; state.modelMine = true; state.mode = LS.mode; applyMode(); // 新对话从全局默认起步，这份就算它自己的选择
  clearThread(); updateHeader(); show('chat'); showSuggestions();
  setTimeout(() => $('composer').focus(), 80);
}
function goList() { if (P('interruptOnLeave') && state.busy) wsend({ type: 'interrupt' }); show('list'); wsend({ type: 'list_sessions' }); }
function renderHistory(m) {
  if (m.unchanged) { if (m.sessionId === state.currentSession) { scrollThread(); tryPendingJump(); } return; }   // 文件没变：缓存即最新、已渲染，不重渲
  clearThread(); removeSuggestions();
  if (m.cwd) { state.cwd = m.cwd; } if (m.title) state.curTitle = m.title; updateHeader();
  // 切到这个对话记住的模型/effort（没记过就是 ''=默认）；用户手快已经先选了的话（modelMine）不抢
  if (m.sessionId === state.currentSession && !state.modelMine) {
    const p = m.pref || {};
    state.model = p.model || ''; state.effort = p.effort || ''; state.modelMine = true;
  }
  if (m.sessionId === state.currentSession) { state.lastModel = m.lastModel || ''; syncModelSub(); state.mood = m.mood || null; updateHeader(); }
  renderItems(m.items);
  scrollThread();
  tryPendingJump();   // 搜索结果点进来的 → 滚到命中那条
  // bridge 全量历史 → 存本地缓存供下次秒开（缓存自身渲染时 _cache=true，跳过避免回写）
  if (!m._cache && m.sessionId && m.items) idbPut('h:' + m.sessionId, { ver: m.ver, items: m.items, cwd: m.cwd, title: m.title, pref: m.pref, lastModel: m.lastModel, mood: m.mood });
}
// 把一批 items 渲染进当前落点 rt()（默认 #thread；prepend 时是 fragment）。含压缩分隔线。
function renderItems(items) {
  let group = null, userB = null; // userB: 最近的用户气泡——它的附图回填成气泡内缩略图，而不是 cc 侧大图
  (items || []).forEach((it) => {
    if (it.kind === 'compact') { group = null; userB = null; const d = el('div', 'hist-compact'); d.innerHTML = '<span>压缩</span>'; rt().appendChild(d); return; }
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
function appendWindow(items) { renderItems(items); } // 落点默认 thread
function renderInitWindow(m, isFind, tentative) {
  clearThread(); removeSuggestions();
  applyHistMeta(m, tentative);
  appendWindow(m.items || []);
  if (!isFind) scrollThread();   // find：不滚到底，交给 tryPendingJump 滚到命中那条
}
const PRELOAD_ROUNDS = 60;      // 历史全文每段补这么多「轮」（一来一回）
const RT_ITEM_CAP = 400;        // 长独白段（茜茜守夜/电影连说很多条）兜底：一段最多这么多条，免一次拉爆
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
    scrollThread(); tryPendingJump(); return;
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
  dot.style.background = on ? (state.mood.label ? moodHue(state.mood.label) : 'var(--accent)') : '';
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
  $('memSub').textContent = state.curTitle || '';
  state.mem = null; renderMemory();          // 加载态
  openScrim('memScrim');
  wsend({ type: 'memory_get', sessionId: state.currentSession });
}
function onMemory(m) {
  if (m.sessionId && m.sessionId !== state.currentSession) return;
  state.mem = { available: !!m.available, on: !!m.on, stats: m.stats || null, recentN: m.recentN, maxTok: m.maxTok };
  renderMemory();
}
function renderMemory() {
  const sw = $('memOn'), note = $('memNote'), box = $('memStats'); if (!sw) return;
  const mem = state.mem;
  const reco = $('memReco');
  if (!mem) { sw.classList.remove('on'); box.innerHTML = '<div class="memstat"><div class="mslab">读取中…</div></div>'; box.classList.add('off'); if (reco) reco.style.display = 'none'; return; }
  if (!mem.available) {
    sw.classList.remove('on'); sw.disabled = true; sw.style.opacity = '.4';
    note.textContent = '这台服务器还没装长期记忆模块（Mnemosyne），暂时开不了。';
    box.innerHTML = ''; box.classList.add('off'); if (reco) reco.style.display = 'none'; return;
  }
  sw.disabled = false; sw.style.opacity = '';
  note.textContent = '开启后，这个对话会自动归档进茜茜的长期记忆，压缩后也能用记忆接回状态。关掉只是不再自动归档／恢复，记忆工具本身一直都在。';
  sw.classList.toggle('on', mem.on);
  const s = mem.stats || {}; let mems = 0; if (s.memories) for (const k in s.memories) mems += (s.memories[k].count || 0);
  const turns = s.dialog_turns || 0;
  box.innerHTML = '<div class="memstat"><div class="msnum">' + mems + '</div><div class="mslab">精炼记忆</div></div>'
    + '<div class="memstat"><div class="msnum">' + turns + '</div><div class="mslab">归档对话（轮）</div></div>';
  box.classList.toggle('off', !mem.on);
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
    const card = el('div', 'memcard');
    const top = el('div', 'memcard-top');
    const meta = el('span', 'memcard-meta');
    meta.textContent = (MEM_TYPE[it.memory_type] || it.memory_type || '?') + ' · 重要度 ' + (it.importance != null ? it.importance : '?')
      + (it.pinned ? ' · 钉' : '') + (it.resolved === 0 ? ' · 未了结' : '') + (it.domain ? ' · ' + it.domain : '');
    const del = el('button', 'memcard-del' + (archView ? '' : ' danger')); del.textContent = archView ? '取消归档' : '归档';
    del.addEventListener('click', (e) => {
      e.stopPropagation();   // 别触发卡片的编辑
      buzz(12);
      wsend({ type: 'memory_archive', id: it.id, archived: !archView });
      state.memMgr.items = state.memMgr.items.filter((x) => x.id !== it.id);   // 乐观移出当前视图
      renderMemMgr();
      toast(archView ? '已取消归档' : '已归档');
    });
    top.appendChild(meta); top.appendChild(del); card.appendChild(top);
    // 正文(content)才是记忆实体；summary 只是标题、且 Ombre 正文已内嵌【标题】，不重复显示
    const text = el('div', 'memcard-text'); text.textContent = it.content || it.summary || '(空)'; card.appendChild(text);
    if (!archView) { card.classList.add('tappable'); card.addEventListener('click', () => openMemEdit(it)); }
    box.appendChild(card);
  }
}

/* ---- 编辑单条精炼记忆（独立一页·仿日记） ---- */
const ME_ICON = {
  type: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  imp: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  pin: '<path d="M9 4h6l-1 7 3 3v2H7v-2l3-3z"/><line x1="12" y1="16" x2="12" y2="21"/>',
  pending: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  del: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
};
function openMemEdit(it) {
  state.memEdit = { id: it.id, domain: it.domain || '', type: it.memory_type || 'experience',
    importance: it.importance != null ? it.importance : 5, pinned: !!it.pinned, resolved: it.resolved !== 0 };
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
  box.appendChild(meRow(ME_ICON.pin, '钉选 · 核心准则不衰减', meSwitch(e.pinned, (v) => { e.pinned = v; })));
  box.appendChild(meRow(ME_ICON.pending, '未了结 · 压缩后优先浮现', meSwitch(!e.resolved, (v) => { e.resolved = !v; })));
  // 删除（两步确认）
  box.appendChild(meRow(ME_ICON.del, state._memDelArm === e.id ? '确认删除？不可恢复' : '删除这条记忆', null, deleteMemEdit, true));
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
    let meta = '';
    if (it.trigger === 'self') meta = '你定的时间';        // 她自己定的下次时间到了
    else if (it.trigger === 'mark') meta = '守夜';         // 守夜的坎兜底叫起
    const dotHtml = (it.kind !== 'mood' && it.mood) ? '<span class="cl-dot" style="background:' + moodHue(it.mood) + '" title="' + esc(it.mood) + '"></span>' : '';
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
    if (md && md.label) now = '此刻 <span class="mood-dot" style="background:' + moodHue(md.label) + '"></span><span class="mood-lab">' + esc(md.label) + '</span><span class="mood-sep">·</span>';
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
  box.appendChild(wkInline('写日记时间', wkClock(() => w.dawnH, (v) => { w.dawnH = v; }, () => w.dawnM, (v) => { w.dawnM = v; })));
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
  const schedules = w.list.map((sch) => ({ nextAt: sch.nextAt || 0, repeat: sch.repeat || null }));
  wsend({ type: 'wakeup_set', sessionId: s.id, enabled: w.enabled, schedules, chase: w.chase, wakeOnEnter: w.wakeOnEnter, dawn: w.dawn, dawnTime });
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
// 时区按 UTC 偏移手动选；存成合法 IANA 名（Etc/GMT 符号是反的：Etc/GMT-8 = UTC+8），bridge 直接当时区用。
function tzFromOffset(off) { return off === 0 ? 'UTC' : 'Etc/GMT' + (off > 0 ? '-' : '+') + Math.abs(off); }
function tzToOffset(tz) { if (tz === 'UTC') return 0; const m = /^Etc\/GMT([+-])(\d+)$/.exec(tz || ''); return m ? (m[1] === '-' ? 1 : -1) * parseInt(m[2], 10) : null; }
function tzOffLabel(off) { return off === 0 ? 'UTC' : 'UTC' + (off > 0 ? '+' : '-') + Math.abs(off); }
const SET_CATS = {
  appearance: { name: '外观', items: [
    { type: 'segment', key: 'theme', name: '主题', opts: [['warm', '暖调'], ['gray', '纸白'], ['dark', '夜间']], onChange: applyTheme },
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
    { type: 'toggle', key: 'autoOpenLast', name: '进入应用自动打开上个对话' },
    { type: 'toggle', key: 'interruptOnLeave', name: '退出对话时中断回复' },
    { type: 'toggle', key: 'autoScroll', name: '生成时自动滚到底部' },
    { type: 'toggle', key: 'pasteAsFile', name: '长文本粘贴为文件' },
    { type: 'slider', key: 'pasteThreshold', name: '文本长度阈值', min: 200, max: 8000, step: 100, fmt: (v) => v + ' 字', dep: 'pasteAsFile' },
    { type: 'toggle', key: 'autoCleanup', name: '自动清理一天前的单轮对话', onChange: cleanupNow },
    { type: 'toggle', key: 'wakePush', name: '后台唤醒通知', onChange: onWakePushToggle },
    { type: 'segment', server: 'cacheTtl', name: '上下文缓存时长', opts: [['1h', '1 小时'], ['5m', '5 分钟']], send: (v) => ({ type: 'cache_ttl_set', ttl: v }) },
    { type: 'tzoff', key: 'timezone', name: 'cc 读到的时区', onChange: sendPresence },
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
  $('setAppearDesc').textContent = ({ warm: '暖调', gray: '纸白', dark: '夜间' }[P('theme')] || '暖调') + ' · 字体 ' + Math.round(P('fontSize') * 100) + '%';
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
      const who = el('span', 'dlg-who'); who.textContent = (t.role === 'user' ? '用户' : '茜茜') + (t.kind && t.kind !== 'chat' ? '·' + t.kind : '');
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
      if (dx > BACK_TRIG()) { buzz(14); if (P('interruptOnLeave') && state.busy) wsend({ type: 'interrupt' }); chat.style.transition = 'transform .26s cubic-bezier(.32,.72,0,1)'; chat.style.transform = 'translateX(100%)'; setTimeout(() => { show('list'); resetChatSlide(); wsend({ type: 'list_sessions' }); }, 270); }
      else { chat.style.transition = 'transform .24s cubic-bezier(.32,.72,0,1)'; chat.style.transform = 'translateX(0)'; setTimeout(() => { resetChatSlide(); $('list').classList.remove('active'); }, 250); }
    } else if (dir === 'search') {
      if (-dx > SEARCH_TRIG()) { buzz(14); state.searchScope = 'chat'; state.searchMode = 'kw'; openSearch(); }
      else closeSearch();
    }
    dir = null;
  });
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
  $('thread').addEventListener('scroll', () => {
    const t = $('thread'); state.threadStick = t.scrollTop + t.clientHeight >= t.scrollHeight - 40;
    if (state.screen === 'chat' && state.hist && state.hist.sid === state.currentSession) {
      if (t.scrollTop < 1500) loadMoreUp();                                                  // 距顶 <~3 屏就提前补旧段（每段 60 轮，含压缩前）
      else if (!state.hist.atBottom && t.scrollHeight - t.scrollTop - t.clientHeight < 1500) loadMoreDown(); // 搜索跳到中段后下滑 → 补新段
    }
  }, { passive: true });
  initPageSwipe('cinemaLog', { onBack: () => show('cinema'), under: 'cinema' });
  initPageSwipe('diary', { onBack: diaryBack });   // diary 是同屏 overview/detail 双视图，返回落点会变，不垫上一级
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
  $('pathDelete').addEventListener('click', () => { const p = state.pathTarget; closeScrim('pathActScrim'); if (p) openPrompt('输入「删除」确认删除「' + p.split('/').pop() + '」（不可恢复）', '', (v) => { if (v === '删除') wsend({ type: 'delete_path', path: p, dir: state.dirPath }); else toast('已取消'); }); });
  $('folderLeft').addEventListener('click', () => { const f = state.folderActTarget; closeScrim('folderActScrim'); if (f) wsend({ type: 'move_folder', name: f, dir: 'left' }); });
  $('folderRight').addEventListener('click', () => { const f = state.folderActTarget; closeScrim('folderActScrim'); if (f) wsend({ type: 'move_folder', name: f, dir: 'right' }); });
  $('folderRename').addEventListener('click', () => { const f = state.folderActTarget; closeScrim('folderActScrim'); if (f) openPrompt('重命名文件夹', '', (name) => { if (name && name !== f) wsend({ type: 'rename_folder', old: f, name }); }, f); });
  $('folderDelete').addEventListener('click', () => { const f = state.folderActTarget; closeScrim('folderActScrim'); if (f) openPrompt('输入「删除」确认删除文件夹（里面的会话保留、只移出）', '', (v) => { if (v === '删除') wsend({ type: 'delete_folder', name: f }); else toast('已取消'); }); });
  $('folderDeleteAll').addEventListener('click', () => { const f = state.folderActTarget; closeScrim('folderActScrim'); if (f) openPrompt('输入「删除」连同「' + f + '」里的所有对话一起删除（不可恢复）', '', (v) => { if (v === '删除') wsend({ type: 'delete_folder', name: f, withSessions: true }); else toast('已取消'); }); });
  $('claudeSave').addEventListener('click', saveClaudeMd);
  $('claudePrev').addEventListener('click', () => setClaudePreview($('claudeView').style.display === 'none'));
  $('compactSave').addEventListener('click', () => { setPref('compactPrompt', $('compactText').value); closeScrim('compactScrim'); toast('压缩提示词已保存'); });
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
  $('mDelete').addEventListener('click', () => { closeMenu(); openPrompt('输入「删除」确认', '', (v) => { if (v === '删除') { wsend({ type: 'delete', sessionId: state.currentSession }); goList(); } else toast('已取消'); }); });
  // 工具类下放到「＋」面板（编辑 CLAUDE.md / 记忆 / MCP 服务器）；复制目录路径并进文件管理
  $('atMemory').addEventListener('click', () => { closePlus(); openMemory(); });
  $('atClaude').addEventListener('click', () => { closePlus(); openClaudeMd(); });
  $('atMcp').addEventListener('click', () => { closePlus(); openMcp(); });
  $('dirCopy').addEventListener('click', () => { navigator.clipboard && navigator.clipboard.writeText(state.dirPath || ''); buzz(12); toast('已复制当前路径'); });

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
  $('atDiary').addEventListener('click', () => { closePlus(); if (!state.currentSession) { toast('新会话还没有日记'); return; } openDiaryFor(state.currentSession, state.curTitle, 'chat'); });
  $('diaryBack').addEventListener('click', diaryBack);
  $('dwBack').addEventListener('click', () => { closeDwPicker(); show('diary'); });
  $('dwAddImg').addEventListener('click', () => $('dwFile').click());
  $('dwFile').addEventListener('change', (e) => { dwAddImages(e.target.files); e.target.value = ''; });
  $('dwSave').addEventListener('click', saveDiaryEntry);
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
  $('sessRename').addEventListener('click', () => { const s = state.sessTarget; closeScrim('sessScrim'); if (s) openPrompt('重命名会话', '', (name) => { if (name) wsend({ type: 'rename', sessionId: s.id, title: name }); }, s.title || ''); });
  $('sessDelete').addEventListener('click', () => { const s = state.sessTarget; closeScrim('sessScrim'); if (s) openPrompt('输入「删除」确认删除', '', (v) => { if (v === '删除') wsend({ type: 'delete', sessionId: s.id }); else toast('已取消'); }); });
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
