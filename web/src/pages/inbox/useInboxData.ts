import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmailListItem, EmailListResponse, InboxStatsDto } from '@aftersell/shared';
import { api, messageOf } from '@/lib/api';

export type ContactStage = 'all' | 'first_contact' | 'follow_up';

export interface InboxFilters {
  urgency: string;
  partType: string;
  category: string;
  status: string;
  evidenceStatus: string;
  safetyHazard: '' | 'true' | 'false';
  search: string;
  contactStage: ContactStage;
}

export const DEFAULT_FILTERS: InboxFilters = {
  urgency: '',
  partType: '',
  category: '',
  status: 'pending_review',
  evidenceStatus: '',
  safetyHazard: '',
  search: '',
  contactStage: 'all',
};

const PAGE_SIZE = 200;

function toQuery(filters: InboxFilters, page: number): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  for (const [key, value] of Object.entries(filters)) {
    if (value && !(key === 'contactStage' && value === 'all')) params.set(key, value);
  }
  return params.toString();
}

export function useInboxData(filters: InboxFilters) {
  const [emails, setEmails] = useState<EmailListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<InboxStatsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const page = useRef(1);
  /** 筛选快速切换时丢弃过期响应 */
  const seq = useRef(0);

  /** 只有首次加载显示整页加载态，之后刷新保留旧列表 */
  const loaded = useRef(false);

  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    page.current = 1;
    if (!loaded.current) setLoading(true);
    setError(null);
    try {
      const [list, s] = await Promise.all([
        api.get<EmailListResponse>(`/emails?${toQuery(filters, 1)}`),
        api.get<InboxStatsDto>('/emails/stats'),
      ]);
      if (mine !== seq.current) return;
      setEmails(list.items);
      setTotal(list.total);
      setStats(s);
      loaded.current = true;
    } catch (err) {
      if (mine === seq.current) setError(messageOf(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [filters]);

  const loadMore = useCallback(async () => {
    if (loadingMore || emails.length >= total) return;
    const mine = ++seq.current;
    setLoadingMore(true);
    try {
      const next = page.current + 1;
      const list = await api.get<EmailListResponse>(`/emails?${toQuery(filters, next)}`);
      if (mine !== seq.current) return;
      page.current = next;
      setEmails((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...list.items.filter((e) => !seen.has(e.id))];
      });
      setTotal(list.total);
    } catch (err) {
      if (mine === seq.current) setError(messageOf(err));
    } finally {
      if (mine === seq.current) setLoadingMore(false);
    }
  }, [filters, loadingMore, emails.length, total]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { emails, total, stats, loading, loadingMore, error, hasMore: emails.length < total, loadMore, refetch };
}
