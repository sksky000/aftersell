import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { env } from '../config/env';
import { FeishuModule } from '../feishu/feishu.module';
import { UsersModule } from '../users/users.module';
import { AuthController, SESSION_TTL_SECONDS } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { FeishuAuthController } from './feishu-auth.controller';

@Module({
  imports: [
    UsersModule,
    FeishuModule,
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: env().JWT_SECRET,
        signOptions: { expiresIn: SESSION_TTL_SECONDS },
      }),
    }),
  ],
  controllers: [AuthController, FeishuAuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
