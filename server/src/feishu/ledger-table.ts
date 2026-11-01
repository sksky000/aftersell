import { MODEL_OPTIONS } from './bike-model-aliases';
import { FIELD_TYPES } from './ledger-record';
import { PROBLEM_PART_OPTIONS } from './problem-part';

interface FieldDef {
  field_name: string;
  type: number;
  property?: Record<string, unknown>;
}

const select = (field_name: string, options: readonly string[]): FieldDef => ({
  field_name,
  type: FIELD_TYPES.select,
  property: { options: options.map((name) => ({ name })) },
});
const text = (field_name: string): FieldDef => ({ field_name, type: FIELD_TYPES.text });
const date = (field_name: string): FieldDef => ({ field_name, type: FIELD_TYPES.date, property: { date_formatter: 'yyyy/MM/dd' } });
const money = (field_name: string): FieldDef => ({ field_name, type: FIELD_TYPES.number, property: { formatter: '0.00' } });

/**
 * 台账表结构：与妙搭台账一致。第一列是主键列（只能是文本），放客户姓名。
 * 系统写入的字段见 LEDGER_FIELDS，其余（解决方案、快递单号、费用等）由人工维护。
 */
export const LEDGER_TABLE_FIELDS: FieldDef[] = [
  text('Name'),
  date('Date'),
  text('Email'),
  { field_name: 'Phone#', type: FIELD_TYPES.phone },
  text('Order#'),
  select('Model#', MODEL_OPTIONS),
  text('Serial No.'),
  text('Concern'),
  select('Concern Category', ['Warranty Claim', 'Pre-sales', 'Tech Support', 'Order Tracking/Follow up', 'Return Request', 'Warranty Registration', 'Other']),
  select('Urgent?', ['Yes', 'No']),
  select('Case Status', ['Open', 'Resolved']),
  select('问题部件', PROBLEM_PART_OPTIONS),
  select('是否有视频或者图片', ['是', '否']),
  select('是否到达时损坏', ['是', '否']),
  text('Concern & Reason Analyse (中文)'),
  { field_name: '图片和视频', type: FIELD_TYPES.attachment },
  text('Shipping Address'),
  text('解决方案'),
  date('解决日期'),
  text('责任方'),
  text('Place to buy'),
  date('Date of Purchase'),
  money('客户付款金额'),
  text('DHL快递单号'),
  money('DHL快递费用'),
  text('FEDEX快递号'),
  money('FedEx快递费'),
];
