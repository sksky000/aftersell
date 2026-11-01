import { useEffect, useRef, useState } from 'react';
import { Languages, RotateCw, X } from 'lucide-react';
import { toast } from 'sonner';
import type { TranslateResponse } from '@aftersell/shared';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api, messageOf } from '@/lib/api';

interface Props {
  /** 发起翻译；refresh=true 时跳过缓存 */
  request: (refresh: boolean) => Promise<TranslateResponse>;
  /** 原文变化时（换邮件、改草稿）译文作废 */
  sourceKey: string;
  label?: string;
}

/** “翻译”按钮 + 译文框；译文只在点按钮时生成 */
export function useTranslationToggle({ request, sourceKey, label = '翻译' }: Props): { button: React.ReactNode; panel: React.ReactNode } {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const translatedFor = useRef<string | null>(null);

  useEffect(() => {
    if (translatedFor.current !== null && translatedFor.current !== sourceKey) setStale(true);
  }, [sourceKey]);

  const run = async (refresh: boolean) => {
    setOpen(true);
    setLoading(true);
    try {
      const r = await request(refresh);
      setText(r.text);
      translatedFor.current = sourceKey;
      setStale(false);
    } catch (e) {
      toast.error(`翻译失败：${messageOf(e)}`);
      if (text === null) setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  return { button: (
    <Button variant="ghost" size="sm" onClick={() => (open ? setOpen(false) : text !== null && !stale ? setOpen(true) : void run(false))} disabled={loading}>
      {loading ? <Spinner className="size-4" /> : <Languages className="size-4" />}
      {open ? `收起${label}` : label}
    </Button>
  ), panel: open ? (
    <div className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>中文译文（机器翻译，仅供理解）</span>
        {stale && <span className="text-amber-600">原文已修改，译文可能过时</span>}
        <button type="button" className="ml-auto inline-flex items-center gap-1 hover:underline" onClick={() => void run(true)} disabled={loading}>
          <RotateCw className="size-3" /> 重新翻译
        </button>
        <button type="button" className="hover:text-foreground" onClick={() => setOpen(false)} title="收起">
          <X className="size-3.5" />
        </button>
      </div>
      {loading && text === null ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner className="size-4" /> 翻译中…
        </div>
      ) : (
        <div className="whitespace-pre-wrap break-words leading-relaxed">{text}</div>
      )}
    </div>
  ) : null };
}

export const translateEmail = (emailId: string) => (refresh: boolean) =>
  api.post<TranslateResponse>(`/emails/${emailId}/translate${refresh ? '?refresh=1' : ''}`);

export const translateText = (text: string) => () => api.post<TranslateResponse>('/translate', { text });
