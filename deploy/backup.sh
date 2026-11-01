#!/usr/bin/env sh
# 每日备份：数据库（pg_dump 自定义格式）+ 附件目录，保留 14 天。
# 在服务器仓库目录外也能跑；建议用 cron 每天凌晨执行（见 docs/DEPLOY.md）。
# 注意：.env 里的 MAIL_SECRET_KEY 不在备份里，丢了它库里加密的授权码 / API key 无法解密，请另行妥善保存一份。
set -eu
cd "$(dirname "$0")/.."

KEEP_DAYS="${KEEP_DAYS:-14}"
DIR="${BACKUP_DIR:-backups}"
TS="$(date +%Y%m%d-%H%M%S)"
umask 077
mkdir -p "$DIR"

docker compose exec -T postgres pg_dump -U aftersell -d aftersell -Fc > "$DIR/db-$TS.dump.tmp"
mv "$DIR/db-$TS.dump.tmp" "$DIR/db-$TS.dump"

if [ -d data/attachments ]; then
  tar czf "$DIR/attachments-$TS.tar.gz.tmp" -C data attachments
  mv "$DIR/attachments-$TS.tar.gz.tmp" "$DIR/attachments-$TS.tar.gz"
fi

find "$DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'attachments-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') 备份完成：$DIR/db-$TS.dump $(du -h "$DIR/db-$TS.dump" | cut -f1)，附件 $( [ -f "$DIR/attachments-$TS.tar.gz" ] && du -h "$DIR/attachments-$TS.tar.gz" | cut -f1 || echo 无)"
