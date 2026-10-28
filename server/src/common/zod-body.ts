import { BadRequestException, Body, Query, type PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new BadRequestException({
        message: first ? first.message : '参数不正确',
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}

/** 用 zod schema 校验请求体：`@ZodBody(schema) dto: z.infer<typeof schema>` */
export const ZodBody = (schema: ZodTypeAny) => Body(new ZodPipe(schema));

/** 用 zod schema 校验查询参数 */
export const ZodQuery = (schema: ZodTypeAny) => Query(new ZodPipe(schema));
