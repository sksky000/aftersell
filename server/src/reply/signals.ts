import type { MissingEvidence, PaymentSettings } from '@aftersell/shared';
import { isDepothelpSender, parseDepothelpSubject } from '../mail/depothelp';
import { extractForwardedCustomer, isLeaderForward } from '../mail/leader-forward';
import { hasModelCodeText, matchModel, type CompiledModel } from '../knowledge/product-knowledge';
import type { EngineAttachment } from './evidence-state';
import type { ConversationStageInfo } from './history-stage';
import {
  daysSinceReceived,
  DYNAMIC_ISSUE_VIDEO_RES,
  EXPLICIT_NO_MULTIMETER_RE,
  EXPLICIT_NO_RECEIPT_RES,
  EXPLICIT_SECONDHAND_RE,
  extractFirstName,
  extractSignatureName,
  extractWalmartStoreNumber,
  FLAT_ON_ARRIVAL_RES,
  isWalmartStoreSender,
  MODEL_CONFIRM_PHOTOS,
  OTHER_MISSING_PART_RE,
  PURCHASE_CATEGORIES,
  REGISTRATION_EVIDENCE_ALLOWLIST,
  stripQuotedReply,
  TOOLKIT_MISSING_RE,
  VALVE_DAMAGE_RES,
  WARRANTY_INTENT_RE,
} from './patterns';

/** 默认 video 主形态：人工几乎只写 "a video"（默认）或 "photos of X"（具体对象） */
const EVIDENCE_ITEM_EN: Record<MissingEvidence, string> = {
  photo_or_video: 'A short video of the issue',
  purchase_proof: 'A copy of your shopping receipt (proof of purchase)',
  model_or_serial: 'The bike model or serial number',
  shipping_info: 'Your delivery information (full name, phone number and delivery address)',
};

export interface SignalsMessage {
  subject: string | null;
  bodyText: string;
  fromAddress: string | null;
  fromName: string | null;
  receivedAt: Date | null;
  category: string;
  partType: string;
  language: string;
  isSafetyHazard: boolean;
  isOurProduct: boolean;
  summary: string | null;
  evidenceStatus: string;
  missingEvidence: MissingEvidence[];
  attachments: EngineAttachment[];
}

/**
 * 一封来信的结构化信号：规则表的 when 条件对它求值，文案里的 {占位符} 也从这里取值。
 * 判定逻辑逐条来自妙搭 buildReplyContext，只是从 if/else 改成了数据。
 */
export interface CaseSignals {
  [key: string]: string | number | boolean | null;
  category: string;
  partType: string;
  language: string;
  stage: string | null;
  isFirstContact: boolean;
  firstName: string;
  channel: 'direct' | 'hotline' | 'leader_forward';
  hotlineName: string | null;
  hotlinePhone: string | null;
  hotlineEarlierCall: boolean;
  delayDays: number;
  isWalmartStore: boolean;
  storeLabel: string;
  storeFrom: string;
  isSafetyHazard: boolean;
  isOurProduct: boolean;
  modelKnown: boolean;
  isPurchaseFlow: boolean;
  toolkitNotIncluded: boolean;
  toolkitOnlyComplaint: boolean;
  providedMediaCount: number;
  hasProvidedMedia: boolean;
  hasProvidedVideo: boolean;
  isDamagedShipping: boolean;
  isValveDamageFlow: boolean;
  needsVideoOnly: boolean;
  stageResolvedAll: boolean;
  evidenceStatus: string;
  missingCount: number;
  missingItemsWord: string;
  missingList: string;
  videoStillMissing: boolean;
  explicitNoReceipt: boolean;
  explicitSecondhand: boolean;
  explicitNoMultimeter: boolean;
  hasImageDescriptions: boolean;
  imageDescriptions: string;
  confirmPhotos: string;
  hasAxleNut: boolean;
  matchedModel: string | null;
  paymentSentence: string;
  actionPrefix: string;
}

export function paymentSentence(p: PaymentSettings): string {
  if (!p.zelleEmail) return 'Payment details are not configured: say we will send the payment instructions separately';
  const who = [p.zelleName && `name ${p.zelleName}`, p.zellePhone && `phone number ${p.zellePhone}`].filter(Boolean).join(', ');
  return `Payment via Zelle only (${p.zelleEmail}${who ? `, ${who}` : ''})${p.extraNote ? `. ${p.extraNote}` : ''}`;
}

function firstNameOf(m: SignalsMessage, channel: CaseSignals['channel'], hotline: { customerName: string } | null): string {
  if (channel === 'hotline' && hotline) return hotline.customerName.split(/\s+/)[0];
  const signatureName = extractSignatureName(m.bodyText);
  if (channel === 'leader_forward') {
    const forwarded = extractForwardedCustomer(m.bodyText);
    return signatureName ?? (forwarded?.name ? forwarded.name.trim().split(/\s+/)[0] : null) ?? 'there';
  }
  const fromNameFirst = (m.fromName ?? '').trim().split(/\s+/)[0] || '';
  const fromNameUsable = /^[A-Za-z]{3,}$/.test(fromNameFirst);
  const subjectContact = parseDepothelpSubject(m.subject);
  return (
    signatureName ??
    (fromNameUsable ? fromNameFirst : null) ??
    (subjectContact ? subjectContact.customerName.split(/\s+/)[0] : null) ??
    extractFirstName(m.fromName, m.fromAddress)
  );
}

export function computeSignals(input: {
  message: SignalsMessage;
  stage: ConversationStageInfo | null;
  models: CompiledModel[];
  payment: PaymentSettings;
  now?: number;
}): CaseSignals {
  const { message: m, stage: stageInfo, models } = input;
  const stage = stageInfo?.stage ?? null;
  const isFirstContact = !stage || stage === 'first_contact';

  const hotline = isDepothelpSender(m.fromAddress) ? parseDepothelpSubject(m.subject) : null;
  const channel: CaseSignals['channel'] = hotline ? 'hotline' : isLeaderForward(m.fromAddress) ? 'leader_forward' : 'direct';
  const firstName = firstNameOf(m, channel, hotline);
  const subjectContact = channel === 'direct' ? parseDepothelpSubject(m.subject) : null;
  const hotlineEarlierCall =
    !!subjectContact && firstName === subjectContact.customerName.split(/\s+/)[0] && !extractSignatureName(m.bodyText);

  const isWalmartStore = isWalmartStoreSender(m.fromAddress);
  const storeNumber = extractWalmartStoreNumber(m.fromAddress);

  const currentBody = stripQuotedReply(m.bodyText);
  const haystack = [m.subject, m.bodyText, m.summary].filter(Boolean).join('\n');
  const modelKnown = hasModelCodeText(models, haystack);
  const matched = matchModel(models, haystack);
  const subjectBodyText = `${m.subject ?? ''}\n${currentBody}`;

  const isPurchaseFlow = PURCHASE_CATEGORIES.has(m.category) && !WARRANTY_INTENT_RE.test(subjectBodyText);
  const toolkitNotIncluded = TOOLKIT_MISSING_RE.test(subjectBodyText) && matched?.noToolkit === true;
  const toolkitOnlyComplaint = toolkitNotIncluded && m.category === 'missing_parts' && !OTHER_MISSING_PART_RE.test(subjectBodyText);

  const media = m.attachments.filter((a) => a.contentType.startsWith('image/') || a.contentType.startsWith('video/'));
  const hasProvidedMedia = media.length > 0;
  const hasProvidedVideo = media.some((a) => a.contentType.startsWith('video/'));
  const isDamagedShipping = m.category === 'damaged_shipping';
  const isStaticTireDamage = m.partType === 'tire' && (isDamagedShipping || m.category === 'quality_issue');
  const isValveDamageFlow =
    isStaticTireDamage &&
    hasProvidedMedia &&
    (VALVE_DAMAGE_RES.some((re) => re.test(subjectBodyText)) || FLAT_ON_ARRIVAL_RES.some((re) => re.test(subjectBodyText)));
  const needsVideoOnly =
    !isPurchaseFlow && !isValveDamageFlow && (isDamagedShipping || DYNAMIC_ISSUE_VIDEO_RES.some((re) => re.test(subjectBodyText)));

  const stageProvided = stageInfo?.providedLabels ?? [];
  const stageResolvedAll =
    !!stageInfo && stageInfo.customerTurns >= 2 && stageInfo.askedLabels.length > 0 && stageInfo.missingLabels.length === 0;

  const missing = m.missingEvidence
    .filter((item) => {
      if (isWalmartStore || m.category === 'product_question' || isPurchaseFlow) return false;
      if (item === 'photo_or_video' && (hasProvidedVideo || (hasProvidedMedia && !needsVideoOnly))) return false;
      if (m.category === 'registration' && !REGISTRATION_EVIDENCE_ALLOWLIST.has(item)) return false;
      const en =
        item === 'photo_or_video' && needsVideoOnly
          ? isDamagedShipping
            ? 'A video showing the damage'
            : 'A video of the issue'
          : EVIDENCE_ITEM_EN[item];
      return !stageProvided.some((label) => en.toLowerCase().includes(label.toLowerCase()));
    })
    .map((item) => {
      if (item === 'photo_or_video') {
        if (m.category === 'missing_parts') return 'Photos of the box contents (so we can confirm which part is missing)';
        if (needsVideoOnly) {
          return isDamagedShipping ? 'A video showing the damage' : 'A video of the issue (dynamic issue — photos alone are NOT enough)';
        }
      }
      return EVIDENCE_ITEM_EN[item];
    });

  const imageDescriptions = m.attachments
    .filter((a) => (a.contentType.startsWith('image/') || a.contentType === 'application/pdf') && a.aiDescription)
    .map((a) => `- ${a.filename}: ${a.aiDescription}`);

  return {
    category: m.category,
    partType: m.partType,
    language: m.language,
    stage,
    isFirstContact,
    firstName,
    channel,
    hotlineName: hotline?.customerName ?? subjectContact?.customerName ?? null,
    hotlinePhone: hotline?.phone ?? subjectContact?.phone ?? null,
    hotlineEarlierCall,
    delayDays: Math.floor(daysSinceReceived(m.receivedAt?.toISOString() ?? null, input.now)),
    isWalmartStore,
    storeLabel: storeNumber ? `Walmart store ${storeNumber}` : 'the store number is in the sender address or signature',
    storeFrom: storeNumber ? ` from Walmart store ${storeNumber}` : '',
    isSafetyHazard: m.isSafetyHazard,
    isOurProduct: m.isOurProduct,
    modelKnown,
    isPurchaseFlow,
    toolkitNotIncluded,
    toolkitOnlyComplaint,
    providedMediaCount: media.length,
    hasProvidedMedia,
    hasProvidedVideo,
    isDamagedShipping,
    isValveDamageFlow,
    needsVideoOnly,
    stageResolvedAll,
    evidenceStatus: m.evidenceStatus,
    missingCount: missing.length,
    missingItemsWord: missing.length > 1 ? 'items' : 'item',
    missingList: missing.join('; '),
    videoStillMissing: missing.some((item) => item.includes('video of the issue')),
    explicitNoReceipt: EXPLICIT_NO_RECEIPT_RES.some((re) => re.test(currentBody)),
    explicitSecondhand: EXPLICIT_SECONDHAND_RE.test(currentBody),
    explicitNoMultimeter: EXPLICIT_NO_MULTIMETER_RE.test(currentBody),
    hasImageDescriptions: imageDescriptions.length > 0,
    imageDescriptions: imageDescriptions.join('\n'),
    confirmPhotos: MODEL_CONFIRM_PHOTOS[m.partType] ?? MODEL_CONFIRM_PHOTOS.default,
    hasAxleNut: /\b(?:axle|wheel)\s+nut\b/i.test(subjectBodyText),
    matchedModel: matched?.modelCode ?? null,
    paymentSentence: paymentSentence(input.payment),
    actionPrefix: isFirstContact
      ? `Suggested handling (${m.category}, the DEFAULT flow for a FIRST contact only)`
      : `Suggested handling (${m.category}, REFERENCE ONLY — this customer is NOT at first contact; the CONVERSATION STAGE block overrides this default flow)`,
  };
}
