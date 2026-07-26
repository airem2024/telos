import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(here, 'config.json');

const defaults = {
  port: 8790,
  // empty token => generated on first run and saved here
  token: '',
  // path to the user's own claude binary so the agent uses their config/auth/models
  claudePath: process.env.CLAUDE_PATH || '',
  // default working directory for brand-new sessions
  defaultCwd: join(homedir(), 'code'),
  // 'default' consults canUseTool (phone popup) for tools that need permission;
  // 'acceptEdits' / 'bypassPermissions' also possible
  permissionMode: 'default',
  // API 逃生舱：enabled 时给 cc 注入 ANTHROPIC_* env 走 API 计费（订阅通路不可用时的备胎）。
  // key=官方 API key；authToken=中转站 Bearer；baseUrl 空=官方。App 设置→连接→API 里改，热生效。
  api: { enabled: false, key: '', authToken: '', baseUrl: '' },
  debug: false
};

export function loadConfig() {
  let cfg = { ...defaults };
  if (existsSync(CONFIG_PATH)) {
    try {
      cfg = { ...cfg, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) };
    } catch (e) {
      console.error('config.json parse error, using defaults:', e.message);
    }
  }
  let changed = false;
  if (!cfg.token) {
    cfg.token = randomBytes(24).toString('base64url');
    changed = true;
  }
  if (!cfg.claudePath) {
    // best-effort: resolve from PATH at runtime; leave empty to let SDK find it
    cfg.claudePath = process.env.CLAUDE_PATH || '';
  }
  if (changed) {
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    console.log('Generated new auth token and saved config.json');
  }
  try {
    if (!existsSync(cfg.defaultCwd)) mkdirSync(cfg.defaultCwd, { recursive: true });
  } catch (e) { /* ignore */ }
  return cfg;
}

export { CONFIG_PATH };
