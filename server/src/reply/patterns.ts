// 信号检测用的正则与称呼提取，均从妙搭 reply-context.ts 原样迁移（词表来源与统计见原注释）
export const REGISTRATION_EVIDENCE_ALLOWLIST = new Set(['purchase_proof']);

export const PURCHASE_CATEGORIES = new Set(['parts_request', 'purchase_inquiry']);

export const WARRANTY_INTENT_RE =
  /\b(?:under warranty|warranty claim|warranty coverage|warranty replacement|covered by (?:the )?warranty|free replacement|still under warranty)\b/i;

// 沃尔玛门店员工来信（B2B 合作伙伴，非终端消费者）：@wal-mart.com 发件地址，本地部分带门店号（如 xxx.s01234.us）。
// 学习库 4 封人工回复均走商务直给口吻：确认门店请求→出厂背书→直接补发/需购买→确认门店收货信息。
export function isWalmartStoreSender(fromAddress: string | null | undefined): boolean {
  return typeof fromAddress === 'string' && /@wal-mart\.com$/i.test(fromAddress.trim());
}

export function extractWalmartStoreNumber(fromAddress: string | null | undefined): string | null {
  if (typeof fromAddress !== 'string') return null;
  const m = /\.s(\d+)\.us@wal-mart\.com$/i.exec(fromAddress.trim());
  if (!m) return null;
  const digits = m[1].replace(/^0+/, '');
  return digits || m[1];
}

// 词表由学习库全量统计生成（2026-09-29，tmp/evidence-stats/：8545 配对中 855 个故障类样本，
// 人工写 photos-or-video 仅 2 封；电池亏电 128/151、错误码 215/233、电机不转 87/92、灯闪 89/102、
// 不充电 145/168、油门 91/107、踏板异响 6/6 均以 video 为主）。后续扩词先查库统计，不手写。
export const DYNAMIC_ISSUE_VIDEO_RES: RegExp[] = [
  // 供电：无法开机 / 断续 / 熄火
  /(?:won'?t|will not|not|cannot|can'?t|fails? to|failed to|stopped|doesn'?t|does not)[^.\n]{0,40}(?:turn on|power on|powering on|start up)/i,
  /not powering on/i,
  /\b(?:cuts?|cutting) out\b/i,
  /\bshuts? (?:off|down)[^.\n]{0,35}(?:while|during|riding|mid)/i,
  /\bdies? (?:while|when|mid)/i,
  /\bintermittent/i,
  // 无法关机
  /not turning off/i,
  /won'?t (?:turn|shut) (?:it )?off/i,
  /will not turn off/i,
  /cannot turn (?:it )?off/i,
  /can'?t turn (?:it )?off/i,
  /stays? on[^.\n]{0,30}(?:after|when)/i,
  // 错误码
  /error code/i,
  /\be-?\d{3}\b/i,
  // 变速 / 传动
  /\bshifting (?:problem|issue|trouble|won'?t|not)/i,
  /\b(?:not|isn'?t|won'?t|cannot|can'?t|doesn'?t|does not|hard to|trouble|problems?|difficulty)[^.\n]{0,30}shifting\b/i,
  /\b(?:not|isn'?t|won'?t|hard to|trouble|problems?|difficulty)[^.\n]{0,30}shift gears\b/i,
  /\b(?:gear|gears|chain|cassette|freewheel)[^.\n]{0,30}(?:slip|slipping|skip|skipping|jump|jumping)/i,
  /won'?t shift/i,
  // 刹车
  /\bbrake(?:s| pads?)?[^.\n]{0,45}(?:rubbing|grinding|squeal|squeak|noise|noises|not working|won'?t|doesn'?t|slipping|failing)/i,
  /can'?t (?:stop|brake)/i,
  // 电机：异响 / 不转
  /\bmotor[^.\n]{0,35}(?:noise|noises|sound|sounds|hum|humming|grinding|clicking|whining|rattling)/i,
  /\bmotor[^.\n]{0,45}(?:doesn'?t|does not|won'?t|will not|not working|no longer|stopped|quit|died)/i,
  /\bmotor[^.\n]{0,45}(?:not|won'?t|cannot|can'?t) (?:work|start|run|respond)/i,
  // 电池亏电 / 掉电 / 不充电
  /\bbattery[^.\n]{0,60}(?:drains?|drained|draining|dies|dead|keeps dying)/i,
  /(?:drains?|drained|draining)[^.\n]{0,40}\bbattery\b/i,
  /(?:won'?t|doesn'?t|does not|not) hold(?:ing)? (?:a |its )?charge/i,
  /los(?:es|ing) (?:its )?charge/i,
  /charge (?:doesn'?t|does not|won'?t) last/i,
  /(?:won'?t|will not|not|doesn'?t|does not) charg(?:e|ing)/i,
  // 油门
  /\bthrottle[^.\n]{0,50}(?:not|doesn'?t|won'?t|stuck|jammed|no response|stopped)/i,
  // 显示 / 灯：闪烁 / 熄灭 / 空白
  /\b(?:display|screen|lcd|panel|headlight|taillight|indicator lights?)[^.\n]{0,45}(?:flicker|flickering|blink|blinking|flash|flashing|blank|goes off|turns off|on and off)/i,
  /\bblinking\b/i,
  /\bflashing\b/i,
  /\b(?:display|screen|lcd)[^.\n]{0,40}(?:blank|black|nothing|no display|not showing|not turning)/i,
  // 踏板 / 泛化异响
  /\bpedals?[^.\n]{0,55}(?:noise|noisy|click|clicking|squeak|squeaking|creak|creaking|making a strange|making noise|sound|grinding)/i,
  /(?:noise|clicking|squeaking|creaking)[^.\n]{0,25}(?:when|every time)[^.\n]{0,20}pedal/i,
  /\b(?:grinding|clicking|clunking|humming|rattling|squeaking|whining)[^.\n]{0,25}(?:noise|sound)/i,
];

export const MODEL_CONFIRM_PHOTOS: Record<string, string> = {
  key: 'a photo of the bike (or the bike model name) and a close-up photo of the keyhole / lock cylinder where the key goes in, so we can match the correct key',
  battery:
    'a photo of the bike (or the bike model name) and a close-up photo of the handlebar area showing the battery button (or the battery label with its model number), so we can confirm the correct battery',
  display:
    'a photo of the bike (or the bike model name) and a close-up photo of the handlebar / display area, so we can confirm the correct display',
  controller:
    'a photo of the bike (or the bike model name) and a close-up photo of the controller (usually under the plastic cover near the bottom bracket), so we can confirm the correct controller',
  charger:
    'a photo of the charger label and the charging port on the bike, so we can confirm the correct charger',
  tire: 'a photo of the tire sidewall showing the size markings (e.g. 20 x 1.95), so we can confirm the correct size',
  wheels:
    'a photo of the bike and the wheel that needs replacing, so we can confirm the correct wheel',
  light:
    'a photo of the bike (or the bike model name) and the light mounting area, so we can confirm the correct light',
  drivetrain:
    'a photo of the bike (or the bike model name) and a close-up photo of the part (shifter / derailleur / crank / pedals), so we can confirm the correct part',
  accessories:
    'a photo of the part you need (and the bike model name if unsure about compatibility), so we can confirm the correct part',
  default:
    'a photo of the part you need (and the bike model name if unsure about compatibility), so we can confirm the correct part',
};
const CLOSING_LINE_RE =
  /^(?:best regards|kind regards|regards|sincerely|respectfully|thank you|thanks|best|cheers)[,!\s]*$/i;

const NON_NAME_WORDS = new Set([
  'please', 'thanks', 'thank', 'best', 'regards', 'have', 'let', 'help',
  'hello', 'hi', 'dear', 'cheers', 'sincerely', 'warmest', 'warm', 'is',
  'it', 'the', 'my', 'do', 'does', 'can', 'could', 'would', 'will', 'when',
  'what', 'where', 'how', 'why', 'yes', 'no', 'not', 'and', 'but', 'you',
  'your', 'me', 'we', 'from', 'sent', 'date', 'subject', 'to', 'sincerely',
  'that', 'this', 'these', 'those', 'them', 'they', 'then', 'than', 'there',
  'here', 'him', 'her', 'his', 'she', 'he', 'was', 'are', 'be', 'been',
  'being', 'am', 'if', 'or', 'for', 'with', 'get', 'got', 'need', 'needs',
  'want', 'wants', 'know', 'knew', 'just', 'still', 'also', 'more', 'most',
  'much', 'many', 'some', 'any', 'all', 'now', 'soon', 'asap', 'again',
  'kindly', 'sorry', 'welcome', 'touch', 'email', 'mail', 'message',
  'follow', 'below', 'above', 'attached', 'attach', 'advance', 'hope',
  'wishing', 'wish', 'ride', 'riding', 'day', 'days', 'week', 'weeks',
  'month', 'months', 'year', 'years', 'time', 'today', 'tomorrow',
  'yesterday', 'morning', 'evening', 'night', 'text', 'call', 'calls',
  'back', 'out', 'up', 'off', 'new', 'old', 'good', 'great',
  'frame', 'medium', 'small', 'large', 'green', 'teal', 'black', 'white',
  'blue', 'red', 'orange', 'yellow', 'grey', 'gray', 'silver', 'gold',
  'bike', 'bicycle', 'trail', 'gravel', 'explorer', 'mountain', 'cargo',
  'commutr', 'urban', 'urbanfold', 'phoenix', 'concord', 'ozark', 'rebel',
  'wheel', 'wheels', 'rim', 'tire', 'tyre', 'tires', 'tube', 'motor',
  'battery', 'display', 'controller', 'charger', 'fork', 'stem', 'seat',
  'saddle', 'seatpost', 'pedal', 'pedals', 'throttle', 'brake', 'brakes',
  'rotor', 'caliper', 'cable', 'cables', 'harness', 'light', 'lights',
  'rack', 'fender', 'fenders', 'grip', 'grips', 'helmet', 'kickstand',
  'basket', 'crank', 'cassette', 'chain', 'derailleur', 'shifter',
  'shifters', 'pas', 'lcd', 'led', 'color', 'owner', 'name', 'model',
  'serial', 'number', 'purchase', 'order', 'address', 'phone', 'warranty',
  'registration', 'receipt',
]);

function isNameLikeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 40 || /[?!]$/.test(trimmed)) return false;
  if (/[@\d]/.test(trimmed)) return false;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length > 3) return false;
  if (!/^[A-Z]/.test(tokens[0])) return false;
  return tokens.every((token: string) => {
    if (token.length > 1 && token === token.toUpperCase()) return false;
    const bare = token.toLowerCase().replace(/[^a-z]/g, '');
    if (!bare || NON_NAME_WORDS.has(bare)) return false;
    return /^[A-Za-zÀ-ÖØ-öø-ÿ''.-]+$/.test(token);
  });
}

export function stripQuotedReply(bodyText: string | null): string {
  if (!bodyText) return '';
  let text = bodyText;
  const cutPatterns: RegExp[] = [
    /^[-_]{8,}/m,
    /^on .+ wrote:\s*$/im,
    /^(?:gönderen|gönderildi|from|de)\s*[:：]/im,
  ];
  for (const pattern of cutPatterns) {
    const match = pattern.exec(text);
    if (match && match.index > 0) text = text.slice(0, match.index);
  }
  return text;
}

export const EXPLICIT_NO_RECEIPT_RES: RegExp[] = [
  /\b(?:do not|don'?t|cannot|can'?t)\s+(?:have|find|locate|get|provide|access|see)\b[^.\n]{0,60}?\breceipt\b/i,
  /\bno\s+receipt\b/i,
  /\blost\s+(?:my|the|a)\s+receipt\b/i,
  /\bwithout\s+(?:a\s+|the\s+)?receipt\b/i,
];
export const EXPLICIT_SECONDHAND_RE =
  /\b(?:purchased|bought|got|acquired)\b[^.\n]{0,40}\b(?:secondhand|second-hand|second hand|it used|a used|the used|from (?:an?\s+)?auction|on facebook marketplace|on craigslist|on offerup|from a friend|from someone)\b/i;
export const EXPLICIT_NO_MULTIMETER_RE =
  /\b(?:do not|don'?t)\s+have\s+(?:a\s+|access to a\s+)?multimeter\b/i;

// 气嘴断裂/瘪胎：静态可见损伤。partType=tire + (damaged_shipping|quality_issue) + 已附图时
// 走免费寄内胎专项流程，不索视频三件套（2026-10-14 案例用户裁决）。
// 分类器对「到货即瘪」会不稳定地判 damaged_shipping 或 quality_issue，两种都要覆盖；
// flat tire 单独出现须带「到货/开箱」语境（防骑行中爆胎误伤），valve 断裂词不受语境限制
export const VALVE_DAMAGE_RES: RegExp[] = [
  /\bvalve(?:\s+stem)?\b[^.!?\n]{0,60}\b(?:broken|broke|snapped|bent|damaged|cracked|leaking|missing|fell off|came off)\b/i,
  /\b(?:broken|snapped|bent|damaged|cracked)\s+valve(?:\s+stem)?\b/i,
];
export const FLAT_ON_ARRIVAL_RES: RegExp[] = [
  /\barriv\w*\s+with\s+(?:a\s+|the\s+)?flat\s+(?:tire|tyre)\b/i,
  /\b(?:tire|tyre)\s+arriv\w*\s+(?:completely\s+)?flat\b/i,
  /\barriv\w*\s+(?:completely\s+)?flat\b/i,
  /\bflat\s+(?:tire|tyre)\b[^.!?\n]{0,80}\b(?:on arrival|upon arrival|out of the box|when\s+(?:i|it|we)\s+(?:opened|unboxed|unpack\w*|assembl\w*))\b/i,
  /\b(?:on|upon)\s+arrival[^.!?\n]{0,40}\bflat\s+(?:tire|tyre)\b/i,
  /\b(?:brand new|just\s+(?:received|got|delivered)|right out of the box)[^.!?\n]{0,60}\bflat\s+(?:tire|tyre)\b/i,
];

// 车型不随车附带工具包：客户报「缺工具包」不算缺件
export const TOOLKIT_MISSING_RE =
  /\b(?:missing|without|no|lacking|lacks)\s+(?:the\s+|any\s+|my\s+|a\s+)?tool\s?kits?\b|\btool\s?kits?\b[^.!?\n]{0,80}\b(?:missing|not\s+included?|didn'?t\s+come|was\s+not|wasn'?t|not\s+in\s+the\s+box)\b/i;
export const OTHER_MISSING_PART_RE =
  /\b(?:chargers?|charging\s+cable|keys?|manuals?|batter(?:y|ies)|pedals?|reflectors?|baskets?|racks?|fenders?|mirrors?|bells?|saddles?|seats?|wheels?|handlebars?|grips?|lights?|displays?|controllers?|throttles?|kickstands?|training\s+wheels?|front\s+forks?|frames?)\b/i;

const EXPLICIT_NAME_RES: RegExp[] = [
  /^\s*owner'?s?\s+name\s*[:#]\s*([\wÀ-ÖØ-öø-ÿ''.-]+(?:\s+[\wÀ-ÖØ-öø-ÿ''.-]+)?)/im,
  /^\s*name\s*[:#]\s*([\wÀ-ÖØ-öø-ÿ''.-]+(?:\s+[\wÀ-ÖØ-öø-ÿ''.-]+)?)\s*$/im,
  /\bmy name is\s+([\wÀ-ÖØ-öø-ÿ''.-]+)/i,
];

function firstWordIfNameLike(value: string): string | null {
  const first = value.trim().split(/\s+/)[0];
  if (!first) return null;
  const bare = first.toLowerCase().replace(/[^a-z]/g, '');
  if (!bare || NON_NAME_WORDS.has(bare)) return null;
  if (first.length > 1 && first === first.toUpperCase()) return null;
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ''.-]+$/.test(first)) return null;
  return first;
}

export function extractSignatureName(bodyText: string | null): string | null {
  const text = stripQuotedReply(bodyText);
  for (const pattern of EXPLICIT_NAME_RES) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      const name = firstWordIfNameLike(match[1]);
      if (name) return name;
    }
  }
  const lines = text
    .split(/\r?\n/)
    .map((line: string) => line.trim())
    .filter(Boolean);
  const tail = lines.slice(-3);
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const line = tail[i];
    if (CLOSING_LINE_RE.test(line)) continue;
    if (isNameLikeLine(line)) return line.split(/\s+/)[0];
  }
  return null;
}

export function daysSinceReceived(receivedAt: string | null, now = Date.now()): number {
  if (!receivedAt) return 0;
  const t = Date.parse(receivedAt);
  if (Number.isNaN(t)) return 0;
  return (now - t) / 86_400_000;
}

export function extractFirstName(fromName: string | null, fromAddress: string | null): string {
  if (fromName && fromName.trim()) {
    const first = fromName.trim().split(/\s+/)[0];
    if (/^\S+$/.test(first) && !/[\d@._-]{4,}/.test(first)) return first;
  }
  if (fromAddress) {
    const local = fromAddress.split('@')[0];
    if (local && /^[\x20-\x7e]+$/.test(local)) {
      return local
        .split(/[._-]+/)
        .filter(Boolean)
        .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
        .slice(0, 2)
        .join(' ');
    }
  }
  return 'there';
}
