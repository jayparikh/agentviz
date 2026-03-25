#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SESSION="${1:-}"
LOG="$SCRIPT_DIR/agentviz-server.log"
if [ -n "$SESSION" ]; then
  nohup node "$SCRIPT_DIR/bin/agentviz.js" "$SESSION" --no-open >> "$LOG" 2>&1 &
else
  nohup node "$SCRIPT_DIR/bin/agentviz.js" --no-open >> "$LOG" 2>&1 &
fi
disown $!
echo "AgentViz started PID=$! at http://localhost:4242  logs: $LOG"
