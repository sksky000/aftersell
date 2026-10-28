import { ChevronRight, MessageSquare, Paperclip, Reply } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  CATEGORY_LABELS,
  EVIDENCE_LABELS,
  PART_TYPE_LABELS,
  PIPELINE_LABELS,
  STATUS_LABELS,
  URGENCY_LABELS,
  type EmailListItem,
} from '@aftersell/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import {
  EVIDENCE_BADGE_CLASS,
  FOLLOW_UP_BADGE_CLASS,
  SAFETY_HAZARD_BADGE_CLASS,
  STATUS_BADGE_CLASS,
  THREAD_BADGE_CLASS,
  FAILED_BADGE_CLASS,
  NOT_OURS_BADGE_CLASS,
  UNCLASSIFIED_BADGE_CLASS,
  URGENCY_BADGE_CLASS,
} from './badges';

export function senderOf(email: Pick<EmailListItem, 'fromName' | 'fromAddress'>): string {
  if (email.fromName && email.fromAddress && email.fromName !== email.fromAddress) {
    return `${email.fromName} <${email.fromAddress}>`;
  }
  return email.fromAddress ?? email.fromName ?? '未知发件人';
}

export default function EmailCard({ email }: { email: EmailListItem }) {
  const classified = email.pipelineState === 'classified' || email.pipelineState === 'drafted';
  return (
    <Link to={`/emails/${email.id}`} className="block">
      <Card className="shadow-none hover:border-primary/40 transition-colors">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm truncate">{email.subject || '（无主题）'}</span>
                {classified ? (
                  <Badge variant="outline" className={URGENCY_BADGE_CLASS[email.urgency]}>
                    {URGENCY_LABELS[email.urgency]}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className={email.pipelineState === 'failed' ? FAILED_BADGE_CLASS : UNCLASSIFIED_BADGE_CLASS}
                    title={email.pipelineError ?? undefined}
                  >
                    {PIPELINE_LABELS[email.pipelineState]}
                  </Badge>
                )}
                {classified && !email.isOurProduct && (
                  <Badge variant="outline" className={NOT_OURS_BADGE_CLASS}>
                    非我方产品
                  </Badge>
                )}
                {email.isSafetyHazard && (
                  <Badge variant="outline" className={SAFETY_HAZARD_BADGE_CLASS}>
                    安全隐患
                  </Badge>
                )}
                <Badge variant="outline" className={STATUS_BADGE_CLASS[email.status]}>
                  {STATUS_LABELS[email.status]}
                </Badge>
                {email.threadSize > 1 && (
                  <Badge variant="outline" className={THREAD_BADGE_CLASS}>
                    <MessageSquare className="size-3 mr-1" />
                    {email.threadSize} 封往来
                  </Badge>
                )}
                {email.isFollowUp && (
                  <Badge variant="outline" className={FOLLOW_UP_BADGE_CLASS}>
                    <Reply className="size-3 mr-1" />
                    跟进
                  </Badge>
                )}
                {email.attachmentCount > 0 && (
                  <Badge variant="outline">
                    <Paperclip className="size-3 mr-1" />
                    {email.attachmentCount}
                  </Badge>
                )}
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground truncate">{senderOf(email)}</div>
              {email.pipelineError && !classified && (
                <div className="mt-1.5 text-xs text-destructive">{email.pipelineError}</div>
              )}
              {(email.summary || email.preview) && (
                <p className="mt-2 text-sm text-foreground/80 line-clamp-2 break-words">{email.summary || email.preview}</p>
              )}
              {classified && (
                <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary">{PART_TYPE_LABELS[email.partType]}</Badge>
                  <Badge variant="secondary">{CATEGORY_LABELS[email.category]}</Badge>
                  <Badge variant="outline" className={EVIDENCE_BADGE_CLASS[email.evidenceStatus]}>
                    {EVIDENCE_LABELS[email.evidenceStatus]}
                    {email.missingEvidence.length > 0 && `·缺${email.missingEvidence.length}项`}
                  </Badge>
                  {email.confidence !== null && (
                    <span className="text-xs text-muted-foreground" title="分类置信度">
                      置信度 {email.confidence}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0 text-xs text-muted-foreground whitespace-nowrap">
              {formatDateTime(email.receivedAt ?? email.createdAt)}
              <ChevronRight className="size-4" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
