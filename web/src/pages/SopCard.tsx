import { CATEGORY_LABELS, MISSING_EVIDENCE_LABELS, PART_TYPE_LABELS, type EmailDetailDto } from '@aftersell/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSnippets } from '@/lib/useSnippets';

/** 标准处理流程：按类别取 SOP，另加该零件的补充说明 */
export default function SopCard({ email }: { email: EmailDetailDto }) {
  const snippets = useSnippets();
  if (!snippets) return null;
  const sops = snippets.filter((s) => s.kind === 'sop');
  const main = sops.find((s) => s.category === email.category && !s.partType) ?? sops.find((s) => s.category === 'other' && !s.partType);
  const extras = sops.filter((s) => s.partType === email.partType && (!s.category || s.category === email.category));
  if (!main && !extras.length) return null;

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {main?.label ?? '处理流程'}
          <Badge variant="secondary">{CATEGORY_LABELS[email.category]}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {email.isSafetyHazard && (
          <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-900 px-3 py-2 text-red-700 dark:text-red-300">
            安全隐患件：优先处理。先提醒客户停用停充，再按流程处理。
          </div>
        )}
        {email.missingEvidence.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-900 px-3 py-2 text-amber-800 dark:text-amber-300">
            凭证不全（缺：{email.missingEvidence.map((m) => MISSING_EVIDENCE_LABELS[m]).join('、')}），先补索凭证。
          </div>
        )}
        {main && (
          <ol className="list-decimal pl-5 space-y-1.5 text-foreground/90">
            {main.text.split('\n').filter(Boolean).map((step) => (
              <li key={step} className="break-words">
                {step}
              </li>
            ))}
          </ol>
        )}
        {extras.map((x) => (
          <div key={x.id} className="rounded-md border border-border bg-muted/40 px-3 py-2 break-words">
            <span className="font-medium">{x.label || PART_TYPE_LABELS[email.partType]}：</span>
            {x.text}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
