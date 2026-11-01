import { describe, expect, it } from 'vitest';
import { splitReply } from './history-parse';

// 全部为合成数据
describe('splitReply', () => {
  it('splits our reply from the quoted customer email (our own quote format)', () => {
    const body = [
      'Hi Pat,',
      '',
      'Could you please provide a photo of the battery?',
      '',
      'Thank you!',
      '',
      '----------- Original Message -------------',
      'From: "Pat Example" <pat@example.test>',
      'Date: Tue, Oct 20, 2026 at 9:12 AM',
      'To: support@example.test',
      'Subject: Battery',
      '',
      'My battery will not charge.',
    ].join('\n');
    expect(splitReply(body)).toEqual({
      reply: 'Hi Pat,\n\nCould you please provide a photo of the battery?\n\nThank you!',
      customer: 'My battery will not charge.',
    });
  });

  it('handles Gmail style and keeps only the latest customer message', () => {
    const body = [
      'Hi Pat, we will send the key.',
      '',
      'On Mon, Oct 12, 2026 at 9:00 AM Pat Example <pat@example.test> wrote:',
      '> Still waiting for the key.',
      '>',
      '> On Fri, Oct 9, 2026 Support <support@example.test> wrote:',
      '>> Please send a photo of the keyhole.',
    ].join('\n');
    expect(splitReply(body)).toEqual({ reply: 'Hi Pat, we will send the key.', customer: 'Still waiting for the key.' });
  });

  it('handles the Tencent Exmail Chinese quote header', () => {
    const body = ['您好，已安排补发。', '', '------------------ 原始邮件 ------------------', '发件人: "Pat" <pat@example.test>', '发送时间: 2026年10月20日', '主题: 电池', '', '电池充不进电'].join('\n');
    expect(splitReply(body)).toEqual({ reply: '您好，已安排补发。', customer: '电池充不进电' });
  });

  it('returns an empty customer part when nothing is quoted', () => {
    expect(splitReply('Hi Pat,\n\nThanks!')).toEqual({ reply: 'Hi Pat,\n\nThanks!', customer: '' });
  });
});
