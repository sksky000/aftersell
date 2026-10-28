# 售后邮件 Agent

- 开发方案在 docs/PLAN.md，按 M0→M5 里程碑推进，每个里程碑完成后停下来等验收
- legacy/ 是妙搭旧代码，只读参考（已 gitignore，不进仓库），按 docs/PLAN.md 的"模块迁移策略"表决定直接迁/重构/删除
- 部署密钥（数据库口令、JWT_SECRET、MAIL_SECRET_KEY）只放服务器 .env；模型 API key、邮箱授权码由管理员在设置页填写，用 MAIL_SECRET_KEY 做 AES-256-GCM 加密入库，接口只返回末 4 位；任何密钥都不进仓库
- 不碰生产邮箱
- 仓库是公开的：任何客户数据、收款信息、邮箱地址样本、评审报告都不能提交

## 结构

- `shared/` zod schema 与类型，前后端共用（server 用编译产物，web 直接引源码）
- `server/` NestJS 10 + Drizzle + PostgreSQL；启动时自动跑 `server/drizzle/` 迁移
  - `src/mail/` 从妙搭直接迁来的纯函数（案件归组、热线、转发、引用剥离），带 vitest 回归；热线 / 领导地址经 `sender-directory` 从设置读取，不写死在代码里
  - `src/mail-sync/` BullMQ 拉信队列（worker 并发 1）+ 幂等入库；`src/emails/` 看板与详情接口；`src/storage/` 附件存储接口（本地磁盘，按 sha256 寻址）
  - `src/llm/` 模型层：槽位配置存 setting 表，适配器按 .env 的 key 创建，每次调用写 llm_call；`prompts/` 下是各槽位 system prompt，客户邮件放在 user turn 的 `<email>` 标签里
  - `src/pipeline/` 处理队列：识图 / PDF 提取 → 分类 → 确定性后处理（`finalizeClassification`）→ 客户裁决覆盖 → 草稿任务
  - `src/reply/` 草稿：阶段引擎 / 证据引擎（妙搭原样迁移）→ `signals.ts` 算 CaseSignals → `rule` 表（JSON logic 条件 + 文案，种子在 `rules.seed.ts`，启动只补缺不覆盖）→ `context.ts` 拼上下文 → `draft-output.ts` 落款 / 地址块 / 检查
  - `src/knowledge/` 说明书知识（种子由妙搭导出）、知识卡、风格条目、价格表、收款信息；业务数据只在库里，不写进代码
- `web/` React 19 + Vite + Tailwind v4 + shadcn 组件；生产构建由 server 静态托管
- `deploy/` Caddyfile、部署脚本

## 常用命令

- `npm install` / `npm run build` / `npm test`
- 改了 `server/src/db/schema.ts` 后：`npm run db:generate -w server` 生成迁移并提交
- 部署：`deploy/deploy.sh`（在 ECS 上 git pull + docker compose up -d --build）

## 约定

- 所有接口入参用 shared 里的 zod schema 经 `ZodBody` 校验，不用 TS 接口当校验
- 权限：`@Roles('admin')` 等；未标注的接口默认需要登录，`@Public()` 显式放行
- 日志不打印请求/响应体
