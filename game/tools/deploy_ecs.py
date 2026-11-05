"""把游戏 dist 部署到阿里云 ECS（Ubuntu 22.04）。

用法（密码走环境变量，不落盘）：
    $env:DSP_PW = "root 密码"; py tools\\deploy_ecs.py 39.103.58.244

做的事：
  1. 装 nginx / unzip（已装则跳过）
  2. 用 SFTP 把 tools/_deploy_game.zip 传到 /tmp/game.zip
  3. 解包到 /var/www/dsp
  4. 写 nginx 站点配置（gzip + 静态缓存），清掉默认站点
  5. 起服务并自检
"""
from __future__ import annotations

import os
import sys
import time

import paramiko

HOST = sys.argv[1] if len(sys.argv) > 1 else "39.103.58.244"
USER = "root"
PASSWORD = os.environ.get("DSP_PW", "")
LOCAL_ZIP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_deploy_game.zip")
REMOTE_ZIP = "/tmp/game.zip"
WWW = "/var/www/dsp"

NGINX_CONF = """server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root /var/www/dsp;
    index index.html;

    gzip on;
    gzip_comp_level 6;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    location /game/assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    location ~* \\.(png|jpg|jpeg|webp|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public";
    }
    location = /index.html {
        add_header Cache-Control "no-cache";
    }
    location = /game/index.html {
        add_header Cache-Control "no-cache";
    }

    location /game/ {
        try_files $uri $uri/ /game/index.html;
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
}
"""


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 900) -> tuple[int, str, str]:
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout, get_pty=False)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    return code, out.strip(), err.strip()


def step(title: str) -> None:
    print(f"\n==> {title}", flush=True)


def main() -> int:
    if not PASSWORD:
        print("缺少 DSP_PW 环境变量", file=sys.stderr)
        return 2
    if not os.path.exists(LOCAL_ZIP):
        print(f"本地包不存在: {LOCAL_ZIP}", file=sys.stderr)
        return 2

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    step(f"连接 {USER}@{HOST}")
    client.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=20,
                   allow_agent=False, look_for_keys=False)
    print("已连接", flush=True)

    code, out, err = run(client, "lsb_release -ds 2>/dev/null || cat /etc/os-release | head -1; free -m | awk 'NR==2{print $2\" MB RAM\"}'; df -h / | awk 'NR==2{print $4\" free\"}'")
    print(out or err)

    step("安装 nginx / unzip")
    code, out, err = run(
        client,
        "export DEBIAN_FRONTEND=noninteractive; "
        "if command -v nginx >/dev/null && command -v unzip >/dev/null; then echo '已存在，跳过'; "
        "else apt-get update -qq && apt-get install -y -qq nginx unzip; fi; nginx -v 2>&1; unzip -v | head -1",
    )
    print(out or err)
    if code != 0:
        print("安装失败", file=sys.stderr)
        return 1

    step("上传游戏包")
    size = os.path.getsize(LOCAL_ZIP)
    t0 = time.time()
    with client.open_sftp() as sftp:
        sftp.put(LOCAL_ZIP, REMOTE_ZIP)
    print(f"上传 {size/1024/1024:.2f} MB 用时 {time.time()-t0:.1f}s")

    step("解包到 " + WWW)
    code, out, err = run(
        client,
        f"rm -rf {WWW} && mkdir -p {WWW} && unzip -q -o {REMOTE_ZIP} -d {WWW} && "
        f"ls {WWW} | head -5 && du -sh {WWW} && test -f {WWW}/index.html && echo INDEX_OK",
    )
    print(out or err)
    if "INDEX_OK" not in out:
        print("解包后没有 index.html", file=sys.stderr)
        return 1

    step("写 nginx 配置")
    code, out, err = run(client, f"cat > /etc/nginx/sites-available/dsp <<'NGX'\n{NGINX_CONF}NGX")
    print(out or err)
    code, out, err = run(
        client,
        "ln -sf /etc/nginx/sites-available/dsp /etc/nginx/sites-enabled/dsp && "
        "rm -f /etc/nginx/sites-enabled/default && "
        "rm -f /etc/nginx/sites-available/default 2>/dev/null; nginx -t 2>&1",
    )
    print(out or err)

    step("重启 nginx")
    code, out, err = run(client, "systemctl enable nginx >/dev/null 2>&1; systemctl restart nginx; sleep 1; systemctl is-active nginx; "
                                 f"curl -s -o /dev/null -w 'local_http=%{{http_code}} size=%{{size_download}}\\n' http://127.0.0.1/")
    print(out or err)

    step("自检（服务器侧）")
    code, out, err = run(client, "ss -lntp | grep -E ':80\\b' || true; "
                                 "curl -s -o /dev/null -w 'index=%{http_code} ' http://127.0.0.1/index.html; "
                                 "curl -s -o /dev/null -w 'gzip_js=%{size_download}\\n' -H 'Accept-Encoding: gzip' "
                                 "$(curl -s http://127.0.0.1/index.html | grep -o '/assets/index-[^\"]*\\.js' | head -1)")
    print(out or err)

    client.close()
    print(f"\n完成：http://{HOST}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())