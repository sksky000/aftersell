import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  /** JWT 签名密钥，至少 32 字符 */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少 32 字符'),
  /** 邮箱授权码加密密钥：32 字节，base64 编码（openssl rand -base64 32） */
  MAIL_SECRET_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'MAIL_SECRET_KEY 必须是 32 字节的 base64'),
  /** 允许连接的邮件服务器主机，逗号分隔 */
  MAIL_HOST_ALLOWLIST: z
    .string()
    .default('imap.exmail.qq.com,smtp.exmail.qq.com,hwimap.exmail.qq.com,hwsmtp.exmail.qq.com'),
  /** 首次启动且没有任何用户时创建的管理员 */
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_INITIAL_PASSWORD: z.string().min(10).optional(),
  /** 经 HTTPS 访问时为 true，cookie 带 Secure */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** 生产环境前端构建产物目录 */
  WEB_DIST_DIR: z.string().optional(),
  /** 附件存放目录（相对路径按工作目录解析）；容器内挂载为数据卷 */
  ATTACHMENT_DIR: z.string().default('data/attachments'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`环境变量配置错误：\n${issues}`);
  }
  return parsed.data;
}

export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

export function mailHostAllowlist(): string[] {
  return env()
    .MAIL_HOST_ALLOWLIST.split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}
