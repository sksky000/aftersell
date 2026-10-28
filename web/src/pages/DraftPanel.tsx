import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Copy, FileSearch, ListChecks, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { RULE_SLOT_LABELS, type DraftContextDto, type DraftDto } from '@aftersell/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/auth';
import { api, messageOf } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const POLL_MS = 4000;

interface Props {
  emailId: string;
  /** 分类完成、草稿还在生成中 */
  pending: boolean;
  /** 草稿生成失败等原因 */
  error: string | null;
  canDraft: boolean;
}

/** M3：只读展示草稿与命中规则；编辑与发送在 M4 审核台 */
export default function DraftPanel({ emailId, pending, error, canDraft }: Props) {
  const { can } = useAuth();
  const [draft, setDraft] = useState<DraftDto | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [waitingFor, setWaitingFor] = useState<number | null>(null);
  const [showHits, setShowHits] = useState(false);
  const [context, setContext] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await api.get<DraftDto | null>(`/emails/${emailId}/draft`);
    setDraft(d);
    setLoaded(true);
    return d;
  }, [emailId]);

  useEffect(() => {
    void load().catch((e) => toast.error(messageOf(e)));
  }, [load]);

  // 生成中或刚点了“重新生成”时轮询，直到出现新版本
  const polling = (pending && !draft) || waitingFor !== null;
  useEffect(() => {
    if (!polling) return;
    const timer = window.setTimeout(async () => {
      const d = await load().catch(() => null);
      if (waitingFor !== null && d && d.version > waitingFor) {
        setWaitingFor(null);
        toast.success(`草稿已更新为第 ${d.version} 版`);
      }
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [polling, waitingFor, draft, load]);

  const regenerate = async () => {
    try {
      await api.post(`/emails/${emailId}/draft/regenerate`);
      setWaitingFor(draft?.version ?? 0);
      toast.success('已加入生成队列，约半分钟');
    } catch (e) {
      toast.error(messageOf(e));
    }
  };

  const openContext = async () => {
    try {
      setContext((await api.get<DraftContextDto>(`/emails/${emailId}/draft/context`)).context || '（无）');
    } catch (e) {
      toast.error(messageOf(e));
    }
  };

  const copy = async () => {
    if (!draft) return;
    await navigator.clipboard.writeText(draft.content);
    toast.success('已复制草稿');
  };

  let body: React.ReactNode;
  if (!loaded) {
    body = (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" /> 加载中…
      </div>
    );
  } else if (!draft) {
    body = (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : pending || waitingFor !== null ? (
          <>
            <Spinner className="size-4" /> 正在生成草稿…
          </>
        ) : canDraft ? (
          '还没有草稿'
        ) : (
          '这类来信（非客诉的其他邮件）不生成草稿'
        )}
      </div>
    );
  } else {
    const grouped = new Map<string, string[]>();
    for (const h of draft.hits) grouped.set(h.slot, [...(grouped.get(h.slot) ?? []), h.description]);
    body = (
      <div className="space-y-4">
        {error && <div className="text-sm text-destructive">{error}</div>}
        {draft.checks.length > 0 && (
          <Alert variant="destructive">
            <AlertDescription className="space-y-1">
              {draft.checks.map((c) => (
                <div key={c.code} className="flex gap-2">
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <span>{c.message}</span>
                </div>
              ))}
            </AlertDescription>
          </Alert>
        )}
        <div className="text-sm whitespace-pre-wrap break-words leading-relaxed rounded-md border border-border p-4 bg-muted/30">{draft.content}</div>
        <div className="text-xs text-muted-foreground">
          第 {draft.version} 版 · {formatDateTime(draft.createdAt)} · {draft.provider} / {draft.model}
        </div>
        <div>
          <button type="button" className="text-sm inline-flex items-center gap-1.5 hover:underline" onClick={() => setShowHits((v) => !v)}>
            <ListChecks className="size-4" /> 命中了 {draft.hits.length} 条规则
          </button>
          {showHits && (
            <div className="mt-2 space-y-2 text-sm">
              {[...grouped.entries()].map(([slot, items]) => (
                <div key={slot}>
                  <div className="text-xs text-muted-foreground">{RULE_SLOT_LABELS[slot as keyof typeof RULE_SLOT_LABELS] ?? slot}</div>
                  <ul className="list-disc pl-5">
                    {items.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">回复草稿</CardTitle>
        <div className="flex items-center gap-2">
          {draft && (
            <Button variant="ghost" size="sm" onClick={() => void copy()}>
              <Copy className="size-4" /> 复制
            </Button>
          )}
          {draft && can('supervisor') && (
            <Button variant="ghost" size="sm" onClick={() => void openContext()}>
              <FileSearch className="size-4" /> 上下文
            </Button>
          )}
          {canDraft && (
            <Button variant="outline" size="sm" onClick={() => void regenerate()} disabled={polling}>
              {waitingFor !== null ? <Spinner className="size-4" /> : <RotateCw className="size-4" />}
              重新生成
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>{body}</CardContent>
      <Dialog open={context !== null} onOpenChange={(open) => !open && setContext(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>送给草稿模型的上下文</DialogTitle>
          </DialogHeader>
          <pre className="text-xs whitespace-pre-wrap break-words">{context}</pre>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
