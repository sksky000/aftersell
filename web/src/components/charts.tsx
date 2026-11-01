import { useEffect, useRef, useState } from 'react';

/**
 * 轻量图表：收发趋势折线、横向条形、数字卡。颜色取 dataviz 参考调色板（已校验色盲可分），
 * 文字一律用正文颜色，不用系列色。
 */
export const SERIES = { blue: '#2a78d6', orange: '#eb6834' };
const GRID = '#e1e0d9';
const AXIS = '#c3c2b7';
const MUTED = '#898781';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** 取整到 1 / 2 / 5 × 10^n 的刻度上限 */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= v / 4)! * pow;
  return Math.ceil(v / step) * step;
}

export const compact = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万` : n.toLocaleString('zh-CN'));

export interface LineSeries {
  key: string;
  label: string;
  color: string;
}

/** 按天的多系列折线：十字线 + 悬停提示；图例始终显示 */
export function LineChart<T extends { day: string }>({ data, series, height = 220 }: { data: T[]; series: LineSeries[]; height?: number }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 12, right: 16, bottom: 26, left: 36 };
  const w = Math.max(width - pad.left - pad.right, 10);
  const h = height - pad.top - pad.bottom;
  const value = (d: T, k: string) => Number((d as Record<string, unknown>)[k] ?? 0);
  const max = niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => value(d, s.key)))));
  const x = (i: number) => (data.length <= 1 ? w / 2 : (i / (data.length - 1)) * w);
  const y = (v: number) => h - (v / max) * h;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(w / 64))));

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = data.length <= 1 ? 0 : Math.round(((e.clientX - box.left) / box.width) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  return (
    <div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 rounded" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join('、') + '趋势'}>
            <g transform={`translate(${pad.left},${pad.top})`}>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={0} x2={w} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth={1} />
                  <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={MUTED} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {compact(t)}
                  </text>
                </g>
              ))}
              {data.map((d, i) =>
                i % labelEvery === 0 || i === data.length - 1 ? (
                  <text key={d.day} x={x(i)} y={h + 18} textAnchor="middle" fontSize={11} fill={MUTED}>
                    {d.day.slice(5)}
                  </text>
                ) : null,
              )}
              {series.map((s) => (
                <polyline
                  key={s.key}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={data.map((d, i) => `${x(i)},${y(value(d, s.key))}`).join(' ')}
                />
              ))}
              {hover !== null && (
                <g>
                  <line x1={x(hover)} x2={x(hover)} y1={0} y2={h} stroke={AXIS} strokeWidth={1} />
                  {series.map((s) => (
                    <circle key={s.key} cx={x(hover)} cy={y(value(data[hover], s.key))} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />
                  ))}
                </g>
              )}
              <rect width={w} height={h} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
            </g>
          </svg>
        )}
        {hover !== null && width > 0 && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md"
            style={{ top: pad.top, left: Math.min(pad.left + x(hover) + 12, width - 150) }}
          >
            <div className="font-medium mb-1">{data[hover].day}</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="ml-auto pl-3 font-medium tabular-nums">{value(data[hover], s.key)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export interface BarItem {
  key: string;
  label: string;
  value: number;
  /** 悬停时显示的补充说明 */
  hint?: string;
}

/** 横向条形：数值标在条尾，单一系列颜色 */
export function BarList({ items, color = SERIES.blue, format = compact, empty = '暂无数据' }: { items: BarItem[]; color?: string; format?: (n: number) => string; empty?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <div className="text-sm text-muted-foreground py-6 text-center">{empty}</div>;
  return (
    <div className="space-y-1">
      {items.map((it) => (
        <div key={it.key} className="group grid grid-cols-[7rem_1fr] items-center gap-3 rounded px-1 py-1 hover:bg-muted/60" title={it.hint ?? `${it.label}：${format(it.value)}`}>
          <span className="text-sm truncate text-foreground/90">{it.label}</span>
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-3 rounded-r-[4px]" style={{ width: `${Math.max((it.value / max) * 85, it.value > 0 ? 1.5 : 0)}%`, background: color }} />
            <span className="text-xs tabular-nums text-muted-foreground">{format(it.value)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1 leading-tight">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
