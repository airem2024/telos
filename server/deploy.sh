#!/usr/bin/env bash
# One-shot deploy for cc-bridge on a Linux box with systemd.
# Installs deps, generates the auth token, and (re)installs a systemd service
# that runs the bridge as the CURRENT user with their own claude auth.
#
#   bash server/deploy.sh            # install + enable + start
#   bash server/deploy.sh --no-svc   # just deps + token, no systemd
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_USER="$(id -un)"
RUN_HOME="$HOME"
NO_SVC=0; [ "${1:-}" = "--no-svc" ] && NO_SVC=1

NODE_BIN="$(command -v node || true)"
CLAUDE_BIN="$(command -v claude || true)"
[ -z "$NODE_BIN" ] && { echo "✗ node not found in PATH. Install Node 18+ first."; exit 1; }
[ -z "$CLAUDE_BIN" ] && echo "⚠ 'claude' not found in PATH — log in / install it before starting the service."

echo "▶ server dir : $SERVER_DIR"
echo "▶ node       : $NODE_BIN ($("$NODE_BIN" -v))"
echo "▶ claude     : ${CLAUDE_BIN:-<missing>}"
echo "▶ run as     : $RUN_USER (HOME=$RUN_HOME)"

echo "▶ installing deps…"
( cd "$SERVER_DIR" && npm install --omit=dev --no-audit --no-fund )

echo "▶ generating config.json / auth token…"
TOKEN="$( cd "$SERVER_DIR" && "$NODE_BIN" -e "import('./config.js').then(m=>console.log(m.loadConfig().token))" )"
echo "  token: $TOKEN"

if [ "$NO_SVC" = "1" ]; then
  echo "✓ done (no service). Start manually:  cd $SERVER_DIR && $NODE_BIN server.js"
  exit 0
fi

PATH_DIR="$(dirname "$NODE_BIN")"
UNIT=/etc/systemd/system/cc-bridge.service
SUDO=""; [ "$(id -u)" != "0" ] && SUDO="sudo"

echo "▶ writing $UNIT (needs sudo)…"
$SUDO tee "$UNIT" >/dev/null <<UNIT
[Unit]
Description=cc-bridge - phone chat app <-> local Claude Code (Agent SDK)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$SERVER_DIR
Environment=HOME=$RUN_HOME
Environment=DISABLE_AUTOUPDATER=1
Environment=CLAUDE_PATH=${CLAUDE_BIN:-claude}
Environment=PATH=$PATH_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$NODE_BIN $SERVER_DIR/server.js
Restart=always
RestartSec=3
StandardOutput=append:$SERVER_DIR/cc-bridge.log
StandardError=append:$SERVER_DIR/cc-bridge.log

[Install]
WantedBy=multi-user.target
UNIT

$SUDO systemctl daemon-reload
$SUDO systemctl enable --now cc-bridge.service
sleep 1
$SUDO systemctl --no-pager --lines=0 status cc-bridge.service || true

cat <<DONE

✓ cc-bridge is running on 127.0.0.1:$( "$NODE_BIN" -e "import('./config.js').then(m=>console.log(m.loadConfig().port))" )
  auth token : $TOKEN

Next: expose it as wss:// so the phone can reach it, e.g.
  cloudflared tunnel --url http://127.0.0.1:8790
then in the app → 设置 → 连接:
  地址 = wss://<the cloudflared host>     Token = $TOKEN
DONE
