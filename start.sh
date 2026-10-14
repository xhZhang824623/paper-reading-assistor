#!/usr/bin/env bash
# 启动本地服务并打开浏览器。按 Ctrl+C 停止。
cd "$(dirname "$0")"
PORT="${1:-8080}"
URL="http://localhost:$PORT/"
( sleep 1; (xdg-open "$URL" || open "$URL" || true) >/dev/null 2>&1 ) &
python3 serve.py "$PORT"
