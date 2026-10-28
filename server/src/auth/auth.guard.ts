import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { hasRole, type Role } from '@aftersell/shared';
import { DB, type Database } from '../db/db.module';
import { users } from '../db/schema';
import { ALLOW_PENDING_PASSWORD, IS_PUBLIC, REQUIRED_ROLE, type AuthUser } from './decorators';

export const SESSION_COOKIE = 'as_session';

export interface SessionPayload {
  sub: string;
  tv: number;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) throw new UnauthorizedException('请先登录');

    let payload: SessionPayload;
    try {
      payload = await this.jwt.verifyAsync<SessionPayload>(token);
    } catch {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    // 每次请求读库：停用、改角色、改密码立即生效
    const [row] = await this.db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    if (!row || !row.isActive || row.tokenVersion !== payload.tv) {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }

    req.user = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      mustChangePassword: row.mustChangePassword,
    };

    if (row.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, targets)) {
      throw new ForbiddenException('请先修改初始密码');
    }

    const required = this.reflector.getAllAndOverride<Role | undefined>(REQUIRED_ROLE, targets);
    if (required && !hasRole(row.role, required)) {
      throw new ForbiddenException('没有权限执行此操作');
    }
    return true;
  }
}
