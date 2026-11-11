#!/bin/bash
# Fate Map launcher (used by "Fate Map.app" and for terminal use).
#   MODE=gui       notifications and an alert dialog on failure (used by the .app)
#   MODE=terminal  prints everything (default)
set -u
MODE="${MODE:-terminal}"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="$HOME/Library/Application Support/Fate Map"
LOG="$HOME/Library/Logs/FateMap.log"
PORT="${FM_PORT:-8793}"   # not $PORT: the Toolbox Launcher's `open` forwards stray environment

VERSION="$(sed -n 's/^__version__ = "\(.*\)"/\1/p' "$APP_DIR/fatemap/__init__.py")"
mkdir -p "$HOME_DIR" "$(dirname "$LOG")"
export PATH="/opt/homebrew/bin:/usr/local/bin:/Library/Frameworks/Python.framework/Versions/Current/bin:$PATH"

log() { echo "[$(date '+%H:%M:%S')] $*" >>"$LOG"; [ "$MODE" = terminal ] && echo "$*"; }
note() { log "$*"; [ "$MODE" = gui ] && osascript -e "display notification \"$1\" with title \"Fate Map\"" >/dev/null 2>&1; }
fail() {
  log "!! $1"
  if [ "$MODE" = gui ]; then
    osascript -e "display dialog \"$1\n\nLog: $LOG\" with title \"Fate Map\" buttons {\"OK\"} default button \"OK\" with icon stop" >/dev/null 2>&1
  else
    echo "$1"
  fi
  exit 1
}

log "=== Fate Map $VERSION starting ($MODE) from $APP_DIR"

# Already running? Reuse it.
RUNNING="$(curl -s -m 2 "http://localhost:$PORT/api/health" 2>/dev/null | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p')"
if [ -n "$RUNNING" ]; then
  if [ "$RUNNING" = "$VERSION" ]; then log "Already running — opening the browser."; open "http://localhost:$PORT"; exit 0; fi
  log "Replacing older version $RUNNING."
  curl -s -m 2 -X POST "http://localhost:$PORT/api/quit" >/dev/null 2>&1; sleep 1.5
elif lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  fail "Port $PORT is used by another program. Quit it, or start with another port: FM_PORT=8797 \"$0\""
fi

# Python: the standard library is enough (3.9 or newer); no packages to install.
PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3.9 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then PY="$(command -v "$c")"; break; fi
done
[ -z "$PY" ] && fail "Python 3.9 or newer was not found. Install it from python.org, then open this app again."

if [ "${1:-}" = "--selftest" ]; then
  cd "$APP_DIR" && "$PY" -c "import fatemap.server; print('self-test ok')"
  exit $?
fi

# Run the server as a child. It quits when its window closes or when this launcher goes away;
# the trap makes quitting the Dock icon stop it too.
cd "$APP_DIR"
EXTRA=""; [ -n "${FM_NO_BROWSER:-}" ] && EXTRA="--no-browser"   # for tests: open the page yourself
FM_PARENT_PID=$$ PYTHONUNBUFFERED=1 "$PY" -m fatemap.server --port "$PORT" $EXTRA >>"$LOG" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; exit 0' TERM INT HUP
for _ in $(seq 1 50); do curl -s -m 1 "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break; kill -0 $SERVER 2>/dev/null || break; sleep 0.2; done
kill -0 $SERVER 2>/dev/null || fail "The program did not start. See the log."
log "Server up on port $PORT (pid $SERVER)."
wait $SERVER
log "Server stopped — launcher exiting."
