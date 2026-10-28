import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  ADJUDICATION_FACTS,
  CATEGORIES,
  LLM_SLOTS,
  type ClassifyDetail,
  type MissingEvidence,
  DEFAULT_SYNC_INTERVAL_MINUTES,
  EMAIL_STATUSES,
  EVIDENCE_STATUSES,
  PART_TYPES,
  PIPELINE_STATES,
  ROLES,
  SYNC_RUN_STATUSES,
  SYNC_TRIGGERS,
  URGENCIES,
} from '@aftersell/shared';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const userRole = pgEnum('user_role', ROLES);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('agent'),
    isActive: boolean('is_active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    /** 改密码、停用、改角色时自增，让旧 token 失效 */
    tokenVersion: integer('token_version').notNull().default(0),
    /** 第二阶段飞书 OAuth 预留 */
    feishuOpenId: varchar('feishu_open_id', { length: 128 }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
    uniqueIndex('users_feishu_open_id_uq').on(t.feishuOpenId),
  ],
);

/** 邮箱配置；第一阶段只有一行（单邮箱） */
export const emailAccount = pgTable('email_account', {
  id: uuid('id').primaryKey().defaultRandom(),
  emailAddress: varchar('email_address', { length: 255 }).notNull(),
  /** AES-256-GCM 密文，密钥来自环境变量 MAIL_SECRET_KEY */
  authCodeCipher: text('auth_code_cipher').notNull(),
  imapHost: varchar('imap_host', { length: 255 }).notNull(),
  imapPort: integer('imap_port').notNull(),
  smtpHost: varchar('smtp_host', { length: 255 }).notNull(),
  smtpPort: integer('smtp_port').notNull(),
  syncEnabled: boolean('sync_enabled').notNull().default(false),
  keepUnread: boolean('keep_unread').notNull().default(true),
  hotlineOnly: boolean('hotline_only').notNull().default(false),
  registrationOnly: boolean('registration_only').notNull().default(false),
  firstContactOnly: boolean('first_contact_only').notNull().default(false),
  maxPerRun: integer('max_per_run').notNull().default(20),
  syncIntervalMinutes: integer('sync_interval_minutes').notNull().default(DEFAULT_SYNC_INTERVAL_MINUTES),
  syncDateFrom: date('sync_date_from'),
  syncDateTo: date('sync_date_to'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

/** 业务配置键值：收款信息、签名、领导邮箱、热线地址、同步频率、模型槽位等 */
export const setting = pgTable('setting', {
  key: varchar('key', { length: 128 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const urgencyEnum = pgEnum('urgency', URGENCIES);
export const partTypeEnum = pgEnum('part_type', PART_TYPES);
export const categoryEnum = pgEnum('category', CATEGORIES);
export const emailStatusEnum = pgEnum('email_status', EMAIL_STATUSES);
export const evidenceStatusEnum = pgEnum('evidence_status', EVIDENCE_STATUSES);
export const pipelineStateEnum = pgEnum('pipeline_state', PIPELINE_STATES);
export const syncTriggerEnum = pgEnum('sync_trigger', SYNC_TRIGGERS);
export const syncRunStatusEnum = pgEnum('sync_run_status', SYNC_RUN_STATUSES);

/** 来信主表；message_id 唯一保证重复拉取不重复入库 */
export const emailMessage = pgTable(
  'email_message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 原样保存（含尖括号）；邮件头缺失时为 <no-id-…@aftersell.local> */
    messageId: varchar('message_id', { length: 998 }).notNull(),
    subject: text('subject'),
    fromAddress: varchar('from_address', { length: 320 }),
    fromName: varchar('from_name', { length: 255 }),
    replyTo: varchar('reply_to', { length: 320 }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    bodyText: text('body_text').notNull().default(''),
    bodyHtml: text('body_html'),
    inReplyTo: varchar('in_reply_to', { length: 998 }),
    refChain: text('ref_chain'),
    /** 同一案件的锚点 message_id；无法确定归属时为空，由人工判断 */
    threadId: varchar('thread_id', { length: 998 }),
    /** 主题 Re: / 正文含引用块 / 有 In-Reply-To / 已归入已有线程 */
    isFollowUp: boolean('is_follow_up').notNull().default(false),
    status: emailStatusEnum('status').notNull().default('pending_review'),
    pipelineState: pipelineStateEnum('pipeline_state').notNull().default('ingested'),
    pipelineError: text('pipeline_error'),
    // 以下为 M2 分类结果
    urgency: urgencyEnum('urgency').notNull().default('normal'),
    partType: partTypeEnum('part_type').notNull().default('other'),
    category: categoryEnum('category').notNull().default('other'),
    summary: text('summary'),
    isComplaint: boolean('is_complaint').notNull().default(true),
    isOurProduct: boolean('is_our_product').notNull().default(true),
    language: varchar('language', { length: 16 }).notNull().default('en'),
    evidenceStatus: evidenceStatusEnum('evidence_status').notNull().default('unknown'),
    /** 缺失凭证的英文 code 数组 */
    missingEvidence: jsonb('missing_evidence').$type<MissingEvidence[]>().notNull().default([]),
    isSafetyHazard: boolean('is_safety_hazard').notNull().default(false),
    /** 分类置信度 0-100 */
    confidence: integer('confidence'),
    classifyDetail: jsonb('classify_detail').$type<ClassifyDetail>(),
    /** M3 草稿置信度 */
    draftConfidence: integer('draft_confidence'),
    classifiedAt: timestamp('classified_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('email_message_message_id_uq').on(t.messageId),
    index('email_message_status_idx').on(t.status),
    index('email_message_from_lower_idx').on(sql`lower(${t.fromAddress})`),
    index('email_message_received_at_idx').on(t.receivedAt),
    index('email_message_thread_id_idx').on(t.threadId),
    index('email_message_in_reply_to_idx').on(t.inReplyTo),
  ],
);

/** 来信附件；文件按内容 sha256 存放，相同内容只存一份 */
export const emailAttachment = pgTable(
  'email_attachment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    emailId: uuid('email_id')
      .notNull()
      .references(() => emailMessage.id, { onDelete: 'cascade' }),
    /** 在原邮件中的顺序 */
    position: integer('position').notNull(),
    filename: varchar('filename', { length: 255 }).notNull(),
    contentType: varchar('content_type', { length: 127 }).notNull(),
    size: integer('size').notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    storageKey: varchar('storage_key', { length: 255 }).notNull(),
    /** 正文内嵌图片的 Content-ID（不含尖括号） */
    contentId: varchar('content_id', { length: 998 }),
    isInline: boolean('is_inline').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('email_attachment_email_id_idx').on(t.emailId, t.position)],
);

/** 每次同步的记录，用于看板显示与排查 */
export const syncRun = pgTable(
  'sync_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trigger: syncTriggerEnum('trigger').notNull(),
    status: syncRunStatusEnum('status').notNull().default('running'),
    triggeredBy: uuid('triggered_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    fetched: integer('fetched').notNull().default(0),
    inserted: integer('inserted').notNull().default(0),
    duplicates: integer('duplicates').notNull().default(0),
    filtered: integer('filtered').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    message: text('message').notNull().default(''),
  },
  (t) => [index('sync_run_started_at_idx').on(t.startedAt)],
);

export const recognitionStatusEnum = pgEnum('recognition_status', ['succeeded', 'failed', 'unsupported']);
export const adjudicationFactEnum = pgEnum('adjudication_fact', ADJUDICATION_FACTS);
export const llmSlotEnum = pgEnum('llm_slot', LLM_SLOTS);

/**
 * 附件内容识别结果，按文件 sha256 存一份：同一张图在跟进邮件里再出现不会重复调用模型。
 * 每次调用前先记一次尝试，失败最多重试 3 次。
 */
export const attachmentRecognition = pgTable('attachment_recognition', {
  sha256: char('sha256', { length: 64 }).primaryKey(),
  status: recognitionStatusEnum('status').notNull(),
  attempts: integer('attempts').notNull().default(0),
  text: text('text'),
  /** 失败原因 code，界面翻译为中文 */
  reason: varchar('reason', { length: 64 }),
  provider: varchar('provider', { length: 32 }),
  model: varchar('model', { length: 100 }),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 客户级裁决：人工确认的事实，分类时覆盖模型判断 */
export const customerAdjudication = pgTable(
  'customer_adjudication',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerEmail: varchar('customer_email', { length: 320 }).notNull(),
    factType: adjudicationFactEnum('fact_type').notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('customer_adjudication_email_fact_uq').on(sql`lower(${t.customerEmail})`, t.factType)],
);

/** 每次模型调用：用于成本统计与问题回放（不存原文，只存输入摘要哈希） */
export const llmCall = pgTable(
  'llm_call',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slot: llmSlotEnum('slot').notNull(),
    provider: varchar('provider', { length: 32 }).notNull(),
    model: varchar('model', { length: 100 }).notNull(),
    emailId: uuid('email_id').references(() => emailMessage.id, { onDelete: 'set null' }),
    ok: boolean('ok').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    durationMs: integer('duration_ms').notNull(),
    inputHash: char('input_hash', { length: 64 }).notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('llm_call_created_at_idx').on(t.createdAt), index('llm_call_email_id_idx').on(t.emailId)],
);

export type UserRow = typeof users.$inferSelect;
export type AttachmentRecognitionRow = typeof attachmentRecognition.$inferSelect;
export type CustomerAdjudicationRow = typeof customerAdjudication.$inferSelect;
export type EmailAccountRow = typeof emailAccount.$inferSelect;
export type EmailMessageRow = typeof emailMessage.$inferSelect;
export type EmailAttachmentRow = typeof emailAttachment.$inferSelect;
export type SyncRunRow = typeof syncRun.$inferSelect;
