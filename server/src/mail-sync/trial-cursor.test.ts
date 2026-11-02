import { describe, expect, it } from 'vitest';
import { advanceCursor } from './mail-sync.service';

describe('trial inbox cursor', () => {
  it('advances only over a contiguous run of handled UIDs', () => {
    expect(advanceCursor([5, 6, 7, 8], new Set([5, 6, 8]), 4)).toBe(6); // 7 被单次上限截断，8 虽已处理也不能跳过 7
    expect(advanceCursor([5, 6], new Set([5, 6]), 4)).toBe(6);
    expect(advanceCursor([], new Set(), 9)).toBe(9);
    expect(advanceCursor([3], new Set(), null)).toBe(0);
  });
});
