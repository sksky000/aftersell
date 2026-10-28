import { bodySharesMediaLink, collectCaseEvidence, type EngineAttachment } from './evidence-state';
import type { KnownCustomerInfo } from './customer-info';

/** 阶段引擎需要的当前来信字段 */
export interface StageMessage {
  messageId: string;
  bodyText: string | null;
  receivedAt: string | null;
  attachments: EngineAttachment[];
}

export type ConversationStage =
  | 'first_contact'
  | 'awaiting_customer_evidence'
  | 'evidence_received'
  | 'quote_given'
  | 'action_promised'
  | 'troubleshooting_in_progress'
  | 'continuing';

export interface ConversationEvent {
  at: Date;
  role: 'customer' | 'agent';
  subject: string | null;
  bodyText: string | null;
  fromAddress: string | null;
  hasMedia: boolean;
  sourceId?: string;
  attachments?: EngineAttachment[];
}

export interface ConversationStageInfo {
  stage: ConversationStage;
  customerTurns: number;
  askedLabels: string[];
  providedLabels: string[];
  missingLabels: string[];
  quotes: Array<{ at: Date; text: string }>;
  promises: Array<{ at: Date; text: string }>;
  lastAgentReplyAt: Date | null;
  lastAgentReplyExcerpt: string;
  priorCaseGapDays: number | null;
}

interface EvidenceItem {
  key: string;
  label: string;
  askRe: RegExp;
  providedRe: RegExp;
}

const EVIDENCE_ITEMS: EvidenceItem[] = [
  {
    key: 'media',
    label: 'photos or a video of the issue',
    askRe: /photos? (?:of|showing)|video (?:showing|of the)|record a video|photos or a video/i,
    providedRe: /(?:attached|enclosed|here (?:is|are)[^.\n]{0,20}(?:the )?(?:photos?|pictures?|videos?))|i (?:attached|sent|uploaded) (?:the |some |a )?(?:photos?|pictures?|videos?)/i,
  },
  {
    key: 'receipt',
    label: 'a copy of the shopping receipt (proof of purchase)',
    askRe: /receipt|proof of purchase|order screenshot|order record/i,
    providedRe: /(?:receipt|order (?:screenshot|record|number)\b[^.\n]{0,20}(?:attached|enclosed|is|here))|(?:attached|enclosed)[^.\n]{0,30}(?:receipt|order screenshot)/i,
  },
  {
    key: 'model',
    label: 'the bike model or serial number',
    askRe: /bike model|serial number|model number/i,
    providedRe:
      /(?:serial|model)\s*(?:number)?[ \t]*(?::|-)[ \t]*[a-z0-9-]{2,}|\b(?:serial|model)[ \t]+(?:number[ \t]+)?is[ \t]+[a-z0-9-]{2,}|\bproduct description\b[^\n]{0,60}\b\d{2}[a-z]{2,}\d{3,}[a-z]*/i,
  },
  {
    key: 'delivery',
    label: 'delivery information (full name, phone number and delivery address)',
    askRe: /delivery information|shipping address|delivery address|full name, phone/i,
    providedRe: /(?:my|our|shipping|delivery) address (?:is|below)|ship (?:it|the)\s+to\b/i,
  },
  {
    key: 'payment',
    label: 'Zelle QR code / payment screenshot',
    askRe: /zelle qr|payment screenshot|screenshot of the payment/i,
    providedRe: /zelle qr|payment (?:screenshot|sent|confirmation)|(?:i|we) (?:have )?(?:already )?(?:sent|made) (?:the )?payment|paid via zelle/i,
  },
];

const QUOTE_RE = /[$][0-9]{2,4}(?:،.[0-9]{2})?/;

export const PRIOR_CASE_GAP_DAYS = 30;
const PROMISE_RE =
  /\bwe (?:will|can|would|'ll|are (?:willing|happy|pleased|able) to) (?:send|ship|create|cover|check|get back|process|arrange|forward|pay|provide|replace|refund|deliver|contact|update|review|lend|offer|reimburse|escalate|try)\b|\bwe are (?:currently )?(?:processing|assembling|arranging|preparing|checking|reviewing|working on)|\bwe have (?:already )?(?:sent|shipped|mailed|processed|issued|arranged|refunded)|\btracking (?:number|#) is\b/i;
const TROUBLESHOOT_RE = /try the following|re-plug|pressing the (?:battery|power)|reseat the|steps below/i;

function splitSentences(text: string | null): string[] {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map((s: string) => s.replace(/^[-*>\s]+/, '').trim())
    .filter((s: string) => s.length > 0 && s.length <= 300);
}

function clipSentence(sentence: string, max: number): string {
  return sentence.length > max ? `${sentence.slice(0, max)}...` : sentence;
}

function detectAskedItems(agentText: string | null): string[] {
  const labels: string[] = [];
  for (const item of EVIDENCE_ITEMS) {
    if (item.askRe.test(agentText ?? '')) labels.push(item.label);
  }
  return labels;
}

function collectProvidedLabels(
  events: ConversationEvent[],
  message: StageMessage,
  knownInfo: KnownCustomerInfo | null,
): string[] {
  const { evidence } = collectCaseEvidence([
    ...events.filter(ev => ev.role === 'customer').map((ev, i) => ({ id: ev.sourceId ?? `history-${i}`, bodyText: ev.bodyText, attachments: ev.attachments })),
    { id: message.messageId, bodyText: message.bodyText, attachments: message.attachments },
  ]);
  const provided = new Set<string>();
  for (const key of ['receipt', 'model', 'payment'] as const) {
    if (evidence[key].state === 'provided' || evidence[key].state === 'unverified') provided.add(key);
  }
  if (evidence.address.state === 'provided' && evidence.name.state === 'provided' && evidence.phone.state === 'provided') provided.add('delivery');
  if (events.some(ev => ev.role === 'customer' && (ev.hasMedia || bodySharesMediaLink(ev.bodyText)))
    || message.attachments.some(att => /^(image|video)\//.test(att.contentType))
    || bodySharesMediaLink(message.bodyText)) provided.add('media');
  // A generic "as requested" response never satisfies unrelated requirements.
  void knownInfo;
  return EVIDENCE_ITEMS.filter(item => provided.has(item.key)).map(item => item.label);
}

export function deriveConversationStage(
  events: ConversationEvent[],
  message: StageMessage,
  knownInfo: KnownCustomerInfo | null,
): ConversationStageInfo | null {
  if (events.length === 0) return null;
  const customerTurns = events.filter((ev: ConversationEvent) => ev.role === 'customer').length + 1;

  const agentEvents = events.filter((ev: ConversationEvent) => ev.role === 'agent');
  const lastAgent = agentEvents.length > 0 ? agentEvents[agentEvents.length - 1] : null;
  const lastAgentText = lastAgent?.bodyText ?? null;

  const askedLabels = detectAskedItems(lastAgentText);
  const askedKeysByLabel = new Map(EVIDENCE_ITEMS.map((item: EvidenceItem) => [item.label, item.key]));
  const providedLabels = collectProvidedLabels(events, message, knownInfo);
  const providedKeys = new Set(
    providedLabels
      .map((label: string) => askedKeysByLabel.get(label))
      .filter((key: string | undefined) => key !== undefined) as string[],
  );
  const missingLabels = askedLabels.filter(
    (label: string) => !providedKeys.has(askedKeysByLabel.get(label) ?? label),
  );

  const quotes: Array<{ at: Date; text: string }> = [];
  const promises: Array<{ at: Date; text: string }> = [];
  for (const ev of agentEvents) {
    for (const sentence of splitSentences(ev.bodyText)) {
      if (QUOTE_RE.test(sentence)) {
        quotes.push({ at: ev.at, text: clipSentence(sentence, 180) });
      }
      if (PROMISE_RE.test(sentence)) {
        promises.push({ at: ev.at, text: clipSentence(sentence, 180) });
      }
    }
  }

  const lastEventAt = events.reduce(
    (latest: Date, ev: ConversationEvent) => (ev.at.getTime() > latest.getTime() ? ev.at : latest),
    events[0].at,
  );
  const currentAt = message.receivedAt ? new Date(message.receivedAt) : null;
  const gapDays =
    currentAt !== null
      ? Math.floor((currentAt.getTime() - lastEventAt.getTime()) / 86_400_000)
      : null;
  const priorCaseGapDays =
    gapDays !== null && gapDays > PRIOR_CASE_GAP_DAYS ? gapDays : null;

  let stage: ConversationStage = 'continuing';
  if (!lastAgent) {
    stage = 'continuing';
  } else if (splitSentences(lastAgentText).some((s: string) => PROMISE_RE.test(s))) {
    stage = 'action_promised';
  } else if (splitSentences(lastAgentText).some((s: string) => QUOTE_RE.test(s))) {
    stage = 'quote_given';
  } else if (askedLabels.length > 0) {
    stage = missingLabels.length > 0 ? 'awaiting_customer_evidence' : 'evidence_received';
  } else if (TROUBLESHOOT_RE.test(lastAgentText ?? '')) {
    stage = 'troubleshooting_in_progress';
  }

  return {
    stage,
    customerTurns,
    askedLabels,
    providedLabels,
    missingLabels,
    quotes: quotes.slice(-3),
    promises: promises.slice(-3),
    lastAgentReplyAt: lastAgent ? lastAgent.at : null,
    lastAgentReplyExcerpt: lastAgentText
      ? clipSentence(lastAgentText.replace(/\s+/g, ' ').trim(), 200)
      : '',
    priorCaseGapDays,
  };
}

const STAGE_HANDLING: Record<ConversationStage, string> = {
  first_contact: 'Handle the current issue using only its own supplied evidence.',
  awaiting_customer_evidence:
    'Our last reply asked the customer for the items listed above. Compare the customer\'s latest email with "Still missing": if they provided some items, acknowledge them briefly and ask ONLY for the remaining ones; if everything has arrived, move straight to the resolution step (quote / warranty decision / shipping arrangement). Never re-introduce the full first-contact flow.',
  evidence_received:
    'The customer has now provided everything we asked for. Skip ALL further evidence requests and move directly to the resolution: quote the price / make the warranty decision / confirm the shipping arrangement, and answer their latest question.',
  quote_given:
    'Our last reply already quoted a price. If the customer agrees to buy, send the fixed Zelle payment instructions and ask for the payment screenshot (plus delivery info only if still missing). If they ask about the quote, answer directly with the same numbers. Do NOT re-quote and do NOT re-ask for evidence we already have.',
  action_promised:
    'Our last reply promised a specific action. Follow up on that action: confirm it is in progress, ask only for what is genuinely needed to complete it (e.g. the shipping address), and directly answer the customer\'s latest question. Do NOT gate the promised action behind new evidence requests.',
  troubleshooting_in_progress:
    'Our last reply sent troubleshooting steps. Do NOT repeat them. Read the customer\'s latest reply for the outcome; if unresolved, move to the next diagnostic step or the replacement/warranty path.',
  continuing:
    'This is a follow-up in an ongoing conversation. Answer the customer\'s latest question directly based on what we last said — do not restart the first-contact flow.',
};

export function formatStageDirectives(info: ConversationStageInfo): string {
  const lines: string[] = [
    `CONVERSATION STAGE (deterministic — computed from the retrieved confirmed-case history; trust this over your own stage judgment):`,
    `- Stage: ${info.stage} (${info.customerTurns} customer emails so far)`,
  ];
  if (info.lastAgentReplyAt) {
    lines.push(
      `- Our last reply (${info.lastAgentReplyAt.toISOString().slice(0, 10)}): "${info.lastAgentReplyExcerpt}"`,
    );
  }
  if (info.askedLabels.length > 0) {
    lines.push(`- Evidence we already asked for: ${info.askedLabels.join('; ')}`);
  }
  if (info.providedLabels.length > 0) {
    lines.push(
      `- Customer has ALREADY provided (across the whole history — NEVER ask for these again): ${info.providedLabels.join('; ')}`,
    );
  }
  if (info.missingLabels.length > 0) {
    lines.push(`- Still missing (if you must ask, ask ONLY for these): ${info.missingLabels.join('; ')}`);
  }
  for (const quote of info.quotes) {
    lines.push(
      `- Previous quote we gave (${quote.at.toISOString().slice(0, 10)}) — reuse this exact number, do NOT quote a different price: "${quote.text}"`,
    );
  }
  for (const promise of info.promises) {
    lines.push(
      `- Action we already promised (${promise.at.toISOString().slice(0, 10)}) — confirm its status, never claim completion unless stated: "${promise.text}"`,
    );
  }
  if (info.priorCaseGapDays !== null) {
    lines.push(
      `- Prior-case boundary: the last message in this history is about ${info.priorCaseGapDays} days old — the earlier conversation is likely a CLOSED case. If the current email raises a NEW issue (a different part or problem), treat it as a FIRST contact for that new issue: do NOT carry over the prior case's quotes, promises or pending steps listed above — the history is background about this customer only. Only if the current email explicitly follows up on the prior case (e.g. asks where the promised part is) do the continuity rules above apply.`,
    );
  }
  lines.push(`STAGE HANDLING (${info.stage}): ${STAGE_HANDLING[info.stage]}`);
  return lines.join('\n');
}
