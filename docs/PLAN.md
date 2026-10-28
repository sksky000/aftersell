# 售后邮件 Agent · 开发方案（方案 B）

Oct 28, 2026 · @SK

自建部署在现有阿里云 ECS，保留飞书登录与台账；业务规则、词表、知识从妙搭版迁移，架构重写。第一阶段用测试邮箱 + DeepSeek 跑通“拉信 → 分类 → 草稿 → 审核 → 发送”核心闭环；模型、价格表、飞书 OAuth 做成可后接的配置项。

## 范围

第一阶段只做核心闭环，其他全部后置。判断标准：客服能否在新系统里完整处理一封真实客诉邮件。

| 做 | 不做（第二阶段起） |
| --- | --- |
| IMAP 拉取、幂等入库、线程归组、三组拉取开关 | 飞书 OAuth 登录（先用账号密码 + 角色） |
| 附件存储、图片 / PDF 识别 | 飞书台账同步 |
| 15 类分类 + 置信度 + 客户裁决覆盖 | 历史邮件学习管线（只迁 52 张已审批知识卡） |
| 阶段引擎、证据判定、说明书知识、规则引擎组装上下文 | 数据分析页（第二阶段，全量邮件入库后才有意义） |
| 草稿生成（DeepSeek，可切 Claude） | 视频理解 |
| 审核台：详情 / 线程 / SOP / 快捷话术 / 富文本 / 翻译 / 主题标签 | 风格记忆自动提炼（先做成可手编的条目表，自动提炼第二阶段） |
| SMTP 发送：幂等、线程头、引用块、CID 内嵌图、附件 | 价格表内容（表结构建好，内容等你定） |
| 设置页：邮箱、收款、风格条目、快捷话术、用户管理 | 批量导入历史邮件 |
| Docker Compose 一键部署、备份脚本 | 多邮箱账号 |

全程用测试邮箱。切到生产邮箱是第二阶段末的独立决策，切换当天关掉妙搭应用的同步开关，两边不同时消费同一个收件箱。

## 技术选型

原则：能复用的不换，换的只是妙搭绑定的那几层。

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 后端 | NestJS 10 + TypeScript（保留） | 规则引擎、邮件收发、线程逻辑是 TS，换语言等于重写全部 |
| 前端 | React 19 + Vite + Tailwind + shadcn（保留） | 页面 70% 可复用；去掉 @lark-apaas 依赖，补 DOMPurify 和统一 API 层 |
| ORM / 数据库 | Drizzle + PostgreSQL 16（保留 Drizzle） | schema.ts 可改造；自建库后补外键、枚举、迁移脚本 |
| 队列 | BullMQ + Redis 7（新增） | 把串行循环拆成 入库 / 识别 / 分类 / 草稿 四类任务，可重试可观察，重启不丢 |
| 定时 | BullMQ repeatable job（新增） | 替代妙搭触发器，配置在库里可改 |
| 邮件 | imapflow + mailparser + nodemailer（保留） | 不依赖妙搭，整体迁 |
| 模型 | 自建 LLMProvider 接口（新增） | DeepSeek / Anthropic / OpenAI-compatible 三个适配器 + mock |
| 附件 | 本地磁盘，Storage 接口（新增） | 后续换 OSS 只改一个适配器 |
| 认证 | 账号密码 + JWT + 角色（新增） | 飞书 OAuth 作为第二种登录方式第二阶段加入，用户表留 feishu\_open\_id 字段 |
| 校验 | zod（前后端共用 schema） | 替代现在的"TS 接口当校验" |
| 密钥 | 环境变量 + 授权码 AES-256-GCM | 密钥不进仓库，容器启动时注入 |
| 测试 | vitest + testcontainers | `npm test` 一条命令，规则引擎和阶段引擎带回归样本 |
| 部署 | Docker Compose | 一台 ECS，四个容器 |

不选的：K8s（规模不需要）、向量数据库（知识库按 category × partType × 车型 确定性匹配已够用，妙搭版也没用向量）、LangChain 类框架（流程是确定的，不需要 agent 编排）。

## 部署形态

&#91;embedded content: 部署：一台 ECS · 四个容器 · 两个数据卷\]

对外只开 443（审核台）。出站需要：exmail IMAP 993 / SMTP 465、DeepSeek API（国内直连）、后续 Anthropic API。授权码、模型 key、JWT 密钥、数据库密码全部在 ECS 上的 `.env`，不进仓库。备份：每日 pg\_dump + 附件卷 tar，保留 14 天，脚本随仓库交付。

## 模块迁移策略

三种处理：**直接迁**（改导入路径即可）、**重构**（逻辑保留、形态改变）、**新写**。

| 原模块 | 处理 | 说明 |
| --- | --- | --- |
| history-stage.ts 阶段引擎 | 直接迁 | 词表抽到配置表；回测脚本改成 vitest 回归 |
| evidence-state.ts 证据判定 | 直接迁 | 同上 |
| customer-info.ts / quote-strip.ts / follow-up-filter.ts / depothelp.ts / leader-forward.ts | 直接迁 | 纯函数；领导邮箱、热线地址改为配置 |
| case-association.ts / reply-reference.ts / learning-history-selection.ts | 直接迁 | 10-15 重构后的案件关联，带 44 条测试 |
| reply-quote.ts / subject-tagger.ts / inline-images.ts / reply-attachments.ts | 直接迁 | 发送格式层；存储调用换 Storage 接口 |
| mail-sync fetchUnreadMessages / resolveThreadId / pending-uids | 直接迁 | IMAP 拉取与线程归组逻辑 |
| manual-knowledge.ts 10 车型 | 重构 | 内容导入 product\_knowledge 表；匹配规则（型号码正则、关键词、互斥顺序、e-bike 守卫）保留为代码，但读表不读常量 |
| reply-context.ts 规则引擎 | 重构 | 见「规则引擎重构」节：正则和判定保留，注入文案进规则表 |
| case-reply-context.ts / cluster-knowledge.ts / draft-output.ts | 重构 | 并入上下文组装器；硬编码 $225 删除，读 price\_list |
| mailbox.service.ts | 重构 | 拆为 EmailQuery / DraftService / SendService / ThreadService / StatsService 五个 |
| mail-sync.service.ts 主循环 | 重构 | 拆成 BullMQ 任务：ingest → recognize → classify → draft，每步可独立重试 |
| image-recognition.ts | 重构 | 识别调用换 LLMProvider.vision；尝试状态从 attachments JSON 移到独立表 |
| post-send-learning.ts + learning-gateway + memory-repository + LearningReviewLab | 删除 | 623 行生产恒关闭的抽象；发送后写 correction 记录一行代码完成 |
| feishu-ledger / bike-model-aliases | 第二阶段 | 换飞书 OpenAPI，逻辑保留 |
| mail-learning L1-L7 | 不迁 | 只导 52 张已审批知识卡 |
| 12 个插件 prompt | 重写 | 按评审报告的三层结构重组；分类 / 识图 / 主题标签改 JSON schema 输出 |
| 前端 InboxPage / RepliedPage / AnalyticsPage / SettingsPage | 直接迁 | 去 @lark-apaas；API 层加统一实例和错误处理 |
| 前端 ReviewPage / ReplyPanel / rich-text-editor | 重构 | sanitize、状态提升、快捷键改为打开确认框、去全局变量 |
| 前端 sop-data.ts | 重构 | 快捷话术和 SOP 文案入库，前端读接口 |
| 认证 / 角色 / 用户管理 / 密钥管理 / 队列 / Storage / LLMProvider / Docker | 新写 |  |

## 数据模型

原 12 张表保留 7 张（补外键和枚举约束），学习管线 4 张不迁，新增 9 张。所有默认在代码里的业务事实都有了表。

| 表 | 来源 | 用途 | 关键约束 |
| --- | --- | --- | --- |
| email\_message | 保留 | 来信主表 | message\_id 唯一；category / status / urgency 改 enum |
| email\_reply | 保留 | 草稿与终稿 | email\_id 外键；新增 send\_idempotency\_key 唯一 |
| reply\_correction | 保留 | 人工修改记录 | email\_id 外键 |
| customer\_adjudication | 保留 | 客户级裁决 | lower(email)+fact\_type 唯一 |
| mailbox\_daily\_stats | 保留 | 收发趋势 | day 唯一 |
| email\_account | 保留 | 邮箱配置 | auth\_code AES-256-GCM，密钥来自环境变量；host 白名单校验 |
| learning\_cluster\_knowledge | 保留（只导数据） | 52 张知识卡 | 改名 knowledge\_card |
| users / roles | 新增 | 账号密码、角色（agent / supervisor / admin）、feishu\_open\_id 预留 | 邮箱唯一 |
| price\_list | 新增 | 车型 × 部件 → 价格、含运费、生效日期 | (model\_code, part\_type) 唯一；内容等你定 |
| product\_knowledge | 新增 | 10 车型说明书知识：型号码正则、关键词、排序、electric / noToolkit 标记、知识正文 | model\_code 唯一 |
| rule | 新增 | 规则引擎条目（见下节） | key 唯一 |
| rule\_hit | 新增 | 每次草稿生成命中了哪些规则 | email\_id + draft\_version |
| style\_rule | 新增 | 风格条目：scope（category / partType）、文案、来源案例、启用 | 替代单行 reply\_style\_memory |
| snippet | 新增 | 快捷话术和 SOP 文案 | 替代前端 sop-data.ts |
| setting | 新增 | 收款信息、签名、领导邮箱、热线地址、同步频率、模型槽位配置 | key 唯一 |
| llm\_call | 新增 | 每次模型调用：槽位、provider、模型、token、耗时、成本、输入哈希 | 用于成本统计和问题回放 |
| send\_log | 新增 | 每次 SMTP 发送：收件人、Message-ID、结果、操作人 | 审计 |

字段级改动：`missing_evidence` 从中文文案改为英文 code 数组（jsonb）；非我方产品从 summary 前缀改为 `is_our_product` 布尔；附件识别尝试状态从 attachments JSON 移到 attachment\_recognition 表。迁移脚本用 drizzle-kit，进仓库。

## 模型层

一个接口、六个任务槽位、三个适配器。槽位到模型的映射存 setting 表，设置页可改，不用改代码。

```typescript
interface LLMProvider {
  generate(req: { system: string; messages: Message[]; maxTokens: number; temperature: number }): Promise<TextResult>;
  extract<T>(req: { system: string; messages: Message[]; schema: ZodSchema<T> }): Promise<T>;   // 强制 JSON
  vision(req: { prompt: string; images: ImageInput[] }): Promise<TextResult>;
}
```

| 槽位 | 用途 | 第一阶段 | 建议最终 |
| --- | --- | --- | --- |
| classify | 15 类分类 + partType + 置信度 + 缺失证据 + isOurProduct | deepseek-chat | Claude Haiku |
| draft | 英文回复草稿 | deepseek-chat | Claude Sonnet；升级件 Opus |
| vision | 图片理解 | DeepSeek 视觉模型（若可用）或 mock | Claude Sonnet |
| pdf | PDF 文本提取 | 本地 pdf-parse，不走模型 | 同左 |
| subject\_tag | 主题标签 | deepseek-chat | Haiku |
| translate | 英→中 | deepseek-chat | Haiku |

适配器：`DeepSeekProvider`（OpenAI 兼容，JSON mode）、`AnthropicProvider`（tool\_use 强制 schema）、`MockProvider`（测试和无 key 时用，返回固定结果）。`extract` 用 zod 校验输出，失败自动重试一次并把错误回馈给模型，再失败走兑底分类（category=other，标记待人工）。每次调用写 llm\_call 表。

Prompt 管理：system prompt 作为仓库里的 markdown 文件（每个槽位一个），版本随代码；业务事实（价格、收款、知识、风格条目）全部由代码从表里读出、用 XML 标签包好放进 user turn。客户邮件正文用 `<email>` 标签隔离，防 prompt injection。

DeepSeek 和 Claude 的差异处理：DeepSeek 对长系统提示的遵循度弱一些，第一阶段会保留妙搭版里部分“do NOT”式护栏；切 Claude 后可删。生成后的确定性检查（重复索证、编造价格、签名格式）不依赖模型，两边都跑。

## 规则引擎重构

把 `buildReplyContext` 的 300 行 if/else 拆成三件事：**信号提取**（代码）、**规则表**（数据）、**评估器**（代码，通用）。妙搭版的每一条判断和每一段注入文案都会原样迁进来，只是形态变了。

**信号提取**：对每封邮件算出一个结构化的 `CaseSignals`：category、partType、stage（阶段引擎）、evidence（证据引擎）、isPurchaseFlow、needsVideoOnly、modelKnown、isWalmartStore、isLeaderForward、isForeignProduct、explicitStatements（无收据 / 二手 / 无万用表）、matchedModel、delayDays、hasVideo 等。这层就是现在那些正则，正则本身存 setting 表可调。

**规则表** `rule`，每行：

| 字段 | 含义 | 例 |
| --- | --- | --- |
| key | 唯一标识 | `evidence.purchase_flow.battery` |
| when | 对 CaseSignals 的条件表达式（JSON logic） | `{"and":[{"==":["isPurchaseFlow",true]},{"==":["partType","battery"]},{"==":["modelKnown",true]}]}` |
| slot | 注入到 prompt 的哪个槽 | evidence\_policy / action / business\_fact / part\_knowledge / channel |
| priority | 同槽多条命中时谁赢 | 90 |
| exclusive | 命中后是否压掉同槽其他规则 | true（对应现在的 OVERRIDES） |
| text | 注入文案（可带占位符） | “Evidence policy: the customer is PURCHASING a battery…” |
| source | 来源案例 / 日期 | 案例 C1 2026-10-09 |
| enabled | 开关 |  |

**评估器**：按槽位分组 → 按 priority 排序 → 逐条求值 when → 遇 exclusive 停止 → 拼装各槽文案 → 写 rule\_hit。通用代码，不含业务。

得到的好处：审核台上每封草稿旁边能展开“命中了哪 6 条规则”；改一条口径在设置页改 text 或 priority，不发版；新增规则先 enabled=false 在历史邮件上跑命中率再开；两条规则打架有数字可看。

初始规则集从 reply-context.ts / case-reply-context.ts / history-stage.ts STAGE\_HANDLING / PART\_KNOWLEDGE / BUSINESS\_FACTS / ACTION\_BY\_CATEGORY 逐条搬，预计 60-80 条，每条带 source 回溯到 AGENTS.md 里的案例。迁完后用妙搭版的 fix-test 案例（6 个历史案例，客户姓名见本地 docs/private）做一致性回归：同一封邮件两边生成的 prompt 槽位内容必须一致。

## 分阶段计划与验收

每个里程碑都有一个你能自己操作验证的结果，不是“代码写完了”。每个里程碑完成时我部署到你的 ECS，你在浏览器里验。

| 里程碑 | 内容 | 你能验证的结果 | 前置 |
| --- | --- | --- | --- |
| M0 骨架 | 仓库、Docker Compose、数据库迁移、账号密码登录、角色、设置页邮箱配置 + 连接测试 | 在 ECS 上登录审核台，填测试邮箱，连接测试通过 | GitHub 仓库、ECS 升配 + SSH 访问、测试邮箱 |
| M1 拉信入库 | IMAP 拉取队列、幂等入库、线程归组、附件落盘、三组开关、看板列表 | 往测试邮箱发 5 封邮件（含图片、PDF、一封 Re:），看板全部出现、重复拉取不重复 | M0 |
| M2 理解 | LLMProvider + DeepSeek 适配器、图片 / PDF 识别、分类（JSON schema）、客户裁决、置信度 | 同一批邮件分类正确，图片识别结果在审核台可见 | DeepSeek key |
| M3 生成 | 阶段引擎、证据引擎、规则表迁移、说明书知识入库、知识卡导入、草稿生成、命中规则展示 | 用妙搭版 6 个历史案例回归：草稿行为与人工终稿同构 | 52 张知识卡、12 条风格条目、裁决表导出 |
| M4 审核发送 | 审核台全功能（富文本 / 快捷话术 / SOP / 翻译 / 主题标签 / 线程）、幂等发送、引用块、CID 图、附件、发送后 correction 记录 | 对 M1 的 5 封邮件完整回复，在收件方邮箱看到线程归组正确、图片完整；连点两次发送只发一封 | M3 |
| M5 收尾 | 已回复页、删除、备份脚本、部署文档、`npm test` 全绿、安全自检（密钥不在仓库、host 白名单、sanitize） | 你按文档从零在 ECS 上重新部署一遍能成功 | M4 |

第二阶段（M5 验收后再排）：飞书 OAuth、飞书台账、数据分析页、风格自动提炼、Claude 适配器切换、生产邮箱并行试跑。

工作方式：我在这个会话里开发、推 GitHub；部署通过你电脑上的 SSH 连 ECS（会话已链接你的电脑），或你在 ECS 上跑一条 `git pull && docker compose up -d`。每个里程碑完成我给你一条消息说怎么验，你验完回一句“过”或问题列表。

## 你需要准备的清单与待定项

按需要的先后顺序排，前四项到位就能开 M0。

- [ ] GitHub 空仓库（私有），把仓库地址给我；我会通过这个会话的 GitHub 连接推代码
- [ ] ECS 升配到 4核8G，确认系统版本和剩余磁盘（建议 ≥ 40 GB 可用），装 Docker + Docker Compose
- [ ] ECS 的 SSH 访问方式（你电脑上已配好的密钥，或你自己执行部署命令）
- [ ] exmail 测试账号：地址 + 客户端专用密码，开启 IMAP/SMTP
- [ ] DeepSeek API key（M2 前）
- [ ] 从妙搭导出三张表的数据（M3 前）：`learning_cluster_knowledge`（只要 status=approved）、`reply_style_memory`、`customer_adjudication`。SQL 或 CSV 都行，不要导 `email_account`
- [ ] 在 exmail 后台重置生产邮箱的客户端专用密码（与本项目无关，但建议尽快；妙搭应用设置页换新码即可）

待定项（不阻塞第一阶段）：

| 事项 | 现状 | 什么时候要 |
| --- | --- | --- |
| 价格表内容 | 表结构建好，为空时草稿写“we will confirm the price” | M4 前给我一份，或你在设置页自己填 |
| 最终模型（DeepSeek / Claude） | 槽位可切，第一阶段 DeepSeek | 第二阶段接 Claude 时要 key 和网络方式 |
| 规则冲突裁决：草稿词数、落款语言、safety 口径 | 妙搭版 prompt 内部矛盾 | M3 写 prompt 时我会列出来问你 |
| 飞书自建应用（OAuth + Bitable 权限） | 第二阶段 | 到时我给申请清单 |
| 历史邮件要不要导入新库 | 不导 | 生产切换前再定 |

你确认这份方案后，我从 M0 开始。
