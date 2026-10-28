import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, FileText, Film, Paperclip, RotateCw, ShieldOff } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ADJUDICATION_LABELS,
  CATEGORY_LABELS,
  EVIDENCE_LABELS,
  MISSING_EVIDENCE_LABELS,
  PART_TYPE_LABELS,
  PIPELINE_LABELS,
  STATUS_LABELS,
  URGENCY_LABELS,
  type CreateAdjudicationRequest,
  type EmailAttachmentDto,
  type EmailDetailDto,
  type ThreadItemDto,
} from '@aftersell/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/auth';
import { api, messageOf } from '@/lib/api';
import { formatDateTime, formatSize } from '@/lib/format';
import {
  EVIDENCE_BADGE_CLASS,
  FAILED_BADGE_CLASS,
  FOLLOW_UP_BADGE_CLASS,
  NOT_OURS_BADGE_CLASS,
  SAFETY_HAZARD_BADGE_CLASS,
  STATUS_BADGE_CLASS,
  THREAD_BADGE_CLASS,
  UNCLASSIFIED_BADGE_CLASS,
  URGENCY_BADGE_CLASS,
} from './inbox/badges';
import { senderOf } from './inbox/EmailCard';

const POLL_MS = 4000;

function RecognitionNote({ att }: { att: EmailAttachmentDto }) {
  const r = att.recognition;
  if (r.status === 'succeeded') {
    return (
      <div className="text-xs text-foreground/80 whitespace-pre-wrap break-words bg-muted/50 rounded-md p-2 mt-1">
        <span className="text-muted-foreground">{att.contentType === 'application/pdf' ? 'PDF 文字：' : 'AI 识图：'}</span>
        {r.text}
      </div>
    );
  }
  const text = r.status === 'pending' ? '等待识别…' : r.reason ?? '未识别';
  return <div className={`text-xs mt-1 ${r.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{text}</div>;
}

function AttachmentList({ items }: { items: EmailAttachmentDto[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-4">
      {items.map((a) => {
        const isImage = /^image\/(png|jpe?g|gif|webp|bmp)$/.test(a.contentType);
        const Icon = a.contentType === 'application/pdf' ? FileText : a.contentType.startsWith('video/') ? Film : Paperclip;
        return (
          <div key={a.id} className="flex gap-3">
            {isImage ? (
              <a href={a.url} target="_blank" rel="noreferrer" className="shrink-0" title={a.filename}>
                <img src={a.url} alt={a.filename} loading="lazy" className="h-28 w-28 object-cover rounded-md border border-border" />
              </a>
            ) : (
              <div className="h-12 w-12 shrink-0 rounded-md border border-border flex items-center justify-center">
                <Icon className="size-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <a href={a.url} target="_blank" rel="noreferrer" className="text-sm hover:underline break-all">
                {a.filename}
              </a>
              <span className="ml-2 text-xs text-muted-foreground">
                {a.isInline ? '正文图片 · ' : ''}
                {formatSize(a.size)}
              </span>
              <RecognitionNote att={a} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClassificationCard({ email }: { email: EmailDetailDto }) {
  if (email.pipelineState === 'ingested') {
    return (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        {email.pipelineError ? (
          <span className="text-destructive">{email.pipelineError}</span>
        ) : (
          <>
            <Spinner className="size-4" /> 正在识别附件与分类…
          </>
        )}
      </div>
    );
  }
  if (email.pipelineState === 'failed') {
    return <div className="text-sm text-destructive">{email.pipelineError ?? '分类失败'}</div>;
  }
  const detail = email.classifyDetail;
  const rows: [string, React.ReactNode][] = [
    [
      '类别 / 零件',
      <>
        {CATEGORY_LABELS[email.category]} · {PART_TYPE_LABELS[email.partType]}
      </>,
    ],
    [
      '紧急度',
      <Badge variant="outline" className={URGENCY_BADGE_CLASS[email.urgency]}>
        {URGENCY_LABELS[email.urgency]}
      </Badge>,
    ],
    [
      '凭证',
      <span className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className={EVIDENCE_BADGE_CLASS[email.evidenceStatus]}>
          {EVIDENCE_LABELS[email.evidenceStatus]}
        </Badge>
        {email.missingEvidence.length > 0 && <span>缺：{email.missingEvidence.map((m) => MISSING_EVIDENCE_LABELS[m]).join('、')}</span>}
      </span>,
    ],
    ['是否客诉', email.isComplaint ? '是' : '否'],
    ['语言', email.language],
    ['置信度', email.confidence ?? '—'],
  ];
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {email.isSafetyHazard && (
          <Badge variant="outline" className={SAFETY_HAZARD_BADGE_CLASS}>
            安全隐患
          </Badge>
        )}
        {!email.isOurProduct && (
          <Badge variant="outline" className={NOT_OURS_BADGE_CLASS}>
            非我方产品{detail?.notOurProductReason ? `：${detail.notOurProductReason}` : ''}
          </Badge>
        )}
      </div>
      {email.summary && <p className="text-sm">{email.summary}</p>}
      <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="text-xs text-muted-foreground">
        {formatDateTime(email.classifiedAt)} 由 {detail ? `${detail.provider} / ${detail.model}` : '模型'} 分类
      </div>
    </div>
  );
}

export default function EmailDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [email, setEmail] = useState<EmailDetailDto | null>(null);
  const [thread, setThread] = useState<ThreadItemDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [detail, items] = await Promise.all([
      api.get<EmailDetailDto>(`/emails/${id}`),
      api.get<ThreadItemDto[]>(`/emails/${id}/thread`),
    ]);
    setEmail(detail);
    setThread(items);
  }, [id]);

  useEffect(() => {
    setEmail(null);
    setError(null);
    load().catch((err) => setError(messageOf(err)));
  }, [load]);

  // 分类或识别进行中时轮询
  const processing =
    !!email &&
    ((email.pipelineState === 'ingested' && !email.pipelineError) || email.attachments.some((a) => a.recognition.status === 'pending'));
  useEffect(() => {
    if (!processing) return;
    const timer = window.setTimeout(() => void load().catch(() => undefined), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [processing, email, load]);

  const reclassify = async () => {
    setBusy(true);
    try {
      await api.post(`/emails/${id}/reclassify`);
      toast.success('已加入重新分类队列');
      setEmail((e) => (e ? { ...e, pipelineState: 'ingested', pipelineError: null } : e));
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleNotOurs = async () => {
    if (!email?.customerEmail) return;
    const existing = email.adjudications.find((a) => a.factType === 'non_phoenix_product');
    setBusy(true);
    try {
      if (existing) await api.delete(`/adjudications/${existing.id}`);
      else {
        await api.post('/adjudications', {
          customerEmail: email.customerEmail,
          factType: 'non_phoenix_product',
        } satisfies CreateAdjudicationRequest);
      }
      await api.post(`/emails/${id}/reclassify`);
      toast.success(existing ? '已撤销裁决，正在重新分类' : '已标记该客户为非我方产品，正在重新分类');
      await load();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <Button variant="ghost" size="sm" asChild>
      <Link to="/inbox">
        <ArrowLeft className="size-4" /> 返回看板
      </Link>
    </Button>
  );

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-4">
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

  const notOursAdjudication = email.adjudications.find((a) => a.factType === 'non_phoenix_product');
  const others = thread.filter((t) => t.id !== email.id);
  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      {back}
      <div className="space-y-2">
        <h1 className="text-xl font-semibold break-words">{email.subject || '（无主题）'}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={STATUS_BADGE_CLASS[email.status]}>
            {STATUS_LABELS[email.status]}
          </Badge>
          <Badge
            variant="outline"
            className={email.pipelineState === 'failed' ? FAILED_BADGE_CLASS : UNCLASSIFIED_BADGE_CLASS}
          >
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
          {email.customerEmail && email.customerEmail !== email.fromAddress?.toLowerCase() && <div>客户：{email.customerEmail}</div>}
          {email.replyTo && email.replyTo !== email.fromAddress && <div>回复地址：{email.replyTo}</div>}
          <div>收信时间：{formatDateTime(email.receivedAt ?? email.createdAt)}</div>
          <div className="text-xs break-all">Message-ID：{email.messageId}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_20rem] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          <Card className="shadow-none">
            <CardContent className="p-5 space-y-5">
              <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">{email.bodyText || '（正文为空）'}</div>
              {email.attachments.length > 0 && (
                <div className="border-t border-border pt-4 space-y-3">
                  <div className="text-xs font-medium text-muted-foreground">附件 {email.attachments.length} 个</div>
                  <AttachmentList items={email.attachments} />
                </div>
              )}
            </CardContent>
          </Card>

          {others.length > 0 && (
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-base">同一案件的来信</CardTitle>
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

        <div className="space-y-4">
          <Card className="shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">分类结果</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ClassificationCard email={email} />
              <Button variant="outline" size="sm" onClick={() => void reclassify()} disabled={busy || processing}>
                <RotateCw className="size-4" /> 重新分类
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">客户裁决</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {email.customerEmail ? (
                <>
                  <div className="text-xs text-muted-foreground break-all">客户：{email.customerEmail}</div>
                  {email.adjudications.length ? (
                    email.adjudications.map((a) => (
                      <div key={a.id}>
                        {ADJUDICATION_LABELS[a.factType]}
                        <span className="text-xs text-muted-foreground ml-1">（{formatDateTime(a.createdAt)}）</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-muted-foreground">暂无。人工确认的事实会覆盖模型判断，对该客户以后的来信都生效。</div>
                  )}
                  {can('supervisor') && (
                    <Button variant="outline" size="sm" onClick={() => void toggleNotOurs()} disabled={busy}>
                      <ShieldOff className="size-4" />
                      {notOursAdjudication ? '撤销“非我方产品”' : '标记为非我方产品'}
                    </Button>
                  )}
                </>
              ) : (
                <div className="text-muted-foreground">无法确定客户邮箱（如只有姓名电话的热线工单），不能做客户级裁决。</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
