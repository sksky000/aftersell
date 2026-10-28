import { z } from 'zod';

/**
 * 发件人角色：决定热线工单识别、领导转发解析和线程归组时“客户是谁”。
 * 领导邮箱等内部地址不写进代码（仓库公开），在设置页配置。
 */
export interface MailRouting {
  /** 热线外包平台转发 800 电话记录的发件地址 */
  hotlineSenders: string[];
  /** 领导把客户邮件转发进来时使用的地址 */
  leaderForwardAddresses: string[];
  /** 我方自己的地址（客服信箱等），解析转发邮件时不会被当成客户 */
  ownAddresses: string[];
}

export const DEFAULT_MAIL_ROUTING: MailRouting = {
  hotlineSenders: ['noreply@depothelp.com'],
  leaderForwardAddresses: [],
  ownAddresses: [],
};

const addressList = z
  .array(z.string().trim().toLowerCase().email('邮箱地址格式不正确'))
  .max(20, '最多 20 个地址')
  .transform((list) => [...new Set(list)]);

export const mailRoutingSchema = z
  .object({
    hotlineSenders: addressList,
    leaderForwardAddresses: addressList,
    ownAddresses: addressList,
  })
  .strict();
