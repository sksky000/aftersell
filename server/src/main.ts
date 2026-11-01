import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { env } from './config/env';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const config = env(); // 启动即校验环境变量，缺项直接退出
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: config.NODE_ENV === 'production' ? ['log', 'warn', 'error'] : undefined,
  });
  app.set('trust proxy', 1); // 前面有 Caddy
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          upgradeInsecureRequests: config.COOKIE_SECURE ? [] : null,
        },
      },
      hsts: config.COOKIE_SECURE,
    }),
  );
  app.use(cookieParser());
  // 富文本回复可能较大（粘贴的格式）；图片走上传接口，不在 JSON 里
  app.useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(config.PORT, '0.0.0.0');
  Logger.log(`服务已启动 :${config.PORT}`, 'Bootstrap');
}

void bootstrap();
