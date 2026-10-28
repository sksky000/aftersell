import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import type { ChangePasswordRequest, LoginRequest, UserDto } from '@aftersell/shared';
import { LoginThrottle } from '../common/login-throttle';
import { hashPassword, verifyPassword } from '../common/password';
import { DB, type Database } from '../db/db.module';
import { users } from '../db/schema';
import { toUserDto, UsersService } from '../users/users.service';
import type { SessionPayload } from './auth.guard';

// 用户不存在时也做一次等耗时的校验，避免通过响应时间探测邮箱是否存在
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

@Injectable()
export class AuthService {
  private readonly throttle = new LoginThrottle();

  constructor(
    private readonly usersService: UsersService,
    private readonly jwt: JwtService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async login(dto: LoginRequest, ip: string): Promise<{ user: UserDto; token: string }> {
    const keys = [`email:${dto.email}`, `ip:${ip}`];
    const locked = Math.max(...keys.map((k) => this.throttle.lockedFor(k)));
    if (locked > 0) {
      throw new HttpException(`登录失败次数过多，请 ${Math.ceil(locked / 60)} 分钟后再试`, HttpStatus.TOO_MANY_REQUESTS);
    }

    const row = await this.usersService.findByEmail(dto.email);
    const ok = row ? await verifyPassword(dto.password, row.passwordHash) : await verifyPassword(dto.password, await DUMMY_HASH);
    if (!row || !ok || !row.isActive) {
      keys.forEach((k) => this.throttle.recordFailure(k));
      throw new UnauthorizedException('邮箱或密码错误');
    }
    keys.forEach((k) => this.throttle.reset(k));

    const [updated] = await this.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, row.id))
      .returning();
    const payload: SessionPayload = { sub: row.id, tv: row.tokenVersion };
    return { user: toUserDto(updated), token: await this.jwt.signAsync(payload) };
  }

  async changePassword(userId: string, dto: ChangePasswordRequest): Promise<{ user: UserDto; token: string }> {
    const row = await this.usersService.findById(userId);
    if (!row) throw new UnauthorizedException();
    if (!(await verifyPassword(dto.currentPassword, row.passwordHash))) {
      throw new BadRequestException('当前密码不正确');
    }
    if (dto.currentPassword === dto.newPassword) throw new BadRequestException('新密码不能与当前密码相同');

    const [updated] = await this.db
      .update(users)
      .set({
        passwordHash: await hashPassword(dto.newPassword),
        mustChangePassword: false,
        tokenVersion: row.tokenVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    // 其他设备的会话全部失效，当前设备换发新 token
    const payload: SessionPayload = { sub: updated.id, tv: updated.tokenVersion };
    return { user: toUserDto(updated), token: await this.jwt.signAsync(payload) };
  }
}
