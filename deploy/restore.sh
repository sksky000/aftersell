#!/usr/bin/env sh
# 从备份恢复：会覆盖当前数据库与附件目录。
# 用法：deploy/restore.sh backups/db-<时间>.dump [backups/attachments-<时间>.tar.gz]
set -eu
cd "$(dirname "$0")/.."
DUMP="${1:?缺少数据库备份文件}"
ATT="${2:-}"
[ -f "$DUMP" ] || { echo "找不到 $DUMP"; exit 1; }

printf '将用 %s 覆盖当前数据库%s。输入 yes 继续：' "$DUMP" "${ATT:+ 和附件目录}"
read -r answer
[ "$answer" = "yes" ] || { echo "已取消"; exit 1; }

docker compose stop app
docker compose exec -T postgres pg_restore -U aftersell -d aftersell --clean --if-exists --no-owner < "$DUMP"
if [ -n "$ATT" ]; then
  rm -rf data/attachments.old
  if [ -d data/attachments ]; then mv data/attachments data/attachments.old; fi
  tar xzf "$ATT" -C data
  chown -R 1000:1000 data/attachments
fi
docker compose start app
echo "恢复完成。确认无误后可删除 data/attachments.old"
