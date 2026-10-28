import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { CATEGORY_LABELS, EVIDENCE_LABELS, PART_TYPE_LABELS, STATUS_LABELS, URGENCY_LABELS } from '@aftersell/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DEFAULT_FILTERS, type ContactStage, type InboxFilters } from './useInboxData';

type SelectKey = 'urgency' | 'partType' | 'category' | 'status' | 'evidenceStatus';

const FIELDS: { key: SelectKey; label: string; all: string; options: Record<string, string> }[] = [
  { key: 'status', label: '状态', all: '全部状态', options: STATUS_LABELS },
  { key: 'urgency', label: '紧急度', all: '全部紧急度', options: URGENCY_LABELS },
  { key: 'partType', label: '零件类型', all: '全部零件', options: PART_TYPE_LABELS },
  { key: 'category', label: '客诉类别', all: '全部类别', options: CATEGORY_LABELS },
  { key: 'evidenceStatus', label: '凭证齐全度', all: '全部凭证状态', options: EVIDENCE_LABELS },
];

const STAGES: { value: ContactStage; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'first_contact', label: '首次来信' },
  { value: 'follow_up', label: '多轮跟进' },
];

const SEARCH_DEBOUNCE_MS = 400;

export default function FilterBar({ filters, onChange }: { filters: InboxFilters; onChange: (f: InboxFilters) => void }) {
  const [search, setSearch] = useState(filters.search);

  useEffect(() => {
    if (search === filters.search) return;
    const timer = window.setTimeout(() => onChange({ ...filters, search }), search ? SEARCH_DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [search, filters, onChange]);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">联系阶段</Label>
        <Tabs value={filters.contactStage} onValueChange={(v) => onChange({ ...filters, contactStage: v as ContactStage })}>
          <TabsList className="bg-white">
            {STAGES.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {FIELDS.map((field) => (
        <div key={field.key} className="flex flex-col gap-1.5 min-w-36">
          <Label className="text-xs text-muted-foreground">{field.label}</Label>
          <Select
            value={filters[field.key] || 'all'}
            onValueChange={(v) => onChange({ ...filters, [field.key]: v === 'all' ? '' : v })}
          >
            <SelectTrigger size="sm" className="w-full bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{field.all}</SelectItem>
              {Object.entries(field.options).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
      <div className="flex flex-col gap-1.5 min-w-32">
        <Label className="text-xs text-muted-foreground">安全隐患</Label>
        <Select
          value={filters.safetyHazard || 'all'}
          onValueChange={(v) => onChange({ ...filters, safetyHazard: v === 'true' || v === 'false' ? v : '' })}
        >
          <SelectTrigger size="sm" className="w-full bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="true">仅安全隐患</SelectItem>
            <SelectItem value="false">排除安全隐患</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5 min-w-52 flex-1">
        <Label className="text-xs text-muted-foreground">搜索</Label>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索主题 / 发件人 / 正文"
          className="h-8 bg-white"
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setSearch('');
          onChange(DEFAULT_FILTERS);
        }}
      >
        <RotateCcw className="size-4" />
        重置
      </Button>
    </div>
  );
}
