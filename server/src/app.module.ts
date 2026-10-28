import { Module, type DynamicModule } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { env } from './config/env';
import { DbModule } from './db/db.module';
import { RedisModule } from './health/redis.module';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MailConfigModule } from './mail-config/mail-config.module';

function staticWeb(): DynamicModule[] {
  const dir = env().WEB_DIST_DIR;
  return dir ? [ServeStaticModule.forRoot({ rootPath: dir, exclude: ['/api/(.*)'] })] : [];
}

@Module({
  imports: [DbModule, RedisModule, AuthModule, UsersModule, MailConfigModule, ...staticWeb()],
  controllers: [HealthController],
})
export class AppModule {}
