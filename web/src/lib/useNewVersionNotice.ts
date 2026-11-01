import { useEffect } from 'react';
import { toast } from 'sonner';

const CHECK_MS = 5 * 60 * 1000;
const ENTRY_RE = /\/assets\/index-[\w-]+\.js/;

/** 当前页面加载的入口脚本；开发环境没有带哈希的入口，返回 null 不检查 */
function currentEntry(): string | null {
  for (const s of document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')) {
    const m = s.src.match(ENTRY_RE);
    if (m) return m[0];
  }
  return null;
}

/**
 * 单页应用在不刷新的情况下一直跑旧代码：部署后提示刷新。
 * 每 5 分钟、以及切回这个标签页时，比较服务器上 index.html 引用的入口脚本。
 */
export function useNewVersionNotice(): void {
  useEffect(() => {
    const loaded = currentEntry();
    if (!loaded) return;
    let notified = false;
    const check = async () => {
      if (notified || document.visibilityState !== 'visible') return;
      try {
        const html = await (await fetch('/', { cache: 'no-store', credentials: 'same-origin' })).text();
        const latest = html.match(ENTRY_RE)?.[0];
        if (latest && latest !== loaded) {
          notified = true;
          toast.info('系统已更新，刷新页面后使用新版本', {
            duration: Infinity,
            action: { label: '刷新', onClick: () => window.location.reload() },
          });
        }
      } catch {
        // 网络抖动时下次再查
      }
    };
    const timer = window.setInterval(() => void check(), CHECK_MS);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);
}
