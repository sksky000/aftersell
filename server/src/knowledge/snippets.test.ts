import { describe, expect, it } from 'vitest';
import { CATEGORIES, saveSnippetSchema } from '@aftersell/shared';
import { renderPlaceholders } from './knowledge.service';
import { SNIPPET_SEED } from './snippets.seed';

describe('snippets', () => {
  it('seed has one SOP per category, unique keys, and valid entries', () => {
    const sopCategories = SNIPPET_SEED.filter((s) => s.kind === 'sop' && !s.partType).map((s) => s.category);
    expect(new Set(sopCategories)).toEqual(new Set(CATEGORIES));
    expect(new Set(SNIPPET_SEED.map((s) => s.seedKey)).size).toBe(SNIPPET_SEED.length);
    for (const { seedKey: _, ...s } of SNIPPET_SEED) expect(saveSnippetSchema.safeParse({ ...s, enabled: true }).success).toBe(true);
  });

  it('fills payment placeholders, and marks them when payment is not configured', () => {
    const text = 'Pay via Zelle {zelleEmail} (name: {zelleName}, phone number: {zellePhone}).';
    expect(renderPlaceholders(text, { zelleEmail: 'pay@example.test', zelleName: 'Pat', zellePhone: '555', extraNote: '' })).toBe(
      'Pay via Zelle pay@example.test (name: Pat, phone number: 555).',
    );
    expect(renderPlaceholders(text, { zelleEmail: '', zelleName: '', zellePhone: '', extraNote: '' })).toContain('[未配置收款信息]');
  });

  it('an SOP needs a category or a part', () => {
    expect(saveSnippetSchema.safeParse({ kind: 'sop', label: 'x', text: 'y', category: null, partType: null, enabled: true }).success).toBe(false);
    expect(saveSnippetSchema.safeParse({ kind: 'quick', label: 'x', text: 'y', category: null, partType: null, enabled: true }).success).toBe(true);
  });
});
