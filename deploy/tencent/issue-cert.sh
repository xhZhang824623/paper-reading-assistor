#!/usr/bin/env bash
# 在服务器上运行（需要 sudo）：DNS 指向本机后为 PAPER_DOMAIN 签发 Let's Encrypt 证书并启用 HTTPS。
# 可以反复运行；证书已存在且未到期时什么都不做。cron 每 15 分钟调用一次，DNS 配好后自动生效。
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
MY_IP="$(curl -s --max-time 8 ifconfig.me || hostname -I | cut -d' ' -f1)"
RESOLVED="$(getent ahostsv4 "$PAPER_DOMAIN" | awk '{print $1}' | head -1 || true)"
if [ -z "$RESOLVED" ]; then echo "$(date -Is) $PAPER_DOMAIN 还没有 DNS 记录，跳过"; exit 0; fi
if [ "$RESOLVED" != "$MY_IP" ]; then echo "$(date -Is) $PAPER_DOMAIN 解析到 $RESOLVED，不是本机 $MY_IP，跳过"; exit 0; fi
if [ ! -s "/etc/letsencrypt/live/$PAPER_DOMAIN/fullchain.pem" ]; then
  echo "$(date -Is) 为 $PAPER_DOMAIN 签发证书"
  sudo certbot certonly --webroot -w "$PWD/acme" -d "$PAPER_DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring
fi
sudo bash ./renew-hook.sh
