import { E_BIKE_GUARD } from './product-knowledge.seed';

export interface ProductKnowledgeSeed {
  modelCode: string;
  name: string;
  codePattern: string;
  matchers: string[];
  electric: boolean;
  noToolkit: boolean;
  knowledge: string;
  sortOrder: number;
}

export interface CompiledModel {
  modelCode: string;
  name: string;
  code: RegExp;
  matchers: RegExp[];
  electric: boolean;
  noToolkit: boolean;
  knowledge: string;
}

const eBikeGuard = new RegExp(E_BIKE_GUARD, 'i');

/** 表里的正则编译失败时跳过该条，由调用方记录 */
export function compileModels(
  rows: (Omit<ProductKnowledgeSeed, 'sortOrder'> & { sortOrder: number; enabled?: boolean })[],
  onInvalid: (modelCode: string, error: string) => void = () => undefined,
): CompiledModel[] {
  const compiled: CompiledModel[] = [];
  for (const row of [...rows].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (row.enabled === false) continue;
    try {
      compiled.push({
        modelCode: row.modelCode,
        name: row.name,
        code: new RegExp(row.codePattern, 'i'),
        matchers: row.matchers.map((m) => new RegExp(m, 'i')),
        electric: row.electric,
        noToolkit: row.noToolkit,
        knowledge: row.knowledge,
      });
    } catch (error) {
      onInvalid(row.modelCode, String(error));
    }
  }
  return compiled;
}

/** 文本里出现明确的型号码 */
export function hasModelCodeText(models: CompiledModel[], text: string): boolean {
  return !!text && models.some((m) => m.code.test(text));
}

/**
 * 妙搭 matchManualModel：型号码是强信号，永远优先于关键词；
 * 出现电动词且没有任何型号码时，只允许电动车型按关键词匹配（防非电动说明书误注入电动邮件）。
 */
export function matchModel(models: CompiledModel[], haystack: string): CompiledModel | null {
  if (!haystack) return null;
  const hasExplicitCode = hasModelCodeText(models, haystack);
  if (!hasExplicitCode && eBikeGuard.test(haystack)) {
    return models.find((m) => m.electric && m.matchers.some((r) => r.test(haystack))) ?? null;
  }
  return models.find((m) => m.code.test(haystack)) ?? models.find((m) => m.matchers.some((r) => r.test(haystack))) ?? null;
}
