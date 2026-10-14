#!/usr/bin/env bash
# 证书签发/续期后执行（certbot deploy hook 也会调用）：把证书复制到两个 nginx 的目录并重载。
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
install_cert() { # $1 domain  $2 target dir  $3 fullchain name  $4 key name
  local live="/etc/letsencrypt/live/$1"
  [ -s "$live/fullchain.pem" ] || return 0
  mkdir -p "$2"
  cp -L "$live/fullchain.pem" "$2/$3"
  cp -L "$live/privkey.pem" "$2/$4"
  chown ubuntu:ubuntu "$2/$3" "$2/$4" 2>/dev/null || true
  chmod 644 "$2/$3"; chmod 600 "$2/$4"
}
# Paper Reading 自己的 nginx
install_cert "$PAPER_DOMAIN" "$PWD/ssl/$PAPER_DOMAIN" fullchain.pem privkey.pem
# TeleAgent 的 nginx（先备份旧文件）
if [ -s "/etc/letsencrypt/live/$TELEAGENT_DOMAIN/fullchain.pem" ] && [ -d "$TELEAGENT_SSL_DIR" ]; then
  mkdir -p "$TELEAGENT_SSL_DIR/backup"
  cp -n "$TELEAGENT_SSL_DIR/cert.pem" "$TELEAGENT_SSL_DIR/backup/cert.pem.$(date +%Y%m%d)" 2>/dev/null || true
  cp -n "$TELEAGENT_SSL_DIR/key.pem" "$TELEAGENT_SSL_DIR/backup/key.pem.$(date +%Y%m%d)" 2>/dev/null || true
  install_cert "$TELEAGENT_DOMAIN" "$TELEAGENT_SSL_DIR" cert.pem key.pem
  if docker ps --format '{{.Names}}' | grep -q '^nginxTeleAgent$'; then
    docker exec nginxTeleAgent nginx -t && docker exec nginxTeleAgent nginx -s reload && echo "nginxTeleAgent 已重载新证书"
  fi
fi
sudo -u ubuntu bash ./apply-nginx.sh
