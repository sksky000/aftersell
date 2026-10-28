import { useState } from 'react';
import { ExternalLink, KeyRound, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  LLM_PROVIDER_INFO,
  saveLlmCredentialSchema,
  type LlmProviderStatus,
  type LlmSettingsDto,
  type SaveLlmCredentialRequest,
} from '@aftersell/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, messageOf } from '@/lib/api';

interface Props {
  status: LlmProviderStatus;
  editable: boolean;
  onSaved: (dto: LlmSettingsDto) => void;
}

/** 一个模型服务的 key：只能写入和删除，页面上只显示末 4 位 */
export default function ProviderCredentialRow({ status, editable, onSaved }: Props) {
  const info = LLM_PROVIDER_INFO[status.id];
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(status.baseUrl ?? '');
  const [advanced, setAdvanced] = useState(Boolean(status.baseUrl));
  const [busy, setBusy] = useState(false);

  const baseUrlChanged = (baseUrl.trim() || null) !== status.baseUrl;

  const save = async () => {
    const body: SaveLlmCredentialRequest = {};
    if (apiKey.trim()) body.apiKey = apiKey.trim();
    if (baseUrlChanged) body.baseUrl = baseUrl.trim() || null;
    const parsed = saveLlmCredentialSchema.safeParse(body);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? '请检查输入');
      return;
    }
    setBusy(true);
    try {
      onSaved(await api.put<LlmSettingsDto>(`/llm/credentials/${status.id}`, parsed.data));
      setApiKey('');
      toast.success(`${info.label} 已保存，请在下方用“测试”确认可用`);
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!window.confirm(`删除设置页保存的 ${info.label} key？`)) return;
    setBusy(true);
    try {
      onSaved(await api.delete<LlmSettingsDto>(`/llm/credentials/${status.id}`));
      setBaseUrl('');
      toast.success('已删除');
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-b border-border pb-4 last:border-0 last:pb-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium">{info.label}</span>
        <Badge variant={status.configured ? 'secondary' : 'outline'}>
          {status.configured ? `已配置 ····${status.keyHint ?? ''}` : '未配置'}
        </Badge>
        {status.source === 'env' && <span className="text-xs text-muted-foreground">（来自服务器 .env）</span>}
        <span className="text-xs text-muted-foreground">{info.note}</span>
        <a href={info.keyUrl} target="_blank" rel="noreferrer" className="text-xs underline inline-flex items-center gap-0.5">
          获取 key <ExternalLink className="size-3" />
        </a>
      </div>
      {editable && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              type="password"
              autoComplete="new-password"
              className="w-80"
              placeholder={status.configured ? '输入新 key 以更换' : '粘贴 API key'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <Button size="sm" onClick={() => void save()} disabled={busy || (!apiKey.trim() && !baseUrlChanged)}>
              {busy ? <Spinner className="size-4" /> : <KeyRound className="size-4" />}
              保存
            </Button>
            {status.source === 'settings' && (
              <Button size="sm" variant="ghost" onClick={() => void clear()} disabled={busy}>
                <Trash2 className="size-4" /> 删除
              </Button>
            )}
            <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setAdvanced((v) => !v)}>
              {advanced ? '收起' : '接口地址'}
            </button>
          </div>
          {advanced && (
            <Input
              className="w-[30rem] max-w-full"
              placeholder={status.defaultBaseUrl ? `默认 ${status.defaultBaseUrl}` : '默认官方地址'}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          )}
        </>
      )}
    </div>
  );
}
