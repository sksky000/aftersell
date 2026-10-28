/**
 * 解析妙搭导出的 INSERT 语句（单条多行 VALUES，字符串 '' 转义、NULL）为对象数组。
 * 只用于一次性导入，不处理一般 SQL。
 */
export function parseInsert(sql: string): Record<string, string | null>[] {
  const head = /INSERT INTO [^(]+\(([^)]*)\)\s*VALUES\s*/i.exec(sql);
  if (!head) throw new Error('不是 INSERT 语句');
  const cols = head[1].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  let i = head.index + head[0].length;
  const rows: Record<string, string | null>[] = [];
  const skipSpace = () => {
    while (i < sql.length && /\s/.test(sql[i])) i += 1;
  };
  while (i < sql.length) {
    while (i < sql.length && /[\s,;]/.test(sql[i])) i += 1;
    if (sql[i] !== '(') break;
    i += 1;
    const values: (string | null)[] = [];
    for (;;) {
      skipSpace();
      // E'...' 是 PostgreSQL 的转义字符串：额外支持反斜杠转义
      const escaped = (sql[i] === 'E' || sql[i] === 'e') && sql[i + 1] === "'";
      if (escaped) i += 1;
      if (sql[i] === "'") {
        let s = '';
        i += 1;
        for (;;) {
          if (i >= sql.length) throw new Error('字符串未闭合');
          if (escaped && sql[i] === '\\') {
            const next = sql[i + 1];
            s += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
            i += 2;
          } else if (sql[i] === "'" && sql[i + 1] === "'") {
            s += "'";
            i += 2;
          } else if (sql[i] === "'") {
            i += 1;
            break;
          } else {
            s += sql[i];
            i += 1;
          }
        }
        values.push(s);
      } else {
        let j = i;
        while (j < sql.length && sql[j] !== ',' && sql[j] !== ')') j += 1;
        const raw = sql.slice(i, j).trim();
        values.push(raw.toUpperCase() === 'NULL' ? null : raw);
        i = j;
      }
      skipSpace();
      if (sql[i] === ',') {
        i += 1;
        continue;
      }
      if (sql[i] === ')') {
        i += 1;
        break;
      }
      throw new Error(`解析失败，位置 ${i}`);
    }
    if (values.length !== cols.length) throw new Error(`第 ${rows.length + 1} 行有 ${values.length} 个值，应为 ${cols.length}`);
    rows.push(Object.fromEntries(cols.map((c, k) => [c, values[k]])));
  }
  return rows;
}
