#!/usr/bin/env bash
# 打包成可直接部署的静态目录 dist/（任何静态托管都能用：Cloudflare Pages、Vercel、GitHub Pages、OSS、chatgpt.site…）
set -e
cd "$(dirname "$0")"
rm -rf dist
mkdir -p dist
cp index.html dist/
cp -r styles src vendor dist/
# 可选：把示例 PDF 一起放进去，方便在线试用
mkdir -p dist/tests/fixtures && cp tests/fixtures/sample-paper.pdf dist/tests/fixtures/
# Cloudflare Pages / Netlify 的缓存与安全头（其他平台会忽略这个文件）
cat > dist/_headers <<'H'
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Cache-Control: no-cache
/vendor/*
  Cache-Control: public, max-age=604800
H
echo "dist/ 已生成，共 $(find dist -type f | wc -l) 个文件，$(du -sh dist | cut -f1)"
