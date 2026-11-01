import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MAIL_ROUTING } from '@aftersell/shared';
import { customerText, detectCustomerLanguage, isChineseText } from './language';
import { configureSenderDirectory } from './sender-directory';

// 全部为合成数据
const TENCENT_FORWARD = [
  '帮忙看一下这个客户，电池的问题',
  '',
  '------------------ 原始邮件 ------------------',
  '发件人: "Pat Example" <pat@example.test>',
  '发送时间: 2026年10月20日(星期二) 上午9:12',
  '收件人: "support" <support@example.test>',
  '主题: Battery not charging',
  '',
  'Hi, my battery will not charge since last week. I have attached a photo of the charger.',
].join('\n');

describe('customer language', () => {
  afterEach(() => configureSenderDirectory(DEFAULT_MAIL_ROUTING));

  it('a forwarded English email stays English despite the Chinese forward header and note', () => {
    const email = { subject: '转发: Battery not charging', bodyText: TENCENT_FORWARD, fromAddress: 'staff@example.test' };
    expect(customerText(email)).toMatch(/^Hi, my battery/);
    expect(detectCustomerLanguage(email, 'zh')).toBe('en');
  });

  it('recognizes a leader forward by sender even without a Fw subject', () => {
    configureSenderDirectory({ ...DEFAULT_MAIL_ROUTING, leaderForwardAddresses: ['boss@example.test'] });
    const email = { subject: 'Battery not charging', bodyText: TENCENT_FORWARD, fromAddress: 'boss@example.test' };
    expect(detectCustomerLanguage(email, 'zh')).toBe('en');
  });

  it('a Chinese customer is Chinese, even when quoting our English reply', () => {
    const body = '你好，电池还是充不进电，请问怎么办？\n\nOn Mon, Oct 12, 2026 at 9:00 AM Support wrote:\n> Could you please provide a photo of the battery and the receipt?';
    expect(detectCustomerLanguage({ subject: 'Re: Battery', bodyText: body, fromAddress: 'pat@example.test' }, 'en')).toBe('zh');
  });

  it('a forwarded Chinese customer email is Chinese', () => {
    const body = TENCENT_FORWARD.replace(/Hi, my battery.*$/m, '你好，我的电池上周开始就充不进电了，附件是充电器的照片。');
    expect(detectCustomerLanguage({ subject: 'Fw: 电池', bodyText: body, fromAddress: 'staff@example.test' }, 'en')).toBe('zh');
  });

  it('keeps other languages from the model, and defaults to English when there is no text', () => {
    expect(detectCustomerLanguage({ subject: 'Bateria', bodyText: 'Hola, mi bateria no carga.', fromAddress: null }, 'other')).toBe('other');
    expect(detectCustomerLanguage({ subject: null, bodyText: '', fromAddress: null }, 'zh')).toBe('en');
  });

  it('a few Chinese characters in an English email do not flip it', () => {
    expect(isChineseText('My bike model is Phoenix 凤凰, it does not start after charging overnight.')).toBe(false);
  });
});
