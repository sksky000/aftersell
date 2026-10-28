import { DEFAULT_MAIL_ROUTING, type MailRouting } from '@aftersell/shared';

/**
 * 发件人角色目录。妙搭版把热线地址、领导邮箱写成常量；这里改为由设置页配置，
 * 启动和保存时由 MailRoutingService 写入。纯函数模块（depothelp / leader-forward /
 * case-association）通过它判断发件人角色，签名与妙搭版保持一致便于直接迁移。
 */
interface Directory {
  hotline: Set<string>;
  leader: Set<string>;
  /** 解析转发邮件时排除的地址：热线 + 领导 + 我方 */
  forwardExcluded: Set<string>;
}

function build(routing: MailRouting): Directory {
  const norm = (list: string[]) => list.map((a) => a.trim().toLowerCase()).filter(Boolean);
  const hotline = new Set(norm(routing.hotlineSenders));
  const leader = new Set(norm(routing.leaderForwardAddresses));
  return {
    hotline,
    leader,
    forwardExcluded: new Set([...hotline, ...leader, ...norm(routing.ownAddresses)]),
  };
}

let current = build(DEFAULT_MAIL_ROUTING);

export function configureSenderDirectory(routing: MailRouting): void {
  current = build(routing);
}

export function senderDirectory(): Readonly<Directory> {
  return current;
}
