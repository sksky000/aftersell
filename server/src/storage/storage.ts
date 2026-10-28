import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

export interface StoredObject {
  key: string;
  sha256: string;
  size: number;
}

/** 附件存储接口；第一阶段本地磁盘，换 OSS 时只替换实现 */
export interface Storage {
  /** 按内容寻址写入，相同内容返回同一个 key */
  putContent(content: Buffer): Promise<StoredObject>;
  open(key: string): Promise<{ stream: ReadStream; size: number }>;
}

export const STORAGE = Symbol('STORAGE');

const KEY_RE = /^[0-9a-f]{2}\/[0-9a-f]{64}$/;

export class LocalDiskStorage implements Storage {
  constructor(private readonly root: string) {}

  private pathOf(key: string): string {
    if (!KEY_RE.test(key)) throw new Error(`非法的存储 key: ${key}`);
    return path.join(this.root, key);
  }

  async putContent(content: Buffer): Promise<StoredObject> {
    const sha256 = createHash('sha256').update(content).digest('hex');
    const key = `${sha256.slice(0, 2)}/${sha256}`;
    const file = this.pathOf(key);
    const existing = await stat(file).catch(() => null);
    if (existing?.size === content.length) return { key, sha256, size: content.length };

    await mkdir(path.dirname(file), { recursive: true });
    // 先写临时文件再改名，进程中断不会留下半个文件
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(tmp, content);
      await rename(tmp, file);
    } catch (error) {
      await unlink(tmp).catch(() => undefined);
      throw error;
    }
    return { key, sha256, size: content.length };
  }

  async open(key: string): Promise<{ stream: ReadStream; size: number }> {
    const file = this.pathOf(key);
    const info = await stat(file);
    return { stream: createReadStream(file), size: info.size };
  }
}
