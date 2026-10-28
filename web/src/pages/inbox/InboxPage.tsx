import { useCallback, useMemo, useState } from 'react';
import { Inbox, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { PART_TYPE_LABELS, PART_TYPE_ORDER, type EmailListItem, type SyncRunDto } from '@aftersell/shared';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import EmailCard from './EmailCard';
import FilterBar from './FilterBar';
import StatsCards from './StatsCards';
import SyncBar from './SyncBar';
import { DEFAULT_FILTERS, useInboxData, type InboxFilters } from './useInboxData';
import { useSyncStatus } from './useSyncStatus';

interface Section {
  key: string;
  title: string;
  hint: string;
  items: EmailListItem[];
}

/** 待分类 → 紧急 → 按零件分组的待审核 → 其他状态 */
function groupEmails(emails: EmailListItem[]): Section[] {
  const unclassified: EmailListItem[] = [];
  const urgent: EmailListItem[] = [];
  const byPart = new Map<string, EmailListItem[]>();
  const handled: EmailListItem[] = [];
  for (const e of emails) {
    if (e.status !== 'pending_review') handled.push(e);
    else if (e.pipelineState === 'ingested') unclassified.push(e);
    else if (e.urgency === 'urgent' || e.urgency === 'high') urgent.push(e);
    else byPart.set(e.partType, [...(byPart.get(e.partType) ?? []), e]);
  }
  return [
    { key: 'unclassified', title: '待分类', hint: '封，接入模型（M2）后自动分类', items: unclassified },
    { key: 'urgent', title: '紧急 & 重要', hint: '封待处理', items: urgent },
    ...PART_TYPE_ORDER.map((part) => ({
      key: part,
      title: PART_TYPE_LABELS[part],
      hint: '封待审核',
      items: byPart.get(part) ?? [],
    })),
    { key: 'handled', title: '已处理', hint: '封', items: handled },
  ].filter((s) => s.items.length > 0);
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-2">
      <Inbox className="size-10 text-muted-foreground" />
      <div className="text-sm font-medium">{title}</div>
      <div className="text-sm text-muted-foreground max-w-md">{description}</div>
    </div>
  );
}

export default function InboxPage() {
  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_FILTERS);
  const { emails, total, stats, loading, loadingMore, error, hasMore, loadMore, refetch } = useInboxData(filters);

  const onRunFinished = useCallback(
    (run: SyncRunDto) => {
      void refetch();
      if (run.trigger === 'manual') {
        if (run.status === 'succeeded') toast.success(run.message);
        else if (run.status === 'failed') toast.error(run.message);
        else toast.warning(run.message);
      } else if (run.inserted > 0) {
        toast.info(`自动同步：新增 ${run.inserted} 封邮件`);
      }
    },
    [refetch],
  );
  const sync = useSyncStatus(onRunFinished);
  const sections = useMemo(() => groupEmails(emails), [emails]);
  const filtered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);

  let content: React.ReactNode;
  if (loading) {
    content = (
      <div className="flex items-center justify-center h-64 gap-2 text-muted-foreground">
        <Spinner className="size-4" /> 加载中…
      </div>
    );
  } else if (error && emails.length === 0) {
    content = (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="text-destructive text-sm">{error}</div>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          <RefreshCw className="size-4" /> 重试
        </Button>
      </div>
    );
  } else if (emails.length === 0) {
    content = filtered ? (
      <EmptyState title="没有符合条件的邮件" description="调整筛选条件，或点击右上角手动同步新邮件" />
    ) : (
      <EmptyState
        title="暂无待审核邮件"
        description={sync.status?.configured === false ? '请先在设置页配置邮箱账号' : '点击右上角“手动同步”拉取最新邮件'}
      />
    );
  } else {
    content = (
      <div className="space-y-8">
        {sections.map((s) => (
          <section key={s.key}>
            <h2 className="text-sm font-medium mb-3">
              {s.title}
              <span className="ml-1 text-xs text-muted-foreground font-normal">
                （{s.items.length} {s.hint}）
              </span>
            </h2>
            <div className="space-y-3">
              {s.items.map((email) => (
                <EmailCard key={email.id} email={email} />
              ))}
            </div>
          </section>
        ))}
        {hasMore && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore && <Spinner className="size-4" />}
              {loadingMore ? '加载中…' : `加载更多（已显示 ${emails.length}/${total} 封）`}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-semibold">邮件看板</h1>
          <p className="text-sm text-muted-foreground mt-1">售后来信自动入库 · 待审核邮件需人工处理</p>
        </div>
        <SyncBar status={sync.status} busy={sync.busy} onRun={sync.runNow} onFiltersChanged={sync.refresh} />
      </div>
      {stats && <StatsCards stats={stats} />}
      <FilterBar filters={filters} onChange={setFilters} />
      {content}
    </div>
  );
}
