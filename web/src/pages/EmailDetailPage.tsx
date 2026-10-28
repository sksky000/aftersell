import { useEffect, useState } from 'react';
import { ArrowLeft, FileText, Film, Paperclip } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import {
  PIPELINE_LABELS,
  STATUS_LABELS,
  type EmailAttachmentDto,
  type EmailDetailDto,
  type ThreadItemDto,
} from '@aftersell/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { api, messageOf } from '@/lib/api';
import { formatDateTime, formatSize } from '@/lib/format';
import { FOLLOW_UP_BADGE_CLASS, STATUS_BADGE_CLASS, THREAD_BADGE_CLASS, UNCLASSIFIED_BADGE_CLASS } from './inbox/badges';
import { senderOf } from './inbox/EmailCard';

function AttachmentList({ items }: { items: EmailAttachmentDto[] }) {
  if (!items.length) return null;
  const images = items.filter((a) => /^image\/(png|jpe?g|gif|webp|bmp)$/.test(a.contentType));
  const others = items.filter((a) => !images.includes(a));
  return (
    <div className="space-y-3">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {images.map((a) => (
            <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block" title={a.filename}>
              <img src={a.url} alt={a.filename} loading="lazy" className="h-32 w-32 object-cover rounded-md border border-border" />
              <div className="mt-1 w-32 text-xs text-muted-foreground truncate">
                {a.isInline ? '正文图片 · ' : ''}
                {a.filename}
              </div>
            </a>
          ))}
        </div>
      )}
      {others.map((a) => {
        const Icon = a.contentType === 'application/pdf' ? FileText : a.contentType.startsWith('video/') ? Film : Paperclip;
        return (
          <a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm hover:underline w-fit"
          >
            <Icon className="size-4 text-muted-foreground" />
            {a.filename}
            <span className="text-xs text-muted-foreground">{formatSize(a.size)}</span>
          </a>
        );
      })}
    </div>
  );
}

export default function EmailDetailPage() {
  const { id = '' } = useParams();
  const [email, setEmail] = useState<EmailDetailDto | null>(null);
  const [thread, setThread] = useState<ThreadItemDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEmail(null);
    setError(null);
    Promise.all([api.get<EmailDetailDto>(`/emails/${id}`), api.get<ThreadItemDto[]>(`/emails/${id}/thread`)])
      .then(([detail, items]) => {
        if (cancelled) return;
        setEmail(detail);
        setThread(items);
      })
      .catch((err) => !cancelled && setError(messageOf(err)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const back = (
    <Button variant="ghost" size="sm" asChild>
      <Link to="/inbox">
        <ArrowLeft className="size-4" /> 返回看板
      </Link>
    </Button>
  );

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-4">
        {back}
        <div className="text-sm text-destructive">{error}</div>
      </div>
    );
  }
  if (!email) {
    return (
      <div className="flex items-center justify-center h-64 gap-2 text-muted-foreground">
        <Spinner className="size-4" /> 加载中…
      </div>
    );
  }

  const others = thread.filter((t) => t.id !== email.id);
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      {back}
      <div className="space-y-2">
        <h1 className="text-xl font-semibold break-words">{email.subject || '（无主题）'}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={STATUS_BADGE_CLASS[email.status]}>
            {STATUS_LABELS[email.status]}
          </Badge>
          <Badge variant="outline" className={UNCLASSIFIED_BADGE_CLASS}>
            {PIPELINE_LABELS[email.pipelineState]}
          </Badge>
          {email.isFollowUp && (
            <Badge variant="outline" className={FOLLOW_UP_BADGE_CLASS}>
              跟进
            </Badge>
          )}
          {email.threadSize > 1 && (
            <Badge variant="outline" className={THREAD_BADGE_CLASS}>
              同一案件 {email.threadSize} 封
            </Badge>
          )}
        </div>
        <div className="text-sm text-muted-foreground space-y-0.5">
          <div>发件人：{senderOf(email)}</div>
          {email.replyTo && email.replyTo !== email.fromAddress && <div>回复地址：{email.replyTo}</div>}
          <div>收信时间：{formatDateTime(email.receivedAt ?? email.createdAt)}</div>
          <div className="text-xs break-all">Message-ID：{email.messageId}</div>
        </div>
      </div>

      <Card className="shadow-none">
        <CardContent className="p-5 space-y-5">
          <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">{email.bodyText || '（正文为空）'}</div>
          {email.attachments.length > 0 && (
            <div className="border-t border-border pt-4 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">附件 {email.attachments.length} 个</div>
              <AttachmentList items={email.attachments} />
            </div>
          )}
        </CardContent>
      </Card>

      {others.length > 0 && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">同一案件的其他来信</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {thread.map((item) => (
              <div key={item.id} className={`border-l-2 pl-4 ${item.id === email.id ? 'border-primary' : 'border-border'}`}>
                <div className="text-xs text-muted-foreground flex gap-2 flex-wrap">
                  <span>{formatDateTime(item.sentAt)}</span>
                  <span>{item.fromName}</span>
                  {item.id === email.id ? (
                    <span className="text-primary">当前邮件</span>
                  ) : (
                    <Link to={`/emails/${item.id}`} className="underline">
                      查看
                    </Link>
                  )}
                </div>
                <div className="text-sm font-medium mt-1">{item.subject || '（无主题）'}</div>
                <div className="text-sm whitespace-pre-wrap break-words mt-1 line-clamp-6">{item.content}</div>
                {item.attachments.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">附件 {item.attachments.length} 个</div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
