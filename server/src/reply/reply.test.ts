import { describe, expect, it } from 'vitest';
import { EMPTY_PAYMENT_SETTINGS, type MissingEvidence } from '@aftersell/shared';
import type { KnowledgeCardRow } from '../db/schema';
import { compileModels, hasModelCodeText, matchModel } from '../knowledge/product-knowledge';
import { PRODUCT_KNOWLEDGE_SEED } from '../knowledge/product-knowledge.seed';
import { parseInsert } from '../scripts/sql-insert';
import { formatPlaybook, formatPrices, paymentParagraph } from './context';
import { checkDraft, CLOSING_LINES, finalizeDraft, findRepeatedEvidenceRequest } from './draft-output';
import { collectCaseEvidence } from './evidence-state';
import { evaluate, evaluateRules, renderText, type EngineRule } from './rule-engine';
import { RULE_SEED } from './rules.seed';
import { computeSignals, type SignalsMessage } from './signals';

const models = compileModels(PRODUCT_KNOWLEDGE_SEED);
const payment = { zelleEmail: 'pay@example.test', zelleName: 'Pat Payee', zellePhone: '+1 555 0100', extraNote: '' };

const msg = (patch: Partial<SignalsMessage> = {}): SignalsMessage => ({
  subject: 'Battery problem',
  bodyText: 'My battery will not charge.\n\nThanks,\nAlex',
  fromAddress: 'alex@example.test',
  fromName: 'Alex Example',
  receivedAt: new Date('2026-10-27T00:00:00Z'),
  category: 'quality_issue',
  partType: 'battery',
  language: 'en',
  isSafetyHazard: false,
  isOurProduct: true,
  summary: null,
  evidenceStatus: 'partial',
  missingEvidence: ['photo_or_video', 'purchase_proof'] as MissingEvidence[],
  attachments: [],
  ...patch,
});
const signalsFor = (patch: Partial<SignalsMessage> = {}, now = Date.parse('2026-10-28T00:00:00Z')) =>
  computeSignals({ message: msg(patch), stage: null, models, payment, now });
const rules: EngineRule[] = RULE_SEED.map((r) => ({ ...r, exclusive: r.exclusive ?? false, enabled: true }));
const hitKeys = (patch: Partial<SignalsMessage> = {}) => evaluateRules(rules, signalsFor(patch)).hits.map((h) => h.key);

describe('rule engine', () => {
  it('evaluates the JSON logic subset', () => {
    const data = { a: 3, b: 'x', c: true };
    expect(evaluate({ and: [{ '>=': [{ var: 'a' }, 3] }, { '==': [{ var: 'b' }, 'x'] }] }, data)).toBe(true);
    expect(evaluate({ '!': { var: 'c' } }, data)).toBe(false);
    expect(evaluate({ in: [{ var: 'b' }, ['x', 'y']] }, data)).toBe(true);
    expect(() => evaluate({ var: 'nope' }, data)).toThrow('未知信号');
  });

  it('stops a slot at the first exclusive hit and skips broken conditions', () => {
    const base = { slot: 'evidence_policy' as const, enabled: true, text: '' };
    const out = evaluateRules(
      [
        { ...base, key: 'a', priority: 90, exclusive: true, when: { var: 'flag' }, text: 'A {name}' },
        { ...base, key: 'b', priority: 50, exclusive: true, when: null, text: 'B' },
        { ...base, key: 'c', priority: 95, exclusive: false, when: { var: 'missing' }, text: 'C' },
      ],
      { flag: true, name: 'Pat' } as never,
    );
    expect(out.hits.map((h) => [h.key, h.text])).toEqual([['a', 'A Pat']]);
    expect(out.errors.map((e) => e.key)).toEqual(['c']);
  });

  it('leaves unknown placeholders untouched', () => {
    expect(renderText('{firstName} {unknown}', signalsFor())).toBe('Alex {unknown}');
  });
});

describe('initial rule set', () => {
  it('has unique keys and every condition evaluates against real signals', () => {
    expect(new Set(RULE_SEED.map((r) => r.key)).size).toBe(RULE_SEED.length);
    for (const s of [signalsFor(), signalsFor({ category: 'parts_request', fromAddress: 'noreply@depothelp.com', subject: 'Alex Example: 2025550101' })]) {
      expect(evaluateRules(rules, s).errors).toEqual([]);
    }
  });

  it('covers all 15 category flows and keeps the payment placeholder', () => {
    expect(RULE_SEED.filter((r) => r.key.startsWith('action.') && !['action.walmart_store', 'action.two_step', 'action.stage_reference'].includes(r.key))).toHaveLength(15);
    const purchase = evaluateRules(rules, signalsFor({ category: 'parts_request' })).hits.find((h) => h.key === 'action.parts_request');
    expect(purchase?.text).toContain('Payment via Zelle only (pay@example.test');
  });

  it('default first contact gets name, missing evidence list, category flow, two-step rule and signature', () => {
    const keys = hitKeys();
    expect(keys).toEqual(
      expect.arrayContaining(['channel.first_name', 'evidence_policy.missing', 'action.quality_issue', 'action.two_step', 'closing.signature', 'part.battery']),
    );
    const text = evaluateRules(rules, signalsFor()).hits.map((h) => h.text).join('\n');
    expect(text).toContain('Customer first name: Alex');
    expect(text).toContain('Still missing (2 items');
    expect(text).toContain('"Thank you!" / "Best regards," / "PhoenixUS-support team"');
  });
});

describe('signals', () => {
  it('purchase flow drops all evidence asks and battery purchases with a known model still ask for photos', () => {
    expect(signalsFor({ category: 'parts_request' }).missingCount).toBe(0);
    const keys = hitKeys({ category: 'parts_request', bodyText: 'I want to buy a battery for my 22CB2702YD.' });
    expect(keys).toContain('evidence_policy.purchase_battery_model_known');
    expect(keys).not.toContain('evidence_policy.complete');
  });

  it('a warranty claim on a parts request is not a purchase', () => {
    expect(signalsFor({ category: 'parts_request', bodyText: 'My charger died, it is still under warranty.' }).isPurchaseFlow).toBe(false);
  });

  it('dynamic issues ask for a video, not photos', () => {
    const s = signalsFor({ bodyText: 'The display keeps flickering while riding.' });
    expect(s.needsVideoOnly).toBe(true);
    expect(s.missingList).toContain('A video of the issue (dynamic issue');
  });

  it('broken valve with photos goes to the free inner tube flow', () => {
    const keys = hitKeys({
      category: 'damaged_shipping',
      partType: 'tire',
      bodyText: 'The bike arrived and the valve stem is broken.',
      attachments: [{ filename: 'wheel.jpg', contentType: 'image/jpeg' }],
    });
    expect(keys).toContain('evidence_policy.valve_damage');
    expect(keys).not.toContain('evidence_note.damaged_shipping');
  });

  it('a no-toolkit model reporting only a missing tool kit needs no evidence', () => {
    const keys = hitKeys({ subject: 'Missing tool kit', category: 'missing_parts', partType: 'accessories', bodyText: 'My Urbanfold 23CF2001YD came without the tool kit.' });
    expect(keys).toEqual(expect.arrayContaining(['evidence_policy.toolkit_only', 'evidence_note.toolkit_not_included']));
  });

  it('channels: hotline, Walmart store, delayed reply, Chinese', () => {
    expect(hitKeys({ fromAddress: 'noreply@depothelp.com', subject: 'Pat Customer: 2025550101 (Account: Phoenix)' })).toContain('channel.hotline');
    const store = signalsFor({ fromAddress: 'abc.s01234.us@wal-mart.com' });
    expect([store.isWalmartStore, store.storeLabel]).toEqual([true, 'Walmart store 1234']);
    expect(hitKeys({ fromAddress: 'abc.s01234.us@wal-mart.com' })).toEqual(expect.arrayContaining(['evidence_policy.walmart_store', 'action.walmart_store']));
    expect(hitKeys({ receivedAt: new Date('2026-10-20T00:00:00Z') })).toContain('channel.delayed_reply');
    expect(hitKeys({ language: 'zh' })).toContain('language.zh');
  });

  it('safety warning: first contact yes, brakes only for safety or injury categories', () => {
    expect(hitKeys({ isSafetyHazard: true })).toContain('safety.first_contact');
    expect(hitKeys({ isSafetyHazard: true, partType: 'brakes', category: 'warranty' })).not.toContain('safety.first_contact');
    expect(hitKeys({ isSafetyHazard: true, partType: 'brakes', category: 'injury_claim' })).toContain('safety.first_contact');
  });

  it('explicit customer statements', () => {
    const keys = hitKeys({ bodyText: "I don't have the receipt and I don't have a multimeter. I bought it secondhand from a friend." });
    expect(keys).toEqual(expect.arrayContaining(['evidence_note.no_receipt', 'evidence_note.no_multimeter', 'evidence_note.secondhand']));
  });
});

describe('manual knowledge matching', () => {
  it('model codes win over keywords, and e-bike words only match electric models', () => {
    expect(matchModel(models, 'flat bar gravel bike 22ASG7002WD')?.modelCode).toBe('22AMG7002WD');
    expect(matchModel(models, 'my explorer flat bar bike')?.modelCode).toBe('23HY7001PH');
    expect(matchModel(models, 'my electric gravel bike')).toBeNull();
    expect(matchModel(models, 'the Urbanfold e-bike')?.modelCode).toBe('23CF2001YD');
    expect(hasModelCodeText(models, 'model 23FR2602YD')).toBe(true);
  });
});

describe('draft post-processing and checks', () => {
  it('replaces whatever closing the model wrote with the fixed three lines', () => {
    const out = finalizeDraft('Hi Alex,\n\nWe will help.\n\nBest regards,\nPhoenixUS Support Team', { info: null });
    expect(out).toBe(`Hi Alex,\n\nWe will help.\n\n${CLOSING_LINES.join('\n')}`);
  });

  it('appends known delivery details only under the confirmation sentence', () => {
    const info = { name: 'Pat Customer', phone: '555-010-0100', address: '1 Main St, Springfield, IL 62701' };
    const out = finalizeDraft('Hi Pat,\n\nWe will send you the new charger. Please confirm whether the shipping address below is correct.\n\nThank you!', { info });
    expect(out).toContain('shipping address below is correct.\n\nPat Customer\n555-010-0100\n1 Main St');
    expect(finalizeDraft('Hi Pat,\n\nWe have your details on file as:\nName: Pat Customer\n\nThanks.', { info })).not.toContain('Pat Customer\n');
  });

  it('completes the photo request for battery purchases', () => {
    expect(finalizeDraft('Hi Pat,\n\nThe price is $225.', { info: null, batteryPhotos: { bicycle: true, battery: true } })).toContain(
      'please send a photo of the bicycle and a photo of the battery',
    );
  });

  it('flags unknown prices, repeated evidence requests and foreign payment accounts', () => {
    const { evidence } = collectCaseEvidence([{ id: 'm1', bodyText: 'Attached is my receipt.', attachments: [] }]);
    const draft = 'Hi Pat,\n\nCould you please provide a copy of your receipt? The price is $199. Pay via zelle other@example.test.';
    const codes = checkDraft(draft, { evidence, priceAmounts: [225], knownText: '', payment }).map((c) => c.code);
    expect(codes).toEqual(['repeated_evidence_request', 'unknown_price', 'payment_mismatch']);
    expect(findRepeatedEvidenceRequest('Please do not send the receipt again.', evidence)).toBeNull();
  });
});

describe('context blocks', () => {
  it('knowledge cards never leak historical payment accounts or prices', () => {
    const card = {
      sampleSize: 10,
      category: 'parts_request',
      partType: 'battery',
      imageFlag: 'no_images',
      skeleton: ['greeting', 'quote'],
      facts: ['We only have a Zelle account. You can pay via zelle someone@example.test', 'Shipping cost is already included in the battery price.'],
      rules: ['默认走 Zelle 收款，Zelle 账号为 someone@example.test', '客户支付后需提供付款截图'],
      pricing: [{ item: 'battery', amount: 240 }],
      drift: null,
    } as unknown as KnowledgeCardRow;
    const text = formatPlaybook(card);
    expect(text).not.toContain('someone@example.test');
    expect(text).not.toContain('240');
    expect(text).toContain('Shipping cost is already included');
  });

  it('price list and payment paragraph', () => {
    expect(formatPrices([{ id: '1', partType: 'battery', modelCode: '22CB2702YD', label: 'Replacement battery', amount: 225, includesShipping: true, note: null, enabled: true }])).toContain(
      '- Replacement battery (model 22CB2702YD only): $225, shipping included',
    );
    expect(formatPrices([])).toContain('NEVER invent a price');
    expect(paymentParagraph(EMPTY_PAYMENT_SETTINGS)).toBeNull();
    expect(paymentParagraph(payment)).toContain('zelle pay@example.test (name: Pat Payee');
  });
});

describe('legacy export parser', () => {
  it('parses multi-row inserts with escaped quotes and NULLs', () => {
    const rows = parseInsert(`INSERT INTO "s"."t" ("id","note","n") VALUES ('a','it''s',NULL),('b','x, (y)',3);`);
    expect(rows).toEqual([
      { id: 'a', note: "it's", n: null },
      { id: 'b', note: 'x, (y)', n: '3' },
    ]);
  });

  it("handles PostgreSQL E'...' escape strings", () => {
    const rows = parseInsert(String.raw`INSERT INTO t ("a","b") VALUES (E'["1/2\\"*3/32\\"","it\'s"]','ok');`);
    expect(rows[0].a).toBe('["1/2\\"*3/32\\"","it\'s"]');
    expect(JSON.parse(rows[0].a!)).toEqual(['1/2"*3/32"', "it's"]);
    expect(rows[0].b).toBe('ok');
  });
});
