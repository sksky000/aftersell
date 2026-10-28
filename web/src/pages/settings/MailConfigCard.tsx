import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { PlugZap, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  DEFAULT_IMAP_HOST,
  DEFAULT_IMAP_PORT,
  DEFAULT_SMTP_HOST,
  DEFAULT_SMTP_PORT,
  DEFAULT_SYNC_INTERVAL_MINUTES,
  MAX_PER_RUN_CEILING,
  saveMailAccountSchema,
  type MailAccountDto,
  type MailConfigMeta,
  type TestConnectionResult,
} from '@aftersell/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/auth';
import { api, messageOf } from '@/lib/api';

interface FormState {
  emailAddress: string;
  authCode: string;
  imapHost: string;
  imapPort: string;
  smtpHost: string;
  smtpPort: string;
  syncEnabled: boolean;
  keepUnread: boolean;
  hotlineOnly: boolean;
  registrationOnly: boolean;
  firstContactOnly: boolean;
  maxPerRun: string;
  syncIntervalMinutes: string;
  syncDateFrom: string;
  syncDateTo: string;
}

const EMPTY: FormState = {
  emailAddress: '',
  authCode: '',
  imapHost: DEFAULT_IMAP_HOST,
  imapPort: String(DEFAULT_IMAP_PORT),
  smtpHost: DEFAULT_SMTP_HOST,
  smtpPort: String(DEFAULT_SMTP_PORT),
  syncEnabled: false,
  keepUnread: true,
  hotlineOnly: false,
  registrationOnly: false,
  firstContactOnly: false,
  maxPerRun: '20',
  syncIntervalMinutes: String(DEFAULT_SYNC_INTERVAL_MINUTES),
  syncDateFrom: '',
  syncDateTo: '',
};

function fromDto(d: MailAccountDto): FormState {
  return {
    emailAddress: d.emailAddress,
    imapHost: d.imapHost,
    smtpHost: d.smtpHost,
    syncEnabled: d.syncEnabled,
    keepUnread: d.keepUnread,
    hotlineOnly: d.hotlineOnly,
    registrationOnly: d.registrationOnly,
    firstContactOnly: d.firstContactOnly,
    authCode: '',
    imapPort: String(d.imapPort),
    smtpPort: String(d.smtpPort),
    maxPerRun: String(d.maxPerRun),
    syncIntervalMinutes: String(d.syncIntervalMinutes),
    syncDateFrom: d.syncDateFrom ?? '',
    syncDateTo: d.syncDateTo ?? '',
  };
}

const SWITCHES: { key: keyof FormState; label: string; hint: string }[] = [
  { key: 'syncEnabled', label: '启用定时拉取', hint: '按下方间隔自动拉取新邮件；关闭后仍可在看板手动同步' },
  { key: 'keepUnread', label: '拉取后保持未读', hint: '不在邮箱里把邮件标为已读' },
  { key: 'hotlineOnly', label: '只拉热线工单', hint: '仅入库热线转发的工单邮件' },
  { key: 'registrationOnly', label: '只拉注册邮件', hint: '仅入库产品注册相关邮件' },
  { key: 'firstContactOnly', label: '只拉首次来信', hint: '跳过已有往来的跟进邮件；可与上两项叠加（取交集）' },
];

export default function MailConfigCard() {
  const { can } = useAuth();
  const editable = can('admin');
  const [saved, setSaved] = useState<MailAccountDto | null>(null);
  const [meta, setMeta] = useState<MailConfigMeta | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestConnectionResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [config, m] = await Promise.all([
        api.get<MailAccountDto | null>('/mail-config'),
        api.get<MailConfigMeta>('/mail-config/meta'),
      ]);
      setSaved(config);
      setMeta(m);
      setForm(config ? fromDto(config) : EMPTY);
    } catch (err) {
      setLoadError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => {
    const base = saved ? fromDto(saved) : EMPTY;
    return JSON.stringify(base) !== JSON.stringify(form);
  }, [saved, form]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = saveMailAccountSchema.safeParse({
      ...form,
      authCode: form.authCode || undefined,
      imapPort: Number(form.imapPort),
      smtpPort: Number(form.smtpPort),
      maxPerRun: Number(form.maxPerRun),
      syncIntervalMinutes: Number(form.syncIntervalMinutes),
      syncDateFrom: form.syncDateFrom || null,
      syncDateTo: form.syncDateTo || null,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? '请检查输入');
      return;
    }
    setSaving(true);
    try {
      const next = await api.put<MailAccountDto>('/mail-config', parsed.data);
      setSaved(next);
      setForm(fromDto(next));
      setResult(null);
      toast.success('邮箱配置已保存');
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.post<TestConnectionResult>('/mail-config/test'));
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Spinner className="size-4" /> 加载中…
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-destructive">{loadError}</div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>邮箱账号</CardTitle>
        <CardDescription>
          客服收发信使用的企业邮箱。客户端专用密码加密保存，保存后不再显示。
          {!editable && ' 只有管理员可以修改。'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-6" onSubmit={(e) => void onSave(e)}>
          <fieldset disabled={!editable} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="emailAddress">邮箱地址</Label>
                <Input
                  id="emailAddress"
                  type="email"
                  autoComplete="off"
                  value={form.emailAddress}
                  onChange={(e) => set('emailAddress', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="authCode">客户端专用密码</Label>
                <Input
                  id="authCode"
                  type="password"
                  autoComplete="new-password"
                  placeholder={saved?.hasAuthCode ? '已保存，留空表示不修改' : '在企业邮箱"客户端专用密码"中生成'}
                  value={form.authCode}
                  onChange={(e) => set('authCode', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="imapHost">IMAP 服务器</Label>
                <Input id="imapHost" list="mail-hosts" value={form.imapHost} onChange={(e) => set('imapHost', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="imapPort">IMAP 端口</Label>
                <Input id="imapPort" type="number" value={form.imapPort} onChange={(e) => set('imapPort', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtpHost">SMTP 服务器</Label>
                <Input id="smtpHost" list="mail-hosts" value={form.smtpHost} onChange={(e) => set('smtpHost', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtpPort">SMTP 端口</Label>
                <Input id="smtpPort" type="number" value={form.smtpPort} onChange={(e) => set('smtpPort', e.target.value)} />
              </div>
              <datalist id="mail-hosts">
                {meta?.allowedHosts.map((h) => <option key={h} value={h} />)}
              </datalist>
            </div>
            {meta && (
              <p className="text-xs text-muted-foreground -mt-3">
                允许的服务器：{meta.allowedHosts.join('、')}（由服务器环境变量 MAIL_HOST_ALLOWLIST 控制）
              </p>
            )}

            <div className="space-y-3 border-t border-border pt-5">
              <div className="text-sm font-medium">拉取规则</div>
              {SWITCHES.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm">{s.label}</div>
                    <div className="text-xs text-muted-foreground">{s.hint}</div>
                  </div>
                  <Switch checked={form[s.key] as boolean} onCheckedChange={(v) => set(s.key, v as never)} />
                </div>
              ))}
              <div className="grid grid-cols-4 gap-4 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="syncIntervalMinutes">拉取间隔（分钟）</Label>
                  <Input
                    id="syncIntervalMinutes"
                    type="number"
                    value={form.syncIntervalMinutes}
                    onChange={(e) => set('syncIntervalMinutes', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxPerRun">单次拉取上限（1-{MAX_PER_RUN_CEILING}）</Label>
                  <Input id="maxPerRun" type="number" value={form.maxPerRun} onChange={(e) => set('maxPerRun', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="syncDateFrom">只拉此日期之后</Label>
                  <Input id="syncDateFrom" type="date" value={form.syncDateFrom} onChange={(e) => set('syncDateFrom', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="syncDateTo">只拉此日期之前</Label>
                  <Input id="syncDateTo" type="date" value={form.syncDateTo} onChange={(e) => set('syncDateTo', e.target.value)} />
                </div>
              </div>
            </div>
          </fieldset>

          {result && (
            <Alert variant={result.imapOk && result.smtpOk ? 'success' : 'destructive'}>
              <AlertDescription className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant={result.imapOk ? 'secondary' : 'destructive'}>IMAP {result.imapOk ? '正常' : '失败'}</Badge>
                  <span>{result.imapMessage}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={result.smtpOk ? 'secondary' : 'destructive'}>SMTP {result.smtpOk ? '正常' : '失败'}</Badge>
                  <span>{result.smtpMessage}</span>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {editable && (
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={saving || !dirty}>
                {saving ? <Spinner className="size-4" /> : <Save className="size-4" />}
                保存配置
              </Button>
              <Button type="button" variant="outline" onClick={() => void onTest()} disabled={testing || !saved || dirty}>
                {testing ? <Spinner className="size-4" /> : <PlugZap className="size-4" />}
                测试连接
              </Button>
              {dirty && saved && <span className="text-xs text-muted-foreground">有未保存的修改，保存后再测试</span>}
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
