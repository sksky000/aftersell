import { describe, expect, it } from 'vitest';
import { parseBitableUrl } from '@aftersell/shared';
import { adaptToTable, buildLedgerRecord, FIELD_TYPES, type LedgerEmail } from './ledger-record';

// 全部为合成数据
const email = (patch: Partial<LedgerEmail>): LedgerEmail => ({
  id: 'e',
  subject: 'Battery',
  fromAddress: 'pat@example.test',
  fromName: 'Pat Example',
  bodyText: '',
  receivedAt: new Date('2026-10-20T01:00:00Z'),
  createdAt: new Date('2026-10-20T01:00:00Z'),
  category: 'quality_issue',
  partType: 'battery',
  urgency: 'normal',
  status: 'pending_review',
  summary: null,
  hasMedia: false,
  ...patch,
});

describe('ledger record', () => {
  it('summarises all of a customer’s emails into one row', () => {
    const r = buildLedgerRecord('pat@example.test', [
      email({ id: 'b', receivedAt: new Date('2026-10-25T01:00:00Z'), bodyText: 'Still not charging. Order number 1234567890123', status: 'replied', summary: '电池不充电，已补发', hasMedia: true }),
      email({ id: 'a', bodyText: 'My Commutr battery will not charge.\n\nOn Mon, Oct 12, 2026 Support wrote:\n> old', urgency: 'high' }),
    ]);
    expect(r).toMatchObject({
      Date: new Date('2026-10-20T01:00:00Z').getTime(),
      Name: 'Pat Example',
      Email: 'pat@example.test',
      'Order#': '1234567890123',
      'Model#': '27.5 COMMUTR EBIKE',
      'Concern Category': 'Warranty Claim',
      'Urgent?': 'Yes',
      'Case Status': 'Resolved',
      问题部件: '锂电池',
      是否有视频或者图片: '是',
      是否到达时损坏: '否',
      'Concern & Reason Analyse (中文)': '电池不充电，已补发',
    });
    expect(String(r.Concern).split('\n')).toEqual(['[2026-10-20] My Commutr battery will not charge.', '[2026-10-25] Still not charging. Order number 1234567890123']);
  });

  it('leaves out empty values so manual edits in the ledger are not overwritten', () => {
    const r = buildLedgerRecord('hotline:pat|5551234567', [email({ fromAddress: 'noreply@depothelp.com', fromName: 'Depot', bodyText: 'hi' })]);
    expect(r).not.toHaveProperty('Email');
    expect(r).not.toHaveProperty('Shipping Address');
    expect(r).not.toHaveProperty('Name', 'Depot');
  });

  it('adapts values to the table’s field types and skips unknown fields', () => {
    const fields = new Map<string, number>([
      ['Date', FIELD_TYPES.date],
      ['Urgent?', FIELD_TYPES.select],
      ['问题部件', FIELD_TYPES.multiSelect],
      ['Order#', FIELD_TYPES.number],
      ['Concern', 20], // 公式等不可写字段
    ]);
    expect(adaptToTable({ Date: 1, 'Urgent?': 'Yes', 问题部件: '锂电池', 'Order#': '123', Concern: 'x', Name: 'y' }, fields)).toEqual({
      Date: 1,
      'Urgent?': 'Yes',
      问题部件: ['锂电池'],
      'Order#': 123,
    });
  });

  it('parses base and wiki bitable links', () => {
    expect(parseBitableUrl('https://abc.feishu.cn/base/BascnAbC123?table=tblXyZ987&view=vew1')).toEqual({ token: 'BascnAbC123', tableId: 'tblXyZ987', wiki: false });
    expect(parseBitableUrl('https://abc.feishu.cn/wiki/WikNode456?table=tblQ1')).toEqual({ token: 'WikNode456', tableId: 'tblQ1', wiki: true });
    expect(parseBitableUrl('https://abc.feishu.cn/base/BascnAbC123')).toBeNull();
  });
});
