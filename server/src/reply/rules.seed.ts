import type { RuleSlot } from '@aftersell/shared';

/**
 * 初始规则集：逐条迁自妙搭 reply-context.ts（buildReplyContext / ACTION_BY_CATEGORY / WALMART_STORE_ACTION /
 * BUSINESS_FACTS / PART_KNOWLEDGE）。文案原样保留，只把收款信息等改为 {占位符}。
 * 启动时只插入库里还没有的 key；设置页改过的文案、优先级、开关不会被覆盖。
 */
export interface RuleSeed {
  key: string;
  description: string;
  slot: RuleSlot;
  priority: number;
  exclusive?: boolean;
  when: unknown;
  text: string;
  source?: string;
}

const v = (name: string) => ({ var: name });
const is = (name: string, value: unknown = true) => ({ '==': [v(name), value] });
const not = (cond: unknown) => ({ '!': cond });
const and = (...conds: unknown[]) => ({ and: conds });
const inList = (name: string, list: string[]) => ({ in: [v(name), list] });

const SRC = '妙搭 reply-context.ts';

const ACTION_BY_CATEGORY: Record<string, string> = {
  warranty:
    'Warranty claim. Ask when the issue started. Do NOT ask for evidence items here — the specific items to request are listed in the Evidence block below. For battery issues verify the charger is the original one. If under warranty, arrange a free replacement part and confirm the shipping info before dispatch. If not covered, offer paid replacement or the refund path.',
  quality_issue:
    'Quality issue. Brief apology. If the photos identify the issue, point out the actual problem first. Offer a free replacement part under warranty and confirm delivery information, or repair cost coverage. Refund only for severe cases.',
  parts_request:
    'Paid parts request. Quote ONLY with reference prices given in this context and note freight is included; if none, say you will confirm the price. For a plain purchase, ask ONLY for the model-confirmation photos and delivery information described in the Evidence block — a paid purchase needs NO shopping receipt, NO serial number and NO defect photos (unless the customer is claiming a free warranty replacement, in which case follow the Evidence block). Do NOT send Zelle payment details in the first reply; share payment info ({paymentSentence}) only after the customer provides those, then ask for the payment screenshot before shipping.',
  refund:
    "Refund request. Explain we cannot issue refunds back to credit-cards on our end. According to Walmart's return policy, returns are available within three months: the customer can submit a return request via the Walmart APP after recording supporting videos, and review full terms inside the application. For partial compensation cases (e.g. repair cost coverage), offer reimbursement via Zelle and state we cover the shipping cost. Do not approve large refund amounts on our own; say the request will be reviewed. After a return is approved, we can send a shipping label for the return.",
  technical_support:
    'Technical support. Give 1-3 short troubleshooting steps (re-plug connectors, align the arrows on connectors, check the controller-to-display connection for E-006 errors). If unresolved, move to the replacement/warranty path.',
  order_inquiry: 'Order/logistics inquiry. Confirm the order number, check and share the tracking status. For missing parts go through the replacement flow.',
  manual_request: 'Manual request. Confirm the bike model and send the matching user manual PDF.',
  registration:
    'Bike registration. Short 1-3 sentence acknowledgment only: "We\'ve received your registration info." A filled registration form photo already contains everything registration needs (owner name, address, purchase date, bike model, battery serial numbers). Do NOT ask for the bike serial number, motor/battery serial numbers, delivery/shipping information, full name, phone number or address. If the Evidence block lists a missing purchase receipt, add: "Could you please provide a copy of your shopping receipt? This helps us process your request smoothly." No troubleshooting, no numbered evidence list, no price talk.',
  product_question:
    'Product or specification question. Answer directly ONLY with facts given in this context or clearly stated in the email thread (known facts: genuine Tektro mineral oil for hydraulic brakes; all our batteries are UL certified). If the requested spec is not available, say: "We don\'t have the detailed specifications available at the moment. We will check with our factory and get back to you." Never invent dimensions, weights or compatibility claims. This is a consultation, NOT a purchase or warranty claim: do NOT ask for the shopping receipt, delivery information, photos or evidence — a spec answer needs none of those. If the customer wants to BUY the part, quote the price and collect the delivery information in the same reply.',
  safety_hazard:
    'Safety hazard. Fixed flow for FIRST contact only: 1) Open with "We are very sorry to hear about the [issue]. This is a serious safety concern." 2) "Please do not attempt to charge or use the bicycle until we have had a chance to review the issue." 3) Ask ONLY for the items listed in the Evidence block below. 4) Close with: "Based on your photos and video, we will escalate this issue for further review." For follow-ups in an ongoing conversation where we already assessed this issue, skip the stop-use warning and the escalation closing line — follow up on the current status and move toward resolution instead.',
  injury_claim:
    'Injury or accident claim. Express sympathy ("We are very sorry to hear about the accident and hope everyone is okay") and state we take this very seriously. Ask how the accident happened and whether medical attention was needed. Do NOT admit fault and do NOT promise any compensation amount. Close with: the case will be escalated for priority review.',
  missing_parts:
    'Missing parts in the box. Brief apology. Confirm exactly which part is missing (ask for a photo of the box contents if the exact missing part is unclear — this is a category-specific ask, not a standard evidence item). Confirm the shipping information, then arrange reshipment (e.g. "We will send you the missing part as soon as possible").',
  damaged_shipping:
    'Arrived damaged in transit. Brief apology. Ask for the damaged-in-transit evidence described in the Evidence policy block (a video of the damage, carton condition, whether the customer assembled the bike) — only for items not already provided. State a free replacement will be arranged once reviewed, and confirm the delivery information.',
  purchase_inquiry:
    'Purchase inquiry (extra battery, accessory or a new bike). Quote ONLY with reference prices given in this context and note freight is included; if none, say you will confirm the price first. For part purchases, ask ONLY for the model-confirmation photos described in the Evidence block — a paid purchase needs NO shopping receipt, NO serial number and NO defect photos. Share Zelle payment details ({paymentSentence}) only after the customer confirms their information; then ask for the payment screenshot and delivery information. For whole-bike purchases, direct the customer to Walmart. For restock or availability questions on whole bikes, state that the bike is still in production and restocking is determined by Walmart — direct the customer to check with Walmart for updates.',
  other:
    'Clarify the request first, then follow the closest category flow. If this appears to be a non-Phoenix/non-Ozark Trail product (the customer describes a brand, wheel size or specs we do not make), politely state that we did not manufacture this product and suggest the customer contact the original seller or correct manufacturer. Do NOT proceed with warranty/replacement/repair/purchase flows for non-our products.',
};

const CATEGORY_LABELS_ZH: Record<string, string> = {
  warranty: '保修',
  quality_issue: '质量问题',
  parts_request: '零件购买',
  refund: '退款',
  technical_support: '故障排查',
  order_inquiry: '订单物流',
  manual_request: '说明书',
  registration: '注册',
  product_question: '产品问询',
  safety_hazard: '安全隐患',
  injury_claim: '受伤索赔',
  missing_parts: '开箱少件',
  damaged_shipping: '运输损坏',
  purchase_inquiry: '购买询价',
  other: '其他',
};

const E_BIKE_ELECTRICAL_FACTS =
  'Known product behavior for pedal assist / throttle complaints: the pedal assist only works when the assist level is set higher than 1; the throttle only works when the bike speed is above 6 and the assist level is higher than 1. For such complaints, give these checks first and ask for a video showing the abnormal function (put the bike on its kickstand so the rear wheel lifts off the ground, then turn the pedals manually — this requires two people). Replacing the controller or display does NOT change this programmed behavior; do not offer controller/display replacement for these symptoms.';

export const RULE_SEED: RuleSeed[] = ([
  // ---------- 客户与渠道 ----------
  { key: 'channel.first_name', description: '客户称呼', slot: 'channel', priority: 100, when: null, text: 'Customer first name: {firstName}' },
  {
    key: 'channel.hotline',
    description: '热线工单转来的客诉',
    slot: 'channel',
    priority: 90,
    when: is('channel', 'hotline'),
    text: 'Channel: this complaint was recorded by our 800 hotline team and relayed via depothelp. Customer full name: {hotlineName}; customer phone: {hotlinePhone}. Address the customer by their real first name. You may reference the phone call (e.g. "Thanks for your call."). Replies to this relay address are forwarded back to the customer.',
  },
  {
    key: 'channel.leader_forward',
    description: '领导转发的客户邮件',
    slot: 'channel',
    priority: 90,
    when: is('channel', 'leader_forward'),
    text: "Channel: the customer emailed our company leadership directly and the email was forwarded to this support mailbox. The text below the forwarding header (From/Date/To lines) is the customer's original message. Reply to the customer directly and never mention the internal forwarding.",
  },
  {
    key: 'channel.hotline_earlier_call',
    description: '客户之前打过热线',
    slot: 'channel',
    priority: 80,
    when: is('hotlineEarlierCall'),
    text: 'This customer contacted us earlier via the 800 hotline (ticket name: {hotlineName}, phone: {hotlinePhone}). You may acknowledge the earlier call (e.g. "Thanks for reaching out after your call with our support line.").',
  },
  {
    key: 'channel.delayed_reply',
    description: '来信超过 3 天才回复：开头致歉',
    slot: 'channel',
    priority: 70,
    when: and(is('channel', 'direct'), { '>=': [v('delayDays'), 3] }),
    text: 'This reply is delayed (the customer\'s email was received {delayDays} days ago). Open the reply with "We apologize for the delayed reply." right after the greeting line.',
    source: '用户裁决 2026-10-28：统一用 "We apologize for the delayed reply."',
  },
  {
    key: 'channel.walmart_store',
    description: '沃尔玛门店员工来信（B2B）',
    slot: 'channel',
    priority: 60,
    when: is('isWalmartStore'),
    text: 'Channel: this email is from a WALMART STORE employee (our retail partner, B2B — e.g. a store associate or AP team lead), NOT an end consumer. The bikes in question are store floor/display/stock bikes ({storeLabel}). Tone: direct, professional, brief business communication between partners — do NOT use consumer-style empathy or apology-first wording ("We\'re sorry to hear..." / "We understand your frustration"). Open by confirming the store\'s request, e.g. "Thank you for contacting PhoenixUS Support. We have received your request{storeFrom} for [the requested part(s)]." Address the store employee by the name in their signature.',
  },

  // ---------- 语言 ----------
  {
    key: 'language.zh',
    description: '中文客户：正文中文、落款英文',
    slot: 'language',
    priority: 50,
    when: is('language', 'zh'),
    text: 'Customer language: Chinese. Reply in Chinese. Write the whole reply in Chinese (do NOT mix English sentences in the body). Keep the fixed English closing: "Thank you!" / "Best regards," / "PhoenixUS-support team". For asking multiple items use "为了协助您，请提供以下信息：" followed by a numbered list (1. 2. 3.).',
    source: '用户裁决 2026-10-28：中文客户正文中文、落款英文',
  },

  // ---------- 安全 ----------
  {
    key: 'safety.follow_up',
    description: '安全隐患（非首联）：不重复停用警告',
    slot: 'safety',
    priority: 90,
    exclusive: true,
    when: and(is('isSafetyHazard'), not(v('isFirstContact'))),
    text: 'Safety hazard flagged, but this customer is NOT at first contact. Check the CONVERSATION STAGE block: if our earlier replies already assessed this safety issue, do NOT repeat the stop-use warning or the escalation closing line — directly follow up on the current status (e.g. "Has your bicycle had any issues during recent use?") and move the case toward resolution. Only open with a fresh stop-riding/stop-charging warning if this is a brand-new safety issue never discussed before.',
  },
  {
    key: 'safety.first_contact',
    description: '安全隐患（首联）：开头停骑 / 停充警告；刹车类除外',
    slot: 'safety',
    priority: 80,
    exclusive: true,
    when: and(
      is('isSafetyHazard'),
      v('isFirstContact'),
      { or: [{ '!=': [v('partType'), 'brakes'] }, inList('category', ['safety_hazard', 'injury_claim'])] },
    ),
    text: 'Safety hazard flagged: open with a serious safety note (stop riding / stop charging and unplug immediately) before anything else.',
    source: '用户裁决 2026-10-28：停用警告适用于所有安全隐患；风格条目“刹车失灵保修不加停骑警告”优先，刹车类仅在安全隐患 / 受伤类别时警告',
  },

  // ---------- 索证口径（互斥，按优先级取第一条） ----------
  {
    key: 'evidence_policy.walmart_store',
    description: '门店来信：不索消费者凭证',
    slot: 'evidence_policy',
    priority: 100,
    exclusive: true,
    when: is('isWalmartStore'),
    text: "Evidence policy (WALMART STORE request — OVERRIDES the default consumer flow): the store is our retail partner, NOT the purchaser. Do NOT ask for a shopping receipt, order number, serial number, or \"photos of the box contents\" — those are consumer-flow items. If the bike model or part compatibility is unclear, ask for photos of the bicycle (and the relevant part area, e.g. the crank arm for pedals, the handlebars for keys/display) — this shows the actual floor/display bike. If the part appears to have been stolen in-store (batteries, chargers, keys are commonly stolen), say so plainly and tell the store these parts must be purchased. Otherwise confirm we will send the replacement. Close by confirming the store's shipping details (contact name, phone number and the store address in the signature).",
  },
  {
    key: 'evidence_policy.product_question',
    description: '规格咨询：不索任何凭证',
    slot: 'evidence_policy',
    priority: 95,
    exclusive: true,
    when: is('category', 'product_question'),
    text: 'Evidence policy: this is a specification/consultation question — a spec answer needs NO evidence. Do NOT ask for the shopping receipt, delivery information, photos, serial number or any evidence items. Only if the customer explicitly asks to purchase a part: quote the price and collect the delivery information in the same reply.',
  },
  {
    key: 'evidence_policy.purchase_battery_model_known',
    description: '购买电池（型号已知）：仍要自行车 + 电池照片',
    slot: 'evidence_policy',
    priority: 90,
    exclusive: true,
    when: and(v('isPurchaseFlow'), is('partType', 'battery'), v('modelKnown')),
    text: 'Evidence policy: the customer is PURCHASING a battery (paid, NOT a warranty claim) and a bike model code already appears in the email/thread. Confirm photos of BOTH the bicycle AND the battery using CASE EVIDENCE below; ask only for missing photos, or human inspection of existing unverified photos. A model code alone never replaces photos: customers sometimes copy the wrong model code, and older bikes may have a different battery connector. A purchase needs NO shopping receipt, NO serial number and NO defect photos. Quote the price directly if a reference price is given in this context (otherwise say you will confirm the price first), and collect ONLY missing delivery fields required for shipment; clarify conflicting fields without repeating the full profile. Then share Zelle payment details ({paymentSentence}) and ask for the payment screenshot.',
    source: '妙搭 2026-10-09 用户裁决：电池即使型号码命中也必索自行车 + 电池照片',
  },
  {
    key: 'evidence_policy.purchase_model_known',
    description: '购买零件（型号已知）：只要收件信息',
    slot: 'evidence_policy',
    priority: 89,
    exclusive: true,
    when: and(v('isPurchaseFlow'), v('modelKnown')),
    text: 'Evidence policy: the customer is PURCHASING a part (paid, NOT a warranty claim) and the bike model is ALREADY identified from the email/thread — do NOT ask for model-confirmation photos or the bike model again. A purchase needs NO shopping receipt, NO serial number and NO defect photos. Ask ONLY for the delivery information (full name, phone number, full address). Quote the price directly if a reference price is given in this context (otherwise say you will confirm the price first), then share Zelle payment details ({paymentSentence}) and ask for the payment screenshot.',
  },
  {
    key: 'evidence_policy.purchase',
    description: '购买零件（型号未知）：先要型号确认照片',
    slot: 'evidence_policy',
    priority: 88,
    exclusive: true,
    when: v('isPurchaseFlow'),
    text: 'Evidence policy: the customer is PURCHASING a part (paid, NOT a warranty claim). A purchase needs NO shopping receipt, NO serial number and NO photos/videos of a defect — do NOT ask for any of those, even if a standard evidence checklist elsewhere mentions them. If the bike model or part compatibility is not yet confirmed, ask for model-confirmation photos: {confirmPhotos}. If the model is already confirmed (or the part is not model-specific), skip the photos. Once the model is confirmed (or the photos arrive), quote the price and collect ONLY missing delivery fields required for shipment; clarify conflicting fields without repeating the full profile in the same reply. For whole-bike purchases, skip the photos and direct the customer to Walmart.',
  },
  {
    key: 'evidence_policy.valve_damage',
    description: '气嘴断裂 / 到货瘪胎且已附图：免费寄内胎',
    slot: 'evidence_policy',
    priority: 80,
    exclusive: true,
    when: v('isValveDamageFlow'),
    text: 'Evidence policy: the customer reported a flat tire / broken valve stem and ALREADY attached photo(s) of the wheel — this is a static, clearly visible defect and the photos are sufficient. Do NOT ask for a video, carton photos or assembly questions. This policy OVERRIDES the default first-contact flow and the damaged-in-transit flow. Acknowledge the broken valve stem (most likely broken by impact), tell the customer we will send them a FREE replacement inner tube, and ask ONLY for the delivery information (recipient full name, phone number and shipping address). If the customer mentioned they would prefer not to return the bike, confirm no return is needed — the inner tube solves it. If the customer prefers buying one locally, tell them the tire size is printed on the tire sidewall and any matching inner tube works.',
    source: '妙搭 2026-10-14 案例用户裁决',
  },
  {
    key: 'evidence_policy.toolkit_only',
    description: '只报缺工具包且车型不带工具包：无需凭证',
    slot: 'evidence_policy',
    priority: 75,
    exclusive: true,
    when: v('toolkitOnlyComplaint'),
    text: "Evidence policy: the customer's ONLY reported issue is the missing TOOL KIT, and this bike model does NOT come with one by design (pre-assembled at the factory, no tools required for assembly). NO evidence is needed and NO reshipment applies — do NOT ask for photos of the box contents, the receipt, the bike model/serial number or ANY other evidence, and do NOT run the default missing-parts flow. This policy overrides it. Write a short plain reply that directly informs the customer this model does not include a tool kit.",
  },
  {
    key: 'evidence_policy.stage_resolved_all',
    description: '多轮跟进且历史索证已齐：不再重开清单',
    slot: 'evidence_policy',
    priority: 70,
    exclusive: true,
    when: v('stageResolvedAll'),
    text: "Evidence policy: the deterministic stage engine computed from this customer's FULL correspondence history that no previously requested evidence is still outstanding, and the current email is a follow-up in an ongoing case. Do NOT re-open the first-contact evidence checklist and do NOT re-ask for photos, videos, the shopping receipt, the bike model/serial number or the delivery address. Move straight to the case's next step: confirm the status of the promised action and answer the customer's latest question. ONLY if the current email reports a genuinely NEW problem or symptom that the history has never covered (and which needs its own evidence, e.g. a video) may you request that one specific item.",
    source: '妙搭 2026-10-10 案例：客户已寄回电池仍被重索凭证',
  },
  {
    key: 'evidence_policy.complete',
    description: '凭证齐全',
    slot: 'evidence_policy',
    priority: 60,
    exclusive: true,
    when: { '==': [v('missingCount'), 0] },
    text: 'Evidence: complete. Do NOT ask for photos/order/serial again; move straight to resolution or next step.',
  },
  {
    key: 'evidence_policy.missing',
    description: '列出仍缺的凭证，只要这些',
    slot: 'evidence_policy',
    priority: 50,
    exclusive: true,
    when: { '>': [v('missingCount'), 0] },
    text: 'Evidence status: {evidenceStatus}. Still missing ({missingCount} {missingItemsWord} — ask ONLY for these, do NOT add any other evidence items): {missingList}.\nEvidence gate: only ask the customer for items listed above that are explicitly still missing. Items the customer already provided (via this email, earlier replies, or attachments) are satisfied — mention them briefly with acknowledgment ("Thank you for the photos"), then move on. For a single missing item, ask directly in one sentence: "Could you please provide ...?". For multiple items, use a numbered list: "To assist you, could you please provide the following?" followed by "1. ... 2. ...". Never recite a full checklist when only some items are missing.',
  },

  // ---------- 证据与客户声明 ----------
  {
    key: 'evidence_note.media_with_video',
    description: '客户已发视频：确认收到，不再索要',
    slot: 'evidence_note',
    priority: 90,
    when: v('hasProvidedVideo'),
    text: 'Customer has ALREADY provided {providedMediaCount} photo/video attachment(s) including a video. Briefly acknowledge them (e.g. "Thank you for the photos and video.") and do NOT ask the customer to send photos or a video again.',
  },
  {
    key: 'evidence_note.photos_need_video',
    description: '动态故障只发了照片：要短视频',
    slot: 'evidence_note',
    priority: 90,
    when: and(v('hasProvidedMedia'), not(v('hasProvidedVideo')), v('needsVideoOnly')),
    text: 'Customer has provided {providedMediaCount} photo attachment(s) but NO video. Acknowledge the photos briefly, then ask for a short VIDEO: this is a dynamic/moving issue and photos alone cannot show it. Do NOT accept photos as a substitute for the video.',
  },
  {
    key: 'evidence_note.media_provided',
    description: '客户已发照片：确认收到，不再索要',
    slot: 'evidence_note',
    priority: 90,
    when: and(v('hasProvidedMedia'), not(v('hasProvidedVideo')), not(v('needsVideoOnly'))),
    text: 'Customer has ALREADY provided {providedMediaCount} photo/video attachment(s). Briefly acknowledge them (e.g. "Thank you for the photos.") and do NOT ask the customer to send photos or a video again.',
  },
  {
    key: 'evidence_note.no_receipt',
    description: '客户明说没有收据',
    slot: 'evidence_note',
    priority: 80,
    when: v('explicitNoReceipt'),
    text: 'The customer explicitly stated they do NOT have the shopping receipt. Do NOT ask for a shopping receipt again. If proof of purchase is truly required, ask for a Walmart order screenshot or a bank statement as an alternative; otherwise proceed without it (e.g. quote the part price and collect only the delivery information).',
  },
  {
    key: 'evidence_note.secondhand',
    description: '客户明说是二手车',
    slot: 'evidence_note',
    priority: 80,
    when: v('explicitSecondhand'),
    text: 'The customer explicitly stated the bike was purchased secondhand/used/from a reseller. Do NOT ask for the original shopping receipt — it is usually unavailable in this case. Proceed with the paid-parts flow and collect only what is actually needed (e.g. the delivery information).',
  },
  {
    key: 'evidence_note.no_multimeter',
    description: '客户明说没有万用表',
    slot: 'evidence_note',
    priority: 80,
    when: v('explicitNoMultimeter'),
    text: 'The customer explicitly stated they do NOT have a multimeter. Do NOT ask them to measure anything with a multimeter — move to an alternative next step (cross-test with another same-model bike, or arrange our US inspection center for battery cases).',
  },
  {
    key: 'evidence_note.toolkit_not_included',
    description: '车型不带工具包，不算缺件',
    slot: 'evidence_note',
    priority: 70,
    when: v('toolkitNotIncluded'),
    text: "The customer's bike model does NOT come with a tool kit (it is pre-assembled at the factory and no tools are required for assembly). The tool kit is NOT a missing part: do NOT apologize for it being missing, do NOT offer to reship or replace one, and do NOT ask for any evidence about it — state this fact directly to the customer. If the customer also reports OTHER genuinely missing parts, handle those per the standard flow.",
  },
  {
    key: 'evidence_note.image_descriptions',
    description: '附件识别结果',
    slot: 'evidence_note',
    priority: 60,
    when: v('hasImageDescriptions'),
    text: 'AI-recognized content of the customer\'s images/PDFs. These are extracted observations, not independently verified facts — do NOT ask the customer for information already visible in the photos:\n{imageDescriptions}\nNote: image descriptions are AI-generated and may contain recognition errors (e.g. a broken part labeled as a screw, or a visible defect described as "no damage"). If the customer\'s message explicitly describes a specific problem (e.g. "the valve is broken"), trust the customer\'s statement over a "no damage observed" image description — an image not showing damage does not mean there is none.',
  },
  {
    key: 'evidence_note.not_our_product',
    description: '非我方产品：礼貌说明，不走任何售后流程',
    slot: 'evidence_note',
    priority: 100,
    when: not(v('isOurProduct')),
    text: '⚠️ NON-OUR-PRODUCT: The classification indicates this is NOT a Phoenix/Ozark Trail/Concord product. Write a short, polite reply stating: we do not manufacture this product / this model is not produced by us. Do NOT proceed with any warranty, repair, replacement, or parts-purchase flow. Do NOT ask for photos, receipts, or other evidence. Do NOT quote prices or offer Zelle payment. The customer may have purchased from another brand — suggest they contact the manufacturer or Walmart for the correct after-sales support.',
  },
  {
    key: 'evidence_note.damaged_shipping',
    description: '运输损坏的索证口径',
    slot: 'evidence_note',
    priority: 50,
    when: and(v('isDamagedShipping'), not(v('isValveDamageFlow'))),
    text: 'Damaged-in-transit evidence policy (based on our historical replies): ask for 1) a short video showing the damage, 2) whether the outer carton was damaged — if yes, photos of all four sides of the box, and 3) whether the customer assembled the bicycle themselves. Use the wording "a video showing the damage" and do NOT write "photos or a video". Skip any item already answered in the thread or visible in provided photos.',
  },
  {
    key: 'evidence_note.video_only',
    description: '动态故障只要视频',
    slot: 'evidence_note',
    priority: 50,
    when: and(v('videoStillMissing'), not(v('isDamagedShipping')), v('needsVideoOnly')),
    text: 'Video-only rule: this is a dynamic/moving issue (e.g. shifting, brake noise, motor sound, display flickering, error codes, battery drain, not powering on, intermittent cutouts). Ask specifically for a short video showing the problem — use the wording "a short video" and do NOT write "photos or a video": photos cannot show moving behavior, so photos alone are NOT acceptable evidence for this issue.',
  },
  {
    key: 'evidence_note.no_combined_wording',
    description: '不写 “photos or a video”',
    slot: 'evidence_note',
    priority: 50,
    when: and(v('videoStillMissing'), not(v('isDamagedShipping')), not(v('needsVideoOnly'))),
    text: 'Wording rule: our historical replies NEVER use the phrase "photos or a video". When the Evidence block lists a video, ask for "a short video of the issue"; when it lists photos of something specific, ask for exactly that. Do not merge photos and video into one combined checklist item.',
  },

  // ---------- 处理流程 ----------
  {
    key: 'action.walmart_store',
    description: '门店请求的处理流程',
    slot: 'action',
    priority: 90,
    when: v('isWalmartStore'),
    text: "{actionPrefix}: Walmart store request (B2B partner — this OVERRIDES the consumer flow): acknowledge the store's request directly and handle it as a partner reshipment/purchase — no consumer-style apology-first tone. If the part is a normal factory omission that qualifies for free reshipment, state it plainly (\"We can send you a new ...\" / \"The parts will be shipped out ...\") and confirm the store's shipping details (contact name, phone, store address from the signature). If the part was likely stolen in-store (batteries, chargers and keys are commonly stolen — e.g. zip-tied items cut off), say so plainly: state the part must be purchased from us, quote the price if given in this context, and use Zelle for payment. You may remind the store that every bicycle is test-ridden and its parts are secured before leaving the factory. Ask only for what a store can provide — never a shopping receipt.",
  },
  ...Object.entries(ACTION_BY_CATEGORY).map(
    ([category, text]): RuleSeed => ({
      key: `action.${category}`,
      description: `${CATEGORY_LABELS_ZH[category]}的默认流程`,
      slot: 'action',
      priority: 80,
      when: and(is('category', category), not(v('isWalmartStore'))),
      text: `{actionPrefix}: ${text}`,
    }),
  ),
  {
    key: 'action.two_step',
    description: '首联两步走：先判断会话阶段',
    slot: 'action',
    priority: 40,
    when: v('isFirstContact'),
    text: 'Two-step rule: FIRST judge the current conversation stage from the customer history or the quoted earlier emails inside the customer\'s message (gathering info / quote already given / part already shipped / action already promised / troubleshooting in progress / awaiting confirmation). If we already promised or performed an action (e.g. "We will create the shipping label" / "We will send you the new part"), do NOT re-run this default flow and do NOT gate that action on new information requests — write a short reply that confirms the action status and directly answers the customer\'s latest question. When confirming a promised action that has not been dispatched yet, use commitment wording ("We will send you the prepaid shipping label shortly") — NEVER claim an action is already completed or an item is already attached unless the context explicitly says so.',
  },
  {
    key: 'action.stage_reference',
    description: '非首联：按会话阶段处理',
    slot: 'action',
    priority: 40,
    when: not(v('isFirstContact')),
    text: "The conversation stage was computed deterministically from this customer's full history and is stated in the CONVERSATION STAGE block. Follow the stage handling rules there: do NOT re-run the first-contact flow, do NOT re-ask for anything already provided, and reuse our previous quotes/promises as stated.",
  },

  // ---------- 业务事实 ----------
  {
    key: 'business_fact.no_service_centers',
    description: '没有本地维修点',
    slot: 'business_fact',
    priority: 50,
    when: null,
    text: 'Business fact: We have NO local service centers or authorized repair shops. Never tell the customer you are looking for one or will find a nearby shop. If the customer asks where to take the bike for repair, offer to cover the repair cost at a local bike shop of their choice instead.',
  },
  {
    key: 'business_fact.reimbursement_via_zelle',
    description: '我们付款给客户只走 Zelle',
    slot: 'business_fact',
    priority: 50,
    when: null,
    text: 'Business fact: When we owe the customer money (repair cost reimbursement), payment is via Zelle only. Ask: "Please provide your Zelle QR code and account information."',
  },
  {
    key: 'business_fact.valid_proof',
    description: '有效购买凭证的口径',
    slot: 'business_fact',
    priority: 50,
    when: null,
    text: 'Business fact: Valid proof of purchase = a paper receipt or a screenshot of the order record from the Walmart website/app. A Walmart order number or item number alone is NOT valid proof — ask specifically for the paper receipt or the Walmart order screenshot.',
  },

  // ---------- 部件知识 ----------
  {
    key: 'part.ebike_electrical',
    description: '助力 / 油门的程序行为',
    slot: 'part_knowledge',
    priority: 60,
    when: inList('partType', ['controller', 'motor', 'display']),
    text: E_BIKE_ELECTRICAL_FACTS,
  },
  {
    key: 'part.power_up_diagnostics',
    description: '不开机：已查接线则推进到测电压 / 交叉测试',
    slot: 'part_knowledge',
    priority: 50,
    when: is('partType', 'controller'),
    text: 'Not-powering-on cases: if the customer already checked/re-plugged the connectors and cables, do NOT repeat those generic steps — move to the next diagnostic step: ask whether they have a multimeter (to measure the battery output voltage) or have access to another bike of the same model to cross-test the battery and controller.',
  },
  {
    key: 'part.battery',
    description: '电池诊断与美国检测中心',
    slot: 'part_knowledge',
    priority: 50,
    when: is('partType', 'battery'),
    text: 'Battery diagnostics: ask if the customer has a multimeter. For battery defects that cannot be resolved remotely, offer our US inspection center: the customer ships the battery to us, we generate the shipping label and cover the freight cost.',
  },
  {
    key: 'part.brakes',
    description: '碟片变形：报销本地校正，不发停骑警告',
    slot: 'part_knowledge',
    priority: 50,
    when: is('partType', 'brakes'),
    text: 'Warped or bent brake rotor: offer to cover the truing/repair cost at a local bike shop near the customer (payment via Zelle only). Reassure the customer the braking performance is not affected — do NOT issue a stop-riding warning for a warped rotor.',
  },
  {
    key: 'part.light',
    description: '车灯：建议自购车把灯',
    slot: 'part_knowledge',
    priority: 50,
    when: is('partType', 'light'),
    text: 'For bike light replacement requests, suggest the customer buy a separate handlebar-mounted headlight instead — it is inexpensive and widely available. Only fall back to OEM light pricing if the customer insists on the original part.',
  },
  {
    key: 'part.tire',
    description: '气嘴断裂换内胎',
    slot: 'part_knowledge',
    priority: 50,
    when: is('partType', 'tire'),
    text: 'Tire/tube knowledge: a broken valve stem (snapped/bent/leaking valve) is a static defect most likely caused by impact; the fix is replacing the inner tube. For damaged-on-arrival cases a free replacement inner tube is offered once the delivery information is provided. If the customer prefers buying one locally, tell them the tire size is printed on the tire sidewall and any matching inner tube works.',
  },
  {
    key: 'part.axle_nut',
    description: '轴螺母：建议五金店自配',
    slot: 'part_knowledge',
    priority: 40,
    when: v('hasAxleNut'),
    text: 'Axle-nut policy: a lost or damaged axle nut is a standard-size hardware item, not an OEM part we stock and ship. Suggest the customer remove the nut from the other side of the same wheel and take it to a local hardware store to buy a matching one (fast and inexpensive). Do NOT enter the paid-part purchase flow for the axle nut — no price quote, no delivery information, no Zelle — unless the customer explicitly insists on an OEM replacement from us. If the customer also requests other parts in the same email, run the normal purchase flow for those parts only.',
    source: '妙搭 2026-10-10 案例',
  },

  // ---------- 落款 ----------
  {
    key: 'closing.signature',
    description: '固定三行落款',
    slot: 'closing',
    priority: 50,
    when: null,
    text: 'Signature (fixed three lines): "Thank you!" / "Best regards," / "PhoenixUS-support team". Never invent prices, phone numbers, tracking numbers or case numbers.',
    source: '用户裁决 2026-10-28：三行落款',
  },
] satisfies RuleSeed[]).map((r) => ({ ...r, source: r.source ?? SRC }));
