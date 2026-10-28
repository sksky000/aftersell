import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncRunDto, SyncStatusDto } from '@aftersell/shared';
import { api } from '@/lib/api';

const BUSY_POLL_MS = 2000;
const IDLE_POLL_MS = 30_000;

function isBusy(s: SyncStatusDto | null): boolean {
  return !!s && (s.running || s.queued || s.lastRun?.status === 'running');
}

/**
 * 轮询同步状态：有任务时 2 秒一次，空闲时 30 秒一次。
 * 每当出现新的已结束同步（手动或定时）调用 onFinished，用于刷新列表。
 */
export function useSyncStatus(onFinished: (run: SyncRunDto) => void) {
  const [status, setStatus] = useState<SyncStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** undefined = 尚未加载，首次加载不触发 onFinished */
  const lastFinishedId = useRef<string | null | undefined>(undefined);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const apply = useCallback((s: SyncStatusDto) => {
    setStatus(s);
    setError(null);
    const run = s.lastRun;
    if (run && run.status !== 'running') {
      if (lastFinishedId.current !== undefined && lastFinishedId.current !== run.id) onFinishedRef.current(run);
      lastFinishedId.current = run.id;
    } else if (lastFinishedId.current === undefined) {
      lastFinishedId.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await api.get<SyncStatusDto>('/mail-sync/status'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const busy = isBusy(status);
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => void refresh(), busy ? BUSY_POLL_MS : IDLE_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [status, busy, refresh]);

  const runNow = useCallback(async () => {
    apply(await api.post<SyncStatusDto>('/mail-sync/run'));
  }, [apply]);

  return { status, error, busy, refresh, runNow };
}
