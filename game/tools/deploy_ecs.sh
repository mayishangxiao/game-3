#!/usr/bin/env bash
# 把游戏部署到 ECS（Ubuntu 22.04）。用法：
#   curl -fsSL <url>/_deploy/deploy.sh | bash -s -- <url>
# 第二次跑就是“更新”，只换文件、不重装 nginx。
set -euo pipefail

BASE_URL="${1:-}"
WWW="/var/www/dsp"

if [ -z "$BASE_URL" ]; then
  echo "用法: bash deploy.sh https://你的临时地址" >&2
  exit 1
fi

echo "==> 1/5 安装依赖"
export DEBIAN_FRONTEND=noninteractive
if ! command -v nginx >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq nginx unzip curl ca-certificates
fi

echo "==> 2/5 下载游戏包"
mkdir -p "$WWW"
tmp="$(mktemp -d)"
curl -fsSL "$BASE_URL/_deploy/game.zip" -o "$tmp/game.zip"
ls -lh "$tmp/game.zip"

echo "==> 3/5 解包到 $WWW"
rm -rf "$WWW"/*
unzip -q "$tmp/game.zip" -d "$WWW"
rm -rf "$tmp"
test -f "$WWW/index.html" || { echo "index.html 没找到，包有问题" >&2; exit 1; }

echo "==> 4/5 写 nginx 配置"
cat > /etc/nginx/sites-available/dsp <<'CONF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root /var/www/dsp;
    index index.html;

    # 文本类开 gzip：JS 1.3MB -> 约 320KB
    gzip on;
    gzip_comp_level 6;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    # 带哈希的产物长缓存，index.html 不缓存
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    location ~* \.(png|jpg|jpeg|webp|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public";
    }
    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
CONF
ln -sf /etc/nginx/sites-available/dsp /etc/nginx/sites-enabled/dsp
rm -f /etc/nginx/sites-enabled/default

echo "==> 5/5 重启 nginx"
nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl restart nginx

IP="$(curl -fsS --max-time 5 https://api.ipify.org || echo 127.0.0.1)"
echo
echo "部署完成： http://$IP/"
du -sh "$WWW"