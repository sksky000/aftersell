import { useEffect, useState } from 'react';
import type { SnippetDto } from '@aftersell/shared';
import { api } from '@/lib/api';

// 话术和 SOP 很少变：一次页面会话里只取一次，审核台各处共用
let cache: Promise<SnippetDto[]> | null = null;

export function useSnippets(): SnippetDto[] | null {
  const [items, setItems] = useState<SnippetDto[] | null>(null);
  useEffect(() => {
    let alive = true;
    cache ??= api.get<SnippetDto[]>('/snippets').catch((e) => {
      cache = null;
      throw e;
    });
    cache.then((list) => alive && setItems(list)).catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, []);
  return items;
}

/** 设置页改了话术 / SOP 后调用，下次进审核台重新读取 */
export function invalidateSnippets(): void {
  cache = null;
}
