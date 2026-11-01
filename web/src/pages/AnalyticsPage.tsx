import { useCallback, useEffect, useState } from 'react';
import { Settings2, Table2, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import {
  ANALYTICS_RANGES,
  CATEGORY_LABELS,
  LLM_SLOT_LABELS,
  llmPricingSchema,
  PART_TYPE_LABELS,
  type AnalyticsDto,
  type Category,
  type LlmPricing,
  type LlmSlot,
  type PartType,
} from '@aftersell/shared';
import { BarList, compact, LineChart, SERIES, StatTile } from '@/components/charts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/auth';
import { api, messageOf } from '@/lib/api';

const CHECK_LABELS: Record<string, string> = {
  repeated_evidence_request: '重复索要已收到的材料',
  unknown_price: '金额不在价格表里',
  payment_mismatch: '收款账号不一致',
  empty_draft: '草稿为空',
  language_mismatch: '草稿语言不对',
};
const BACKLOG_LABELS: Record<string, string> = { '<1d': '不到 1 天', '1-3d': '1–3 天', '3-7d': '3–7 天', '>7d': '超过 7 天' };

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const hours = (v: number | null) => (v == null ? '—' : v < 1 ? `${Math.round(v * 60)} 分钟` : v < 48 ? `${v.toFixed(1)} 小时` : `${(v / 24).toFixed(1)} 天`);
const yuan = (v: number) => (v < 0.01 && v > 0 ? '< ¥0.01' : `¥${v.toFixed(v < 10 ? 2 : 0)}`);

export default function AnalyticsPage() {
  const { can } = useAuth();
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<AnalyticsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTable, setShowTable] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<AnalyticsDto>(`/analytics?days=${days}`));
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">数据分析</h1>
          <p className="text-sm text-muted-foreground mt-1">按北京时间统计；“当前待审核”与积压不受时间范围影响</p>
        </div>
        <div className="flex items-center gap-2">
          {loading && data && <Spinner className="size-4 text-muted-foreground" />}
          <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <TabsList className="bg-white">
              {ANALYTICS_RANGES.map((d) => (
                <TabsTrigger key={d} value={String(d)}>
                  近 {d} 天
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      {!data ? (
        <div className="flex items-center justify-center h-64 gap-2 text-muted-foreground">
          <Spinner className="size-4" /> 加载中…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatTile label="收到来信" value={compact(data.overview.received)} sub={`日均 ${(data.overview.received / data.range.days).toFixed(1)} 封`} />
            <StatTile label="发出回复" value={compact(data.overview.replied)} />
            <StatTile label="当前待审核" value={compact(data.overview.pendingNow)} sub={`已忽略 ${data.overview.ignored}`} />
            <StatTile label="首次回复用时（中位）" value={hours(data.timeliness.medianHours)} sub={`24 小时内回复 ${pct(data.timeliness.within24hRate)}`} />
            <StatTile
              label="AI 草稿直接发出"
              value={pct(data.aiQuality.sentWithDraft ? data.aiQuality.unedited / data.aiQuality.sentWithDraft : null)}
              sub={`${data.aiQuality.unedited} / ${data.aiQuality.sentWithDraft} 封未改动`}
            />
            <StatTile label="模型费用（估算）" value={yuan(data.llm.costCny)} sub={data.llm.unpricedModels.length ? `${data.llm.unpricedModels.length} 个模型未配单价` : `${compact(data.llm.calls)} 次调用`} />
          </div>

          <Card className="shadow-none">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base">收发趋势</CardTitle>
                <CardDescription className="mt-1">每天收到的来信与我方发出的回复</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)}>
                {showTable ? <TrendingUp className="size-4" /> : <Table2 className="size-4" />}
                {showTable ? '看图' : '看表格'}
              </Button>
            </CardHeader>
            <CardContent>
              {showTable ? (
                <div className="max-h-72 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>日期</TableHead>
                        <TableHead className="text-right">来信</TableHead>
                        <TableHead className="text-right">回复</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...data.trend].reverse().map((d) => (
                        <TableRow key={d.day}>
                          <TableCell>{d.day}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.received}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.replied}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <LineChart
                  data={data.trend}
                  series={[
                    { key: 'received', label: '来信', color: SERIES.blue },
                    { key: 'replied', label: '回复', color: SERIES.orange },
                  ]}
                />
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-base">来信类别</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList items={data.byCategory.map((c) => ({ key: c.key, label: CATEGORY_LABELS[c.key as Category] ?? c.key, value: c.count }))} />
              </CardContent>
            </Card>
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-base">零件类型</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList items={data.byPartType.map((c) => ({ key: c.key, label: PART_TYPE_LABELS[c.key as PartType] ?? c.key, value: c.count }))} />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-base">待审积压</CardTitle>
                <CardDescription>当前待审核邮件按已等待时长分组</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <BarList items={data.backlog.map((b) => ({ key: b.bucket, label: BACKLOG_LABELS[b.bucket], value: b.count }))} />
                <div className="text-xs text-muted-foreground">
                  区间内来信已回复 {data.timeliness.repliedEmails} 封 · 首次回复中位 {hours(data.timeliness.medianHours)} · 90% 在{' '}
                  {hours(data.timeliness.p90Hours)} 内
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-base">AI 草稿质量</CardTitle>
                <CardDescription>系统发出、带 AI 草稿的回复中，客服改过的比例；按类别看哪类草稿还需要调规则</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.aiQuality.byCategory.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>类别</TableHead>
                        <TableHead className="text-right">发出</TableHead>
                        <TableHead className="text-right">改过</TableHead>
                        <TableHead className="text-right">改稿率</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.aiQuality.byCategory.map((c) => (
                        <TableRow key={c.category}>
                          <TableCell>{CATEGORY_LABELS[c.category as Category] ?? c.category}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.sent}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.edited}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(c.sent ? c.edited / c.sent : null)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-sm text-muted-foreground">区间内还没有用 AI 草稿发出的回复</div>
                )}
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">区间内生成草稿 {data.aiQuality.draftsGenerated} 版，检查提示：</div>
                  {data.aiQuality.checks.length ? (
                    <BarList color={SERIES.orange} items={data.aiQuality.checks.map((c) => ({ key: c.key, label: CHECK_LABELS[c.key] ?? c.key, value: c.count }))} />
                  ) : (
                    <div className="text-sm text-muted-foreground">无</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-none">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base">模型调用</CardTitle>
                <CardDescription className="mt-1">
                  共 {compact(data.llm.calls)} 次，失败 {data.llm.failed} 次；输入 {compact(data.llm.inputTokens)} / 输出 {compact(data.llm.outputTokens)} tokens。
                  费用按设置的单价估算，未计缓存优惠，以服务商账单为准。
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setPricingOpen(true)}>
                <Settings2 className="size-4" /> 模型单价
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.llm.unpricedModels.length > 0 && (
                <div className="text-sm rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                  未配置单价、费用没算进去的模型：{data.llm.unpricedModels.join('、')}
                </div>
              )}
              {data.llm.bySlot.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>任务</TableHead>
                      <TableHead>模型</TableHead>
                      <TableHead className="text-right">调用</TableHead>
                      <TableHead className="text-right">失败</TableHead>
                      <TableHead className="text-right">输入 tokens</TableHead>
                      <TableHead className="text-right">输出 tokens</TableHead>
                      <TableHead className="text-right">平均耗时</TableHead>
                      <TableHead className="text-right">费用</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.llm.bySlot.map((r) => (
                      <TableRow key={`${r.slot}-${r.model}`}>
                        <TableCell>{LLM_SLOT_LABELS[r.slot as LlmSlot]?.label ?? r.slot}</TableCell>
                        <TableCell className="text-xs">{r.model}</TableCell>
                        <TableCell className="text-right tabular-nums">{compact(r.calls)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.failed}</TableCell>
                        <TableCell className="text-right tabular-nums">{compact(r.inputTokens)}</TableCell>
                        <TableCell className="text-right tabular-nums">{compact(r.outputTokens)}</TableCell>
                        <TableCell className="text-right tabular-nums">{(r.avgMs / 1000).toFixed(1)} 秒</TableCell>
                        <TableCell className="text-right tabular-nums">{r.costCny == null ? '未配单价' : yuan(r.costCny)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-sm text-muted-foreground">区间内没有模型调用</div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <PricingDialog
        open={pricingOpen}
        editable={can('admin')}
        models={[...new Set(data?.llm.bySlot.map((r) => r.model) ?? [])]}
        onClose={() => setPricingOpen(false)}
        onSaved={() => void load()}
      />
    </div>
  );
}

function PricingDialog({ open, editable, models, onClose, onSaved }: { open: boolean; editable: boolean; models: string[]; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<{ model: string; input: string; output: string }[]>([]);
  const [saving, setSaving] = useState(false);

  // 只在打开时读一次；models 每次渲染都是新数组，按内容比较，免得覆盖正在填写的内容
  const modelsKey = models.join('\n');
  useEffect(() => {
    if (!open) return;
    const models = modelsKey ? modelsKey.split('\n') : [];
    api
      .get<LlmPricing>('/analytics/pricing')
      .then((p) => {
        const known = new Map(p.prices.map((x) => [x.model, x]));
        // 已配置的 + 区间内用到但没配置的模型
        const all = [...new Set([...p.prices.map((x) => x.model), ...models])];
        setRows(all.map((m) => ({ model: m, input: known.has(m) ? String(known.get(m)!.inputPerMillion) : '', output: known.has(m) ? String(known.get(m)!.outputPerMillion) : '' })));
      })
      .catch((e) => toast.error(messageOf(e)));
  }, [open, modelsKey]);

  const save = async () => {
    const filled = rows.filter((r) => r.input.trim() !== '' || r.output.trim() !== '');
    const parsed = llmPricingSchema.safeParse({
      prices: filled.map((r) => ({ model: r.model.trim(), inputPerMillion: Number(r.input || 0), outputPerMillion: Number(r.output || 0) })),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? '请检查输入');
      return;
    }
    setSaving(true);
    try {
      await api.put('/analytics/pricing', parsed.data);
      toast.success('单价已保存');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>模型单价</DialogTitle>
          <DialogDescription>单位：元 / 百万 tokens，按服务商价目页填写（不含缓存优惠）。留空的模型不计费用。{!editable && ' 只有管理员可以修改。'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_7rem_7rem] gap-2 text-xs text-muted-foreground">
            <span>模型</span>
            <span>输入</span>
            <span>输出</span>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_7rem_7rem] gap-2">
              <Input value={r.model} disabled={!editable} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, model: e.target.value } : x)))} />
              <Input type="number" min={0} step="0.01" value={r.input} disabled={!editable} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, input: e.target.value } : x)))} />
              <Input type="number" min={0} step="0.01" value={r.output} disabled={!editable} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, output: e.target.value } : x)))} />
            </div>
          ))}
          {editable && (
            <Button variant="ghost" size="sm" onClick={() => setRows([...rows, { model: '', input: '', output: '' }])}>
              + 添加模型
            </Button>
          )}
        </div>
        {editable && (
          <DialogFooter>
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Spinner className="size-4" />}保存
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
