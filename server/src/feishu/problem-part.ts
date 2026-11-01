export interface ProblemPartMessage {
  subject: string | null;
  bodyText: string | null;
  partType: string;
}

const PHRASE_RULES: [RegExp, string][] = [
  [/\bl\/h\b/, 'L/H档同时闪烁'],
  [/how to (?:assemble|install)/, '安装'],
  [/how to (?:use|operate|work|turn on)/, '使用方法'],
  [/front (?:brake|disc)/, '前刹车器（含碟刹盘,线）'],
  [/rear (?:brake|disc)/, '后刹车器（含碟刹盘,线）'],
  [/front (?:wheel|rim|hub|spoke)/, '前轮组（车圈/辐条/花鼓/衬带/内外胎）'],
  [/rear (?:wheel|rim|hub|spoke)/, '后轮组（车圈/辐条/花鼓/衬带/电机/内外胎）'],
  [/inner tube|\btubes?\b|flat tire|went flat/, '内胎（含衬带）'],
  [/front (?:fender|mudguard)/, '前泥板（含支撑和螺丝）'],
  [/rear (?:fender|mudguard)/, '后泥板（含支撑和螺丝）'],
  [/seat ?post quick release|saddle quick release/, '鞍管快拆'],
  [/seat ?posts?\b|seatpost/, '鞍管'],
  [/crank bolts?/, '曲柄螺丝'],
  [/bottom brackets?/, '中轴组件'],
  [/motor (?:wire|cable|connector|plug)/, '电机线'],
  [/tool kit|tool set/, '工具套'],
  [/valve caps?/, '气嘴帽'],
  [/(?:derailleur )?hangers?\b/, '吊耳'],
  [/(?:rear )?derailleurs?/, '后拨链器（含变速线和线管）'],
  [/shifter|shift lever|twist shifter|gear shifter/, '右变速手柄（含变速线和线管）'],
  [/free ?wheel|cassette/, '飞轮'],
  [/kick ?stands?/, '停车架'],
  [/handle ?bars?/, '车把'],
  [/\bstems?\b/, '把立（含螺丝）'],
  [/rear racks?|cargo racks?|\bracks?\b/, '后衣架（含支撑和螺丝）'],
  [/baskets?/, '前车篮（含螺丝）'],
  [/head ?lights?|front lights?/, '前灯（含线）'],
  [/(?:speed|torque|cadence|pas) sensors?|\bsensors?\b/, '传感器'],
];

const WORD_RULES: [RegExp, string][] = [
  [/\bbatter(?:y|ies)\b|lithium/, '锂电池'],
  [/\bkeys?\b/, '钥匙'],
  [/\bcharg(?:er|ing)\b/, '充电器'],
  [/\btires?\b|\btyres?\b|\btread\b/, '外胎（有返工，换包装）'],
  [/\bchains?\b/, '链条'],
  [/\bcranks?\b|chainrings?|crank ?arms?/, '链轮曲柄（含曲柄螺丝）'],
  [/\bpedals?\b/, '脚踏'],
  [/\bforks?\b/, '前叉'],
  [/\bframes?\b|head ?sets?\b/, '车架（中轴/车头碗组好）'],
  [/\bdisplays?\b|\blcd\b|\bscreens?\b/, '仪表'],
  [/\bthrottles?\b/, '油门'],
  [/\bcontrollers?\b/, '控制器'],
  [/\bmotors?\b/, '后轮组（车圈/辐条/花鼓/衬带/电机/内外胎）'],
  [/\bseats?\b|\bsaddles?\b/, '鞍座（带法律标签）'],
  [/\bbells?\b/, '铃铛'],
  [/reflectors?/, '反光器（前/后反+轮反）'],
  [/\binstall(?:ation|ed|ing)?\b/, '安装'],
  [/\bquick releases?\b/, '快拆'],
  [/\bregist(?:er|ration|ered|ering)\b/, '注册'],
  [/\b(?:user |owners? |instruction )?manuals?\b|\binstructions?\b/, '用户手册'],
  [/\bbox(?:es)?\b|\bcartons?\b|packaging/, '纸箱'],
  [/\bscrews?\b|\bbolts?\b|\bnuts?\b|hardware/, '标准件'],
];

const PART_TYPE_FALLBACK: Record<string, string> = {
  battery: '锂电池',
  key: '钥匙',
  charger: '充电器',
  light: '前灯（含线）',
  display: '仪表',
  controller: '控制器',
  tire: '外胎（有返工，换包装）',
};

function matchFromText(text: string): string {
  for (const [pattern, option] of PHRASE_RULES) {
    if (pattern.test(text)) return option;
  }
  for (const [pattern, option] of WORD_RULES) {
    if (pattern.test(text)) return option;
  }
  return '';
}

export function resolveProblemPart(messages: ProblemPartMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const subject = (message.subject ?? '').toLowerCase();
    const errorCode = subject.match(/\b(e-00[1-7])\b/);
    if (errorCode) return errorCode[1];
    const hit = matchFromText(subject) || matchFromText((message.bodyText ?? '').toLowerCase());
    if (hit) return hit;
    const fallback = PART_TYPE_FALLBACK[message.partType];
    if (fallback) return fallback;
  }
  return '';
}
