import { AlertTriangle, Archive, Clock, FileWarning, Flame, Reply, Sparkles } from 'lucide-react';
import type { InboxStatsDto } from '@aftersell/shared';
import { Card, CardContent } from '@/components/ui/card';

const ITEMS: { key: keyof InboxStatsDto; label: string; icon: typeof Clock; iconClass: string }[] = [
  { key: 'pendingReview', label: '待审核', icon: Clock, iconClass: 'text-blue-600 bg-blue-50' },
  { key: 'unclassified', label: '待分类', icon: Sparkles, iconClass: 'text-violet-600 bg-violet-50' },
  { key: 'urgentPending', label: '紧急 / 高优先', icon: AlertTriangle, iconClass: 'text-red-600 bg-red-50' },
  { key: 'safetyHazardPending', label: '安全隐患待处理', icon: Flame, iconClass: 'text-red-600 bg-red-50' },
  { key: 'evidenceIncompletePending', label: '凭证不全待补', icon: FileWarning, iconClass: 'text-amber-600 bg-amber-50' },
  { key: 'replied', label: '已回复', icon: Reply, iconClass: 'text-emerald-600 bg-emerald-50' },
  { key: 'ignored', label: '已忽略', icon: Archive, iconClass: 'text-gray-500 bg-gray-100' },
];

export default function StatsCards({ stats }: { stats: InboxStatsDto }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
      {ITEMS.map((item) => (
        <Card key={item.key} className="shadow-none">
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
      ))}
    </div>
  );
}
