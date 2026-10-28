import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { text } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dateWindow } from '../mail-sync/mail-sync.service';
import { LocalDiskStorage } from './storage';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'aftersell-storage-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('LocalDiskStorage', () => {
  it('stores by content hash, deduplicates and reads back', async () => {
    const storage = new LocalDiskStorage(root);
    const a = await storage.putContent(Buffer.from('hello'));
    const b = await storage.putContent(Buffer.from('hello'));
    expect(a).toEqual(b);
    expect(a.key).toBe(`${a.sha256.slice(0, 2)}/${a.sha256}`);
    expect(await readdir(path.join(root, a.sha256.slice(0, 2)))).toEqual([a.sha256]);
    const file = await storage.open(a.key);
    expect(file.size).toBe(5);
    expect(await text(file.stream)).toBe('hello');
  });

  it('rejects keys that could escape the storage root', async () => {
    const storage = new LocalDiskStorage(root);
    await expect(storage.open('../etc/passwd')).rejects.toThrow('非法的存储 key');
  });
});

describe('dateWindow', () => {
  it('includes the whole end date', () => {
    expect(dateWindow('2026-10-01', '2026-10-28')).toEqual({
      since: new Date('2026-10-01T00:00:00Z'),
      before: new Date('2026-10-29T00:00:00Z'),
    });
    expect(dateWindow(null, null)).toEqual({});
  });
});
