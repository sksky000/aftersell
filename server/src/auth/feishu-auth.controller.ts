import { Controller, Get, Logger, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { FeishuLoginInfo } from '@aftersell/shared';
import { env } from '../config/env';
import { describeFeishuError, FeishuService } from '../feishu/feishu.service';
import { SESSION_COOKIE } from './auth.guard';
import { cookieOptions } from './auth.controller';
import { AuthService } from './auth.service';
import { Public } from './decorators';

const STATE_COOKIE = 'fs_state';
const STATE_TTL_MS = 10 * 60 * 1000;
const AUTHORIZE_URL = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';

function callbackUrl(req: Request): string {
  // 前面有 Caddy（trust proxy），protocol / host 是浏览器实际访问的地址，须与飞书后台配置的重定向地址一致
  return `${req.protocol}://${req.get('host')}/api/auth/feishu/callback`;
}

/** 飞书网页登录（OAuth 授权码）：只用来确认是谁，账号仍由管理员创建 */
@Controller('auth/feishu')
export class FeishuAuthController {
  private readonly logger = new Logger(FeishuAuthController.name);

  constructor(
    private readonly feishu: FeishuService,
    private readonly auth: AuthService,
  ) {}

  @Public()
  @Get('info')
  async info(): Promise<FeishuLoginInfo> {
    return { enabled: await this.feishu.loginEnabled() };
  }

  @Public()
  @Get('login')
  async login(@Req() req: Request, @Res() res: Response): Promise<void> {
    const creds = (await this.feishu.loginEnabled()) ? await this.feishu.credentials() : null;
    if (!creds) return res.redirect(`/login?error=${encodeURIComponent('飞书登录未开启')}`);
    const state = randomBytes(16).toString('hex');
    // 回调是从飞书跳回来的顶层导航，用 lax 才带得上
    res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure: env().COOKIE_SECURE, path: '/api/auth/feishu', maxAge: STATE_TTL_MS });
    const params = new URLSearchParams({ client_id: creds.appId, redirect_uri: callbackUrl(req), state });
    res.redirect(`${AUTHORIZE_URL}?${params}`);
  }

  @Public()
  @Get('callback')
  async callback(@Req() req: Request, @Res() res: Response, @Query('code') code?: string, @Query('state') state?: string): Promise<void> {
    const fail = (message: string) => res.redirect(`/login?error=${encodeURIComponent(message)}`);
    const expected = (req.cookies as Record<string, string | undefined>)[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, { path: '/api/auth/feishu' });
    if (!code) return fail('飞书没有返回授权码，请重试');
    if (!state || !expected || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
      return fail('登录已过期，请重新点击“飞书登录”');
    }
    try {
      const creds = await this.feishu.credentials();
      if (!creds || !(await this.feishu.loginEnabled())) return fail('飞书登录未开启');
      const tokenRes = await this.feishu.call<{ access_token: string }>('/authen/v2/oauth/token', {
        body: { grant_type: 'authorization_code', client_id: creds.appId, client_secret: creds.appSecret, code, redirect_uri: callbackUrl(req) },
      });
      const info = await this.feishu.call<{ open_id: string; name?: string; email?: string; enterprise_email?: string }>('/authen/v1/user_info', {
        token: tokenRes.access_token,
      });
      const emails = [...new Set([info.enterprise_email, info.email].filter((e): e is string => Boolean(e)).map((e) => e.toLowerCase()))];
      const { user, token } = await this.auth.loginWithFeishu(info.open_id, emails);
      this.logger.log(`飞书登录 user=${user.id}`);
      res.cookie(SESSION_COOKIE, token, cookieOptions());
      res.redirect('/');
    } catch (error) {
      const message = error instanceof UnauthorizedException ? error.message : describeFeishuError(error);
      this.logger.warn(`飞书登录失败: ${message}`);
      fail(message);
    }
  }
}
