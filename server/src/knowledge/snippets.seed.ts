import type { Category, PartType, SnippetKind } from '@aftersell/shared';

export interface SnippetSeed {
  seedKey: string;
  kind: SnippetKind;
  label: string;
  text: string;
  category: Category | null;
  partType: PartType | null;
  sortOrder: number;
}

/** 迁自妙搭 ReviewPage/sop-data.ts；启动时只补库里没有的 seedKey，设置页的修改不会被覆盖 */
const SOPS: { category: Category; label: string; steps: string[] }[] = [
  {
    category: 'warranty',
    label: '保修流程',
    steps: [
      '问清故障发生时间与使用情况',
      '索要自行车与故障零件的照片/视频 + 购买凭证（订单号/购买截图）',
      '核对充电器是否原装（电池类问题）',
      '保修内补发零件：先索要收件人姓名/电话/地址再发货',
      '不符合保修的走退款或付费补发（信息收齐前不发 Zelle 收款信息）',
    ],
  },
  {
    category: 'quality_issue',
    label: '质量问题流程',
    steps: [
      '索要自行车与故障零件的照片/视频 + 订单号',
      '照片能定位问题时先指出实际问题，再给方案',
      '判断保修内/外',
      '保修内补发零件（要收件人姓名/电话/地址）',
      '严重质量问题可走退款',
    ],
  },
  {
    category: 'parts_request',
    label: '付费配件流程',
    steps: [
      '按零件类型索要型号确认照片（钥匙→车辆+钥匙孔、电池→自行车+电池、显示器→车把）；电池即使工单含型号码也必索照片（防抄错型号/接口不匹配）；不需要收据/序列号/故障照片',
      '按价格表报价并注明含运费（表里没有的先核实）',
      '首封回复不发 Zelle 收款信息；型号照片与收件信息收齐后再发 {zelleEmail}（户名 {zelleName}，电话 {zellePhone}）',
      '索要付款截图核实后发货',
    ],
  },
  {
    category: 'refund',
    label: '退货退款流程',
    steps: ['核对订单与退货原因', '发送退货协议文件由客户签署', '退款/付款到账', '客户打包拍照（电池可放车箱内同寄、车子折叠）', '安排快递上门取件'],
  },
  {
    category: 'technical_support',
    label: '故障排查流程',
    steps: [
      '按故障现象给 1-3 步排查指引（重插接口、连接器箭头对齐）',
      'E-006 类通信故障检查控制器与显示屏连接',
      '无法解决的转补发/保修流程（要自行车与故障零件照片 + 收件信息）',
    ],
  },
  {
    category: 'order_inquiry',
    label: '订单物流流程',
    steps: ['核对订单号', '查询物流状态', '缺件/丢件走补发流程（要缺件与自行车照片 + 收件人信息）'],
  },
  { category: 'manual_request', label: '说明书索取流程', steps: ['确认车型', '发送对应说明书 PDF'] },
  {
    category: 'registration',
    label: '车辆注册流程',
    steps: ['一两句话确认收到注册信息（"We\'ve received your registration info."）', '未附购物凭证时索要 receipt 截图', '无需排查/索证/报价，保持简短'],
  },
  {
    category: 'product_question',
    label: '产品问询流程',
    steps: ['已知事实直接答（刹车用 Tektro 原装矿物油、电池均 UL 认证）', '没有把握的参数说明与工厂核实后回复', '禁止编造尺寸/重量/兼容性参数'],
  },
  {
    category: 'safety_hazard',
    label: '安全隐患流程（紧急）',
    steps: ['开场致歉并强调严重安全隐患', '要求立即停止使用与充电', '索证（编号列表）：Walmart 收据 + 受影响部位照片 + 视频', '表明将升级审核（escalate for further review）'],
  },
  {
    category: 'injury_claim',
    label: '受伤索赔流程（紧急）',
    steps: ['表达同情与重视，询问伤势', '收集事故经过、现场照片、就医情况', '不承认责任、不承诺赔偿金额', '升级主管优先审核'],
  },
  {
    category: 'missing_parts',
    label: '开箱少件流程',
    steps: ['确认所缺零件（不清楚则要箱内物品与自行车照片）', '索要/核对收件人姓名、电话、地址', '安排补发并告知客户'],
  },
  {
    category: 'damaged_shipping',
    label: '运输损坏流程',
    steps: ['致歉', '索证（编号列表）：损坏部位照片 + 包装照片 + 购买凭证', '审核后优先免费补件（补件前核对收件人信息）'],
  },
  {
    category: 'purchase_inquiry',
    label: '购买询价流程',
    steps: [
      '配件购买：索要型号确认照片（同付费配件流程，电池即使工单含型号码也必索自行车+电池照片），不需要收据/序列号；整车购买直接引导 Walmart',
      '按价格表报价并注明含运费（表里没有的先核实）',
      '客户信息确认后再 Zelle 收款 + 付款截图核实 + 索要收件信息',
      '整车购买引导至 Walmart',
    ],
  },
  { category: 'other', label: '其他流程', steps: ['判断诉求类型后转对应流程'] },
];

const QUICK: { key: string; label: string; text: string }[] = [
  {
    key: 'purchase_proof',
    label: '索取购买凭证',
    text: 'Could you please share your order number or a screenshot of your purchase (Walmart order works)? This helps us locate your order quickly.',
  },
  { key: 'photo_video', label: '索取照片视频', text: 'Could you please send a photo or a short video of the issue? It will help us confirm the problem right away.' },
  {
    key: 'brake_video',
    label: '刹车视频索要',
    text: 'Could you flip the bike over so the handlebars and seat rest on the ground with the wheels facing up? Then spin the front wheel by hand, clearly record how the brake rotor contacts the brake caliper, and send us a video.',
  },
  {
    key: 'e001',
    label: 'E-001排查',
    text: 'First, film whether the outer sheath of the motor cable coming from the rear wheel hub is worn by the rear brake rotor (on the left rear side of the bike).\n\nSecond, set the pedal assist to level 2, deploy the kickstand and lean the bike on it so the rear wheel lifts off the ground. Turn the pedals by foot and check if there is resistance on the rear wheel. Then spin the rear wheel forward by hand to see if the assist activates. You may need someone to help record this.',
  },
  {
    key: 'throttle',
    label: '油门使用方法',
    text: 'A green light on the charger and a blue light on the battery indicator mean the battery is fully charged. The bike display will not turn on normally while the battery is connected to the charger. Please unplug the charger, reinstall the battery, press the battery button, and then press the power button on the handlebar. The throttle only works when the bike speed is above 6 km/h and the assist level is higher than level one.',
  },
  { key: 'serial', label: '索取序列号', text: 'Could you please share the serial number of your bike? It is usually found on the frame or the battery.' },
  { key: 'shipping_info', label: '索取收件信息', text: 'Could you please confirm your full name, phone number and shipping address so we can arrange the shipment?' },
  { key: 'confirm_shipping', label: '确认收货信息', text: 'Please confirm whether the shipping information below is correct.' },
  {
    key: 'zelle',
    label: 'Zelle 报价收款',
    text: 'We only have a Zelle account. You can pay via Zelle {zelleEmail} (name: {zelleName}, phone number: {zellePhone}). Please provide a screenshot of the payment confirmation. We need to verify it.',
  },
  {
    key: 'return_pickup',
    label: '退货打包取件',
    text: 'Once the refund is processed, please pack the bike (you can fold it and keep the battery inside the case), take photos of the package, and we will arrange the carrier pick-up for you.',
  },
  { key: 'walmart_store', label: '联系沃尔玛获取', text: 'Did you assemble the bike yourself? Have you contacted the store manager at the Walmart location where it was shipped from?' },
  { key: 'missing_key', label: '钥匙缺失', text: 'Did you assemble the bike yourself? You need to contact the Walmart store manager who sent you the bike to request the missing parts.' },
  {
    key: 'inner_tube',
    label: '内胎购买引导',
    text: 'Your situation is not covered under our warranty. Please refer to the final section of the user manual for warranty terms. Tires are consumable items. Based on your video, the issue appears to be caused by riding conditions. You can purchase a replacement inner tube of the same specification on Amazon or patch the existing one. The size specifications are marked on the outer tire.',
  },
  {
    key: 'registration',
    label: '注册确认',
    text: "We've received your registration info. Could you please provide a copy of your shopping receipt? This helps us process your request smoothly.",
  },
  { key: 'safety_stop', label: '安全警示停用', text: 'This is a serious safety concern. Please do not attempt to charge or use the bicycle until we have had a chance to review the issue.' },
  { key: 'whatsapp', label: 'WhatsApp 引导', text: 'For faster communication, feel free to add us on WhatsApp and we will assist you there.' },
];

export const SNIPPET_SEED: SnippetSeed[] = [
  ...SOPS.map((s, i) => ({
    seedKey: `sop.${s.category}`,
    kind: 'sop' as const,
    label: s.label,
    text: s.steps.join('\n'),
    category: s.category,
    partType: null,
    sortOrder: i * 10,
  })),
  {
    seedKey: 'sop.part.key',
    kind: 'sop',
    label: '钥匙补充',
    text: '索要车辆和钥匙孔照片（钥匙孔照片用于匹配正确钥匙）；邮件中已给钥匙编号则一并确认',
    category: null,
    partType: 'key',
    sortOrder: 500,
  },
  ...QUICK.map((q, i) => ({
    seedKey: `quick.${q.key}`,
    kind: 'quick' as const,
    label: q.label,
    text: q.text,
    category: null,
    partType: null,
    sortOrder: i * 10,
  })),
];
