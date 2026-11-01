// 车型别名对照表：来源飞书表格「车名清单」
// 每行第一项为台账 Model# 选项名（同时也是可匹配别名），其余为别名；
// 别名出现在邮件文本中即命中该选项，多别名命中时取最长别名优先
const MODEL_ALIAS_TABLE: readonly (readonly string[])[] = [
  ['20 URBANFOLD EBIKE', 'URBANFOLD', '23CF2001YD', '20"FOLDING E-BIKE', 'FOLDING', '672402502', '677619099', '6972126040427'],
  ['24IN OZT FS MTB', '23OZ2402PH', '23OZ2401PH', '24" FS.1 EPICTRAIL MTB', '677764447', '671815770', '6972126040489', '6972126041011'],
  // M.3 Ranger+/M.3 Ranger 即 23FR2602YD E-fat tire bike（用户 2026-09-28 确认）
  ['26 FAT E-BIKE', '23FR2602YD', 'FAT', 'M.3 RANGER', '26" FAT TIRE E-BIKE', '672341703', '677766873', '6972126040441', '6972126040984'],
  ['27.5 COMMUTR EBIKE', '22MB2702YD', '22CB2702YD', 'COMMUTR', '27.5M CC E-COMMUTER', '27.5M CC E-STEP THRU', '664710020', '677619101', '6972126040113', '6972126041141'],
  // 27.5 COMMUTR S 与 COMMUTR 共享 22MB2702YD/22CB2702YD/COMMUTR/27.5M CC E-COMMUTER，取先出现的 COMMUTR EBIKE
  ['27.5 COMMUTR S EBIKE', '664710023', '677619100', '6972126040120', '6972126041158'],
  ['27.5 RIDGE LG BIKE', '27.5in Ozark Trail Mountain Bicycle Large', '675626292', '677770295', '24OZL2701PH', '6972126040793', '6972126041165'],
  ['27.5 RIDGE MD BIKE', '27.5in Ozark Trail Mountain Bicycle Medium', '675626291', '677770294', '24OZM2701PH', '6972126040786', '6972126041189'],
  ['27.5 RIDGE SM BIKE', '27.5in Ozark Trail Mountain Bicycle Small', '675626293', '677770296', '24OZS2701PH', '6972126040779', '6972126041172'],
  ['29 FULL SUSPENSION S'],
  ['29 MTB', '29 Full Suspension M Black', '29 Full Suspension', '29 Full Suspension L Gray', '671734536', '677770277', '23OZM2902PH', '6972126040656', '6972126041059', '671734541', '677770282', '23OZS2901PH', '6972126040663', '6972126041042', '671734540', '677770281', '23OZL2902PH', '6972126040687', '6972126041066'],
  ['29 OZT FULL SUSPENSI'],
  ['29 RIDGE PRO BIKE', '29 RIDGE PRO', 'Ridge m.2'],
  ['29 FULL SUSPENSION MD'],
  // 700C ALARIS 别名 ALARIS 同时覆盖 SM 行，取先出现的 BIKE MD
  ['700C ALARIS BIKE MD', '700C ALARIS', 'ALARIS'],
  ['700C ALARIS BIKE SM'],
  ['700C AXIA BIKE'],
  ['700C EXPLR D BIKE MD', '700C Ozark Trail Gravel Bike Medium', 'Gravel Bike', '700C Ozark Trail Gravel Bike Small'],
  ['700C EXPLR D BIKE SM'],
  ['700C EXPLR F BIKE LG', '23HY7003PHL'],
  ['700C EXPLR F BIKE MD'],
  ['700C GRAVEL BIKE', '700 c g.1 explorer'],
  ['700C EXPLR F BIKE S', '700C G.1 Explorer Flat Bar Medium', 'Flat Bar', '700C G.1 Explorer Flat Bar Small', '700C G.1 Explorer Flat Bar Large'],
  ['16 MTB'],
  ['CARGO E-BIKE', '23CC2001YD', 'CARGO'],
  // G.2 Rebel+/Rebel G2 即 OZT 700C E-Gravel 电动瓜车；不带尺码泛别名放先出现的 L 行（与 COMMUTR/ALARIS 先例一致）
  ['OZT 700C E-GRAVEL L', 'E-GRAVEL', 'REBEL G2', 'G.2 REBEL', 'REBELG2', 'REBEL'],
  ['OZT 700C E-GRAVEL M'],
  ['OZT 700C E-GRAVEL S'],
  ['27.5 OZT E-MTB S', 'E-MTB'],
];

function normalizeAliasText(value: string): string {
  return value
    .replace(/["”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function buildAliasRegex(alias: string): RegExp {
  const pattern = alias
    .split(' ')
    .map((token: string) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  const prefix = /^[A-Z0-9]/.test(alias) ? '\\b' : '';
  const suffix = /[A-Z0-9]$/.test(alias) ? '\\b' : '';
  return new RegExp(`${prefix}${pattern}${suffix}`);
}

interface AliasMatcher {
  regex: RegExp;
  option: string;
  aliasLength: number;
}

const ALIAS_MATCHERS: readonly AliasMatcher[] = (() => {
  const seen = new Set<string>();
  const matchers: AliasMatcher[] = [];
  for (const entry of MODEL_ALIAS_TABLE) {
    const option = normalizeAliasText(entry[0]);
    for (const alias of entry) {
      const normalized = normalizeAliasText(alias);
      if (normalized.length < 2 || seen.has(normalized)) continue;
      seen.add(normalized);
      matchers.push({ regex: buildAliasRegex(normalized), option, aliasLength: normalized.length });
    }
  }
  return matchers.sort((a: AliasMatcher, b: AliasMatcher) => b.aliasLength - a.aliasLength);
})();

export function matchBikeModelByAlias(text: string): string {
  const normalized = normalizeAliasText(text);
  if (!normalized) return '';
  for (const matcher of ALIAS_MATCHERS) {
    if (matcher.regex.test(normalized)) return matcher.option;
  }
  return '';
}
