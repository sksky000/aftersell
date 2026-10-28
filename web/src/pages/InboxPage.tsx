import { Inbox } from 'lucide-react';

/** M1 接入拉信入库后替换为看板列表 */
export default function InboxPage() {
  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold">邮件看板</h1>
      <div className="mt-16 flex flex-col items-center text-muted-foreground gap-3">
        <Inbox className="size-10" />
        <div className="text-sm">还没有邮件。拉信入库将在下一个里程碑（M1）上线。</div>
      </div>
    </div>
  );
}
