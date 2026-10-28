import { describe, expect, it } from 'vitest';
import { caseRelation, hasClosedCaseText, selectCaseMessages } from './case-association';
import { selectPendingUids } from './pending-uids';

// 迁自妙搭版 tests/case-closure-regression 与 case-evidence-regression，全部为合成数据
describe('hasClosedCaseText', () => {
  it('questions, negative answers and incomplete closure fields do not close a case', () => {
    for (const text of [
      'Is the issue resolved? No, please follow up. | Escalation.',
      'Is the issue resolved?\nNo',
      'Is the issue resolved? Yes, but it still fails.',
      'Is the issue resolved?',
      'Issue resolved?',
      'Is the issue resolved? Unknown',
      'Is the issue resolved?\nCustomer name: Alex Example',
      'The issue is not resolved.',
      'The problem was never fixed.',
      'The case has not been closed.',
      'Everything is not working now.',
      'If the problem is fixed, reply to us.',
      'We will mark the case closed.',
      'The issue is resolved, right?',
      'The issue is resolved but the battery still fails.',
    ]) expect(hasClosedCaseText(text), text).toBe(false);
  });

  it('only clear affirmative closure statements or affirmative field answers close a case', () => {
    for (const text of [
      'The issue is resolved.',
      'The battery issue is resolved.',
      'Problem fixed!',
      'The case has been closed.',
      'Everything works now.',
      'Everything is working now.',
      'Is the issue resolved? Yes',
      'Is the issue resolved?\nYes.\nCustomer name: Alex Example',
    ]) expect(hasClosedCaseText(text), text).toBe(true);
  });

  it('quoted closure and reported speech do not close the active case', () => {
    for (const text of [
      'Still broken.\nOn Tuesday agent wrote:\nThe issue is resolved.',
      'On Tuesday agent wrote:\nThe issue is resolved.',
      '> The issue is resolved.\nStill broken.',
      'You wrote "The issue is resolved." It is not.',
      '"The issue is resolved."',
      'You wrote:\n"The issue is resolved."',
      'Still broken.\n----- Original Message -----\nThe issue is resolved.',
    ]) expect(hasClosedCaseText(text), text).toBe(false);
  });
});

const hotlineMail = (body = 'Is the issue resolved? No, please follow up. | Escalation.') => ({
  messageId: '<hotline@example.test>',
  fromAddress: 'noreply@depothelp.com',
  subject: 'Customer inquiry',
  bodyText: `Email Address (Validation Required) alex@example.test\n${body}`,
  receivedAt: '2026-09-12T00:00:00Z',
});
const alexMail = (extra = {}) => ({
  messageId: '<current@example.test>',
  fromAddress: 'alex@example.test',
  subject: 'Follow-up',
  bodyText: 'Still waiting.',
  receivedAt: '2026-10-16T00:00:00Z',
  ...extra,
});

describe('caseRelation', () => {
  it('strong reply headers retain unresolved history, but never override real closure or new cases', () => {
    const prior = hotlineMail();
    const current = alexMail({ inReplyTo: prior.messageId });
    expect(caseRelation(current, prior)).toBe('same');
    expect(caseRelation(current, hotlineMail('The issue is resolved.'))).toBe('different');
    expect(caseRelation({ ...current, bodyText: 'This is a new issue.' }, prior)).toBe('different');
    expect(caseRelation({ ...current, fromAddress: 'someone-else@example.test' }, prior)).toBe('different');
    expect(caseRelation(current, { ...prior, caseClosed: true })).toBe('different');
  });

  const mail = (extra = {}) => ({
    messageId: '<m2@example.test>',
    fromAddress: 'person@example.test',
    subject: 'Re: Battery replacement',
    bodyText: 'Following up on the battery replacement.',
    inReplyTo: null,
    receivedAt: '2026-10-14T10:00:00Z',
    createdAt: '2026-10-14T10:00:00Z',
    ...extra,
  });
  const old = (extra = {}) =>
    mail({
      messageId: '<m1@example.test>',
      subject: 'Battery replacement',
      bodyText: 'The battery is not charging.',
      receivedAt: '2026-10-12T10:00:00Z',
      ...extra,
    });

  it('closed prior case and new issue never transfer evidence', () => {
    expect(caseRelation(mail({ bodyText: 'This is a new issue with the axle.' }), old({ bodyText: 'The battery issue is resolved.' }))).toBe('different');
    expect(selectCaseMessages(mail({ bodyText: 'The axle nut is missing.' }), [old()]).rows).toEqual([]);
  });

  it('different customer remains isolated even with forged matching reply header', () => {
    expect(caseRelation(mail({ inReplyTo: '<m1@example.test>' }), old({ fromAddress: 'other@example.test' }))).toBe('different');
  });

  it('same customer different order does not merge even with reused subject', () => {
    expect(caseRelation(mail({ bodyText: 'Battery order #ORDER200.' }), old({ bodyText: 'Battery order #ORDER100.' }))).toBe('different');
  });

  it('same case can change subject when reply header identifies it', () => {
    expect(caseRelation(mail({ subject: 'Shipping update', bodyText: 'I already sent it back.', inReplyTo: '<m1@example.test>' }), old())).toBe('same');
  });

  it('ambiguous same-customer part overlap requires review', () => {
    const result = selectCaseMessages(mail({ subject: 'A question' }), [old({ subject: 'A previous conversation' })]);
    expect(result.rows).toHaveLength(0);
    expect(result.uncertain).toBe(1);
  });

  it('transitive explicit references retain earlier messages across subjects', () => {
    const first = old({ subject: 'Original battery problem' });
    const second = old({ messageId: '<middle@example.test>', subject: 'Returning it', bodyText: 'I shipped it.', inReplyTo: first.messageId });
    const result = selectCaseMessages(mail({ subject: 'Status', bodyText: 'Any update?', inReplyTo: second.messageId }), [first, second]);
    expect(result.rows).toHaveLength(2);
  });

  it('explicit case id survives long gap, sender-only history does not', () => {
    expect(caseRelation(mail({ bodyText: 'Case #CASE123: still waiting for the battery.' }), old({ bodyText: 'Case #CASE123: battery problem.', receivedAt: '2026-01-01' }))).toBe('same');
    expect(caseRelation(mail(), old({ receivedAt: '2026-01-01' }))).toBe('uncertain');
  });

  it('different hotline phone is not merged via same name or shared email', () => {
    const a = mail({
      fromAddress: 'noreply@depothelp.com',
      subject: 'Alex Example: 2025550101 (Account: Phoenix)',
      bodyText: 'Email Address (Validation Required) person@example.test\nBattery replacement',
    });
    const b = old({ fromAddress: 'noreply@depothelp.com', subject: 'Alex Example: 2025550107 (Account: Phoenix)', bodyText: a.bodyText });
    expect(caseRelation({ ...a, inReplyTo: b.messageId }, b)).toBe('uncertain');
  });

  it('explicit closed-case signal blocks recycled header', () => {
    expect(caseRelation(mail({ inReplyTo: '<m1@example.test>' }), old({ caseClosed: true }))).toBe('different');
  });
});

describe('selectPendingUids', () => {
  it('existing unread messages never consume the incoming body batch', () => {
    const headers = [
      { uid: 50, messageId: 'already' },
      { uid: 20, messageId: 'new-2' },
      { uid: 10, messageId: 'new-1' },
      { uid: 10, messageId: 'new-1' },
    ];
    expect(selectPendingUids(headers, new Set(['already']), 2)).toEqual([10, 20]);
    expect(selectPendingUids(headers, new Set(['already', 'new-1']), 1)).toEqual([20]);
    expect(selectPendingUids(headers, new Set(), 0)).toEqual([]);
  });
});
