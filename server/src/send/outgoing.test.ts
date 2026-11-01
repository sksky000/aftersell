import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MAIL_ROUTING, isRecipientAllowed, mailRoutingSchema } from '@aftersell/shared';
import { configureSenderDirectory } from '../mail/sender-directory';
import {
  buildFallbackSubject,
  buildOutgoingHtml,
  buildOutgoingText,
  buildReferences,
  composeOutgoingSubject,
  resolveReplyTarget,
  rewriteInlineImages,
} from './outgoing';

// 全部为合成数据
const message = {
  fromName: 'Pat Example',
  fromAddress: 'pat@example.test',
  receivedAt: new Date('2026-10-20T01:12:00Z'),
  subject: 'Battery <issue> [Waiting photos | Battery dead]',
  bodyText: 'My battery is dead.\n<b>help</b>',
};

describe('quote block', () => {
  it('quotes the customer email below the reply, without old subject tags', () => {
    const text = buildOutgoingText('Hi Pat,', message, 'support@example.test');
    expect(text).toContain('Hi Pat,\n\n----------- Original Message -------------\nFrom: "Pat Example" <pat@example.test>');
    expect(text).toContain('Date: Tue, Oct 20, 2026 at 9:12 AM');
    expect(text).toContain('Subject: Battery <issue>\n');
    expect(text.endsWith('My battery is dead.\n<b>help</b>')).toBe(true);
  });

  it('escapes the quoted customer text in HTML', () => {
    const html = buildOutgoingHtml('<div>Hi</div>', message, 'support@example.test');
    expect(html.startsWith('<div>Hi</div>')).toBe(true);
    expect(html).toContain('&lt;b&gt;help&lt;/b&gt;');
    expect(html).not.toContain('<b>help</b>');
  });
});

describe('subject', () => {
  it('falls back to Re: original subject, dropping forward prefixes and old tags', () => {
    expect(buildFallbackSubject('转发: Battery not charging')).toBe('Re: Battery not charging');
    expect(buildFallbackSubject('Fw: Fwd: Bent fork')).toBe('Re: Bent fork');
    expect(buildFallbackSubject('Re: Key [Quote sent | Missing key]')).toBe('Re: Key');
    expect(buildFallbackSubject('')).toBe('Re: Your inquiry');
  });

  it('appends tags and keeps the subject within 15 words', () => {
    expect(composeOutgoingSubject('Battery not charging', { progress: 'Photos requested', issue: 'Battery not charging' })).toBe(
      'Re: Battery not charging [Photos requested | Battery not charging]',
    );
    const long = composeOutgoingSubject('one two three four five six seven eight nine ten', {
      progress: 'a b c d e f g h',
      issue: 'p q r s t u',
    });
    expect(long.split(/\s+/).length).toBeLessThanOrEqual(15);
    expect(long).toMatch(/\[.+ \| .+\]$/);
  });
});

describe('recipient', () => {
  afterEach(() => configureSenderDirectory(DEFAULT_MAIL_ROUTING));

  it('replies to Reply-To, then the sender', () => {
    expect(resolveReplyTarget({ fromAddress: 'Pat@Example.test', replyTo: null, bodyText: '' })).toEqual({ to: 'pat@example.test', via: 'direct', reason: null });
    expect(resolveReplyTarget({ fromAddress: 'pat@example.test', replyTo: 'orders@example.test', bodyText: '' }).to).toBe('orders@example.test');
  });

  it('hotline tickets reply to the customer email in the ticket, or refuse', () => {
    const ticket = 'Email Address (Validation Required) jo@example.test';
    expect(resolveReplyTarget({ fromAddress: 'noreply@depothelp.com', replyTo: null, bodyText: ticket })).toMatchObject({ to: 'jo@example.test', via: 'hotline' });
    expect(resolveReplyTarget({ fromAddress: 'noreply@depothelp.com', replyTo: null, bodyText: 'Email Address (Validation Required) n/a' })).toMatchObject({ to: null, via: 'hotline' });
  });

  it('leader forwards reply to the forwarded customer', () => {
    configureSenderDirectory({ ...DEFAULT_MAIL_ROUTING, leaderForwardAddresses: ['boss@example.test'] });
    const body = 'FYI\n\n发件人: "Pat Example" <pat@example.test>\n主题: Battery';
    expect(resolveReplyTarget({ fromAddress: 'boss@example.test', replyTo: null, bodyText: body })).toMatchObject({ to: 'pat@example.test', via: 'leader_forward' });
  });

  it('test mode only allows the allowlist; old settings default to test mode on', () => {
    const routing = mailRoutingSchema.parse({ hotlineSenders: [], leaderForwardAddresses: [], ownAddresses: [] });
    expect(routing.sendTestMode).toBe(true);
    expect(isRecipientAllowed(routing, 'pat@example.test')).toBe(false);
    expect(isRecipientAllowed({ sendTestMode: true, sendAllowlist: ['pat@example.test'] }, 'Pat@example.test')).toBe(true);
    expect(isRecipientAllowed({ sendTestMode: false, sendAllowlist: [] }, 'anyone@example.test')).toBe(true);
  });
});

describe('thread headers', () => {
  it('chains References and de-duplicates', () => {
    expect(buildReferences({ messageId: '<c@x>', inReplyTo: 'b@x', refChain: '<a@x> <b@x>' })).toBe('<a@x> <b@x> <c@x>');
    expect(buildReferences({ messageId: '<a@x>', inReplyTo: null, refChain: null })).toBe('<a@x>');
  });
});

describe('inline images', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';

  it('turns uploaded images into cid references, once per upload', () => {
    const html = `<p>See</p><img src="/api/uploads/${id}" alt="a"><img src="https://aftersell.example/api/uploads/${id}">`;
    const r = rewriteInlineImages(html, 'support@example.test');
    expect(r.invalid).toEqual([]);
    expect(r.images).toHaveLength(1);
    expect(r.html).not.toContain('/api/uploads/');
    expect(r.html.match(new RegExp(`cid:${r.images[0].cid}`, 'g'))).toHaveLength(2);
    expect(r.images[0].cid).toMatch(/@example\.test$/);
  });

  it('flags images that were not uploaded through the system', () => {
    const r = rewriteInlineImages('<img src="https://tracker.example/pixel.png"><img src="data:image/png;base64,AAAA">', 'support@example.test');
    expect(r.invalid).toHaveLength(2);
    expect(r.images).toEqual([]);
  });
});
