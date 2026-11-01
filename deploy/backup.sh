#!/usr/bin/env sh
# 每日备份：数据库（pg_dump 自定义格式，保留 14 天）+ 附件镜像（增量）。
# 建议用 cron 每天凌晨执行（见 docs/DEPLOY.md）。
#
# 附件按内容 sha256 存放、写入后不再修改，所以只需把新文件补进镜像目录 backups/attachments/：
# - 镜像与附件在同一块盘时用硬链接，不额外占空间，误删附件后仍能从镜像找回；
# - BACKUP_DIR 指向另一块盘时自动改为复制。
# 同一块盘上的备份防不了整盘损坏，异地备份（自动快照 / OSS）见方案“之后”一项。
#
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

ATT_NOTE="无"
if [ -d data/attachments ]; then
  mkdir -p "$DIR/attachments"
  before="$(find "$DIR/attachments" -type f | wc -l)"
  # -n 不覆盖已有文件：只补新增的
  if ! cp -aln data/attachments/. "$DIR/attachments/" 2>/dev/null; then
    cp -an data/attachments/. "$DIR/attachments/"
  fi
  after="$(find "$DIR/attachments" -type f | wc -l)"
  ATT_NOTE="镜像新增 $((after - before)) 个文件，共 $after 个"
fi

# 旧版脚本留下的整包附件备份一并按天数清理
find "$DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'attachments-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') 备份完成：$DIR/db-$TS.dump $(du -h "$DIR/db-$TS.dump" | cut -f1)，附件$ATT_NOTE"
