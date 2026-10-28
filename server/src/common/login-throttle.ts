/**
 * 登录失败节流：同一 key（邮箱 / IP）在窗口内失败次数超过上限即锁定到窗口结束。
 * 单实例内存实现；第一阶段只有一个 app 容器，够用。
 */
export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  /** 返回剩余锁定秒数，0 表示未锁定 */
  lockedFor(key: string): number {
    const entry = this.failures.get(key);
    if (!entry) return 0;
    const t = this.now();
    if (t >= entry.resetAt) {
      this.failures.delete(key);
      return 0;
    }
    return entry.count >= this.maxFailures ? Math.ceil((entry.resetAt - t) / 1000) : 0;
  }

  recordFailure(key: string): void {
    const t = this.now();
    const entry = this.failures.get(key);
    if (!entry || t >= entry.resetAt) {
      this.failures.set(key, { count: 1, resetAt: t + this.windowMs });
    } else {
      entry.count += 1;
    }
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}
