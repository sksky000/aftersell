import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const cache = new Map<string, string>();

/**
 * 读取 server/prompts/<name>.md。system prompt 随代码版本管理；
 * 业务事实（价格、知识、风格条目）不写在这里，由代码从表里读出放进 user turn。
 */
export function loadPrompt(name: string): string {
  let text = cache.get(name);
  if (text === undefined) {
    // src/llm 与 dist/llm 到 server/prompts 的相对位置相同
    text = readFileSync(path.resolve(__dirname, '../../prompts', `${name}.md`), 'utf8').trim();
    cache.set(name, text);
  }
  return text;
}
