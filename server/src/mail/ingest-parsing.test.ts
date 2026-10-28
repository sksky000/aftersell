import { simpleParser } from 'mailparser';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MAIL_ROUTING } from '@aftersell/shared';
import { selectIncomingAttachments } from './incoming-attachments';
import { extractForwardedCustomerEmail, isLeaderForward } from './leader-forward';
import { parseIncoming } from './parse-incoming';
import { configureSenderDirectory } from './sender-directory';
import { passesHeaderFilter, passesMessageFilter, type SyncFilters } from './sync-filters';

// 合成的 1 像素 PNG，只用于验证 MIME 解析
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64');

function mime(headers: string[], parts?: string[][]): string {
  if (!parts) return [...headers, 'Content-Type: text/plain; charset=utf-8', '', 'Plain body.', ''].join('\r\n');
  return [
    ...headers,
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b"',
    '',
    ...parts.flatMap((p) => ['--b', ...p]),
    '--b--',
    '',
  ].join('\r\n');
}

const photoMail = mime(
  ['From: Example <person@example.test>', 'To: support@example.test', 'Subject: Battery photos', 'Message-ID: <photo-fixture@example.test>', 'Date: Tue, 14 Oct 2026 08:00:00 +0000'],
  [
    ['Content-Type: text/html; charset=utf-8', '', '<p>Battery photos</p><img src="cid:inline-photo"><img src="https://external.example.test/x.png">'],
    ...['attachment', 'inline'].map((d) => [
      `Content-Type: image/png; name="${d}.png"`,
      `Content-Disposition: ${d}; filename="${d}.png"`,
      `Content-ID: <${d}-photo>`,
      'Content-Transfer-Encoding: base64',
      '',
      png,
    ]),
    ['Content-Type: application/pdf; name="receipt.pdf"', 'Content-Disposition: attachment; filename="receipt.pdf"', 'Content-Transfer-Encoding: base64', '', pdf],
    ['Content-Type: text/plain; name="notes.txt"', 'Content-Disposition: attachment; filename="notes.txt"', '', 'ignored'],
  ],
);

afterEach(() => configureSenderDirectory(DEFAULT_MAIL_ROUTING));

describe('selectIncomingAttachments', () => {
  it('real MIME parser keeps ordinary and CID inline photos plus PDF, without external HTML images', async () => {
    const parsed = await simpleParser(photoMail);
    const selected = selectIncomingAttachments(parsed.attachments);
    expect(selected.map((a) => a.filename)).toEqual(['attachment.png', 'inline.png', 'receipt.pdf']);
    expect(selected[0].content.equals(Buffer.from(png, 'base64'))).toBe(true);
    expect(selected[1]).toMatchObject({ contentId: 'inline-photo', isInline: true });
    expect(selected[0].isInline).toBe(false);
  });

  it('retains type, size and count limits and never keeps directory names', () => {
    const valid = { filename: 'synthetic.png', contentType: 'image/png', content: Buffer.from(png, 'base64') };
    const selected = selectIncomingAttachments([
      { ...valid, contentType: 'text/plain' },
      { ...valid, content: 'not bytes' },
      { ...valid, size: 0 },
      { ...valid, size: 25 * 1024 * 1024 + 1 },
      ...Array.from({ length: 12 }, () => ({ ...valid })),
    ]);
    expect(selected).toHaveLength(10);
    expect(selectIncomingAttachments([{ ...valid, filename: false }])[0].filename).toBe('attachment-1');
    expect(selectIncomingAttachments([{ ...valid, filename: '../../etc/passwd.png' }])[0].filename).toBe('passwd.png');
  });
});

describe('parseIncoming', () => {
  it('maps headers, body and attachments', async () => {
    const email = await parseIncoming(photoMail);
    expect(email).toMatchObject({
      messageId: '<photo-fixture@example.test>',
      subject: 'Battery photos',
      fromAddress: 'person@example.test',
      fromName: 'Example',
      inReplyTo: null,
    });
    expect(email.receivedAt?.toISOString()).toBe('2026-10-14T08:00:00.000Z');
    expect(email.bodyText).toContain('Battery photos');
    expect(email.bodyHtml).toContain('cid:inline-photo');
    expect(email.attachments).toHaveLength(3);
  });

  it('keeps reply headers for thread grouping', async () => {
    const email = await parseIncoming(
      mime([
        'From: person@example.test',
        'Subject: Re: Battery photos',
        'Message-ID: <reply@example.test>',
        'In-Reply-To: <photo-fixture@example.test>',
        'References: <root@example.test> <photo-fixture@example.test>',
      ]),
    );
    expect(email.inReplyTo).toBe('<photo-fixture@example.test>');
    expect(email.references).toBe('<root@example.test> <photo-fixture@example.test>');
  });

  it('derives a stable ID when Message-ID is missing, and falls back to the IMAP date', async () => {
    const raw = mime(['From: person@example.test', 'Subject: No id']);
    const internal = new Date('2026-10-20T00:00:00Z');
    const a = await parseIncoming(raw, internal);
    const b = await parseIncoming(raw, internal);
    expect(a.messageId).toMatch(/^<no-id-[0-9a-f]{32}@aftersell\.local>$/);
    expect(a.messageId).toBe(b.messageId);
    expect(a.receivedAt).toEqual(internal);
  });

  it('strips NUL characters that PostgreSQL text rejects', async () => {
    const email = await parseIncoming(mime(['From: person@example.test', 'Subject: A\u0000B', 'Message-ID: <nul@example.test>']));
    expect(email.subject).toBe('AB');
  });

  it('normalizes hotline ticket fields onto separate lines', async () => {
    const email = await parseIncoming(
      [
        'From: noreply@depothelp.com',
        'Subject: Alex Example: 2025550101 (Account: Phoenix)',
        'Message-ID: <ticket@example.test>',
        'Content-Type: text/plain',
        '',
        'NAME Alex Example PHONE 2025550101 Call Summary Battery will not charge',
        '',
      ].join('\r\n'),
    );
    expect(email.bodyText.split('\n')).toEqual(['NAME Alex Example', 'PHONE 2025550101', 'Call Summary Battery will not charge']);
  });
});

describe('sync filters', () => {
  const f = (patch: Partial<SyncFilters>): SyncFilters => ({ hotlineOnly: false, registrationOnly: false, firstContactOnly: false, ...patch });

  it('hotline and registration switches are a union', () => {
    const both = f({ hotlineOnly: true, registrationOnly: true });
    expect(passesHeaderFilter(both, 'noreply@depothelp.com', 'Ticket')).toBe(true);
    expect(passesHeaderFilter(both, 'person@example.test', 'Product registration')).toBe(true);
    expect(passesHeaderFilter(both, 'person@example.test', 'Battery')).toBe(false);
  });

  it('first-contact switch intersects and also rejects quoted bodies', () => {
    const first = f({ firstContactOnly: true, registrationOnly: true });
    expect(passesHeaderFilter(first, 'p@example.test', 'Re: registration')).toBe(false);
    expect(passesMessageFilter(first, 'p@example.test', 'Registration', 'Hi\n\nOn Mon, Oct 12, 2026 at 9:00 AM Support wrote:\n> old')).toBe(false);
    expect(passesMessageFilter(first, 'p@example.test', 'Registration', 'Please register my bike.')).toBe(true);
  });

  it('no switches means everything passes', () => {
    expect(passesMessageFilter(f({}), null, null, '')).toBe(true);
  });
});

describe('sender directory', () => {
  it('leader forward address comes from settings, and own addresses are never taken as the customer', () => {
    expect(isLeaderForward('boss@example.test')).toBe(false);
    configureSenderDirectory({
      hotlineSenders: ['noreply@depothelp.com'],
      leaderForwardAddresses: ['boss@example.test'],
      ownAddresses: ['support@example.test'],
    });
    expect(isLeaderForward('Boss@Example.test')).toBe(true);
    expect(passesHeaderFilter({ hotlineOnly: true, registrationOnly: false, firstContactOnly: false }, 'boss@example.test', 'Fwd: x')).toBe(true);
    const body = 'FYI\nFrom: Support <support@example.test>\nFrom: "Pat Customer"<pat@example.test>\nSubject: Battery';
    expect(extractForwardedCustomerEmail(body)).toBe('pat@example.test');
  });
});
