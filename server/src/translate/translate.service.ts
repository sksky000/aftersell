import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { emailMessage } from '../db/schema';
import { loadPrompt } from '../llm/prompts';
import { LlmService } from '../llm/llm.service';
import { neutralize } from '../pipeline/classification';

const MAX_CHARS = 8000;

/** 英→中翻译（translate 槽位）。来信译文缓存在 email_message.translation_zh，草稿每次现译 */
@Injectable()
export class TranslateService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly llm: LlmService,
  ) {}

  async toChinese(text: string, emailId?: string): Promise<string> {
    if (!(await this.llm.isAvailable('translate'))) throw new BadRequestException('还没有配置翻译模型，请到 设置 → 模型 填写');
    const clipped = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[…]` : text;
    const { text: out } = await this.llm.generate(
      'translate',
      { system: loadPrompt('translate'), user: `<text>\n${neutralize(clipped)}\n</text>`, maxTokens: 4000 },
      { emailId },
    );
    return out.trim();
  }

  async email(emailId: string, refresh: boolean): Promise<string> {
    const [row] = await this.db
      .select({ bodyText: emailMessage.bodyText, translationZh: emailMessage.translationZh })
      .from(emailMessage)
      .where(eq(emailMessage.id, emailId))
      .limit(1);
    if (!row) throw new NotFoundException('邮件不存在');
    if (row.translationZh && !refresh) return row.translationZh;
    if (!row.bodyText.trim()) throw new BadRequestException('正文为空，没有可翻译的内容');
    const text = await this.toChinese(row.bodyText, emailId);
    await this.db.update(emailMessage).set({ translationZh: text }).where(eq(emailMessage.id, emailId));
    return text;
  }
}
