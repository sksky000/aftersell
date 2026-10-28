import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { SyncStatusDto, UpdateSyncFiltersRequest } from '@aftersell/shared';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/auth';
import { api, messageOf } from '@/lib/api';
import { formatDateTime, formatTime } from '@/lib/format';

type FilterKey = keyof NonNullable<SyncStatusDto['filters']>;

const FILTER_SWITCHES: { key: FilterKey; label: string; on: string; off: string; hint: string }[] = [
  {
    key: 'hotlineOnly',
    label: '仅拉取热线工单',
    on: '已开启仅拉取热线工单，普通客户邮件保持未读不入库',
    off: '已关闭仅拉取热线工单',
    hint: '只拉热线平台转发的 800 电话记录（及领导转发），其余邮件保持未读不入库',
  },
  {
    key: 'registrationOnly',
    label: '仅拉取注册邮件',
    on: '已开启仅拉取注册邮件，其余邮件保持未读不入库',
    off: '已关闭仅拉取注册邮件',
    hint: '只拉主题含 register / registration 的邮件；与热线开关同时开启时两类都拉',
  },
  {
    key: 'firstContactOnly',
    label: '仅拉取首次来信',
    on: '已开启仅拉取首次来信，跟进邮件保持未读不入库',
    off: '已关闭仅拉取首次来信',
    hint: '只拉主题非 Re: 且正文无引用块的邮件；与上两项同时开启时取交集',
  },
];

interface Props {
  status: SyncStatusDto | null;
  busy: boolean;
  onRun: () => Promise<void>;
  onFiltersChanged: () => Promise<void>;
}

export default function SyncBar({ status, busy, onRun, onFiltersChanged }: Props) {
  const { can } = useAuth();
  const [saving, setSaving] = useState<FilterKey | null>(null);
  const [starting, setStarting] = useState(false);

  const toggle = async (key: FilterKey, checked: boolean, text: { on: string; off: string }) => {
    setSaving(key);
    try {
      await api.patch('/mail-config/filters', { [key]: checked } satisfies UpdateSyncFiltersRequest);
      await onFiltersChanged();
      toast.success(checked ? text.on : text.off);
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSaving(null);
    }
  };

  const run = async () => {
    setStarting(true);
    try {
      await onRun();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setStarting(false);
    }
  };

  const last = status?.lastRun;
  const schedule = status?.schedule;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-4 flex-wrap">
        {FILTER_SWITCHES.map((s) => {
          const checked = status?.filters?.[s.key] ?? false;
          return (
            <label
              key={s.key}
              title={s.hint}
              className={`flex items-center gap-2 text-sm select-none ${checked ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}
            >
              <Switch
                checked={checked}
                onCheckedChange={(v) => void toggle(s.key, v, s)}
                disabled={!status?.configured || !can('supervisor') || saving !== null || busy}
              />
              {s.label}
            </label>
          );
        })}
        <Button onClick={() => void run()} disabled={!status?.configured || busy || starting}>
          {busy || starting ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
          {status?.queued ? '排队中…' : busy ? '同步中…' : '手动同步'}
        </Button>
      </div>
      <div className="text-xs text-muted-foreground text-right">
        {status && !status.configured ? (
          <>
            尚未配置邮箱，
            <Link to="/settings" className="underline">
              前往设置
            </Link>
          </>
        ) : (
          <>
            {last && last.status !== 'running' && (
              <span className={last.status === 'failed' ? 'text-destructive' : undefined}>
                上次同步 {formatDateTime(last.finishedAt ?? last.startedAt)}：{last.message}
              </span>
            )}
            {schedule && (
              <span className="ml-3">
                {schedule.enabled
                  ? `每 ${schedule.intervalMinutes} 分钟自动拉取${schedule.nextRunAt ? `，下次 ${formatTime(schedule.nextRunAt)}` : ''}`
                  : '定时拉取未开启（设置 → 邮箱）'}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
