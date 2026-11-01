import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { RepliedListResponse } from '@aftersell/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, messageOf } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 400;

/** 我方发出的所有回复：系统发送的 + 在邮箱客户端里发的（已发送同步） */
export default function RepliedPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RepliedListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (query) params.set('search', query);
      setData(await api.get<RepliedListResponse>(`/emails/replied?${params}`));
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">已回复</h1>
          <p className="text-sm text-muted-foreground mt-1">我方发出的回复，含在邮箱客户端里直接回复、同步进来的</p>
        </div>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索主题 / 收件人 / 内容" className="h-8 w-72 bg-white" />
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
          <Spinner className="size-4" /> 加载中…
        </div>
      ) : !data?.items.length ? (
        <div className="text-sm text-muted-foreground text-center py-16">{query ? '没有符合条件的回复' : '还没有回复记录'}</div>
      ) : (
        <div className="space-y-3">
          {data.items.map((r) => (
            <Card key={r.id} className="shadow-none">
              <CardContent className="p-4 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                  <span>{formatDateTime(r.sentAt)}</span>
                  <span>→ {r.to ?? '—'}</span>
                  {r.source === 'system' ? (
                    <Badge variant="outline">{r.sentBy ? `${r.sentBy} 发送` : '系统发送'}</Badge>
                  ) : (
                    <Badge variant="outline">邮箱客户端发送</Badge>
                  )}
                  {r.edited && <Badge variant="outline">改过 AI 草稿</Badge>}
                </div>
                <div className="text-sm font-medium break-words">
                  {r.emailId ? (
                    <Link to={`/emails/${r.emailId}`} className="hover:underline">
                      {r.subject || r.customerSubject || '（无主题）'}
                    </Link>
                  ) : (
                    r.subject || '（无主题）'
                  )}
                </div>
                <div className="text-sm text-muted-foreground line-clamp-2 break-words">{r.excerpt}</div>
              </CardContent>
            </Card>
          ))}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || loading}>
                上一页
              </Button>
              <span className="text-sm text-muted-foreground">
                第 {page} / {pages} 页 · 共 {data.total} 条
              </span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= pages || loading}>
                下一页
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
