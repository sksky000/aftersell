import { AlertTriangle, Archive, Clock, FileWarning, Flame, Reply, Sparkles } from 'lucide-react';
import type { InboxStatsDto } from '@aftersell/shared';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { DEFAULT_FILTERS, type InboxFilters } from './useInboxData';

/** 每张卡点开后的筛选条件：与 /emails/stats 的统计口径一致 */
const ITEMS: { key: keyof InboxStatsDto; label: string; icon: typeof Clock; iconClass: string; filters: Partial<InboxFilters> }[] = [
  { key: 'pendingReview', label: '待审核', icon: Clock, iconClass: 'text-blue-600 bg-blue-50', filters: { status: 'pending_review' } },
  { key: 'unclassified', label: '待分类', icon: Sparkles, iconClass: 'text-violet-600 bg-violet-50', filters: { status: '', pipelineState: 'ingested' } },
  {
    key: 'urgentPending',
    label: '紧急 / 高优先',
    icon: AlertTriangle,
    iconClass: 'text-red-600 bg-red-50',
    filters: { status: 'pending_review', priority: 'urgent_or_high' },
  },
  {
    key: 'safetyHazardPending',
    label: '安全隐患待处理',
    icon: Flame,
    iconClass: 'text-red-600 bg-red-50',
    filters: { status: 'pending_review', safetyHazard: 'true' },
  },
  {
    key: 'evidenceIncompletePending',
    label: '凭证不全待补',
    icon: FileWarning,
    iconClass: 'text-amber-600 bg-amber-50',
    filters: { status: 'pending_review', evidenceIncomplete: 'true' },
  },
  { key: 'replied', label: '已回复', icon: Reply, iconClass: 'text-emerald-600 bg-emerald-50', filters: { status: 'replied' } },
  { key: 'ignored', label: '已忽略', icon: Archive, iconClass: 'text-gray-500 bg-gray-100', filters: { status: 'ignored' } },
];

const same = (a: InboxFilters, b: InboxFilters) => JSON.stringify(a) === JSON.stringify(b);

interface Props {
  stats: InboxStatsDto;
  filters: InboxFilters;
  onSelect: (filters: InboxFilters) => void;
}

/** 统计卡：点一下列出这一类邮件，再点一下回到默认（待审核） */
export default function StatsCards({ stats, filters, onSelect }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
      {ITEMS.map((item) => {
        const target = { ...DEFAULT_FILTERS, ...item.filters };
        const active = same(filters, target);
        return (
          <button
            key={item.key}
            type="button"
            className="text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => onSelect(active && item.key !== 'pendingReview' ? DEFAULT_FILTERS : target)}
            title={`查看${item.label}的邮件`}
          >
            <Card className={cn('shadow-none transition-colors hover:border-primary/50 cursor-pointer', active && 'border-primary ring-1 ring-primary')}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`size-9 shrink-0 rounded-md flex items-center justify-center ${item.iconClass}`}>
                  <item.icon className="size-4.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xl font-semibold leading-tight">{stats[item.key]}</div>
                  <div className="text-xs text-muted-foreground truncate">{item.label}</div>
                </div>
              </CardContent>
            </Card>
          </button>
        );
      })}
    </div>
  );
}
