#!/usr/bin/env bash
# 在服务器上运行：根据证书是否存在选择 HTTP 或 HTTPS 配置，校验后重载 nginxPaperReading。
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
if [ -s "ssl/$PAPER_DOMAIN/fullchain.pem" ] && [ -s "ssl/$PAPER_DOMAIN/privkey.pem" ]; then
  sed -e "s/__PAPER_DOMAIN__/$PAPER_DOMAIN/g" -e "s/__TELEAGENT_DOMAIN__/$TELEAGENT_DOMAIN/g" -e "s/__PAPER_HTTPS_PORT__/${PAPER_HTTPS_PORT:-443}/g" templates/https.conf > nginx/default.conf
  echo "nginx: HTTPS 配置（$PAPER_DOMAIN）"
else
  cp templates/http.conf nginx/default.conf
  echo "nginx: HTTP 配置（证书尚未签发）"
fi
sudo docker compose up -d >/dev/null
sudo docker compose exec -T paperreading nginx -t
sudo docker compose exec -T paperreading nginx -s reload
