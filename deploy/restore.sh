#!/usr/bin/env sh
# 从备份恢复数据库（会覆盖当前数据库），并从附件镜像补回缺失的附件文件。
# 用法：deploy/restore.sh backups/db-<时间>.dump [附件来源]
#   附件来源默认 backups/attachments（镜像目录，只补缺失文件、不覆盖）；
#   也可以给旧版脚本的 attachments-<时间>.tar.gz（整包替换附件目录，原目录改名为 attachments.old）。
set -eu
cd "$(dirname "$0")/.."
DUMP="${1:?缺少数据库备份文件}"
ATT="${2:-backups/attachments}"
[ -f "$DUMP" ] || { echo "找不到 $DUMP"; exit 1; }
[ -e "$ATT" ] || { echo "找不到附件来源 $ATT（只恢复数据库请先确认）"; ATT=""; }

printf '将用 %s 覆盖当前数据库%s。输入 yes 继续：' "$DUMP" "${ATT:+，并从 $ATT 恢复附件}"
read -r answer
[ "$answer" = "yes" ] || { echo "已取消"; exit 1; }

docker compose stop app
docker compose exec -T postgres pg_restore -U aftersell -d aftersell --clean --if-exists --no-owner < "$DUMP"
if [ -d "$ATT" ]; then
  mkdir -p data/attachments
  cp -an "$ATT"/. data/attachments/
  chown -R 1000:1000 data/attachments
elif [ -f "$ATT" ]; then
  rm -rf data/attachments.old
  if [ -d data/attachments ]; then mv data/attachments data/attachments.old; fi
  tar xzf "$ATT" -C data
  chown -R 1000:1000 data/attachments
  echo "原附件目录已改名为 data/attachments.old，确认无误后可删除"
fi
docker compose start app
echo "恢复完成"
