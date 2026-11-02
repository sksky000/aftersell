/**
 * 试跑模式（M9）：接生产邮箱与妙搭并行时打开。收件箱只读、不改任何邮件标记、系统禁止发信。
 * 由 MailConfigService 在启动和保存配置时写入，同步、发信、草稿各处直接读取（同 sender-directory 的做法）。
 */
let trial = false;

export function configureTrialMode(value: boolean): void {
  trial = value;
}

export function isTrialMode(): boolean {
  return trial;
}
