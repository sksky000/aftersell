# 部署与运维

一台 Linux 服务器、四个容器（app / postgres / redis / caddy）、两个数据位置（Docker 卷 `pgdata` 里的数据库，仓库目录下的 `data/attachments` 附件）。以下命令都在服务器上、以 root 执行。

## 1. 准备服务器

- 建议 4 核 8G、可用磁盘 ≥ 40 GB；Alibaba Cloud Linux 3 / CentOS / Ubuntu 均可
- 安装 Docker 与 Docker Compose 插件，确认 `docker compose version` 能运行
- 安全组放行入方向 80、443；出方向需要能访问企业邮箱 IMAP 993 / SMTP 465 和模型服务（DeepSeek、阿里云百炼）

## 2. 首次部署

```bash
git clone https://github.com/sksky000/aftersell /srv/aftersell
cd /srv/aftersell
deploy/init-env.sh <服务器IP或域名> <管理员登录邮箱>
mkdir -p data/attachments && chown 1000:1000 data/attachments
docker compose up -d --build
docker compose ps        # 四个容器都是 Up，app 显示 (healthy)
```

`init-env.sh` 生成 `.env`（权限 600）并填入随机的数据库口令、`JWT_SECRET`、`MAIL_SECRET_KEY` 和初始管理员密码；已有 `.env` 时不会覆盖。

**把 `.env` 另存一份到安全的地方。** `MAIL_SECRET_KEY` 用来加密库里的邮箱授权码和模型 API key，丢了只能在设置页重新填写。

浏览器打开 `https://<服务器IP或域名>`：
- 只有 IP 时用 Caddy 自签证书，浏览器提示“不安全”，选择继续访问
- 有域名后把 `.env` 里 `SITE_HOST` 改成域名、`TLS_ISSUER` 改成一个邮箱，`docker compose up -d` 后自动申请正式证书

## 3. 首次登录后的设置

用 `.env` 里的 `ADMIN_EMAIL` 和 `ADMIN_INITIAL_PASSWORD` 登录，系统会要求先改密码。然后按顺序：

1. **设置 → 邮箱**：填企业邮箱地址和客户端专用密码，点“测试连接”，IMAP 和 SMTP 都要通过
2. **设置 → 邮箱 → 发件人角色**：
   - 领导转发地址：把客户邮件转发进来用的邮箱（系统会从转发内容里找出真正的客户，回复直接发给客户）
   - 我方地址：客服邮箱等
   - 发信测试模式：试运行期间保持开启，回复只会发到“发信白名单”里的地址
3. **设置 → 模型**：填 DeepSeek、阿里云百炼的 API key，每个任务点“测试”
4. **设置 → 业务知识**：核对收款信息、价格表
5. **设置 → 用户**：给客服和主管建账号
6. 回到看板点“手动同步”，确认邮件进来、自动分类、生成草稿；确认无误后在 设置 → 邮箱 打开定时拉取

## 4. 更新版本

```bash
cd /srv/aftersell && deploy/deploy.sh
```

拉最新代码、重建并重启 app；数据库迁移在 app 启动时自动执行，数据不受影响。用 `docker compose ps app` 看 Up 时长确认容器确实重建了。浏览器里开着的页面会提示“系统已更新”，点刷新即可。

服务器访问 GitHub 不稳定、`git pull` 超时的话，在本地打包推送：

```bash
# 本地仓库里
BASE=$(ssh root@<服务器> "cd /srv/aftersell && git rev-parse HEAD")
git bundle create d.bundle $BASE..main
scp d.bundle root@<服务器>:/tmp/
# 服务器上
cd /srv/aftersell && git fetch /tmp/d.bundle main && git merge --ff-only FETCH_HEAD && rm /tmp/d.bundle
docker compose up -d --build && docker image prune -f
```

## 5. 备份与恢复

每天凌晨 3 点自动备份，保留 14 天：

```bash
crontab -e
# 加一行：
0 3 * * * /srv/aftersell/deploy/backup.sh >> /srv/aftersell/backups/backup.log 2>&1
```

备份文件在 `/srv/aftersell/backups/`：`db-<时间>.dump`（数据库）和 `attachments-<时间>.tar.gz`（附件）。手动备份直接运行 `deploy/backup.sh`。建议定期把备份目录同步到服务器以外的地方（如 OSS），服务器整盘损坏时本机备份也会一起丢。

恢复（会覆盖当前数据，需输入 yes 确认）：

```bash
deploy/restore.sh backups/db-20261101-030000.dump backups/attachments-20261101-030000.tar.gz
```

在新服务器上整体恢复：按第 2 节部署，把原来的 `.env` 放回仓库目录（不要运行 `init-env.sh`），`docker compose up -d --build` 后再运行 `restore.sh`。

## 6. 常用排查

| 现象 | 看哪里 |
| --- | --- |
| 页面打不开 | `docker compose ps`；`docker compose logs --tail 100 caddy app` |
| 邮件没进来 | 看板顶部同步记录的提示；`docker compose logs app \| grep -i 同步` |
| 草稿没生成 / 很慢 | 设置 → 模型 点“测试”；草稿开了思考约 50 秒一封 |
| 回复发不出去 | 发送框里的错误提示；测试模式下收件人是否在白名单；设置 → 邮箱 测试连接 |
| 磁盘满 | `df -h`；`du -sh data/attachments backups`；`docker system df` |

日志由 Docker 自动轮转（每个容器最多 5 个 20 MB 文件），不打印请求和响应内容。
