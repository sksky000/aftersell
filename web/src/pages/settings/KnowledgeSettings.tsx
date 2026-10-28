import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  CATEGORY_LABELS,
  PART_TYPE_LABELS,
  PART_TYPES,
  paymentSettingsSchema,
  RULE_SLOT_LABELS,
  RULE_SLOTS,
  savePriceItemSchema,
  type KnowledgeCardDto,
  type PaymentSettings,
  type PriceItemDto,
  type ProductKnowledgeDto,
  type RuleDto,
  type StyleRuleDto,
} from '@aftersell/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/auth';
import { api, messageOf } from '@/lib/api';

const TEXTAREA =
  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60';

/** 读一个列表接口，返回数据与刷新函数 */
function useList<T>(url: string) {
  const [items, setItems] = useState<T[] | null>(null);
  const reload = useCallback(async () => {
    try {
      setItems(await api.get<T[]>(url));
    } catch (e) {
      toast.error(messageOf(e));
    }
  }, [url]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { items, reload };
}

function Loading() {
  return (
    <div className="flex items-center gap-2 text-muted-foreground text-sm">
      <Spinner className="size-4" /> 加载中…
    </div>
  );
}

async function run(action: () => Promise<unknown>, ok: string): Promise<boolean> {
  try {
    await action();
    toast.success(ok);
    return true;
  } catch (e) {
    toast.error(messageOf(e));
    return false;
  }
}

// ---------- 收款信息 ----------

function PaymentCard() {
  const { can } = useAuth();
  const editable = can('admin');
  const [form, setForm] = useState<PaymentSettings | null>(null);
  useEffect(() => {
    api.get<PaymentSettings>('/knowledge/payment').then(setForm, (e) => toast.error(messageOf(e)));
  }, []);
  if (!form) return <Loading />;
  const save = async () => {
    const parsed = paymentSettingsSchema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? '请检查输入');
    await run(() => api.put('/knowledge/payment', parsed.data), '收款信息已保存');
  };
  const fields: [keyof PaymentSettings, string][] = [
    ['zelleEmail', 'Zelle 账号（邮箱）'],
    ['zelleName', '户名'],
    ['zellePhone', '电话'],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>收款信息</CardTitle>
        <CardDescription>草稿需要收款时原样使用这里的 Zelle 信息；不写进代码仓库。{!editable && ' 只有管理员可以修改。'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset disabled={!editable} className="grid grid-cols-3 gap-4">
          {fields.map(([key, label]) => (
            <div key={key} className="space-y-2">
              <Label>{label}</Label>
              <Input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
            </div>
          ))}
          <div className="space-y-2 col-span-3">
            <Label>其他收款说明（可选）</Label>
            <Input
              value={form.extraNote}
              placeholder="例如：无法使用 Zelle 的客户可提供 Stripe 支付链接"
              onChange={(e) => setForm({ ...form, extraNote: e.target.value })}
            />
          </div>
        </fieldset>
        {editable && (
          <Button onClick={() => void save()}>
            <Save className="size-4" /> 保存
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- 价格表 ----------

const EMPTY_PRICE = { partType: 'battery', modelCode: '', label: '', amount: '', includesShipping: true, note: '', enabled: true };

function PricesCard() {
  const { items, reload } = useList<PriceItemDto>('/knowledge/prices');
  const [editing, setEditing] = useState<{ id: string | null; form: typeof EMPTY_PRICE } | null>(null);
  const save = async () => {
    if (!editing) return;
    const f = editing.form;
    const parsed = savePriceItemSchema.safeParse({ ...f, amount: Number(f.amount), modelCode: f.modelCode || null, note: f.note || null });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? '请检查输入');
    const ok = await run(
      () => (editing.id ? api.put(`/knowledge/prices/${editing.id}`, parsed.data) : api.post('/knowledge/prices', parsed.data)),
      '价格已保存',
    );
    if (ok) {
      setEditing(null);
      void reload();
    }
  };
  const remove = async (p: PriceItemDto) => {
    if (!window.confirm(`删除“${p.label}”？`)) return;
    if (await run(() => api.delete(`/knowledge/prices/${p.id}`), '已删除')) void reload();
  };
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>价格表</CardTitle>
          <CardDescription className="mt-1.5">草稿只能用这里的价格报价；填了车型码的价格只适用于该车型。草稿里出现表外金额会提示核对。</CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing({ id: null, form: { ...EMPTY_PRICE } })}>
          <Plus className="size-4" /> 添加
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {!items ? (
          <Loading />
        ) : !items.length ? (
          <div className="text-sm text-muted-foreground">还没有价格。没有价格时草稿会写“we will check and confirm the price”。</div>
        ) : (
          items.map((p) => (
            <div key={p.id} className="flex items-center gap-3 text-sm border-b border-border pb-2 last:border-0">
              <span className={`flex-1 ${p.enabled ? '' : 'text-muted-foreground line-through'}`}>
                {p.label}
                <span className="ml-2 text-xs text-muted-foreground">
                  {PART_TYPE_LABELS[p.partType as keyof typeof PART_TYPE_LABELS]}
                  {p.modelCode ? ` · ${p.modelCode}` : ' · 不限车型'}
                  {p.includesShipping ? ' · 含运费' : ' · 不含运费'}
                </span>
              </span>
              <span className="font-medium">${p.amount}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setEditing({
                    id: p.id,
                    form: { ...p, amount: String(p.amount), modelCode: p.modelCode ?? '', note: p.note ?? '' },
                  })
                }
              >
                <Pencil className="size-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void remove(p)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))
        )}
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? '修改价格' : '添加价格'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label>名称（英文，会出现在报价里）</Label>
                <Input value={editing.form.label} placeholder="Replacement battery" onChange={(e) => setEditing({ ...editing, form: { ...editing.form, label: e.target.value } })} />
              </div>
              <div className="space-y-2">
                <Label>零件类型</Label>
                <Select value={editing.form.partType} onValueChange={(v) => setEditing({ ...editing, form: { ...editing.form, partType: v } })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PART_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {PART_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>车型码（可选）</Label>
                <Input value={editing.form.modelCode} placeholder="22CB2702YD" onChange={(e) => setEditing({ ...editing, form: { ...editing.form, modelCode: e.target.value } })} />
              </div>
              <div className="space-y-2">
                <Label>价格（美元）</Label>
                <Input type="number" value={editing.form.amount} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, amount: e.target.value } })} />
              </div>
              <div className="space-y-2">
                <Label>备注（可选）</Label>
                <Input value={editing.form.note} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, note: e.target.value } })} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={editing.form.includesShipping} onCheckedChange={(v) => setEditing({ ...editing, form: { ...editing.form, includesShipping: v } })} />
                含运费
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={editing.form.enabled} onCheckedChange={(v) => setEditing({ ...editing, form: { ...editing.form, enabled: v } })} />
                启用
              </label>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => void save()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------- 风格条目 ----------

function StylesCard() {
  const { items, reload } = useList<StyleRuleDto>('/knowledge/styles');
  const [editing, setEditing] = useState<{ id: string | null; text: string } | null>(null);
  const save = async (s: StyleRuleDto | null, patch: { text?: string; enabled?: boolean }) => {
    const body = { text: patch.text ?? s?.text ?? '', category: s?.category ?? null, partType: s?.partType ?? null, enabled: patch.enabled ?? s?.enabled ?? true };
    const ok = await run(() => (s ? api.put(`/knowledge/styles/${s.id}`, body) : api.post('/knowledge/styles', body)), '已保存');
    if (ok) {
      setEditing(null);
      void reload();
    }
  };
  const remove = async (s: StyleRuleDto) => {
    if (!window.confirm('删除这条风格条目？')) return;
    if (await run(() => api.delete(`/knowledge/styles/${s.id}`), '已删除')) void reload();
  };
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>风格条目</CardTitle>
          <CardDescription className="mt-1.5">客服改稿沉淀下来的写法偏好，每条可单独开关；与案件证据冲突时以证据为准。</CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing({ id: null, text: '' })}>
          <Plus className="size-4" /> 添加
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {!items ? (
          <Loading />
        ) : (
          items.map((s) => (
            <div key={s.id} className="flex items-start gap-3 text-sm border-b border-border pb-2 last:border-0">
              <Switch checked={s.enabled} onCheckedChange={(v) => void save(s, { enabled: v })} />
              <span className={`flex-1 ${s.enabled ? '' : 'text-muted-foreground'}`}>{s.text}</span>
              <Button variant="ghost" size="sm" onClick={() => setEditing({ id: s.id, text: s.text })}>
                <Pencil className="size-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void remove(s)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))
        )}
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? '修改风格条目' : '添加风格条目'}</DialogTitle>
          </DialogHeader>
          {editing && <textarea className={TEXTAREA} rows={5} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />}
          <DialogFooter>
            <Button onClick={() => editing && void save(items?.find((s) => s.id === editing.id) ?? null, { text: editing.text })}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------- 规则 ----------

function RulesCard() {
  const { items, reload } = useList<RuleDto>('/rules');
  const [editing, setEditing] = useState<RuleDto | null>(null);
  const patch = async (key: string, body: Partial<RuleDto>) => {
    const ok = await run(() => api.patch(`/rules/${key}`, body), '规则已更新，下次生成草稿生效');
    if (ok) {
      setEditing(null);
      void reload();
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>规则</CardTitle>
        <CardDescription>
          每条规则 = 条件 + 注入草稿上下文的文案。同一组里按优先级从高到低判断，标“互斥”的规则命中后同组其余规则不再生效。改文案、优先级或开关不用发版。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!items ? (
          <Loading />
        ) : (
          RULE_SLOTS.map((slot) => {
            const inSlot = items.filter((r) => r.slot === slot).sort((a, b) => b.priority - a.priority);
            if (!inSlot.length) return null;
            return (
              <div key={slot} className="space-y-2">
                <div className="text-sm font-medium">{RULE_SLOT_LABELS[slot]}</div>
                {inSlot.map((r) => (
                  <div key={r.key} className="flex items-center gap-3 text-sm">
                    <Switch checked={r.enabled} onCheckedChange={(v) => void patch(r.key, { enabled: v })} />
                    <span className={`flex-1 ${r.enabled ? '' : 'text-muted-foreground'}`}>
                      {r.description}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {r.key} · 优先级 {r.priority}
                      </span>
                    </span>
                    {r.exclusive && <Badge variant="outline">互斥</Badge>}
                    <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                      <Pencil className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing?.description}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground break-all">
                条件：{editing.when ? JSON.stringify(editing.when) : '总是'}
                {editing.source ? ` · 来源：${editing.source}` : ''}
              </div>
              <div className="space-y-2">
                <Label>注入文案（{'{占位符}'} 会替换为本封邮件的值）</Label>
                <textarea className={TEXTAREA} rows={10} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
              </div>
              <div className="flex items-center gap-6">
                <div className="space-y-2">
                  <Label>优先级</Label>
                  <Input type="number" className="w-28" value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: Number(e.target.value) })} />
                </div>
                <label className="flex items-center gap-2 text-sm mt-6">
                  <Switch checked={editing.exclusive} onCheckedChange={(v) => setEditing({ ...editing, exclusive: v })} />
                  互斥
                </label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => editing && void patch(editing.key, { text: editing.text, priority: editing.priority, exclusive: editing.exclusive })}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------- 知识卡与说明书知识 ----------

function CardsCard() {
  const { items, reload } = useList<KnowledgeCardDto>('/knowledge/cards');
  const [open, setOpen] = useState<string | null>(null);
  const toggle = async (c: KnowledgeCardDto, enabled: boolean) => {
    if (await run(() => api.patch(`/knowledge/cards/${c.id}`, { enabled }), enabled ? '已启用' : '已停用')) void reload();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>知识卡</CardTitle>
        <CardDescription>从妙搭历史回复聚类出的场景知识（只导入已审批的）。按“类别 + 零件 + 是否带图”匹配一张注入草稿；卡里的价格和收款信息不使用。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {!items ? (
          <Loading />
        ) : !items.length ? (
          <div className="text-sm text-muted-foreground">还没有导入知识卡。</div>
        ) : (
          items.map((c) => (
            <div key={c.id} className="border-b border-border pb-2 last:border-0">
              <div className="flex items-center gap-3 text-sm">
                <Switch checked={c.enabled} onCheckedChange={(v) => void toggle(c, v)} />
                <button type="button" className="flex-1 text-left hover:underline" onClick={() => setOpen(open === c.id ? null : c.id)}>
                  {CATEGORY_LABELS[c.category as keyof typeof CATEGORY_LABELS] ?? c.category} ·{' '}
                  {PART_TYPE_LABELS[c.partType as keyof typeof PART_TYPE_LABELS] ?? c.partType} · {c.imageFlag === 'with_images' ? '带图' : '无图'}
                  <span className="ml-2 text-xs text-muted-foreground">样本 {c.sampleSize}</span>
                </button>
              </div>
              {open === c.id && (
                <div className="mt-2 ml-12 text-xs space-y-1 text-foreground/80">
                  {c.facts.map((f) => (
                    <div key={f}>· {f}</div>
                  ))}
                  {c.rules.map((r) => (
                    <div key={r}>▸ {r}</div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ProductsCard() {
  const { items, reload } = useList<ProductKnowledgeDto>('/knowledge/products');
  const [editing, setEditing] = useState<ProductKnowledgeDto | null>(null);
  const patch = async (code: string, body: { knowledge?: string; enabled?: boolean }) => {
    if (await run(() => api.patch(`/knowledge/products/${code}`, body), '已保存')) {
      setEditing(null);
      void reload();
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>说明书知识</CardTitle>
        <CardDescription>按邮件里的型号码或车型关键词匹配一个车型，把它的说明书要点注入草稿。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {!items ? (
          <Loading />
        ) : (
          items.map((p) => (
            <div key={p.modelCode} className="flex items-center gap-3 text-sm border-b border-border pb-2 last:border-0">
              <Switch checked={p.enabled} onCheckedChange={(v) => void patch(p.modelCode, { enabled: v })} />
              <span className="flex-1">
                {p.name}
                <span className="ml-2 text-xs text-muted-foreground">
                  {p.modelCode}
                  {p.electric ? ' · 电动' : ''}
                  {p.noToolkit ? ' · 不带工具包' : ''}
                </span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                <Pencil className="size-4" />
              </Button>
            </div>
          ))
        )}
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing?.name}</DialogTitle>
          </DialogHeader>
          {editing && <textarea className={TEXTAREA} rows={16} value={editing.knowledge} onChange={(e) => setEditing({ ...editing, knowledge: e.target.value })} />}
          <DialogFooter>
            <Button onClick={() => editing && void patch(editing.modelCode, { knowledge: editing.knowledge })}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function KnowledgeSettings() {
  return (
    <div className="space-y-6">
      <PaymentCard />
      <PricesCard />
      <StylesCard />
      <RulesCard />
      <CardsCard />
      <ProductsCard />
    </div>
  );
}
