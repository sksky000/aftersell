# 售后邮件 Agent

凤凰售后邮件自动分类、草稿生成、人工审核发送平台。开发方案见 [docs/PLAN.md](docs/PLAN.md)。

当前进度：**M0 骨架**——账号密码登录、三级角色、用户管理、邮箱配置（授权码 AES-256-GCM 加密 + 主机白名单）+ 连接测试、Docker Compose 部署。

## 本地开发

需要 Node 22+，以及本地或 docker 里的 PostgreSQL 16 和 Redis 7。

```bash
npm install
cp .env.example .env   # 填 DATABASE_URL / REDIS_URL / 密钥，COOKIE_SECURE=false
npm run build -w shared
npm run dev:server     # :3000，启动时自动跑数据库迁移
npm run dev:web        # :5173，/api 代理到 :3000
npm test
```

改了 `server/src/db/schema.ts` 后运行 `npm run db:generate -w server`，把生成的 `server/drizzle/*.sql` 一起提交。

## 部署（ECS）

服务器需要 Docker + Docker Compose，安全组放行 80 / 443。

首次：

```bash
git clone https://github.com/sksky000/aftersell /srv/aftersell
cd /srv/aftersell
deploy/init-env.sh https://<服务器IP或域名> <管理员登录邮箱>   # 生成 .env 与随机密钥
mkdir -p data/attachments && chown 1000:1000 data/attachments
docker compose up -d --build
```

初始管理员密码在服务器 `.env` 的 `ADMIN_INITIAL_PASSWORD`，首次登录后强制修改。

更新：`deploy/deploy.sh`（git pull + 重建 + 重启，数据不受影响）。

只有 IP 时 Caddy 使用自签证书，浏览器会提示"不安全"，选择继续访问即可；有域名后把 `SITE_ADDRESS` 改成域名、`TLS_ISSUER` 改成邮箱，自动申请正式证书。

## 角色

| 角色 | 权限 |
| --- | --- |
| 客服 agent | 处理邮件（M1 起） |
| 主管 supervisor | 另可查看邮箱配置 |
| 管理员 admin | 另可修改邮箱配置、测试连接、管理用户 |

## 安全约定

- 所有密钥只在服务器 `.env`；`legacy/`（妙搭旧代码）和 `docs/private/` 不进仓库
- 邮件服务器主机必须在 `MAIL_HOST_ALLOWLIST` 内，防止把授权码发往任意主机
- 日志不记录请求 / 响应体
