import { useCallback, useEffect, useState } from 'react';
import { Plug, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { saveFeishuConfigSchema, type FeishuConfigDto, type FeishuTestResult, type LedgerStatusDto } from '@aftersell/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/auth';
import { api, messageOf } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/** 飞书应用（登录 + 台账）配置；App Secret 加密保存，不回显 */
export default function FeishuCard() {
  const { can } = useAuth();
  const admin = can('admin');
  const [form, setForm] = useState({ appId: '', appSecret: '', ledgerEnabled: false, ledgerUrl: '' });
  const [saved, setSaved] = useState<FeishuConfigDto | null | undefined>(undefined);
  const [ledger, setLedger] = useState<LedgerStatusDto | null>(null);
  const [test, setTest] = useState<FeishuTestResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([api.get<FeishuConfigDto | null>('/feishu/config'), api.get<LedgerStatusDto>('/feishu/ledger')]);
      setSaved(c);
      setLedger(l);
      if (c) setForm({ appId: c.appId, appSecret: '', ledgerEnabled: c.ledgerEnabled, ledgerUrl: c.ledgerUrl ?? '' });
    } catch (e) {
      toast.error(messageOf(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const parsed = saveFeishuConfigSchema.safeParse({ ...form, appSecret: form.appSecret || undefined, ledgerUrl: form.ledgerUrl.trim() || null });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? '请检查输入');
    void act(async () => {
      await api.put('/feishu/config', parsed.data);
      setForm((f) => ({ ...f, appSecret: '' }));
      await load();
    }, '已保存');
  };

  if (saved === undefined) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" /> 加载中…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>飞书应用</CardTitle>
          <CardDescription>用于把客诉写入飞书台账（登录仍用邮箱和密码）。App Secret 加密保存，保存后不再显示。{!admin && ' 只有管理员可以修改。'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <fieldset disabled={!admin} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>App ID</Label>
                <Input value={form.appId} placeholder="cli_..." onChange={(e) => setForm({ ...form, appId: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>App Secret</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder={saved?.hasAppSecret ? '已保存，留空不修改' : ''}
                  value={form.appSecret}
                  onChange={(e) => setForm({ ...form, appSecret: e.target.value })}
                />
              </div>
            </div>
            <label className="flex items-start gap-3">
              <Switch checked={form.ledgerEnabled} onCheckedChange={(v) => setForm({ ...form, ledgerEnabled: v })} />
              <span className="space-y-1">
                <span className="text-sm font-medium block">台账同步</span>
                <span className="text-xs text-muted-foreground block">
                  每个客户一行，邮件分类完成、发出回复后约 1 分钟内更新。只写表里已有的同名字段，空值不覆盖人工填写的内容。
                </span>
              </span>
            </label>
            <div className="space-y-1.5">
              <Label>台账多维表格链接</Label>
              <Input value={form.ledgerUrl} placeholder="打开那张表后复制浏览器地址，需包含 table=tbl..." onChange={(e) => setForm({ ...form, ledgerUrl: e.target.value })} />
              <p className="text-xs text-muted-foreground">还要在这张表右上角“…→ 添加文档应用”里加上这个飞书应用，否则没有写入权限。</p>
            </div>
          </fieldset>
          {admin && (
            <div className="flex gap-2">
              <Button onClick={save} disabled={busy}>
                <Save className="size-4" /> 保存
              </Button>
              {saved && (
                <Button variant="outline" disabled={busy} onClick={() => void act(async () => setTest(await api.post<FeishuTestResult>('/feishu/test')))}>
                  <Plug className="size-4" /> 测试
                </Button>
              )}
            </div>
          )}
          {test && (
            <div className="space-y-2">
              <div className={`text-sm ${test.ok ? 'text-green-700' : 'text-destructive'}`}>{test.message}</div>
              {test.fields.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {test.fields.map((f) => (
                    <Badge key={f.name} variant={f.used ? 'secondary' : 'outline'} className={f.used ? '' : 'text-muted-foreground'}>
                      {f.name}
                    </Badge>
                  ))}
                </div>
              )}
              {test.fields.length > 0 && <p className="text-xs text-muted-foreground">灰底是系统会写的字段，其余由人工维护。</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {ledger?.enabled && (
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>台账同步状态</CardTitle>
              <CardDescription className="mt-1.5">
                已同步 {ledger.rows} 个客户
                {ledger.lastSyncAt && ` · 最近一次 ${formatDateTime(ledger.lastSyncAt)}：${ledger.lastMessage ?? ''}`}
                {ledger.running && ' · 同步中…'}
              </CardDescription>
            </div>
            {admin && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => window.confirm('把所有客诉客户重新写一遍台账？一般只在更换表格后需要。') && void act(() => api.post('/feishu/ledger/resync'), '已开始，约 1 分钟内生效')}
              >
                <RefreshCw className="size-4" /> 全部重新同步
              </Button>
            )}
          </CardHeader>
          {ledger.failed.length > 0 && (
            <CardContent className="space-y-1 text-sm">
              <div className="text-destructive">以下客户同步失败，10 分钟后自动重试：</div>
              {ledger.failed.map((f) => (
                <div key={f.customer} className="text-xs">
                  <span className="font-medium">{f.customer}</span> <span className="text-muted-foreground">{f.error}</span>
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
