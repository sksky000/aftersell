import { useCallback, useEffect, useMemo, useState } from 'react';
import { PlugZap, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  EFFORTS,
  LLM_PROVIDER_INFO,
  LLM_PROVIDERS,
  LLM_SLOT_LABELS,
  LLM_SLOTS,
  llmSettingsSchema,
  type LlmProviderId,
  type LlmSettings,
  type LlmSettingsDto,
  type LlmSlot,
  type LlmTestResult,
} from '@aftersell/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/auth';
import { api, messageOf } from '@/lib/api';

export default function LlmSettingsCard() {
  const { can } = useAuth();
  const editable = can('admin');
  const [dto, setDto] = useState<LlmSettingsDto | null>(null);
  const [form, setForm] = useState<LlmSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<LlmSlot | null>(null);
  const [results, setResults] = useState<Partial<Record<LlmSlot, LlmTestResult>>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api.get<LlmSettingsDto>('/llm/settings');
      setDto(d);
      setForm(d.settings);
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const configured = useMemo(() => new Set(dto?.providers.filter((p) => p.configured).map((p) => p.id)), [dto]);
  const dirty = !!dto && !!form && JSON.stringify(dto.settings) !== JSON.stringify(form);

  const setSlot = (slot: LlmSlot, patch: Partial<LlmSettings['slots'][LlmSlot]>) =>
    setForm((f) => (f ? { slots: { ...f.slots, [slot]: { ...f.slots[slot], ...patch } } } : f));

  const save = async () => {
    if (!form) return;
    const parsed = llmSettingsSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? '请检查输入');
      return;
    }
    setSaving(true);
    try {
      const next = await api.put<LlmSettingsDto>('/llm/settings', parsed.data);
      setDto(next);
      setForm(next.settings);
      setResults({});
      toast.success('模型配置已保存，未分类的邮件会自动补跑');
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const test = async (slot: LlmSlot) => {
    setTesting(slot);
    try {
      const r = await api.post<LlmTestResult>('/llm/test', { slot });
      setResults((prev) => ({ ...prev, [slot]: r }));
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setTesting(null);
    }
  };

  if (error) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-destructive">{error}</div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          重试
        </Button>
      </div>
    );
  }
  if (!dto || !form) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Spinner className="size-4" /> 加载中…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>模型服务</CardTitle>
          <CardDescription>API key 只保存在服务器的 .env 文件里，页面上不显示也不能修改。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {LLM_PROVIDERS.map((id) => (
            <div key={id} className="flex items-center gap-3 text-sm">
              <span className="w-44">{LLM_PROVIDER_INFO[id].label}</span>
              <Badge variant={configured.has(id) ? 'secondary' : 'outline'}>{configured.has(id) ? '已配置' : '未配置'}</Badge>
              <span className="text-xs text-muted-foreground">
                {LLM_PROVIDER_INFO[id].envKey} · {LLM_PROVIDER_INFO[id].note}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>任务槽位</CardTitle>
          <CardDescription>
            每类任务单独选服务和模型，改完保存即生效，不用发版。{!editable && ' 只有管理员可以修改。'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {LLM_SLOTS.map((slot) => {
            const cfg = form.slots[slot];
            const result = results[slot];
            return (
              <div key={slot} className="space-y-2 border-b border-border pb-4 last:border-0 last:pb-0">
                <div>
                  <span className="text-sm font-medium">{LLM_SLOT_LABELS[slot].label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{LLM_SLOT_LABELS[slot].hint}</span>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <Select
                    value={cfg.provider}
                    onValueChange={(v) => setSlot(slot, { provider: v as LlmProviderId, effort: v === 'anthropic' ? cfg.effort ?? 'low' : undefined })}
                    disabled={!editable}
                  >
                    <SelectTrigger className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LLM_PROVIDERS.filter((p) => slot !== 'vision' || LLM_PROVIDER_INFO[p].vision).map((p) => (
                        <SelectItem key={p} value={p}>
                          {LLM_PROVIDER_INFO[p].label}
                          {configured.has(p) ? '' : '（未配置）'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="w-56"
                    value={cfg.model}
                    onChange={(e) => setSlot(slot, { model: e.target.value })}
                    disabled={!editable}
                    placeholder="模型名"
                  />
                  {cfg.provider === 'anthropic' && (
                    <Select value={cfg.effort ?? 'low'} onValueChange={(v) => setSlot(slot, { effort: v as (typeof EFFORTS)[number] })} disabled={!editable}>
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EFFORTS.map((e) => (
                          <SelectItem key={e} value={e}>
                            effort {e}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {editable && (
                    <Button variant="outline" size="sm" onClick={() => void test(slot)} disabled={testing !== null || dirty}>
                      {testing === slot ? <Spinner className="size-4" /> : <PlugZap className="size-4" />}
                      测试
                    </Button>
                  )}
                </div>
                {result && (
                  <div className={`text-xs ${result.ok ? 'text-emerald-700' : 'text-destructive'}`}>
                    {result.message}（{(result.durationMs / 1000).toFixed(1)} 秒）
                  </div>
                )}
              </div>
            );
          })}
          {editable && (
            <div className="flex items-center gap-3">
              <Button onClick={() => void save()} disabled={saving || !dirty}>
                {saving ? <Spinner className="size-4" /> : <Save className="size-4" />}
                保存
              </Button>
              {dirty && <span className="text-xs text-muted-foreground">有未保存的修改，保存后再测试</span>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
