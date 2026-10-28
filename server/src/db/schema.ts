import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
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
import { ROLES } from '@aftersell/shared';

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

export type UserRow = typeof users.$inferSelect;
export type EmailAccountRow = typeof emailAccount.$inferSelect;
