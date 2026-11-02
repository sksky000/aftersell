import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CATEGORY_LABELS,
  PART_TYPE_LABELS,
  TRIAL_RATING_LABELS,
  TRIAL_RATINGS,
  type Category,
  type PartType,
  type TrialPairDto,
  type TrialPairsResponse,
  type TrialRating,
  type TrialSummaryDto,
} from '@aftersell/shared';
import { StatTile } from '@/components/charts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, messageOf } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 10;
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

function PairCard({ p, onRated }: { p: TrialPairDto; onRated: () => void }) {
  const [note, setNote] = useState(p.note ?? '');
  const [saving, setSaving] = useState<TrialRating | null>(null);

  const rate = async (rating: TrialRating) => {
    setSaving(rating);
    try {
      await api.put(`/trial/pairs/${p.emailId}/rating`, { rating, note: note.trim() || null });
      onRated();
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card className="shadow-none">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <Link to={`/emails/${p.emailId}`} className="font-medium hover:underline break-words">
              {p.subject || '（无主题）'}
            </Link>
            <div className="text-xs text-muted-foreground">
              {CATEGORY_LABELS[p.category as Category] ?? p.category} · {PART_TYPE_LABELS[p.partType as PartType] ?? p.partType} · 收信 {formatDateTime(p.receivedAt)}
            </div>
          </div>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">客户来信</summary>
          <div className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 max-h-60 overflow-y-auto">{p.customer || '（正文为空）'}</div>
        </details>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-md border border-border p-3">
            <div className="text-xs text-muted-foreground mb-1">AI 草稿（第 {p.draftVersion} 版）</div>
            <div className="text-sm whitespace-pre-wrap break-words max-h-80 overflow-y-auto">{p.draft}</div>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground mb-1">客服实际回复（{formatDateTime(p.actualSentAt)}）</div>
            <div className="text-sm whitespace-pre-wrap break-words max-h-80 overflow-y-auto">{p.actual}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">AI 草稿：</span>
          {TRIAL_RATINGS.map((r) => (
            <Button key={r} size="sm" variant={p.rating === r ? 'default' : 'outline'} disabled={saving !== null} onClick={() => void rate(r)}>
              {saving === r && <Spinner className="size-4" />}
              {TRIAL_RATING_LABELS[r]}
            </Button>
          ))}
          <Input className="h-8 flex-1 min-w-48" placeholder="备注（可选）：哪里不对、该怎么写" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </CardContent>
    </Card>
  );
}

/** 试跑对比：同一封来信，AI 草稿与客服实际回复并排，主管打分 */
export default function TrialPage() {
  const [summary, setSummary] = useState<TrialSummaryDto | null>(null);
  const [status, setStatus] = useState<'unrated' | 'rated'>('unrated');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TrialPairsResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([
        api.get<TrialSummaryDto>('/trial/summary'),
        api.get<TrialPairsResponse>(`/trial/pairs?status=${status}&page=${page}&pageSize=${PAGE_SIZE}`),
      ]);
      setSummary(s);
      setData(d);
    } catch (e) {
      toast.error(messageOf(e));
    }
  }, [status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const usable = summary ? summary.byRating.ready + summary.byRating.minor : 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">试跑对比</h1>
        <p className="text-sm text-muted-foreground mt-1">
          生产邮箱只读接入期间，把 AI 草稿和客服实际发出的回复并排对照，逐条打分，判断能否切换、哪类邮件还要调规则。
          {summary && !summary.trialMode && ' 当前未开启试跑模式（设置 → 邮箱）。'}
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="可对比的来信" value={String(summary.pairs)} sub="有 AI 草稿、客服也已回复" />
          <StatTile label="已打分" value={String(summary.rated)} sub={`还剩 ${summary.pairs - summary.rated} 封`} />
          <StatTile label="可直接用 + 小改" value={pct(usable, summary.rated)} sub={`${usable} / ${summary.rated} 封`} />
          <StatTile label="可直接用" value={pct(summary.byRating.ready, summary.rated)} sub={`大改 ${summary.byRating.major} · 不能用 ${summary.byRating.unusable}`} />
        </div>
      )}

      {summary && summary.byCategory.length > 0 && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">按类别</CardTitle>
            <CardDescription>可用率低的类别，优先在 设置 → 业务知识 里调规则、风格条目或知识卡</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>类别</TableHead>
                  <TableHead className="text-right">已打分</TableHead>
                  <TableHead className="text-right">可直接用 + 小改</TableHead>
                  <TableHead className="text-right">可用率</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.byCategory.map((c) => (
                  <TableRow key={c.category}>
                    <TableCell>{CATEGORY_LABELS[c.category as Category] ?? c.category}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.rated}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.usable}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', c.rated >= 5 && c.usable / c.rated < 0.6 && 'text-destructive')}>{pct(c.usable, c.rated)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Tabs
          value={status}
          onValueChange={(v) => {
            setStatus(v as 'unrated' | 'rated');
            setPage(1);
          }}
        >
          <TabsList className="bg-white">
            <TabsTrigger value="unrated">待打分</TabsTrigger>
            <TabsTrigger value="rated">已打分</TabsTrigger>
          </TabsList>
        </Tabs>
        {data && pages > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              上一页
            </Button>
            <span className="text-muted-foreground">
              {page} / {pages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              下一页
            </Button>
          </div>
        )}
      </div>

      {!data ? (
        <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
          <Spinner className="size-4" /> 加载中…
        </div>
      ) : !data.items.length ? (
        <div className="text-sm text-muted-foreground text-center py-16">
          {status === 'unrated' ? '没有待打分的来信。客服回复后，“已发送”同步进来就会出现在这里。' : '还没有打过分'}
        </div>
      ) : (
        <div className="space-y-4">
          {data.items.map((p) => (
            <PairCard key={p.emailId} p={p} onRated={() => void load()} />
          ))}
        </div>
      )}
    </div>
  );
}
