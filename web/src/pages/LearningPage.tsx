import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Download, Play, Plug, Save, Sparkles, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  CATEGORY_LABELS,
  PART_TYPE_LABELS,
  saveHistoryAccountSchema,
  startHistoryImportSchema,
  type CandidateStatus,
  type CardCandidateDto,
  type Category,
  type HistoryTestResult,
  type LearningJobState,
  type LearningStatusDto,
  type MailConfigMeta,
  type PartType,
  type StyleCandidateDto,
} from '@aftersell/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/auth';
import { api, messageOf } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const POLL_MS = 3000;
const cat = (c: string | null) => (c ? (CATEGORY_LABELS[c as Category] ?? c) : '所有类别');
const part = (p: string | null) => (p ? (PART_TYPE_LABELS[p as PartType] ?? p) : '所有零件');
const imgLabel = (f: string) => (f === 'with_images' ? '附了照片' : '没附照片');

function JobLine({ name, job }: { name: string; job: LearningJobState }) {
  if (job.state === 'idle') return null;
  const pct = job.total ? Math.round((job.done / job.total) * 100) : null;
  return (
    <div className="text-sm flex items-center gap-2 flex-wrap">
      {job.state === 'running' ? <Spinner className="size-4" /> : job.state === 'done' ? <Check className="size-4 text-green-600" /> : <X className="size-4 text-destructive" />}
      <span className="font-medium">{name}</span>
      {job.state === 'running' && <span className="text-muted-foreground">{job.total ? `${job.done} / ${job.total}（${pct}%）` : '准备中…'}</span>}
      {job.message && <span className={job.state === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>{job.message}</span>}
      {job.finishedAt && job.state !== 'running' && <span className="text-xs text-muted-foreground">{formatDateTime(job.finishedAt)}</span>}
    </div>
  );
}

function AccountCard({ status, onChanged }: { status: LearningStatusDto; onChanged: () => void }) {
  const { can } = useAuth();
  const admin = can('admin');
  const [meta, setMeta] = useState<MailConfigMeta | null>(null);
  const [form, setForm] = useState({ emailAddress: status.account?.emailAddress ?? '', authCode: '', imapHost: status.account?.imapHost ?? 'imap.exmail.qq.com', imapPort: status.account?.imapPort ?? 993 });
  const today = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const [range, setRange] = useState({ dateFrom: yearAgo, dateTo: today });
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<HistoryTestResult | null>(null);

  useEffect(() => {
    if (admin) api.get<MailConfigMeta>('/mail-config/meta').then(setMeta).catch(() => undefined);
  }, [admin]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const parsed = saveHistoryAccountSchema.safeParse({ ...form, authCode: form.authCode || undefined });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? '请检查输入');
    void act(async () => {
      await api.put('/learning/account', parsed.data);
      setForm((f) => ({ ...f, authCode: '' }));
    }, '账号已保存');
  };
  const startImport = () => {
    const parsed = startHistoryImportSchema.safeParse({ dateFrom: range.dateFrom, dateTo: range.dateTo || null });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? '请检查日期');
    void act(() => api.post('/learning/import', parsed.data), '已开始导入，完成后自动标注');
  };

  const running = status.jobs.import.state === 'running' || status.jobs.label.state === 'running';
  return (
    <Card>
      <CardHeader>
        <CardTitle>1. 导入历史回复</CardTitle>
        <CardDescription>
          从生产邮箱的“已发送”只读拉取客服过去的回复：只读打开、只读“已发送”文件夹、不改任何邮件状态、不发信。导入后由模型逐封标注场景（每封一次调用）。
          {!admin && ' 账号和导入只有管理员能操作。'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {admin && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div className="space-y-1.5">
              <Label>生产邮箱地址</Label>
              <Input value={form.emailAddress} onChange={(e) => setForm({ ...form, emailAddress: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>客户端专用密码</Label>
              <Input type="password" autoComplete="new-password" placeholder={status.account ? '已保存，留空不修改' : ''} value={form.authCode} onChange={(e) => setForm({ ...form, authCode: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>IMAP 服务器</Label>
              <Input list="history-hosts" value={form.imapHost} onChange={(e) => setForm({ ...form, imapHost: e.target.value })} />
              <datalist id="history-hosts">{meta?.allowedHosts.map((h) => <option key={h} value={h} />)}</datalist>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={busy}>
                <Save className="size-4" /> 保存
              </Button>
              {status.account && (
                <>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(async () => setTest(await api.post<HistoryTestResult>('/learning/account/test')))}>
                    <Plug className="size-4" /> 测试
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    title="删除保存的账号和密码"
                    onClick={() => window.confirm('删除保存的生产邮箱账号和密码？已导入的历史回复不受影响。') && void act(() => api.delete('/learning/account'), '已删除')}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
        {test && <div className={`text-sm ${test.ok ? 'text-green-700' : 'text-destructive'}`}>{test.message}</div>}
        {admin && status.account && (
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1.5">
              <Label>发送日期从</Label>
              <Input type="date" value={range.dateFrom} onChange={(e) => setRange({ ...range, dateFrom: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>到</Label>
              <Input type="date" value={range.dateTo} onChange={(e) => setRange({ ...range, dateTo: e.target.value })} />
            </div>
            <Button onClick={startImport} disabled={busy || running}>
              <Download className="size-4" /> 开始导入
            </Button>
            <span className="text-xs text-muted-foreground">已导入过的会自动跳过；一次最多 2 万封</span>
          </div>
        )}
        <div className="space-y-1.5">
          <JobLine name="导入" job={status.jobs.import} />
          <JobLine name="标注" job={status.jobs.label} />
        </div>
        <div className="text-sm text-muted-foreground flex items-center gap-3 flex-wrap">
          <span>
            已导入 {status.history.total} 封 · 已标注 {status.history.labeled} · 其中售后回复 {status.history.afterSales}
            {status.history.failed > 0 && ` · 标注失败 ${status.history.failed}`}
          </span>
          {status.history.labeled < status.history.total && status.jobs.label.state !== 'running' && (
            <Button size="sm" variant="outline" onClick={() => void act(() => api.post('/learning/label'), '已开始标注')}>
              <Play className="size-4" /> 继续标注
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function GenerateCard({ status, onChanged }: { status: LearningStatusDto; onChanged: () => void }) {
  const run = async (url: string, ok: string) => {
    try {
      await api.post(url);
      toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(messageOf(e));
    }
  };
  const ready = status.clusters.filter((c) => c.count >= status.minClusterSize && !c.pendingDraft && c.category !== 'other').length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>2. 生成候选</CardTitle>
        <CardDescription>
          知识卡：同一场景（类别 × 零件 × 是否附照片）至少 {status.minClusterSize} 封售后回复，才从最近 15 封里总结一张候选卡。风格条目：从客服改过 AI 草稿再发出的记录里归纳。候选都要审核通过才生效。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={() => void run('/learning/cards', '已开始生成知识卡候选')} disabled={status.jobs.cards.state === 'running' || !ready}>
            <Sparkles className="size-4" /> 生成知识卡候选（{ready} 个场景）
          </Button>
          <Button variant="outline" onClick={() => void run('/learning/styles', '已开始归纳改稿记录')} disabled={status.jobs.styles.state === 'running'}>
            <Sparkles className="size-4" /> 从改稿记录生成风格候选（{status.unminedCorrections} 条新改稿）
          </Button>
        </div>
        <div className="space-y-1.5">
          <JobLine name="知识卡" job={status.jobs.cards} />
          <JobLine name="风格条目" job={status.jobs.styles} />
        </div>
        {status.clusters.length > 0 && (
          <div className="max-h-72 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>类别</TableHead>
                  <TableHead>零件</TableHead>
                  <TableHead>客户</TableHead>
                  <TableHead className="text-right">样本</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.clusters.map((c) => (
                  <TableRow key={`${c.category}-${c.partType}-${c.imageFlag}`}>
                    <TableCell>{cat(c.category)}</TableCell>
                    <TableCell>{part(c.partType)}</TableCell>
                    <TableCell className="text-muted-foreground">{imgLabel(c.imageFlag)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.count}</TableCell>
                    <TableCell>
                      {c.pendingDraft ? <Badge variant="outline">待审核</Badge> : c.count >= status.minClusterSize && c.category !== 'other' ? <Badge variant="secondary">可生成</Badge> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ItemList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{title}</div>
      <ol className="list-decimal pl-5 space-y-0.5">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

function CardBody({ c }: { c: { skeleton: string[]; facts: string[]; rules: string[]; drift: string | null } }) {
  return (
    <div className="space-y-3 text-sm">
      <ItemList title="回复结构" items={c.skeleton} />
      <ItemList title="可直接告诉客户的事实" items={c.facts} />
      <ItemList title="处理规则" items={c.rules} />
      {c.drift && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">近期变化</div>
          <div>{c.drift}</div>
        </div>
      )}
    </div>
  );
}

function ReviewButtons({ onReview }: { onReview: (action: 'approve' | 'reject') => void }) {
  return (
    <div className="flex gap-2">
      <Button size="sm" onClick={() => onReview('approve')}>
        <Check className="size-4" /> 通过并启用
      </Button>
      <Button size="sm" variant="outline" onClick={() => onReview('reject')}>
        <X className="size-4" /> 驳回
      </Button>
    </div>
  );
}

function CardCandidate({ c, onReview }: { c: CardCandidateDto; onReview: (action: 'approve' | 'reject') => void }) {
  const [showSamples, setShowSamples] = useState(false);
  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-medium">
            {cat(c.category)} · {part(c.partType)} · {imgLabel(c.imageFlag)}
          </div>
          <div className="text-xs text-muted-foreground">
            基于 {c.sampleSize} 封历史回复 · 生成于 {formatDateTime(c.createdAt)}
            {c.reviewedAt && ` · 审核于 ${formatDateTime(c.reviewedAt)}`}
          </div>
        </div>
        {c.status === 'draft' && <ReviewButtons onReview={onReview} />}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-md bg-muted/40 p-3">
          <div className="text-xs font-medium mb-2">候选</div>
          <CardBody c={c} />
        </div>
        <div className="rounded-md border border-dashed border-border p-3">
          <div className="text-xs font-medium mb-2">{c.current ? `当前生效（${c.current.source === 'miaoda' ? '妙搭导入' : '历史学习'}，${c.current.sampleSize} 封）——通过后将被停用` : '当前没有生效的卡'}</div>
          {c.current && <CardBody c={c.current} />}
        </div>
      </div>
      {c.samples.length > 0 && (
        <div>
          <button type="button" className="text-sm inline-flex items-center gap-1 hover:underline" onClick={() => setShowSamples((v) => !v)}>
            {showSamples ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />} 参考样本（{c.samples.length}）
          </button>
          {showSamples && (
            <div className="mt-2 space-y-3">
              {c.samples.map((s, i) => (
                <div key={i} className="text-xs rounded-md border border-border p-2 space-y-1">
                  <div className="text-muted-foreground">{s.sentAt ? formatDateTime(s.sentAt) : ''}</div>
                  {s.customer && <div className="whitespace-pre-wrap break-words text-muted-foreground">客户：{s.customer}</div>}
                  <div className="whitespace-pre-wrap break-words">回复：{s.reply}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StyleCandidate({ s, onReview }: { s: StyleCandidateDto; onReview: (action: 'approve' | 'reject') => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm">{s.text}</div>
          <div className="text-xs text-muted-foreground mt-1">
            适用：{cat(s.category)} · {part(s.partType)} · 生成于 {formatDateTime(s.createdAt)}
          </div>
        </div>
        {s.status === 'draft' && <ReviewButtons onReview={onReview} />}
      </div>
      <button type="button" className="text-sm inline-flex items-center gap-1 hover:underline" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />} 依据的改稿（{s.evidence.length}）
      </button>
      {open && (
        <div className="space-y-2">
          {s.evidence.map((e, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-muted/40 p-2 whitespace-pre-wrap break-words">
                <div className="text-muted-foreground mb-1">AI 草稿</div>
                {e.draft}
              </div>
              <div className="rounded-md border border-border p-2 whitespace-pre-wrap break-words">
                <div className="text-muted-foreground mb-1">客服发出</div>
                {e.final}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewSection({ pending, onChanged }: { pending: LearningStatusDto['pending']; onChanged: () => void }) {
  const [kind, setKind] = useState<'cards' | 'styles'>('cards');
  const [status, setStatus] = useState<CandidateStatus>('draft');
  const [cards, setCards] = useState<CardCandidateDto[] | null>(null);
  const [styles, setStyles] = useState<StyleCandidateDto[] | null>(null);

  const load = useCallback(async () => {
    try {
      if (kind === 'cards') setCards(await api.get<CardCandidateDto[]>(`/learning/candidates/cards?status=${status}`));
      else setStyles(await api.get<StyleCandidateDto[]>(`/learning/candidates/styles?status=${status}`));
    } catch (e) {
      toast.error(messageOf(e));
    }
  }, [kind, status]);

  useEffect(() => {
    void load();
  }, [load, pending.cards, pending.styles]);

  const review = async (id: string, action: 'approve' | 'reject') => {
    try {
      await api.post(`/learning/candidates/${kind}/${id}/review`, { action });
      toast.success(action === 'approve' ? '已通过，下次生成草稿生效' : '已驳回');
      await load();
      onChanged();
    } catch (e) {
      toast.error(messageOf(e));
    }
  };

  const list = kind === 'cards' ? cards : styles;
  return (
    <Card>
      <CardHeader className="flex-row items-end justify-between space-y-0 flex-wrap gap-3">
        <div>
          <CardTitle>3. 审核</CardTitle>
          <CardDescription className="mt-1.5">通过的知识卡立即替换同场景原来的卡；通过的风格条目立即生效。之后也可以在 设置 → 业务知识 里关闭。</CardDescription>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Tabs value={kind} onValueChange={(v) => setKind(v as 'cards' | 'styles')}>
            <TabsList className="bg-white">
              <TabsTrigger value="cards">知识卡（待审 {pending.cards}）</TabsTrigger>
              <TabsTrigger value="styles">风格条目（待审 {pending.styles}）</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={status} onValueChange={(v) => setStatus(v as CandidateStatus)}>
            <TabsList className="bg-white">
              <TabsTrigger value="draft">待审核</TabsTrigger>
              <TabsTrigger value="approved">已通过</TabsTrigger>
              <TabsTrigger value="rejected">已驳回</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {list === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" /> 加载中…
          </div>
        ) : !list.length ? (
          <div className="text-sm text-muted-foreground py-6 text-center">没有{status === 'draft' ? '待审核' : status === 'approved' ? '已通过' : '已驳回'}的候选</div>
        ) : kind === 'cards' ? (
          (list as CardCandidateDto[]).map((c) => <CardCandidate key={c.id} c={c} onReview={(a) => void review(c.id, a)} />)
        ) : (
          (list as StyleCandidateDto[]).map((s) => <StyleCandidate key={s.id} s={s} onReview={(a) => void review(s.id, a)} />)
        )}
      </CardContent>
    </Card>
  );
}

/** 学习与审核：历史导入 → 生成候选 → 主管审核 */
export default function LearningPage() {
  const [status, setStatus] = useState<LearningStatusDto | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.get<LearningStatusDto>('/learning/status'));
    } catch (e) {
      toast.error(messageOf(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const running = !!status && Object.values(status.jobs).some((j) => j.state === 'running');
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, load]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">学习与审核</h1>
        <p className="text-sm text-muted-foreground mt-1">从历史回复和客服改稿里学习，生成知识卡与风格条目候选，主管审核通过后用于生成草稿</p>
      </div>
      {!status ? (
        <div className="flex items-center justify-center h-64 gap-2 text-muted-foreground">
          <Spinner className="size-4" /> 加载中…
        </div>
      ) : (
        <>
          <AccountCard status={status} onChanged={() => void load()} />
          <GenerateCard status={status} onChanged={() => void load()} />
          <ReviewSection pending={status.pending} onChanged={() => void load()} />
        </>
      )}
    </div>
  );
}
