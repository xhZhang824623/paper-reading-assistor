#!/usr/bin/env bash
# 一键部署 / 更新到 TeleAgent 那台腾讯云。用法：deploy/tencent/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
source deploy/tencent/config.env
HOST="$DEPLOY_HOST"; REMOTE_DIR="$DEPLOY_DIR"

./build.sh
ssh "$HOST" "mkdir -p '$REMOTE_DIR/dist' '$REMOTE_DIR/acme' '$REMOTE_DIR/nginx' '$REMOTE_DIR/ssl' '$REMOTE_DIR/templates'"
rsync -az --delete dist/ "$HOST:$REMOTE_DIR/dist/"
rsync -az --delete deploy/tencent/templates/ "$HOST:$REMOTE_DIR/templates/"
rsync -az deploy/tencent/docker-compose.yml deploy/tencent/config.env deploy/tencent/apply-nginx.sh deploy/tencent/issue-cert.sh deploy/tencent/renew-hook.sh "$HOST:$REMOTE_DIR/"
# certbot 续期后的钩子 + 每 15 分钟检查一次是否可以签发（DNS 配好后自动启用 HTTPS）
ssh "$HOST" "cd '$REMOTE_DIR' && chmod +x apply-nginx.sh issue-cert.sh renew-hook.sh \
  && sudo mkdir -p /etc/letsencrypt/renewal-hooks/deploy \
  && printf '#!/bin/bash\nbash $REMOTE_DIR/renew-hook.sh\n' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/paperreading.sh >/dev/null \
  && sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/paperreading.sh \
  && printf '*/15 * * * * ubuntu cd $REMOTE_DIR && sudo bash ./issue-cert.sh >> $REMOTE_DIR/issue-cert.log 2>&1\n' | sudo tee /etc/cron.d/paperreading-cert >/dev/null \
  && ./apply-nginx.sh && sleep 1 && curl -fsS http://127.0.0.1/health"
echo
if ssh "$HOST" "test -s '$REMOTE_DIR/ssl/$PAPER_DOMAIN/fullchain.pem'"; then echo "已部署：https://$PAPER_DOMAIN:${PAPER_HTTPS_PORT:-443}/"; else echo "已部署（HTTP）：http://$(ssh "$HOST" 'curl -s --max-time 8 ifconfig.me || hostname -I | cut -d" " -f1')/   DNS 与 443 就绪后会自动切到 https://$PAPER_DOMAIN/"; fi
