import { RULE_SLOTS, type RuleSlot } from '@aftersell/shared';
import type { CaseSignals } from './signals';

/** JSON logic 子集：var / == / != / and / or / ! / > / >= / < / <= / in */
export type Logic = { [op: string]: unknown } | boolean | number | string | null;

export function evaluate(logic: unknown, data: Record<string, unknown>): unknown {
  if (logic === null || typeof logic !== 'object' || Array.isArray(logic)) return logic;
  const entries = Object.entries(logic as Record<string, unknown>);
  if (entries.length !== 1) throw new Error(`条件格式错误：${JSON.stringify(logic)}`);
  const [op, raw] = entries[0];
  const args = Array.isArray(raw) ? raw : [raw];
  const val = (i: number) => evaluate(args[i], data);
  switch (op) {
    case 'var': {
      const name = String(args[0]);
      if (!(name in data)) throw new Error(`未知信号：${name}`);
      return data[name];
    }
    case '==':
      return val(0) === val(1);
    case '!=':
      return val(0) !== val(1);
    case '!':
      return !val(0);
    case 'and':
      return args.every((_, i) => Boolean(val(i)));
    case 'or':
      return args.some((_, i) => Boolean(val(i)));
    case '>':
      return Number(val(0)) > Number(val(1));
    case '>=':
      return Number(val(0)) >= Number(val(1));
    case '<':
      return Number(val(0)) < Number(val(1));
    case '<=':
      return Number(val(0)) <= Number(val(1));
    case 'in': {
      const list = val(1);
      return Array.isArray(list) && list.includes(val(0));
    }
    default:
      throw new Error(`不支持的条件运算：${op}`);
  }
}

/** 文案里的 {signalName} 替换为信号值；未知占位符原样保留 */
export function renderText(text: string, signals: CaseSignals): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = signals[name];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : whole;
  });
}

export interface EngineRule {
  key: string;
  slot: RuleSlot;
  priority: number;
  exclusive: boolean;
  when: unknown;
  text: string;
  enabled: boolean;
}

export interface RuleEvaluation {
  /** 按槽位顺序、槽内按优先级排好的命中规则 */
  hits: { key: string; slot: RuleSlot; text: string }[];
  /** 条件求值出错的规则（跳过，不影响其他规则） */
  errors: { key: string; error: string }[];
}

/**
 * 通用评估器（不含业务）：按槽位分组 → 槽内按 priority 从高到低 → 逐条求 when →
 * 命中 exclusive 规则后停止该槽 → 渲染文案。
 */
export function evaluateRules(rules: EngineRule[], signals: CaseSignals): RuleEvaluation {
  const hits: RuleEvaluation['hits'] = [];
  const errors: RuleEvaluation['errors'] = [];
  for (const slot of RULE_SLOTS) {
    const inSlot = rules
      .filter((r) => r.enabled && r.slot === slot)
      .sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
    for (const r of inSlot) {
      let matched: boolean;
      try {
        matched = r.when == null ? true : Boolean(evaluate(r.when, signals));
      } catch (error) {
        errors.push({ key: r.key, error: error instanceof Error ? error.message : String(error) });
        continue;
      }
      if (!matched) continue;
      hits.push({ key: r.key, slot, text: renderText(r.text, signals).trim() });
      if (r.exclusive) break;
    }
  }
  return { hits, errors };
}
