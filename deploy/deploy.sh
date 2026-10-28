#!/usr/bin/env sh
# 在服务器的仓库目录里运行：拉最新代码、重建并重启。数据在 docker 卷和 data/ 里，不受影响。
set -eu
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
