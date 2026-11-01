import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MAIL_ROUTING } from '@aftersell/shared';
import { htmlToPlainText, restoreForwardedAddresses } from './forward-address';
import { extractForwardedCustomer } from './leader-forward';
import { configureSenderDirectory } from './sender-directory';

// 全部为合成数据；结构仿 Foxmail 转发：纯文本只有昵称，地址在 mailto 链接里
const TEXT = ['看下这个客户', '', '------------------ Original ------------------', 'From: Pat Example', 'Date: Tue, Oct 20, 2026 09:12 AM', 'To: support', 'Subject: Battery', '', 'My battery is dead.'].join('\n');
const HTML = `<div>看下这个客户</div><div>------------------&nbsp;Original&nbsp;------------------</div>
<div><b>From:</b>&nbsp;<a href="mailto:pat@example.test" target="_blank">Pat Example</a>;</div>
<div><b>Date:</b>&nbsp;Tue, Oct 20, 2026 09:12 AM</div>
<div><b>To:</b>&nbsp;<a href="mailto:support@example.test">support</a>;</div>
<div><b>Subject:</b>&nbsp;Battery</div><div>My battery is dead.</div>`;

describe('forwarded customer address recovery', () => {
  afterEach(() => configureSenderDirectory(DEFAULT_MAIL_ROUTING));

  it('restores the address hidden in a mailto link, so the customer can be identified', () => {
    expect(extractForwardedCustomer(TEXT)).toBeNull();
    const restored = restoreForwardedAddresses(TEXT, HTML);
    expect(restored).toContain('From: "Pat Example" <pat@example.test>');
    expect(restored).toContain('Date: Tue, Oct 20, 2026 09:12 AM');
    expect(extractForwardedCustomer(restored)).toEqual({ name: 'Pat Example', email: 'pat@example.test' });
  });

  it('works with the Chinese labels too', () => {
    const text = '发件人: Pat Example\n主题: 电池';
    const html = '<div>发件人:&nbsp;<a href="mailto:Pat@Example.test">Pat Example</a></div><div>主题: 电池</div>';
    expect(restoreForwardedAddresses(text, html)).toBe('发件人: "Pat Example" <pat@example.test>\n主题: 电池');
  });

  it('leaves text alone when the address is already there or nothing matches', () => {
    const full = 'From: "Pat Example" <pat@example.test>\nhello';
    expect(restoreForwardedAddresses(full, HTML)).toBe(full);
    expect(restoreForwardedAddresses(TEXT, '<div>no links</div>')).toBe(TEXT);
    expect(restoreForwardedAddresses(TEXT, null)).toBe(TEXT);
    // 再跑一次结果不变（启动时补存量邮件可重复执行）
    const once = restoreForwardedAddresses(TEXT, HTML);
    expect(restoreForwardedAddresses(once, HTML)).toBe(once);
  });

  it('turns HTML into text keeping mailto addresses and line breaks', () => {
    const text = htmlToPlainText(HTML);
    expect(text).toContain('From: Pat Example <pat@example.test>;');
    expect(text).toContain('My battery is dead.');
    expect(htmlToPlainText('<a href="mailto:a@example.test">a@example.test</a>')).toBe('<a@example.test>');
  });
});
