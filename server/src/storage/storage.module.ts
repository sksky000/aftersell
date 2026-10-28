import { Global, Module } from '@nestjs/common';
import * as path from 'node:path';
import { env } from '../config/env';
import { LocalDiskStorage, STORAGE } from './storage';

@Global()
@Module({
  providers: [{ provide: STORAGE, useFactory: () => new LocalDiskStorage(path.resolve(env().ATTACHMENT_DIR)) }],
  exports: [STORAGE],
})
export class StorageModule {}
