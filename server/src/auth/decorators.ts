import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@aftersell/shared';

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_ROLE = 'auth:role';
export const ALLOW_PENDING_PASSWORD = 'auth:allowPendingPassword';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
}

/** 不需要登录 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** 最低角色要求；高等级角色自动满足 */
export const Roles = (role: Role) => SetMetadata(REQUIRED_ROLE, role);

/** 用户处于"必须修改密码"状态时仍可访问（me / 改密码 / 登出） */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
