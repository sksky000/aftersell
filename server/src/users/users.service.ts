import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import type { CreateUserRequest, UpdateUserRequest, UserDto } from '@aftersell/shared';
import { env } from '../config/env';
import { hashPassword } from '../common/password';
import { DB, type Database } from '../db/db.module';
import { users, type UserRow } from '../db/schema';

export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  /** 库里没有任何用户时，用 ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD 建第一个管理员（首次登录须改密） */
  async onApplicationBootstrap(): Promise<void> {
    const [{ value }] = await this.db.select({ value: count() }).from(users);
    if (value > 0) return;
    const { ADMIN_EMAIL, ADMIN_INITIAL_PASSWORD } = env();
    if (!ADMIN_EMAIL || !ADMIN_INITIAL_PASSWORD) {
      this.logger.warn('库中没有用户，且未配置 ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD，无法登录');
      return;
    }
    await this.db.insert(users).values({
      email: ADMIN_EMAIL.toLowerCase(),
      name: '管理员',
      role: 'admin',
      passwordHash: await hashPassword(ADMIN_INITIAL_PASSWORD),
      mustChangePassword: true,
    });
    this.logger.log(`已创建初始管理员 ${ADMIN_EMAIL}`);
  }

  async findByEmail(email: string): Promise<UserRow | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
      .limit(1);
    return row;
  }

  async findById(id: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  }

  async list(): Promise<UserDto[]> {
    const rows = await this.db.select().from(users).orderBy(asc(users.createdAt));
    return rows.map(toUserDto);
  }

  async create(dto: CreateUserRequest): Promise<UserDto> {
    if (await this.findByEmail(dto.email)) throw new ConflictException('该邮箱已存在');
    const [row] = await this.db
      .insert(users)
      .values({
        email: dto.email,
        name: dto.name,
        role: dto.role,
        passwordHash: await hashPassword(dto.password),
        mustChangePassword: true,
      })
      .returning();
    return toUserDto(row);
  }

  async update(actorId: string, id: string, dto: UpdateUserRequest): Promise<UserDto> {
    const current = await this.findById(id);
    if (!current) throw new NotFoundException('用户不存在');

    const losesAdmin =
      current.role === 'admin' &&
      current.isActive &&
      ((dto.role !== undefined && dto.role !== 'admin') || dto.isActive === false);
    if (losesAdmin) {
      if (actorId === id) throw new BadRequestException('不能取消自己的管理员身份或停用自己');
      const [{ value }] = await this.db
        .select({ value: count() })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true), ne(users.id, id)));
      if (value === 0) throw new BadRequestException('至少要保留一个启用的管理员');
    }

    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    let invalidateSessions = false;
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.role !== undefined && dto.role !== current.role) {
      patch.role = dto.role;
      invalidateSessions = true;
    }
    if (dto.isActive !== undefined && dto.isActive !== current.isActive) {
      patch.isActive = dto.isActive;
      invalidateSessions = true;
    }
    if (dto.password !== undefined) {
      patch.passwordHash = await hashPassword(dto.password);
      patch.mustChangePassword = true;
      invalidateSessions = true;
    }
    if (invalidateSessions) patch.tokenVersion = current.tokenVersion + 1;

    const [row] = await this.db.update(users).set(patch).where(eq(users.id, id)).returning();
    return toUserDto(row);
  }
}
