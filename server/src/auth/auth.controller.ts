import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  type ChangePasswordRequest,
  type LoginRequest,
  type UserDto,
} from '@aftersell/shared';
import { env } from '../config/env';
import { ZodBody } from '../common/zod-body';
import { UsersService, toUserDto } from '../users/users.service';
import { SESSION_COOKIE } from './auth.guard';
import { AuthService } from './auth.service';
import { AllowPendingPassword, CurrentUser, Public, type AuthUser } from './decorators';

export const SESSION_TTL_SECONDS = 7 * 24 * 3600;

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: env().COOKIE_SECURE,
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @ZodBody(loginSchema) dto: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserDto> {
    const { user, token } = await this.auth.login(dto, req.ip ?? 'unknown');
    res.cookie(SESSION_COOKIE, token, cookieOptions());
    return user;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
  }

  @AllowPendingPassword()
  @Get('me')
  async me(@CurrentUser() user: AuthUser): Promise<UserDto> {
    const row = await this.users.findById(user.id);
    return toUserDto(row!);
  }

  @AllowPendingPassword()
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @ZodBody(changePasswordSchema) dto: ChangePasswordRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserDto> {
    const result = await this.auth.changePassword(user.id, dto);
    res.cookie(SESSION_COOKIE, result.token, cookieOptions());
    return result.user;
  }
}
