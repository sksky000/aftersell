import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSearch, ListChecks, Paperclip, RotateCw, Save, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  MAX_REPLY_ATTACHMENTS,
  MAX_UPLOAD_BYTES,
  RULE_SLOT_LABELS,
  uploadUrl,
  type DraftContextDto,
  type DraftDto,
  type PreviewSubjectResponse,
  type ReplyTargetDto,
  type SendReplyRequest,
  type SentReplyDto,
  type UploadDto,
} from '@aftersell/shared';
import RichTextEditor, { type RichTextEditorHandle } from '@/components/RichTextEditor';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/auth';
import { api, messageOf, uploadFile } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { htmlToText, sanitizeReplyHtml, textToHtml } from '@/lib/html';

const POLL_MS = 4000;
const AUTOSAVE_MS = 2000;

interface Props {
  emailId: string;
  /** 分类完成、草稿还在生成中 */
  pending: boolean;
  /** 草稿生成失败等原因 */
  error: string | null;
  /** 这类邮件会自动生成草稿（非客诉的 other 不生成，但仍可手写回复） */
  canDraft: boolean;
  /** 邮件已标记为已回复（含在邮箱客户端里回复的） */
  replied: boolean;
  onSent: () => void;
}

const formatSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

function editorHtmlOf(d: DraftDto | null): string {
  if (!d) return '';
  return d.html ?? textToHtml(d.finalContent ?? d.content);
}

/** 草稿 + 编辑 + 发送。快捷键 Ctrl+Enter 只打开确认框，不直接发送 */
export default function ReplyPanel({ emailId, pending, error, canDraft, replied, onSent }: Props) {
  const { can } = useAuth();
  const editorRef = useRef<RichTextEditorHandle>(null);
  const [draft, setDraft] = useState<DraftDto | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [waitingFor, setWaitingFor] = useState<number | null>(null);
  const [showHits, setShowHits] = useState(false);
  const [context, setContext] = useState<string | null>(null);

  // 编辑器：initialHtml 只在换草稿时变化，html / text 是当前内容
  const [initialHtml, setInitialHtml] = useState('');
  const [html, setHtml] = useState('');
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<UploadDto[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // 发送确认框
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sendKey, setSendKey] = useState('');
  const [subject, setSubject] = useState('');
  const [subjectLoading, setSubjectLoading] = useState(false);
  const [target, setTarget] = useState<ReplyTargetDto | null>(null);
  const [sending, setSending] = useState(false);

  const resetEditor = useCallback((d: DraftDto | null) => {
    const h = editorHtmlOf(d);
    setInitialHtml(h);
    setHtml(h);
    setText(d ? (d.finalContent ?? d.content) : '');
    setAttachments(d?.attachments ?? []);
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    const d = await api.get<DraftDto | null>(`/emails/${emailId}/draft`);
    setDraft(d);
    setLoaded(true);
    return d;
  }, [emailId]);

  useEffect(() => {
    load()
      .then(resetEditor)
      .catch((e) => toast.error(messageOf(e)));
  }, [load, resetEditor]);

  // 生成中或刚点了“重新生成”时轮询，直到出现新版本
  const polling = (pending && !draft) || waitingFor !== null;
  useEffect(() => {
    if (!polling) return;
    const timer = window.setTimeout(async () => {
      const prev = draft?.version ?? 0;
      const d = await load().catch(() => null);
      if (d && d.version > prev) {
        resetEditor(d);
        if (waitingFor !== null) {
          setWaitingFor(null);
          toast.success(`草稿已更新为第 ${d.version} 版`);
        }
      }
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [polling, waitingFor, draft, load, resetEditor]);

  const sent = draft?.status === 'sent';
  const locked = sent || replied || draft?.status === 'sending';

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const d = await api.put<DraftDto>(`/emails/${emailId}/reply`, { content: text, html, attachmentIds: attachments.map((a) => a.id) });
      setDraft(d);
      setDirty(false);
      return true;
    } catch (e) {
      toast.error(`保存失败：${messageOf(e)}`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [emailId, text, html, attachments]);

  // 停止输入 2 秒后自动保存
  useEffect(() => {
    if (!dirty || locked || saving) return;
    const timer = window.setTimeout(() => void save(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, locked, saving, save]);

  const regenerate = async () => {
    if (dirty || (draft?.finalContent && draft.finalContent !== draft.content)) {
      if (!window.confirm('重新生成会新建一版草稿，当前的修改不会带过去。继续吗？')) return;
    }
    try {
      await api.post(`/emails/${emailId}/draft/regenerate`);
      setWaitingFor(draft?.version ?? 0);
      toast.success('已加入生成队列，约半分钟');
    } catch (e) {
      toast.error(messageOf(e));
    }
  };

  const openContext = async () => {
    try {
      setContext((await api.get<DraftContextDto>(`/emails/${emailId}/draft/context`)).context || '（无）');
    } catch (e) {
      toast.error(messageOf(e));
    }
  };

  const addAttachments = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    if (attachments.length + list.length > MAX_REPLY_ATTACHMENTS) {
      toast.error(`最多 ${MAX_REPLY_ATTACHMENTS} 个附件`);
      return;
    }
    const tooBig = list.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooBig) {
      toast.error(`${tooBig.name} 超过 25MB 上限`);
      return;
    }
    setUploading(true);
    try {
      const uploaded: UploadDto[] = [];
      for (const f of list) uploaded.push(await uploadFile(f));
      setAttachments((prev) => [...prev, ...uploaded]);
      setDirty(true);
    } catch (e) {
      toast.error(`附件上传失败：${messageOf(e)}`);
    } finally {
      setUploading(false);
    }
  };

  const openConfirm = useCallback(async () => {
    if (!text.trim()) {
      toast.error('回复内容不能为空');
      return;
    }
    if (html.includes('图片上传中')) {
      toast.error('还有图片在上传，请稍候');
      return;
    }
    setSendKey(crypto.randomUUID());
    setTarget(null);
    setSubject('');
    setConfirmOpen(true);
    setSubjectLoading(true);
    api
      .get<ReplyTargetDto>(`/emails/${emailId}/reply/target`)
      .then(setTarget)
      .catch((e) => setTarget({ to: null, via: 'direct', blockedReason: messageOf(e) }));
    api
      .post<PreviewSubjectResponse>(`/emails/${emailId}/reply/subject`, { content: text })
      .then((r) => setSubject((s) => s || r.subject))
      .catch(() => toast.error('主题生成失败，请手动填写'))
      .finally(() => setSubjectLoading(false));
  }, [emailId, text, html]);

  // Ctrl+Enter：打开发送确认框
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !locked && !confirmOpen) {
        e.preventDefault();
        void openConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locked, confirmOpen, openConfirm]);

  const send = async () => {
    if (sending) return;
    setSending(true);
    try {
      const body: SendReplyRequest = { content: text, html, subject, attachmentIds: attachments.map((a) => a.id), idempotencyKey: sendKey };
      const r = await api.post<SentReplyDto>(`/emails/${emailId}/reply/send`, body);
      toast.success(r.duplicate ? '这封回复之前已经发出，没有重复发送' : `已发送给 ${r.to}`);
      setConfirmOpen(false);
      resetEditor(await load());
      onSent();
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setSending(false);
    }
  };

  // ---------- 渲染 ----------

  let draftInfo: React.ReactNode = null;
  if (!loaded) {
    draftInfo = (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" /> 加载中…
      </div>
    );
  } else if (!draft?.content && !locked) {
    draftInfo = (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : pending || waitingFor !== null ? (
          <>
            <Spinner className="size-4" /> 正在生成草稿…生成后会自动填进下面的编辑框
          </>
        ) : canDraft ? (
          '还没有草稿，可以直接在下面写回复'
        ) : (
          '这类来信（非客诉的其他邮件）不自动生成草稿，需要回复时直接在下面写'
        )}
      </div>
    );
  } else if (draft && !locked) {
    const grouped = new Map<string, string[]>();
    for (const h of draft.hits) grouped.set(h.slot, [...(grouped.get(h.slot) ?? []), h.description]);
    draftInfo = (
      <div className="space-y-3">
        {error && <div className="text-sm text-destructive">{error}</div>}
        {draft.checks.length > 0 && (
          <Alert variant="destructive">
            <AlertDescription className="space-y-1">
              {draft.checks.map((c) => (
                <div key={c.code} className="flex gap-2">
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <span>{c.message}</span>
                </div>
              ))}
            </AlertDescription>
          </Alert>
        )}
        <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
          <span>
            AI 草稿第 {draft.version} 版 · {formatDateTime(draft.createdAt)} · {draft.provider} / {draft.model}
          </span>
          <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => setShowHits((v) => !v)}>
            <ListChecks className="size-3.5" /> 命中了 {draft.hits.length} 条规则
          </button>
        </div>
        {showHits && (
          <div className="space-y-2 text-sm rounded-md border border-border p-3">
            {[...grouped.entries()].map(([slot, items]) => (
              <div key={slot}>
                <div className="text-xs text-muted-foreground">{RULE_SLOT_LABELS[slot as keyof typeof RULE_SLOT_LABELS] ?? slot}</div>
                <ul className="list-disc pl-5">
                  {items.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{locked ? '回复' : '回复草稿'}</CardTitle>
        <div className="flex items-center gap-2">
          {draft?.content && can('supervisor') && (
            <Button variant="ghost" size="sm" onClick={() => void openContext()}>
              <FileSearch className="size-4" /> 上下文
            </Button>
          )}
          {canDraft && !locked && (
            <Button variant="outline" size="sm" onClick={() => void regenerate()} disabled={polling}>
              {waitingFor !== null ? <Spinner className="size-4" /> : <RotateCw className="size-4" />}
              重新生成
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {draftInfo}

        {sent && draft ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
              <CheckCircle2 className="size-4" />
              {draft.sentAt && formatDateTime(draft.sentAt)} 已发送给 {draft.sentTo}
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">主题：</span>
              {draft.subjectSent}
            </div>
            <div
              className="text-sm leading-relaxed rounded-md border border-border p-4 bg-muted/30 break-words [&_img]:max-w-full [&_img]:max-h-80 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
              dangerouslySetInnerHTML={{ __html: sanitizeReplyHtml(editorHtmlOf(draft)) }}
            />
            <AttachmentList items={draft.attachments} />
          </div>
        ) : draft?.status === 'sending' ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Spinner className="size-4" /> 正在发送…如长时间停在这里，请到邮箱“已发送”里核对是否已发出
          </div>
        ) : replied ? (
          <div className="text-sm text-muted-foreground">这封邮件已标记为已回复（可能是在邮箱客户端里回复的）。</div>
        ) : (
          <>
            <RichTextEditor
              ref={editorRef}
              value={initialHtml}
              onChange={(h, t) => {
                setHtml(h);
                setText(t);
                setDirty(true);
              }}
            />
            <AttachmentList
              items={attachments}
              onRemove={(id) => {
                setAttachments((prev) => prev.filter((a) => a.id !== id));
                setDirty(true);
              }}
            />
            <div className="flex items-center gap-2">
              <label>
                <input type="file" multiple className="hidden" disabled={uploading} onChange={(e) => void addAttachments(e.target.files).finally(() => (e.target.value = ''))} />
                <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-sm cursor-pointer hover:bg-muted">
                  {uploading ? <Spinner className="size-4" /> : <Paperclip className="size-4" />}
                  附件
                </span>
              </label>
              <span className="text-xs text-muted-foreground">
                {saving ? '保存中…' : dirty ? '有未保存的修改' : draft?.finalContent != null ? '已保存' : ''}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void save().then((ok) => ok && toast.success('已保存'))} disabled={saving || !dirty}>
                  <Save className="size-4" /> 保存
                </Button>
                <Button size="sm" onClick={() => void openConfirm()} disabled={!text.trim() || uploading} title="Ctrl+Enter">
                  <Send className="size-4" /> 发送…
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={(open) => !sending && setConfirmOpen(open)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>确认发送</DialogTitle>
            <DialogDescription>发出后无法撤回，请核对收件人、主题和内容。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>收件人</Label>
              {target === null ? (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Spinner className="size-4" /> 解析中…
                </div>
              ) : (
                <>
                  <div className="text-sm font-medium">
                    {target.to ?? '—'}
                    {target.via !== 'direct' && <span className="ml-2 text-xs text-muted-foreground">{target.via === 'hotline' ? '（热线工单里的客户邮箱）' : '（转发内容里的客户邮箱）'}</span>}
                  </div>
                  {target.blockedReason && <div className="text-sm text-destructive">{target.blockedReason}</div>}
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reply-subject">主题</Label>
              <div className="relative">
                <Input id="reply-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={subjectLoading ? '正在生成主题…' : ''} />
                {subjectLoading && <Spinner className="size-4 absolute right-3 top-2.5" />}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>内容</Label>
              <div className="text-sm whitespace-pre-wrap break-words max-h-64 overflow-y-auto rounded-md border border-border p-3 bg-muted/30">{htmlToText(html) || text}</div>
              {html.includes('/api/uploads/') && <div className="text-xs text-muted-foreground">正文里的图片会内嵌在邮件中。</div>}
            </div>
            {attachments.length > 0 && <AttachmentList items={attachments} />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={sending}>
              取消
            </Button>
            <Button onClick={() => void send()} disabled={sending || !subject.trim() || !target?.to || !!target.blockedReason}>
              {sending ? <Spinner className="size-4" /> : <Send className="size-4" />}
              确认发送
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={context !== null} onOpenChange={(open) => !open && setContext(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>送给草稿模型的上下文</DialogTitle>
          </DialogHeader>
          <pre className="text-xs whitespace-pre-wrap break-words">{context}</pre>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AttachmentList({ items, onRemove }: { items: UploadDto[]; onRemove?: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((a) => (
        <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs">
          <Paperclip className="size-3" />
          <a href={uploadUrl(a.id)} target="_blank" rel="noreferrer" className="hover:underline max-w-56 truncate">
            {a.filename}
          </a>
          <span className="text-muted-foreground">{formatSize(a.size)}</span>
          {onRemove && (
            <button type="button" className="hover:text-destructive" onClick={() => onRemove(a.id)} title="移除">
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
