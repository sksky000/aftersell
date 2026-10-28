import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { mailRoutingSchema, type MailRouting } from '@aftersell/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/auth';
import { api, messageOf } from '@/lib/api';

type FormState = Record<keyof MailRouting, string>;

const FIELDS: { key: keyof MailRouting; label: string; hint: string }[] = [
  { key: 'hotlineSenders', label: '热线工单发件地址', hint: '热线平台转发 800 电话记录所用的地址；“仅拉取热线工单”按此识别' },
  { key: 'leaderForwardAddresses', label: '领导转发地址', hint: '领导把客户邮件转发进来时的地址；会从转发内容里解析出真正的客户' },
  { key: 'ownAddresses', label: '我方地址', hint: '客服信箱等我方地址；解析转发邮件时不会被当成客户' },
];

const toForm = (r: MailRouting): FormState => ({
  hotlineSenders: r.hotlineSenders.join('\n'),
  leaderForwardAddresses: r.leaderForwardAddresses.join('\n'),
  ownAddresses: r.ownAddresses.join('\n'),
});

const splitList = (text: string) => text.split(/[\s,;，；]+/).filter(Boolean);

export default function MailRoutingCard() {
  const { can } = useAuth();
  const editable = can('admin');
  const [saved, setSaved] = useState<MailRouting | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.get<MailRouting>('/settings/mail-routing');
      setSaved(r);
      setForm(toForm(r));
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => !!saved && !!form && JSON.stringify(toForm(saved)) !== JSON.stringify(form), [saved, form]);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const parsed = mailRoutingSchema.safeParse({
      hotlineSenders: splitList(form.hotlineSenders),
      leaderForwardAddresses: splitList(form.leaderForwardAddresses),
      ownAddresses: splitList(form.ownAddresses),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? '请检查输入');
      return;
    }
    setSaving(true);
    try {
      const next = await api.put<MailRouting>('/settings/mail-routing', parsed.data);
      setSaved(next);
      setForm(toForm(next));
      toast.success('地址设置已保存');
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSaving(false);
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
  if (!form) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Spinner className="size-4" /> 加载中…
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>发件人角色</CardTitle>
        <CardDescription>
          决定热线工单识别、领导转发解析和案件归组时“客户是谁”。每行一个地址。
          {!editable && ' 只有管理员可以修改。'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={(e) => void onSave(e)}>
          <fieldset disabled={!editable} className="grid grid-cols-3 gap-4">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-2">
                <Label htmlFor={f.key}>{f.label}</Label>
                <textarea
                  id={f.key}
                  rows={4}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
                />
                <p className="text-xs text-muted-foreground">{f.hint}</p>
              </div>
            ))}
          </fieldset>
          {editable && (
            <Button type="submit" disabled={saving || !dirty}>
              {saving ? <Spinner className="size-4" /> : <Save className="size-4" />}
              保存
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
