#!/usr/bin/env sh
# 首次部署时在服务器上运行：生成 .env 并填入随机密钥。已存在 .env 时不覆盖。
# 用法：deploy/init-env.sh <服务器 IP 或域名> <管理员邮箱>
set -eu
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env 已存在，不覆盖"
  exit 0
fi
SITE_HOST="${1:?缺少服务器 IP 或域名}"
ADMIN_EMAIL="${2:?缺少管理员邮箱}"

rand() { openssl rand -base64 "$1" | tr -d '\n'; }
ADMIN_PW="$(openssl rand -base64 12 | tr -d '\n/+=')"

umask 077
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(rand 48)
MAIL_SECRET_KEY=$(rand 32)
MAIL_HOST_ALLOWLIST=imap.exmail.qq.com,smtp.exmail.qq.com,hwimap.exmail.qq.com,hwsmtp.exmail.qq.com
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_INITIAL_PASSWORD=${ADMIN_PW}
SITE_HOST=${SITE_HOST}
TLS_ISSUER=internal
COOKIE_SECURE=true
EOF
echo "已生成 .env（权限 600）。初始管理员密码见 .env 中的 ADMIN_INITIAL_PASSWORD，首次登录后须修改。"
